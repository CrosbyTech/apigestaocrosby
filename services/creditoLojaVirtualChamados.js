// ============================================================================
// CHAMADOS "CRÉDITO LOJA VIRTUAL" DO DRYLAND → CRÉDITO DO CLIENTE NO HEADCOACH
// (Yago, 23/11/2026: "crie um job para olhar a cada 1h esses chamados e gerar os
// créditos automaticamente e fechar o chamado informando que foi gerado")
//
// Quando o separador não acha uma peça de um pedido do site, o Dryland tira a
// peça do pedido e abre um chamado no FINANCEIRO com o assunto
//   "Crédito Loja Virtual · VJ1575 · 53639 não encontrada (CIDADE JARDIM)"
// e o texto
//   "PEÇA NÃO ENCONTRADA NA SEPARAÇÃO — gerar CRÉDITO na LOJA VIRTUAL (nunca no
//    Credev). Pedido: VJ1575 · Loja de origem: … Cliente: Fulana · doc 079… ·
//    tel … Peça: 53639 T-SHIRT … · 1 un × R$ 26,70 = *R$ 26,70* …"
//
// O crédito da loja virtual, no HeadCoach, é o ADIANTAMENTO do cliente na
// empresa 99 — é desse saldo que o Faturamento baixa quando o pedido seguinte
// vem pago com "crédito LV" (services/faturamentoExpedicao.js → mapearFormas).
// Um lançamento por chamado, com a referência "chamado #N": é ela que impede
// gerar duas vezes (igual aos lotes feitos à mão em 13 e 14/11/2026).
//
// Para cada chamado aberto desse tipo:
//   1) lê o texto e confere (pedido e peça batem com o assunto; qtd × preço = total);
//   2) acha o cliente pelo pedido faturado no HeadCoach (o documento tem de bater)
//      ou, sem pedido faturado, pelo CPF/CNPJ no cadastro;
//   3) se ainda não há lançamento "chamado #N", gera o crédito;
//   4) responde no chamado que o crédito foi gerado e conclui.
// Chamado fora do padrão, com dado que não confere ou sem cliente achado NÃO é
// tocado: fica aberto para alguém do Financeiro tratar.
// ============================================================================
import axios from 'axios';
import supabase from '../config/supabase.js';
import { drylandRpc, DRYLAND_URL, DRYLAND_KEY } from '../routes/drylandChamados.routes.js';

export const EMPRESA_CREDITO_LV = 99;
export const TIPO_CREDITO_LV = 'adiantamento';
const AUTOR = 'HeadCoach (automático)';
const r2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const digitos = (v) => String(v || '').replace(/\D/g, '');
const semAcento = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
const numBr = (s) => Number(String(s || '').replace(/\./g, '').replace(',', '.'));

export const ehCreditoLojaVirtual = (assunto) => /^\s*credito loja virtual/.test(semAcento(assunto));

/**
 * Lê o texto padrão do chamado. Devolve { ok:true, pedido, loja, clienteNome, doc,
 * sku, descricao, qtd, unit, total } ou { ok:false, motivo }.
 */
export function lerChamado(assunto, texto) {
  const t = String(texto || '').replace(/\s+/g, ' ').trim();
  const s = semAcento(t);
  if (!/peca nao encontrada na separacao/.test(s) || !/gerar credito na loja virtual/.test(s)) return { ok: false, motivo: 'texto fora do padrão "peça não encontrada na separação"' };
  const pedido = t.match(/Pedido:\s*([A-Z]{1,4}\d+)/i)?.[1]?.toUpperCase() || null;
  const loja = t.match(/Loja de origem:\s*(.+?)\s+Cliente:/i)?.[1]?.trim() || null;
  const cli = t.match(/Cliente:\s*(.+?)\s*·\s*doc\s*([\d.\-/]+)/i);
  const peca = t.match(/Pe[çc]a:\s*(\d+)\s+(.+?)\s*·\s*[^·]*·\s*[^·]*·\s*(\d+)\s*un\s*[×x]\s*R\$\s*([\d.,]+)\s*=\s*\*?\s*R\$\s*([\d.,]+)/i);
  if (!pedido) return { ok: false, motivo: 'não achei o número do pedido no texto' };
  if (!cli) return { ok: false, motivo: 'não achei o cliente e o documento no texto' };
  if (!peca) return { ok: false, motivo: 'não achei a peça, a quantidade e o valor no texto' };
  const out = { ok: true, pedido, loja, clienteNome: cli[1].trim(), doc: digitos(cli[2]), sku: peca[1], descricao: peca[2].trim(), qtd: Number(peca[3]), unit: r2(numBr(peca[4])), total: r2(numBr(peca[5])) };
  if (!(out.qtd > 0) || !(out.unit > 0) || !(out.total > 0)) return { ok: false, motivo: 'quantidade ou valor inválido no texto' };
  if (Math.abs(r2(out.qtd * out.unit) - out.total) > 0.011) return { ok: false, motivo: `a conta do texto não fecha: ${out.qtd} × ${brl(out.unit)} ≠ ${brl(out.total)}` };
  if (![11, 14].includes(out.doc.length)) return { ok: false, motivo: `documento do cliente inválido no texto (${cli[2]})` };
  const a = String(assunto || '').toUpperCase();
  if (!a.includes(out.pedido)) return { ok: false, motivo: `o pedido do texto (${out.pedido}) não é o do assunto` };
  if (!new RegExp(`(^|\\D)${out.sku}(\\D|$)`).test(a)) return { ok: false, motivo: `a peça do texto (${out.sku}) não é a do assunto` };
  return out;
}

/** Cliente do chamado: pelo pedido faturado no HeadCoach (documento tem de bater) ou pelo CPF/CNPJ no cadastro. */
export async function clienteDoChamado({ pedido, doc }) {
  const { data: vendas, error } = await supabase.from('pdv_vendas').select('id, status, cliente_code, cliente_nome, cliente_cpf_cnpj').eq('numero_site', pedido).order('id', { ascending: false });
  if (error) throw new Error(`não consegui ler o pedido ${pedido}: ${error.message}`);
  const comCliente = (vendas || []).filter((v) => v.cliente_code);
  const doPedido = comCliente.find((v) => digitos(v.cliente_cpf_cnpj) === doc);
  if (doPedido) return { code: Number(doPedido.cliente_code), nome: doPedido.cliente_nome, origem: `pedido ${pedido} (transação ${doPedido.id})` };
  if (comCliente.length) return { erro: `o pedido ${pedido} foi faturado para outro documento (${digitos(comCliente[0].cliente_cpf_cnpj) || 'sem documento'}), não para o do chamado (${doc})` };
  const { data: pessoas, error: e2 } = await supabase.from('pes_pessoa').select('code, nm_pessoa, cpf, is_inactive').eq('cpf', doc);
  if (e2) throw new Error(`não consegui ler o cadastro do documento ${doc}: ${e2.message}`);
  const ativos = (pessoas || []).filter((p) => !p.is_inactive);
  const lista = ativos.length ? ativos : pessoas || [];
  if (lista.length === 1) return { code: Number(lista[0].code), nome: lista[0].nm_pessoa, origem: 'cadastro (CPF/CNPJ)' };
  if (lista.length > 1) return { erro: `há ${lista.length} cadastros com o documento ${doc} (códigos ${lista.map((p) => p.code).join(', ')})` };
  return { erro: `o pedido ${pedido} ainda não foi faturado no HeadCoach e não há cadastro com o documento ${doc}` };
}

/** Lançamento já feito para o chamado (referência "chamado #N", sozinha ou junto de outros: "chamado #2177/#2178"). */
export async function lancamentoDoChamado(numero) {
  const { data, error } = await supabase.from('hc_cliente_saldos_mov').select('id, empresa, cliente_code, tipo, movimento, valor, referencia, em').ilike('referencia', `%#${Number(numero)}%`);
  if (error) throw new Error(`não consegui conferir se o chamado #${numero} já teve crédito: ${error.message}`);
  const re = new RegExp(`#${Number(numero)}(\\D|$)`);
  return (data || []).find((m) => /^chamado/i.test(m.referencia || '') && re.test(m.referencia)) || null;
}

/** Lança o crédito (uma vez por chamado). → { jaExistia, valor, saldo } */
export async function lancarCredito({ numero, cliente, tipo = TIPO_CREDITO_LV, empresa = EMPRESA_CREDITO_LV, valor, observacao, por = AUTOR, doc = null }) {
  const antes = await lancamentoDoChamado(numero);
  if (antes) return { jaExistia: true, valor: Number(antes.valor), saldo: null, mov: antes };
  const { data, error } = await supabase.rpc('hc_saldo_movimentar', {
    p_empresa: empresa,
    p_cliente: cliente.code,
    p_tipo: tipo,
    p_valor: r2(valor),
    p_movimento: 'ajuste',
    p_venda: null,
    p_devolucao: null,
    p_referencia: `chamado #${numero}`,
    p_observacao: String(observacao).slice(0, 500),
    p_por: por,
    p_nome: cliente.nome ? String(cliente.nome).slice(0, 200) : null,
    p_doc: doc || null,
  });
  if (error) throw new Error(`não consegui lançar o crédito do chamado #${numero}: ${error.message}`);
  return { jaExistia: false, valor: r2(valor), saldo: Number(data) };
}

/** Responde no chamado (a loja é avisada) e conclui. */
export async function responderEConcluir(chamadoId, texto, por = AUTOR) {
  const m = await drylandRpc('chamado_msg_add', { p_id: chamadoId, p_texto: texto, p_por: por, p_lado: 'setor', p_anexo: null });
  if (!m?.ok) throw new Error(`o Dryland recusou a resposta no chamado: ${m?.mensagem || m?.erro || 'sem motivo'}`);
  try {
    await axios.post(`${DRYLAND_URL}/functions/v1/chamado-avisar`, { chamado_id: chamadoId, texto, mencoes: [] }, { headers: { 'Content-Type': 'application/json', apikey: DRYLAND_KEY, Authorization: `Bearer ${DRYLAND_KEY}` }, timeout: 15000 });
  } catch (e) {
    console.warn(`⚠️ [credito-lv] chamado ${chamadoId}: resposta gravada, mas o aviso à loja falhou (${e.message})`);
  }
  const c = await drylandRpc('chamado_atualizar', { p_id: chamadoId, p_patch: { status: 'concluido', comentario: texto.slice(0, 300) }, p_por: por });
  if (!c?.ok) throw new Error(`o Dryland recusou concluir o chamado: ${c?.mensagem || c?.erro || 'sem motivo'}`);
}

/** Chamados "Crédito Loja Virtual" em aberto no Financeiro. */
export async function chamadosAbertos() {
  const lista = await drylandRpc('chamado_listar', {});
  const todos = Array.isArray(lista) ? lista : lista?.chamados || lista?.data || [];
  return todos.filter((c) => c.setor === 'financeiro' && ehCreditoLojaVirtual(c.assunto) && !['concluido', 'cancelado'].includes(c.status)).sort((a, b) => a.numero - b.numero);
}

/**
 * Passa pelos chamados abertos: gera o crédito, responde e conclui.
 * simular=true só mostra o que faria (nada é gravado, nem aqui nem no Dryland).
 * → { gerados:[], jaTinham:[], pulados:[], erros:[] }
 */
export async function processarChamadosCreditoLv({ simular = false, por = AUTOR, log = () => {} } = {}) {
  const out = { gerados: [], jaTinham: [], pulados: [], erros: [] };
  for (const c of await chamadosAbertos()) {
    const base = { numero: c.numero, id: c.id, assunto: c.assunto };
    try {
      const g = await drylandRpc('chamado_get', { p_id: c.id });
      const lido = lerChamado(c.assunto, g?.chamado?.texto ?? g?.texto);
      if (!lido.ok) {
        out.pulados.push({ ...base, motivo: lido.motivo });
        continue;
      }
      const cliente = await clienteDoChamado(lido);
      if (cliente.erro) {
        out.pulados.push({ ...base, motivo: cliente.erro });
        continue;
      }
      const item = { ...base, pedido: lido.pedido, sku: lido.sku, cliente: cliente.code, clienteNome: cliente.nome, valor: lido.total };
      const antes = await lancamentoDoChamado(c.numero);
      if (simular) {
        (antes ? out.jaTinham : out.gerados).push({ ...item, simulado: true });
        continue;
      }
      const observacao = `Crédito loja virtual: peça ${lido.sku} ${lido.descricao} não encontrada na separação (${lido.loja || 'loja não informada'}) · pedido ${lido.pedido} · ${lido.qtd}x · chamado Dryland #${c.numero}`;
      const r = await lancarCredito({ numero: c.numero, cliente, valor: lido.total, observacao, por, doc: lido.doc });
      const resposta = r.jaExistia
        ? `CRÉDITO GERADO. O crédito de ${brl(r.valor)} deste chamado já estava lançado na Loja Virtual para ${cliente.nome} (cód. ${cliente.code}). Chamado concluído pelo HeadCoach.`
        : `CRÉDITO GERADO. ${brl(lido.total)} de crédito na Loja Virtual para ${cliente.nome} (cód. ${cliente.code}), pela peça ${lido.sku} (${lido.qtd} un) não encontrada no pedido ${lido.pedido}. Lançado automaticamente pelo HeadCoach.`;
      await responderEConcluir(c.id, resposta, por);
      (r.jaExistia ? out.jaTinham : out.gerados).push({ ...item, saldo: r.saldo });
      log(`#${c.numero} ${lido.pedido} · ${cliente.code} ${cliente.nome} · ${brl(lido.total)} ${r.jaExistia ? '(já estava lançado)' : 'gerado'} · concluído`);
    } catch (e) {
      out.erros.push({ ...base, erro: e.message });
    }
  }
  return out;
}
