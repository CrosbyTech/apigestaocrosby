// ============================================================================
// TRANSFERÊNCIA ENTRE LOJAS DO VAREJO (Yago, 19/11/2026)
// Tela /varejo/transferencia-lojas — a própria loja manda mercadoria para outra:
//   • ORIGEM = a loja de quem está logado (owner/admin escolhem qualquer ativa);
//   • DESTINO = uma das lojas ATIVAS (LOJAS_ATIVAS) ou a 99 Brejinho (SO_DESTINO), diferente da origem;
//   • as peças são bipadas com o LEITOR RFID de mesa (a loja não tem portal);
//   • a operação é decidida pela RAIZ DO CNPJ das duas lojas (regra do Yago,
//     19/11/2026 — todas são lojas próprias, então nenhum par fica de fora):
//       MESMA raiz (mesma empresa)   → TRANSFERÊNCIA (CFOP 5152 / 6152, PIS/COFINS 08)
//       raiz DIFERENTE (outra empresa) → VENDA entre empresas, igual à venda normal
//                                        (CFOP 5102 / 6102, PIS/COFINS 01)
//     Ex.: Cidade Jardim (FA MODA) → Ayrton Senna (FERREIRA COMÉRCIO) é VENDA.
//     O número da operação do POP fica só como referência no registro:
//     7272 transferência; 7273 venda entre Crosby e Fábio (nos dois sentidos, como
//     as lojas já faziam no TOTVS); 7280 venda com as empresas dos Irmãos; sem
//     número quando uma das lojas está fora dos grupos do POP (98 Shopping Recife);
//   • a NF-e sai pelo HeadCoach, NA EMPRESA DE ORIGEM, pelo mesmo motor da
//     transferência da matriz (services/transferenciaNota.js → pdvFiscal.js).
//     Gabarito conferido nas notas que as lojas emitiam no TOTVS (2, 5, 55, 65,
//     87, 93, 94, 95, 97 — tmp/hcapi/tv_gabarito.mjs): mercadoria sempre
//     "adquirida ou recebida de terceiros", ICMS 00 cheio (interna do estado ou
//     12% interestadual), sem pagamento (tPag 90) e sem frete;
//   • nada vai ao TOTVS. A transferência fica em pdv_vendas (canal
//     'transferencia' → aparece em HeadCoach › Transações) e em
//     transferencias_transacoes (→ aparece em Recebimento de Transferência da
//     loja de destino assim que a nota é autorizada).
// Só emite a loja que tem configuração fiscal no HeadCoach (pdv_fiscal_config).
// As lojas do Simples Nacional (5 e 55, empresas dos Irmãos) emitem desde 25/11/2026:
// a nota sai com CRT 1 e ICMSSN101, sem ICMS destacado (pdvFiscal.js › SIMPLES_POR_RAIZ).
// ============================================================================
import axios from 'axios';
import supabase from '../config/supabase.js';
import { getToken } from '../utils/totvsTokenManager.js';
import { httpsAgent, httpAgent, TOTVS_BASE_URL } from '../totvsrouter/totvsHelper.js';
import { TransferenciaError, raizCnpj, GRUPOS_POP, OPERACOES_POP } from './transferenciasMercadoria.js';
import { processarTransferenciaNota } from './transferenciaNota.js';
import { buscarEmitente, buscarClienteFiscal, buscarProdutoFiscal, buscarConfig, cenarioExpedicao, cfopTransferencia } from './pdvFiscal.js';
import { registrarEpcs } from '../routes/pdvCrosby.routes.js';
import { empresasRestritasDoUsuario } from '../utils/empresasUsuario.js';

/** Lojas do varejo que estão ativas (Yago, 19/11/2026). A 90 (Ayrton Senna) entrou no mesmo dia,
 * pelo exemplo que ele deu ao corrigir a regra (Cidade Jardim → Ayrton Senna). A 88 (Shopping
 * Guararapes) entrou em 23/11/2026: a Cidade Jardim não a encontrava para transferir. */
export const LOJAS_ATIVAS = [2, 5, 55, 65, 87, 88, 90, 93, 94, 95, 97, 98];
/** Só DESTINO: a 99 (Brejinho) recebe mercadoria de todas as lojas (Yago, 25/11/2026: a Cidade Jardim
 * não a encontrava). Ela não é origem por aqui — o que sai dela vai por Expedição › Transferências. */
export const SO_DESTINO = [99];

// raízes de CNPJ das empresas dos Irmãos (Irmãos CR e Irmãos Varejo): são do Simples Nacional
// (conferido nos XML das notas do TOTVS em 19/11/2026) e, no POP, a venda com elas é a 7280
const RAIZES_IRMAOS = ['33592092', '53661116'];

const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const hojeBrasil = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Recife' }).format(new Date());
const quem = (user) => user?.name || user?.email || null;
const NATUREZA_NOME = { transferencia: 'Transferência entre lojas', venda: 'Venda de mercadoria entre empresas' };

// ─── lojas ───────────────────────────────────────────────────────────────────
let cacheLojas = null;
let cacheLojasEm = 0;
// todas as lojas da tela (as ativas + as que são só destino), com `soDestino` marcado
async function lojasDaTela() {
  if (cacheLojas && Date.now() - cacheLojasEm < 10 * 60 * 1000) return cacheLojas;
  const { data, error } = await supabase.from('erp_empresas').select('code, descricao, fantasia, cnpj, person_code, uf, cidade, ie').in('code', [...LOJAS_ATIVAS, ...SO_DESTINO]).order('code');
  if (error) throw new TransferenciaError(`Não consegui ler as lojas: ${error.message}`, 'DB_ERROR', 500);
  cacheLojas = (data || []).map((e) => ({
    code: Number(e.code),
    nome: e.fantasia || e.descricao || `Empresa ${e.code}`,
    cnpj: String(e.cnpj || '').replace(/\D/g, ''),
    raiz: raizCnpj(e.cnpj),
    grupo: GRUPOS_POP[raizCnpj(e.cnpj)] || null,
    uf: e.uf || null,
    cidade: e.cidade || null,
    personCode: Number(e.person_code) || null,
    soDestino: SO_DESTINO.includes(Number(e.code)),
  }));
  cacheLojasEm = Date.now();
  return cacheLojas;
}
/** Lojas que ENVIAM por esta tela. */
export async function lojasAtivas() {
  return (await lojasDaTela()).filter((l) => !l.soDestino);
}
/** Lojas que podem RECEBER: as ativas + a 99 (Brejinho). */
export async function lojasDeDestino() {
  return lojasDaTela();
}

/**
 * Regra da operação entre duas lojas, pela raiz do CNPJ (Yago, 19/11/2026):
 * mesma raiz → transferência; raiz diferente → venda entre empresas. Só não deixa
 * a loja transferir para ela mesma.
 * → { permitido, natureza: 'transferencia'|'venda', operacao: 7272|7273|7280|null, descricao, aplicacao, motivo }
 */
export function regraEntreLojas(origem, destino) {
  if (!origem || !destino) return { permitido: false, motivo: 'Escolha a loja de origem e a de destino' };
  if (origem.code === destino.code) return { permitido: false, motivo: 'A loja de destino é a própria origem' };
  const grupoOrigem = GRUPOS_POP[origem.raiz] || null;
  const grupoDestino = GRUPOS_POP[destino.raiz] || null;
  if (origem.raiz === destino.raiz) {
    const operacao = grupoOrigem ? 7272 : null;
    return {
      permitido: true,
      natureza: 'transferencia',
      operacao,
      descricao: operacao ? OPERACOES_POP[operacao] : 'TRANSFERÊNCIA ENTRE LOJAS DA MESMA EMPRESA',
      aplicacao: `As duas lojas são da mesma empresa${grupoOrigem ? ` (${grupoOrigem})` : ''}: transferência`,
      grupoOrigem,
      grupoDestino,
    };
  }
  // empresas diferentes: a mercadoria vai por VENDA, como uma venda normal entre empresas
  const foraDoPop = !grupoOrigem || !grupoDestino;
  const operacao = foraDoPop ? null : RAIZES_IRMAOS.includes(origem.raiz) || RAIZES_IRMAOS.includes(destino.raiz) ? 7280 : 7273;
  return {
    permitido: true,
    natureza: 'venda',
    operacao,
    foraDoPop,
    descricao: operacao ? OPERACOES_POP[operacao] : 'VENDA ENTRE EMPRESAS',
    aplicacao: `Empresas diferentes (${grupoOrigem || origem.nome} → ${grupoDestino || destino.nome}): a mercadoria vai por venda`,
    grupoOrigem,
    grupoDestino,
  };
}

// por que a loja (ainda) não emite a NF-e pelo HeadCoach; null = emite
async function impedimentoFiscal(loja) {
  // (até 25/11/2026 as lojas do Simples Nacional — 5 e 55 — eram recusadas aqui: o motor de
  // NF-e só montava o regime normal. Agora a nota delas sai com CRT 1 e ICMSSN101.)
  try {
    await buscarConfig(loja.code);
  } catch (e) {
    return e.code === 'CONFIG_MISSING'
      ? `A loja ${loja.code} — ${loja.nome} ainda não tem a configuração fiscal no HeadCoach (série e numeração da NF-e). Peça ao financeiro para liberar.`
      : e.message;
  }
  return null;
}

/** Lojas de origem que o usuário pode usar e as lojas de destino. */
export async function contextoVarejo(user) {
  const lojas = await lojasAtivas();
  const restritas = await empresasRestritasDoUsuario(user);
  const minhas = restritas ? lojas.filter((l) => restritas.includes(l.code)) : lojas;
  const origens = await Promise.all(minhas.map(async (l) => ({ ...l, impedimento: await impedimentoFiscal(l) })));
  return { origens, destinos: await lojasDeDestino(), todasAsLojas: !restritas };
}

async function lojasDoPar(user, origemCode, destinoCode) {
  const lojas = await lojasAtivas();
  const origem = lojas.find((l) => l.code === Number(origemCode));
  const destino = (await lojasDeDestino()).find((l) => l.code === Number(destinoCode));
  if (!origem) throw new TransferenciaError('Loja de origem inválida: só as lojas ativas transferem por aqui', 'ORIGEM_INVALIDA');
  if (!destino) throw new TransferenciaError('Loja de destino inválida: escolha uma das lojas ativas', 'DESTINO_INVALIDO');
  const restritas = await empresasRestritasDoUsuario(user);
  if (restritas && !restritas.includes(origem.code)) throw new TransferenciaError(`Você não tem acesso à loja ${origem.code} — ${origem.nome}`, 'SEM_ACESSO', 403);
  const regra = regraEntreLojas(origem, destino);
  return { origem, destino, regra };
}

// emitente, destinatário e cenário fiscal do par (lança com mensagem clara do que falta)
async function fiscalDoPar(origem, destino, regra) {
  const impedimento = await impedimentoFiscal(origem);
  if (impedimento) throw new TransferenciaError(impedimento, 'ORIGEM_SEM_FISCAL', 422);
  if (!destino.personCode) throw new TransferenciaError(`A loja ${destino.code} — ${destino.nome} está sem o cadastro de pessoa no TOTVS`, 'DESTINO_SEM_PESSOA', 422);
  const [emit, cliente, cfg] = await Promise.all([buscarEmitente(origem.code), buscarClienteFiscal(destino.personCode), buscarConfig(origem.code)]);
  if (!cliente) throw new TransferenciaError(`A loja de destino (${destino.nome}) não foi encontrada no cadastro de pessoas do TOTVS`, 'DESTINO_NAO_ENCONTRADO', 404);
  const cen = cenarioExpedicao({ emitUf: emit.uf, cliente });
  const pendencias = [];
  if (!cliente.cnpj) pendencias.push(`A loja de destino (${destino.nome}) está sem CNPJ no cadastro do TOTVS.`);
  if (!cliente.endereco?.cMun || !cliente.endereco?.UF) pendencias.push(`A loja de destino (${destino.nome}) está sem endereço completo no TOTVS.`);
  if (!cen.contribuinte) pendencias.push(`A loja de destino (${destino.nome}) está sem inscrição estadual no TOTVS.`);
  const cfop = cen.contribuinte && regra.permitido ? cfopTransferencia(cen.chave, 'adquirido', regra.natureza) : null;
  return { emit, cliente, cfg, cen, cfop, pendencias };
}

/** O que a tela mostra depois de escolher origem e destino. */
export async function prepararVarejo(user, { origem: o, destino: d } = {}) {
  const { origem, destino, regra } = await lojasDoPar(user, o, d);
  const base = { origem, destino, regra, naturezaNome: regra.permitido ? NATUREZA_NOME[regra.natureza] : null };
  if (!regra.permitido) return { ...base, pendencias: [regra.motivo], podeTransferir: false };
  const f = await fiscalDoPar(origem, destino, regra);
  return {
    ...base,
    cfop: f.cfop,
    cenario: f.cen.interestadual ? `Para outro estado (${f.emit.uf} → ${f.cen.destUf}) · ICMS 12%` : `Dentro de ${f.emit.uf} · ICMS interno`,
    numeracao: { serie: f.cfg.serie_nfe, ambiente: f.cfg.ambiente },
    destinoFiscal: { razao: f.cliente.nome, cnpj: f.cliente.cnpj, ie: f.cliente.ie || null, uf: f.cliente.endereco?.UF || null, cidade: f.cliente.endereco?.xMun || null },
    pendencias: f.pendencias,
    podeTransferir: f.pendencias.length === 0,
  };
}

// ─── numeração da NF-e ───────────────────────────────────────────────────────
// O acerto normal (faturamentoExpedicao.acertarNumeracao) olha os últimos 20 dias
// do TOTVS. Loja que nunca emitiu NF-e pelo HeadCoach pode ter a série parada há
// mais tempo lá: na 1ª nota, procura mês a mês (até 6) a última NF-e da série no
// TOTVS e continua dela. Uma vez por loja enquanto o servidor estiver no ar.
const numeracaoConferida = new Set();
async function conferirNumeracaoAntiga(empresa) {
  if (numeracaoConferida.has(empresa)) return null;
  const cfg = await buscarConfig(empresa);
  const { data: jaEmitiu } = await supabase.from('pdv_notas_fiscais').select('id').eq('empresa', empresa).eq('modelo', 55).eq('serie', cfg.serie_nfe).eq('status', 'autorizada').limit(1);
  if ((jaEmitiu || []).length) {
    numeracaoConferida.add(empresa);
    return null;
  }
  const tk = await getToken();
  const headers = { Authorization: `Bearer ${tk.access_token}` };
  const dia = (d) => d.toISOString().slice(0, 10);
  let fim = new Date();
  let max = 0;
  for (let mes = 0; mes < 6 && !max; mes += 1) {
    const ini = new Date(fim.getTime() - 30 * 86400000);
    for (let page = 1; page <= 40; page += 1) {
      const r = await axios.post(
        `${TOTVS_BASE_URL}/fiscal/v2/invoices/search`,
        { filter: { branchCodeList: [Number(empresa)], operationType: 'Output', startIssueDate: `${dia(ini)}T00:00:00.000Z`, endIssueDate: `${dia(fim)}T23:59:59.999Z` }, page, pageSize: 100 },
        { headers, httpsAgent, httpAgent, timeout: 120000 },
      );
      for (const n of r.data?.items || []) {
        if (Number(n.documentType) === 55 && String(n.serialCode) === String(cfg.serie_nfe) && n.origin === 'Own') max = Math.max(max, Number(n.invoiceCode) || 0);
      }
      if (!r.data?.hasNext) break;
    }
    fim = new Date(ini.getTime() - 86400000);
  }
  numeracaoConferida.add(empresa);
  if (max >= Number(cfg.prox_num_nfe)) {
    await supabase.from('pdv_fiscal_config').update({ prox_num_nfe: max + 1 }).eq('empresa', empresa);
    console.log(`🔢 [transferência varejo] empresa ${empresa} série ${cfg.serie_nfe}: o TOTVS já usou até ${max} → próxima NF-e do HeadCoach ${max + 1}`);
    return { proximo: max + 1, ultimaTotvs: max };
  }
  return null;
}

/**
 * Grava a transferência e emite a NF-e pela loja de origem.
 * body: { origem, destino, vendedorCode, vendedorNome, observacao,
 *         itens: [{ productCode, quantidade, valorUnit, nome, epcs: [] }] }
 */
export async function transferirVarejo(user, b = {}) {
  if (!Number(b.vendedorCode)) throw new TransferenciaError('Escolha quem está fazendo a transferência (vendedor)', 'SEM_VENDEDOR');
  if (!Array.isArray(b.itens) || !b.itens.length) throw new TransferenciaError('Nenhuma peça lida', 'SEM_ITENS');
  const { origem, destino, regra } = await lojasDoPar(user, b.origem, b.destino);
  if (!regra.permitido) throw new TransferenciaError(regra.motivo, 'PAR_INVALIDO', 422);
  const { emit, cliente, cen, pendencias } = await fiscalDoPar(origem, destino, regra);
  if (pendencias.length) throw new TransferenciaError(pendencias.join(' '), 'DESTINO_INCOMPLETO', 422);

  // a mesma etiqueta não entra duas vezes
  const vistas = new Set();
  for (const it of b.itens) {
    for (const e of Array.isArray(it.epcs) ? it.epcs : []) {
      const k = String(e).trim().toUpperCase();
      if (vistas.has(k)) throw new TransferenciaError(`A etiqueta ${k} está repetida na transferência`, 'EPC_REPETIDO');
      vistas.add(k);
    }
  }

  const itens = [];
  let seq = 1;
  for (const it of b.itens) {
    const q = Number(it.quantidade);
    const vUn = round2(it.valorUnit);
    if (!(q > 0) || !Number.isInteger(q)) throw new TransferenciaError(`Peça ${it.productCode}: quantidade inválida`, 'ITEM_INVALIDO');
    if (!(vUn > 0)) throw new TransferenciaError(`Peça ${it.productCode}${it.nome ? ` (${it.nome})` : ''} está sem preço: a nota não sai com valor zero`, 'ITEM_SEM_PRECO');
    const epcs = (Array.isArray(it.epcs) ? it.epcs : []).map((e) => String(e).trim().toUpperCase()).filter(Boolean);
    if (epcs.length > q) throw new TransferenciaError(`Peça ${it.productCode}: mais etiquetas do que peças`, 'ITEM_INVALIDO');
    const pf = await buscarProdutoFiscal(it.productCode, origem.code);
    itens.push({
      seq: seq++,
      product_code: Number(it.productCode),
      sku: pf.sku,
      nome: String(pf.nome || it.nome || `Produto ${it.productCode}`).slice(0, 200),
      referencia: pf.referencia,
      ncm: pf.ncm,
      cest: pf.cest,
      origem: pf.origem,
      unidade: pf.unidade,
      quantidade: q,
      valor_unit: vUn,
      desconto_unit: 0,
      total: round2(q * vUn),
      epcs,
      // loja não produz: a mercadoria é sempre adquirida ou recebida de terceiros (5152/6152 · 5102/6102)
      tipo_fiscal: 'adquirido',
      cfop: cfopTransferencia(cen.chave, 'adquirido', regra.natureza),
    });
  }
  const total = round2(itens.reduce((s, i) => s + i.total, 0));
  const qtd = itens.reduce((s, i) => s + i.quantidade, 0);
  const por = quem(user) || b.por || null;

  const { data: venda, error } = await supabase
    .from('pdv_vendas')
    .insert({
      empresa: origem.code,
      empresa_cnpj: emit.cnpj,
      empresa_nome: emit.xNome,
      tipo_venda: 'nfe',
      operacao: null,
      cliente_code: cliente.code,
      cliente_nome: cliente.nome,
      cliente_cpf_cnpj: cliente.cnpj,
      vendedor_code: Number(b.vendedorCode),
      vendedor_nome: b.vendedorNome || null,
      qtd_pecas: qtd,
      subtotal: total,
      desconto: 0,
      cashback_usado: 0,
      total,
      status: 'registrada',
      observacao: String(b.observacao || '').trim() || null,
      criado_por: por,
      origem: 'expedicao',
      canal: 'transferencia',
      pedido_chave: null,
      numero_site: null,
      data_caixa: hojeBrasil(),
      operacao_doc_interno: null,
      frete: 0,
      transporte: null,
      cobranca: null,
      comprovantes: [],
      pedido_info: {
        transferencia: { natureza: regra.natureza, ref: null, solicitacaoId: null, destinoCode: destino.code, destinoNome: destino.nome, operacaoNota: regra.operacao, varejo: true, origemCode: origem.code },
      },
    })
    .select()
    .single();
  if (error) throw new TransferenciaError(error.message, 'DB_ERROR', 500);
  const { data: itensGravados, error: e1 } = await supabase.from('pdv_venda_itens').insert(itens.map((i) => ({ ...i, venda_id: venda.id }))).select();
  if (e1) {
    await supabase.from('pdv_vendas').delete().eq('id', venda.id);
    throw new TransferenciaError(e1.message, 'DB_ERROR', 500);
  }
  await registrarEpcs({ venda, itens: itensGravados || [], tipo: 'venda' });

  // registro que a loja de destino enxerga em Recebimento de Transferência
  const { error: e2 } = await supabase.from('transferencias_transacoes').insert({
    transferencia_id: null,
    empresa: origem.code,
    empresa_destino: destino.code,
    empresa_totvs: null,
    venda_id: venda.id,
    natureza: regra.natureza,
    transacao_code: null,
    transacao_status: 1,
    operacao: regra.operacao,
    cfop: itens[0]?.cfop || null,
    total,
    qtd_pecas: qtd,
    qtd_epcs: itens.reduce((s, i) => s + i.epcs.length, 0),
    qtd_faltando: 0,
    qtd_sobrando: 0,
    cliente_code: cliente.code,
    cliente_nome: destino.nome,
    vendedor_code: Number(b.vendedorCode),
    vendedor_nome: b.vendedorNome || null,
    itens: itens.map((i) => ({ productCode: i.product_code, name: i.nome, quantidade: i.quantidade, unit: i.valor_unit, total: i.total, cfop: i.cfop, epcs: i.epcs })),
    criado_por: por,
  });
  if (e2) console.warn(`⚠️ [transferência varejo] venda ${venda.id}: não gravei o registro para a loja de destino: ${e2.message}`);
  console.log(`🔁 [transferência varejo] ${origem.code} ${origem.nome} → ${destino.code} ${destino.nome} · ${qtd} pç · R$ ${total.toFixed(2)} · ${regra.natureza}${regra.operacao ? ` (POP ${regra.operacao})` : ''} · venda ${venda.id} · ${por || '—'}`);

  try {
    await conferirNumeracaoAntiga(origem.code);
  } catch (e) {
    console.warn(`⚠️ [transferência varejo] não conferi a numeração antiga da empresa ${origem.code}: ${e.message}`);
  }
  const r = await processarTransferenciaNota(venda.id);
  return { ...r, origem, destino, regra, registroDestino: !e2 };
}

/** Últimas transferências que saíram das lojas do usuário (para acompanhar e tentar de novo). */
export async function ultimasDoVarejo(user, { origem = null, limite = 30 } = {}) {
  const lojas = await lojasAtivas();
  const restritas = await empresasRestritasDoUsuario(user);
  let codes = (restritas ? lojas.filter((l) => restritas.includes(l.code)) : lojas).map((l) => l.code);
  if (origem) codes = codes.filter((c) => c === Number(origem));
  if (!codes.length) return [];
  const { data, error } = await supabase
    .from('transferencias_transacoes')
    .select('id, empresa, empresa_destino, venda_id, natureza, operacao, cfop, total, qtd_pecas, qtd_epcs, cliente_nome, vendedor_nome, nf_numero, nf_serie, nf_chave, nf_status, nota_id, transacao_status, criado_por, criado_em')
    .in('empresa', codes)
    .not('venda_id', 'is', null)
    .order('id', { ascending: false })
    .limit(Math.min(100, Number(limite) || 30));
  if (error) throw new TransferenciaError(error.message, 'DB_ERROR', 500);
  const nome = Object.fromEntries(lojas.map((l) => [l.code, l.nome]));
  const ids = (data || []).map((t) => t.id);
  const { data: recs } = ids.length ? await supabase.from('hc_recebimentos_transferencia').select('transferencia_transacao_id, recebido_em, cancelado_em').in('transferencia_transacao_id', ids) : { data: [] };
  const recebida = new Map((recs || []).filter((r) => !r.cancelado_em).map((r) => [r.transferencia_transacao_id, r.recebido_em]));
  return (data || []).map((t) => ({
    id: t.id,
    vendaId: t.venda_id,
    origem: { code: t.empresa, nome: nome[t.empresa] || null },
    destino: { code: t.empresa_destino, nome: nome[t.empresa_destino] || t.cliente_nome || null },
    natureza: t.natureza,
    operacao: t.operacao,
    total: Number(t.total) || 0,
    qtdPecas: Number(t.qtd_pecas) || 0,
    nf: t.nf_numero ? { id: t.nota_id, numero: t.nf_numero, serie: t.nf_serie, chave: t.nf_chave, status: t.nf_status } : { id: null, numero: null, status: t.nf_status || 'pendente' },
    situacao: t.nf_status === 'cancelada' || Number(t.transacao_status) === 6 ? 'cancelada' : t.nf_status === 'autorizada' ? (recebida.has(t.id) ? 'recebida' : 'a_receber') : 'nota_pendente',
    recebidaEm: recebida.get(t.id) || null,
    vendedor: t.vendedor_nome || null,
    criadoPor: t.criado_por || null,
    criadoEm: t.criado_em,
  }));
}
