// ============================================================================
// RECEBIMENTO DE MERCADORIA TRANSFERIDA + ESTOQUE DAS LOJAS (Yago, 13/11/2026)
//
// As transferências feitas na tela Transferências (matriz → lojas) ficam em
// transferencias_transacoes, com as peças e as etiquetas (EPC) de cada uma.
// A loja de destino vê as que foram para ela, clica em RECEBER MERCADORIA,
// confere (leitor RFID; peça sem etiqueta por quantidade) e finaliza:
//   • o recebimento fica em hc_recebimentos_transferencia (uma vez só por
//     transferência), com o que veio, o que faltou e o que chegou de fora;
//   • as peças recebidas ENTRAM NO ESTOQUE da loja (hc_estoque_movimentos,
//     uma linha por etiqueta; sem etiqueta, uma linha com a quantidade) e cada
//     etiqueta fica registrada na loja (hc_estoque_epcs);
//   • a solicitação (se houver) vai para concluída, mercadoria no destino.
// Por enquanto o estoque é só isso (pedido do Yago); depois ganha vendas,
// devoluções etc. Tabelas: migrations/hc_estoque_recebimento.sql.
// Quem vê/recebe: quem tem acesso à empresa de destino (mesma regra do caixa:
// owner/admin todas as próprias; os demais, as vinculadas).
// ============================================================================
import supabase from '../config/supabase.js';
import { empresasDoUsuario } from './hcCaixa.js';

export class RecebimentoError extends Error {
  constructor(message, code = 'RECEBIMENTO', status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const quem = (user) => user?.name || user?.email || null;
const normEpc = (e) => String(e || '').trim().toUpperCase();

function falhaDb(error) {
  if (/relation .* does not exist|could not find the table|schema cache|column .* does not exist/i.test(String(error?.message || ''))) {
    return new RecebimentoError('O recebimento de mercadoria ainda não está liberado: faltam as tabelas no banco. Rode "node scripts/migrar-hc-estoque-recebimento.mjs" na pasta da API.', 'MIGRATION_PENDING', 503);
  }
  return new RecebimentoError(error?.message || 'Erro no banco', 'DB_ERROR', 500);
}
async function q(promessa) {
  const { data, error } = await promessa;
  if (error) throw falhaDb(error);
  return data;
}
async function todas(montar) {
  const out = [];
  for (let de = 0; ; de += 1000) {
    const lote = await q(montar().range(de, de + 999));
    out.push(...(lote || []));
    if (!lote || lote.length < 1000) break;
  }
  return out;
}
async function empresasPermitidas(user, empresa) {
  const lista = await empresasDoUsuario(user);
  if (empresa) {
    const n = Number(empresa);
    if (!lista.some((e) => e.code === n)) throw new RecebimentoError(`Você não tem acesso à empresa ${n}`, 'SEM_ACESSO_EMPRESA', 403);
    return { lista, codes: [n] };
  }
  return { lista, codes: lista.map((e) => e.code) };
}

// transferência que já saiu: nota autorizada (99 pelo HeadCoach) ou transação atendida no TOTVS
const saiu = (t) => (t.venda_id ? t.nf_status === 'autorizada' : Number(t.transacao_status) === 4);
const cancelada = (t) => t.nf_status === 'cancelada' || Number(t.transacao_status) === 6;
const esperadoDe = (itens) => (itens || []).reduce((s, i) => s + (Number(i.quantidade) || 0), 0);

const CAMPOS_TRX =
  'id, transferencia_id, empresa, empresa_destino, transacao_code, transacao_status, venda_id, nf_numero, nf_serie, nf_chave, nf_status, natureza, total, qtd_pecas, qtd_epcs, cliente_nome, criado_por, criado_em, itens';

/** Transferências para as lojas do usuário: a receber e recebidas. */
export async function listarTransferencias(user, f = {}) {
  const { lista, codes } = await empresasPermitidas(user, f.empresa);
  if (!codes.length) return { empresas: lista, transferencias: [] };
  const trx = await todas(() => supabase.from('transferencias_transacoes').select(CAMPOS_TRX).in('empresa_destino', codes).order('id', { ascending: false }));
  const validas = trx.filter((t) => saiu(t) && !cancelada(t));
  const recs = new Map();
  for (let i = 0; i < validas.length; i += 200) {
    const ids = validas.slice(i, i + 200).map((t) => t.id);
    const rs = await q(supabase.from('hc_recebimentos_transferencia').select('id, transferencia_transacao_id, qtd_esperada, qtd_recebida, qtd_faltando, qtd_fora, recebido_por, recebido_em').in('transferencia_transacao_id', ids));
    for (const r of rs || []) recs.set(Number(r.transferencia_transacao_id), r);
  }
  const nomes = Object.fromEntries(lista.map((e) => [e.code, e.nome]));
  const transferencias = validas.map((t) => {
    const r = recs.get(Number(t.id)) || null;
    const { itens, ...resto } = t;
    return {
      ...resto,
      empresa_destino_nome: nomes[t.empresa_destino] || t.cliente_nome || null,
      qtd_esperada: esperadoDe(itens),
      qtd_itens: (itens || []).length,
      recebimento: r,
      situacao: !r ? 'a_receber' : r.qtd_faltando > 0 || r.qtd_fora > 0 ? 'recebida_divergencia' : 'recebida',
    };
  });
  return { empresas: lista, transferencias };
}

/** Uma transferência com as peças (para conferir) e o recebimento, se já houver. */
export async function detalheTransferencia(user, id) {
  const t = await q(supabase.from('transferencias_transacoes').select(CAMPOS_TRX).eq('id', Number(id)).maybeSingle());
  if (!t) throw new RecebimentoError('Transferência não encontrada', 'NOT_FOUND', 404);
  const { lista } = await empresasPermitidas(user, t.empresa_destino);
  const recebimento = await q(supabase.from('hc_recebimentos_transferencia').select('*').eq('transferencia_transacao_id', t.id).maybeSingle());
  const itens = (t.itens || []).map((i) => ({
    productCode: Number(i.productCode),
    name: i.name || null,
    quantidade: Number(i.quantidade) || 0,
    unit: Number(i.unit) || 0,
    epcs: (i.epcs || []).map(normEpc).filter(Boolean),
  }));
  return {
    transferencia: { ...t, itens, empresa_destino_nome: lista.find((e) => e.code === Number(t.empresa_destino))?.nome || t.cliente_nome, qtd_esperada: esperadoDe(itens), saiu: saiu(t), cancelada: cancelada(t) },
    recebimento: recebimento || null,
  };
}

/**
 * Finaliza o recebimento: { epcs: [lidos], manuais: { productCode: qtd }, observacao }.
 * Peça com etiqueta entra pela etiqueta lida; sem etiqueta (ou etiqueta que não
 * leu), pela quantidade informada — nunca mais do que foi transferido.
 */
// entrada no estoque da loja a partir do recebimento gravado
async function lancarNoEstoque(rec, porNome) {
  const empresa = Number(rec.empresa);
  const movs = [];
  const epcsRows = [];
  for (const i of rec.itens || []) {
    for (const e of i.epcsRecebidos || []) {
      movs.push({ empresa, product_code: i.productCode, nome: i.name, quantidade: 1, epc: e, tipo: 'recebimento_transferencia', recebimento_id: rec.id, por: porNome });
      epcsRows.push({ epc: e, empresa, product_code: i.productCode, nome: i.name, recebimento_id: rec.id, entrou_em: new Date().toISOString() });
    }
    if (i.manual > 0) movs.push({ empresa, product_code: i.productCode, nome: i.name, quantidade: i.manual, epc: null, tipo: 'recebimento_transferencia', recebimento_id: rec.id, por: porNome });
  }
  for (let k = 0; k < movs.length; k += 500) await q(supabase.from('hc_estoque_movimentos').insert(movs.slice(k, k + 500)));
  for (let k = 0; k < epcsRows.length; k += 500) await q(supabase.from('hc_estoque_epcs').upsert(epcsRows.slice(k, k + 500), { onConflict: 'epc' }));
  return movs.length;
}

export async function receberTransferencia(user, id, b = {}) {
  const { transferencia: t, recebimento: ja } = await detalheTransferencia(user, id);
  if (ja) {
    // recebimento gravado mas a entrada no estoque não terminou (queda no meio): completa
    const { count } = await supabase.from('hc_estoque_movimentos').select('id', { count: 'exact', head: true }).eq('recebimento_id', ja.id);
    if (count === 0 && Number(ja.qtd_recebida) > 0) {
      await lancarNoEstoque(ja, ja.recebido_por);
      return ja;
    }
    throw new RecebimentoError(`Esta transferência já foi recebida por ${ja.recebido_por || '—'}`, 'JA_RECEBIDA', 409);
  }
  if (t.cancelada) throw new RecebimentoError('Esta transferência foi cancelada', 'CANCELADA', 409);
  if (!t.saiu) throw new RecebimentoError('A nota desta transferência ainda não foi autorizada', 'NAO_SAIU', 409);
  const lidos = new Set((Array.isArray(b.epcs) ? b.epcs : []).map(normEpc).filter(Boolean));
  const manuais = b.manuais && typeof b.manuais === 'object' ? b.manuais : {};
  const daTransferencia = new Set();
  const itens = t.itens.map((i) => {
    for (const e of i.epcs) daTransferencia.add(e);
    const epcsRecebidos = i.epcs.filter((e) => lidos.has(e));
    const resto = Math.max(0, i.quantidade - epcsRecebidos.length);
    const manual = Math.min(resto, Math.max(0, parseInt(manuais[String(i.productCode)] ?? manuais[i.productCode] ?? 0, 10) || 0));
    const recebido = epcsRecebidos.length + manual;
    return {
      productCode: i.productCode,
      name: i.name,
      esperado: i.quantidade,
      recebido,
      manual,
      epcsRecebidos,
      epcsFaltando: i.epcs.filter((e) => !lidos.has(e)),
    };
  });
  const fora = [...lidos].filter((e) => !daTransferencia.has(e));
  const qtdRecebida = itens.reduce((s, i) => s + i.recebido, 0);
  if (!qtdRecebida) throw new RecebimentoError('Nenhuma peça conferida: leia as etiquetas ou informe a quantidade');
  const qtdFaltando = itens.reduce((s, i) => s + (i.esperado - i.recebido), 0);
  const observacao = String(b.observacao || '').trim() || null;
  if ((qtdFaltando > 0 || fora.length) && (!observacao || observacao.length < 3)) {
    throw new RecebimentoError('Faltou peça ou chegou peça de fora: escreva uma observação explicando antes de finalizar', 'PEDE_OBSERVACAO');
  }
  const { data: rec, error } = await supabase
    .from('hc_recebimentos_transferencia')
    .insert({
      transferencia_transacao_id: t.id,
      transferencia_id: t.transferencia_id || null,
      empresa: Number(t.empresa_destino),
      empresa_origem: Number(t.empresa),
      venda_id: t.venda_id || null,
      nf_numero: t.nf_numero || null,
      qtd_esperada: t.qtd_esperada,
      qtd_recebida: qtdRecebida,
      qtd_faltando: qtdFaltando,
      qtd_fora: fora.length,
      itens,
      fora,
      observacao,
      recebido_por_id: user?.id || null,
      recebido_por: quem(user),
    })
    .select()
    .single();
  if (error) {
    if (/duplicate key|transferencia_transacao_id/i.test(error.message)) throw new RecebimentoError('Esta transferência acabou de ser recebida por outra pessoa', 'JA_RECEBIDA', 409);
    throw falhaDb(error);
  }
  // entrada no estoque da loja
  const empresa = Number(t.empresa_destino);
  await lancarNoEstoque(rec, quem(user));
  // a solicitação acompanha: mercadoria no destino
  if (t.transferencia_id) {
    await supabase
      .from('transferencias_mercadoria')
      .update({ status: 'concluida', local: 'destino', local_por: quem(user), local_em: new Date().toISOString(), atualizado_em: new Date().toISOString() })
      .eq('id', t.transferencia_id)
      .neq('status', 'cancelada');
  }
  console.log(`📦 [recebimento] transferência ${t.id} (NF ${t.nf_numero || '—'}) recebida na empresa ${empresa}: ${qtdRecebida}/${t.qtd_esperada} pç, faltando ${qtdFaltando}, de fora ${fora.length} · ${quem(user)}`);
  return rec;
}

/** Estoque da loja: saldo por produto (só o que entrou por recebimento, por enquanto). */
export async function estoque(user, f = {}) {
  const { lista, codes } = await empresasPermitidas(user, f.empresa);
  if (!codes.length) return { empresas: lista, produtos: [], totais: { produtos: 0, pecas: 0 } };
  const movs = await todas(() => supabase.from('hc_estoque_movimentos').select('empresa, product_code, nome, quantidade, epc, em').in('empresa', codes).order('id'));
  const busca = String(f.busca || '')
    .trim()
    .toUpperCase();
  const mapa = new Map();
  for (const m of movs) {
    const k = `${m.empresa}|${m.product_code}`;
    if (!mapa.has(k)) mapa.set(k, { empresa: m.empresa, productCode: Number(m.product_code), nome: m.nome, quantidade: 0, etiquetas: 0, ultimaEntrada: m.em });
    const x = mapa.get(k);
    x.quantidade += Number(m.quantidade) || 0;
    if (m.epc) x.etiquetas += 1;
    if (m.nome) x.nome = m.nome;
    if (m.em > x.ultimaEntrada) x.ultimaEntrada = m.em;
  }
  let produtos = [...mapa.values()].filter((p) => p.quantidade !== 0);
  if (busca) produtos = produtos.filter((p) => String(p.productCode).includes(busca) || String(p.nome || '').toUpperCase().includes(busca));
  produtos.sort((a, b) => a.empresa - b.empresa || String(a.nome || '').localeCompare(String(b.nome || '')));
  return { empresas: lista, produtos, totais: { produtos: produtos.length, pecas: produtos.reduce((s, p) => s + p.quantidade, 0) } };
}
