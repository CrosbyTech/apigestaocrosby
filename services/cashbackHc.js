// ============================================================================
// CASHBACK DO HEADCOACH (Yago, 18/11/2026)
//
// O cashback NOVO nasce e é usado aqui (tabelas hc_cashback_lotes / _mov,
// migrations/hc_cashback.sql). Regras:
//   • venda do PDV Crosby com cliente identificado gera 20% do valor;
//   • CARÊNCIA de 3 dias: gerado no dia 0, liberado no dia 3;
//   • VALIDADE de 90 dias de uso: vale até o dia 93; depois não conta no saldo,
//     mas o registro fica e pode ser REATIVADO;
//   • vale em qualquer loja; sai primeiro do lote que vence antes;
//   • venda cancelada: o cashback que ela usou volta e o que ela gerou é cancelado.
// O saldo ANTIGO continua no TOTVS (saldo bônus) e é baixado lá até acabar —
// ver totvsrouter/pdv.js (/pdv/bonus). services/hcCashback.js é só a cópia
// diária desse saldo antigo.
// ============================================================================
import supabase from '../config/supabase.js';

export const CASHBACK_HC = {
  pct: 20, // % do valor da venda
  carenciaDias: 3, // só pode usar a partir do 3º dia
  validadeDias: 90, // dias de uso depois da carência (vale até o dia 93)
};
// rede de segurança (venda autorizada sem lote): só vendas depois da virada —
// as anteriores geraram o cashback no TOTVS
const VIRADA = '2026-11-25T00:00:00-03:00';

export class CashbackHcError extends Error {
  constructor(message, code = 'CASHBACK_HC', status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const r2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const digitos = (v) => String(v || '').replace(/\D/g, '');
export const hojeBrasil = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Recife' }).format(new Date());
export const somaDias = (dia, n) => {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
/** Datas do cashback gerado num dia: { liberaEm, expiraEm } (expiraEm é o último dia de uso). */
export function prazosDoCashback(dia = hojeBrasil()) {
  const liberaEm = somaDias(dia, CASHBACK_HC.carenciaDias);
  return { liberaEm, expiraEm: somaDias(liberaEm, CASHBACK_HC.validadeDias) };
}

function falhaDb(error) {
  const msg = String(error?.message || error || '');
  if (/hc_cashback_(lotes|mov|gerar|usar|estornar_venda|reativar)/i.test(msg) && /does not exist|schema cache|Could not find/i.test(msg)) {
    return new CashbackHcError('Tabelas do cashback ausentes — rode node scripts/migrar-hc-cashback.mjs', 'MIGRATION_PENDING', 503);
  }
  if (/CASHBACK_INSUFICIENTE/.test(msg)) return new CashbackHcError(`Cashback insuficiente (${msg.replace(/^.*CASHBACK_INSUFICIENTE:\s*/, '')})`, 'CASHBACK_INSUFICIENTE', 409);
  return new CashbackHcError(msg, 'DB_ERROR', 500);
}

/** Situação de um lote hoje. */
export function situacaoDoLote(l, hoje = hojeBrasil()) {
  const saldo = r2(Number(l.valor) - Number(l.usado));
  if (l.cancelado_em) return 'cancelado';
  if (saldo <= 0) return 'usado';
  if (String(l.expira_em) < hoje) return 'vencido';
  if (String(l.libera_em) > hoje) return 'carencia';
  return 'disponivel';
}

const COLS_LOTE = 'id, cliente_code, cliente_nome, cliente_cpf_cnpj, empresa, origem, venda_id, base, pct, valor, usado, gerado_em, libera_em, expira_em, cancelado_em, cancelado_motivo, reativado_em, reativado_por, observacao, por';

function lotePublico(l, hoje) {
  return {
    id: l.id,
    clienteCode: Number(l.cliente_code),
    clienteNome: l.cliente_nome || null,
    empresa: Number(l.empresa),
    origem: l.origem,
    vendaId: l.venda_id ? Number(l.venda_id) : null,
    base: l.base != null ? r2(l.base) : null,
    pct: l.pct != null ? Number(l.pct) : null,
    valor: r2(l.valor),
    usado: r2(l.usado),
    saldo: r2(Number(l.valor) - Number(l.usado)),
    geradoEm: l.gerado_em,
    liberaEm: l.libera_em,
    expiraEm: l.expira_em,
    situacao: situacaoDoLote(l, hoje),
    canceladoEm: l.cancelado_em || null,
    canceladoMotivo: l.cancelado_motivo || null,
    reativadoEm: l.reativado_em || null,
    reativadoPor: l.reativado_por || null,
    observacao: l.observacao || null,
  };
}

/** Lotes do cliente (pelo código; sem ele, pelo CPF guardado no lote). */
async function lotesDoCliente({ cliente = null, cpf = null }) {
  const code = parseInt(cliente, 10) || null;
  const doc = digitos(cpf);
  if (!code && !doc) return [];
  let q = supabase.from('hc_cashback_lotes').select(COLS_LOTE).order('expira_em').order('id').limit(5000);
  q = code ? q.eq('cliente_code', code) : q.eq('cliente_cpf_cnpj', doc);
  const { data, error } = await q;
  if (error) throw falhaDb(error);
  return data || [];
}

/**
 * Saldo de cashback do cliente no HeadCoach (vale em qualquer loja):
 * { disponivel, emCarencia, proximaLiberacao{data,valor}, proximoVencimento{data,valor}, vencido }
 */
export async function saldoCashbackHc({ cliente = null, cpf = null } = {}) {
  const hoje = hojeBrasil();
  const lotes = await lotesDoCliente({ cliente, cpf });
  const r = { disponivel: 0, emCarencia: 0, vencido: 0, proximaLiberacao: null, proximoVencimento: null, clienteCode: lotes[0] ? Number(lotes[0].cliente_code) : parseInt(cliente, 10) || null };
  for (const l of lotes) {
    const sit = situacaoDoLote(l, hoje);
    const saldo = r2(Number(l.valor) - Number(l.usado));
    if (sit === 'disponivel') {
      r.disponivel = r2(r.disponivel + saldo);
      if (!r.proximoVencimento || l.expira_em < r.proximoVencimento.data) r.proximoVencimento = { data: l.expira_em, valor: saldo };
      else if (l.expira_em === r.proximoVencimento.data) r.proximoVencimento.valor = r2(r.proximoVencimento.valor + saldo);
    } else if (sit === 'carencia') {
      r.emCarencia = r2(r.emCarencia + saldo);
      if (!r.proximaLiberacao || l.libera_em < r.proximaLiberacao.data) r.proximaLiberacao = { data: l.libera_em, valor: saldo };
      else if (l.libera_em === r.proximaLiberacao.data) r.proximaLiberacao.valor = r2(r.proximaLiberacao.valor + saldo);
    } else if (sit === 'vencido') r.vencido = r2(r.vencido + saldo);
  }
  return r;
}

/**
 * Gera o cashback de uma venda AUTORIZADA do PDV Crosby (um lote por venda:
 * chamar de novo não duplica). Devolve { gerado, valor, liberaEm, expiraEm, loteId }
 * ou { gerado: false, motivo }.
 */
export async function gerarCashbackDaVenda(venda, { por = null } = {}) {
  if (!venda?.id) return { gerado: false, motivo: 'venda não encontrada' };
  if (venda.origem && venda.origem !== 'pdv') return { gerado: false, motivo: 'só o PDV Crosby gera cashback' };
  if (!['nfce', 'nfe'].includes(venda.tipo_venda)) return { gerado: false, motivo: 'troca não gera cashback' };
  if (venda.status !== 'autorizada') return { gerado: false, motivo: 'a nota ainda não foi autorizada' };
  if (!venda.cliente_code) return { gerado: false, motivo: 'venda sem cliente identificado' };
  const base = r2(venda.total);
  const valor = r2((base * CASHBACK_HC.pct) / 100);
  if (!(valor > 0)) return { gerado: false, motivo: 'venda sem valor' };
  const { liberaEm, expiraEm } = prazosDoCashback(hojeBrasil());
  const { data: loteId, error } = await supabase.rpc('hc_cashback_gerar', {
    p_cliente: Number(venda.cliente_code),
    p_empresa: Number(venda.empresa),
    p_venda: Number(venda.id),
    p_base: base,
    p_pct: CASHBACK_HC.pct,
    p_valor: valor,
    p_libera: liberaEm,
    p_expira: expiraEm,
    p_nome: venda.cliente_nome || null,
    p_doc: digitos(venda.cliente_cpf_cnpj) || null,
    p_por: por || venda.criado_por || null,
    p_observacao: `Cashback de ${CASHBACK_HC.pct}% da venda nº ${venda.id} (PDV Crosby)`,
  });
  if (error) throw falhaDb(error);
  // o lote pode ser de uma chamada anterior: devolve o que está gravado
  const { data: lote } = await supabase.from('hc_cashback_lotes').select(COLS_LOTE).eq('id', loteId).maybeSingle();
  const gravado = lote ? r2(lote.valor) : valor;
  if (r2(venda.cashback_gerado || 0) !== gravado) {
    await supabase.from('pdv_vendas').update({ cashback_gerado: gravado }).eq('id', venda.id);
  }
  console.log(`🎁 [cashback] venda ${venda.id}: ${brl(gravado)} para o cliente ${venda.cliente_code} (libera ${lote?.libera_em || liberaEm}, vale até ${lote?.expira_em || expiraEm})`);
  return { gerado: true, valor: gravado, liberaEm: lote?.libera_em || liberaEm, expiraEm: lote?.expira_em || expiraEm, loteId: Number(loteId), cancelado: !!lote?.cancelado_em };
}

/** Usa o cashback do HeadCoach numa venda (atômico; recusa se não cobre). */
export async function usarCashbackHc({ cliente, valor, vendaId = null, empresa = null, por = null, observacao = null }) {
  const v = r2(valor);
  if (!(v > 0)) return 0;
  const { data, error } = await supabase.rpc('hc_cashback_usar', {
    p_cliente: Number(cliente),
    p_valor: v,
    p_venda: vendaId ? Number(vendaId) : null,
    p_empresa: empresa ? Number(empresa) : null,
    p_por: por,
    p_observacao: observacao || (vendaId ? `Usado na venda nº ${vendaId}` : 'Usado no PDV Crosby'),
  });
  if (error) throw falhaDb(error);
  console.log(`🎁 [cashback] cliente ${cliente}: ${brl(v)} usado${vendaId ? ` na venda ${vendaId}` : ''}${empresa ? ` (empresa ${empresa})` : ''}`);
  return r2(data ?? v);
}

/**
 * Venda cancelada: devolve o cashback que ela usou e cancela o que ela gerou.
 * Devolve { devolvido, cancelado }. Pode ser chamada de novo.
 */
export async function estornarCashbackDaVenda(vendaId, motivo = null, por = null) {
  const { data, error } = await supabase.rpc('hc_cashback_estornar_venda', { p_venda: Number(vendaId), p_motivo: motivo, p_por: por });
  if (error) throw falhaDb(error);
  const r = { devolvido: r2(data?.devolvido || 0), cancelado: r2(data?.cancelado || 0) };
  if (r.cancelado > 0) await supabase.from('pdv_vendas').update({ cashback_gerado: 0 }).eq('id', Number(vendaId));
  if (r.devolvido > 0 || r.cancelado > 0) console.log(`🎁 [cashback] venda ${vendaId} cancelada: ${brl(r.devolvido)} devolvido ao cliente, ${brl(r.cancelado)} de cashback gerado cancelado`);
  return r;
}

/** O que a venda usou de cashback do HeadCoach (líquido de estornos). */
export async function cashbackHcUsadoNaVenda(vendaId) {
  const { data, error } = await supabase.from('hc_cashback_mov').select('valor').eq('venda_id', Number(vendaId)).in('movimento', ['uso', 'estorno_uso']);
  if (error) throw falhaDb(error);
  return r2(-(data || []).reduce((s, m) => s + Number(m.valor), 0));
}

/** Lote que a venda gerou (ou null). */
export async function loteDaVenda(vendaId) {
  const { data, error } = await supabase.from('hc_cashback_lotes').select(COLS_LOTE).eq('venda_id', Number(vendaId)).eq('origem', 'venda').maybeSingle();
  if (error) throw falhaDb(error);
  return data ? lotePublico(data, hojeBrasil()) : null;
}

/** Histórico do cliente: lotes (gerações) e extrato (geração, uso, estorno, cancelamento, reativação). */
export async function historicoCashbackHc({ cliente }) {
  const code = parseInt(cliente, 10);
  if (!code) throw new CashbackHcError('Informe o cliente', 'CLIENTE');
  const hoje = hojeBrasil();
  const [lotes, movs] = await Promise.all([
    lotesDoCliente({ cliente: code }),
    supabase
      .from('hc_cashback_mov')
      .select('id, lote_id, empresa, movimento, valor, venda_id, observacao, por, em')
      .eq('cliente_code', code)
      .order('id', { ascending: false })
      .limit(2000)
      .then(({ data, error }) => {
        if (error) throw falhaDb(error);
        return data || [];
      }),
  ]);
  const saldo = await saldoCashbackHc({ cliente: code });
  return {
    clienteCode: code,
    regras: CASHBACK_HC,
    saldo,
    lotes: lotes.map((l) => lotePublico(l, hoje)).sort((a, b) => String(b.geradoEm).localeCompare(String(a.geradoEm))),
    movimentos: movs.map((m) => ({ id: m.id, loteId: Number(m.lote_id), empresa: m.empresa != null ? Number(m.empresa) : null, movimento: m.movimento, valor: r2(m.valor), vendaId: m.venda_id ? Number(m.venda_id) : null, observacao: m.observacao || null, por: m.por || null, em: m.em })),
  };
}

/** Resumo geral (tela Saldos de Clientes): totais por situação + clientes. */
export async function resumoCashbackHc({ empresas = null, busca = '' } = {}) {
  const hoje = hojeBrasil();
  const out = [];
  if (Array.isArray(empresas) && !empresas.length) return { regras: CASHBACK_HC, totais: { gerado: 0, usado: 0, disponivel: 0, carencia: 0, vencido: 0, cancelado: 0, lotes: 0 }, clientes: [] };
  const termo = String(busca || '').trim();
  for (let de = 0; de < 200000; de += 1000) {
    let q = supabase.from('hc_cashback_lotes').select(COLS_LOTE).order('id').range(de, de + 999);
    if (Array.isArray(empresas)) q = q.in('empresa', empresas.map(Number));
    if (/^\d+$/.test(termo)) q = q.eq('cliente_code', Number(termo));
    else if (termo) q = q.ilike('cliente_nome', `%${termo.replace(/[%_,()]/g, ' ')}%`);
    const { data, error } = await q;
    if (error) throw falhaDb(error);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  const tot = { gerado: 0, usado: 0, disponivel: 0, carencia: 0, vencido: 0, cancelado: 0, lotes: out.length };
  const porCliente = new Map();
  for (const l of out) {
    const sit = situacaoDoLote(l, hoje);
    const saldo = r2(Number(l.valor) - Number(l.usado));
    // cashback de venda cancelada não conta como gerado (só o que o cliente chegou a usar dele)
    const gerado = sit === 'cancelado' ? Number(l.usado) : Number(l.valor);
    tot.gerado = r2(tot.gerado + gerado);
    tot.usado = r2(tot.usado + Number(l.usado));
    if (sit === 'disponivel') tot.disponivel = r2(tot.disponivel + saldo);
    else if (sit === 'carencia') tot.carencia = r2(tot.carencia + saldo);
    else if (sit === 'vencido') tot.vencido = r2(tot.vencido + saldo);
    else if (sit === 'cancelado') tot.cancelado = r2(tot.cancelado + saldo);
    const c = porCliente.get(Number(l.cliente_code)) || { clienteCode: Number(l.cliente_code), nome: l.cliente_nome, gerado: 0, usado: 0, disponivel: 0, carencia: 0, vencido: 0 };
    c.nome = c.nome || l.cliente_nome;
    c.gerado = r2(c.gerado + gerado);
    c.usado = r2(c.usado + Number(l.usado));
    if (['disponivel', 'carencia', 'vencido'].includes(sit)) c[sit] = r2(c[sit] + saldo);
    porCliente.set(Number(l.cliente_code), c);
  }
  return { regras: CASHBACK_HC, totais: tot, clientes: [...porCliente.values()].sort((a, b) => b.disponivel + b.carencia + b.vencido - (a.disponivel + a.carencia + a.vencido)) };
}

/**
 * Reativa cashback VENCIDO (o registro nunca é apagado): os lotes escolhidos
 * voltam a valer por `dias` a partir de hoje. alvo: { lotes: [ids] } | { cliente } | { todos: true }.
 * Devolve { lotes, clientes, valor }.
 */
export async function reativarCashbackHc({ lotes = null, cliente = null, todos = false, dias = CASHBACK_HC.validadeDias, por = null, observacao = null } = {}) {
  const n = parseInt(dias, 10);
  if (!(n >= 1 && n <= 730)) throw new CashbackHcError('Informe por quantos dias o cashback volta a valer (1 a 730)', 'DIAS');
  const hoje = hojeBrasil();
  let q = supabase.from('hc_cashback_lotes').select(COLS_LOTE).is('cancelado_em', null).lt('expira_em', hoje).limit(20000);
  if (Array.isArray(lotes) && lotes.length) q = q.in('id', lotes.map(Number));
  else if (cliente) q = q.eq('cliente_code', Number(cliente));
  else if (!todos) throw new CashbackHcError('Informe os lotes, o cliente ou todos', 'ALVO');
  const { data, error } = await q;
  if (error) throw falhaDb(error);
  const alvo = (data || []).filter((l) => Number(l.valor) - Number(l.usado) > 0);
  const expira = somaDias(hoje, n);
  let valor = 0;
  const clientes = new Set();
  const erros = [];
  for (const l of alvo) {
    const { data: v, error: e } = await supabase.rpc('hc_cashback_reativar', { p_lote: l.id, p_expira: expira, p_por: por, p_observacao: observacao || `Cashback reativado por ${n} dia(s)` });
    if (e) {
      erros.push({ lote: l.id, erro: e.message });
      continue;
    }
    valor = r2(valor + Number(v || 0));
    clientes.add(Number(l.cliente_code));
  }
  console.log(`🎁 [cashback] reativação${por ? ` por ${por}` : ''}: ${alvo.length - erros.length} lote(s), ${clientes.size} cliente(s), ${brl(valor)}, vale até ${expira}`);
  return { lotes: alvo.length - erros.length, clientes: clientes.size, valor, expiraEm: expira, erros };
}

/** Rede de segurança: venda autorizada do PDV (depois da virada) que ficou sem o cashback é gerada aqui. */
export async function sincronizarCashbackDasVendas() {
  const { data: vendas, error } = await supabase
    .from('pdv_vendas')
    .select('id, empresa, origem, tipo_venda, status, total, cashback_gerado, cliente_code, cliente_nome, cliente_cpf_cnpj, criado_por, criado_em')
    .eq('origem', 'pdv')
    .eq('status', 'autorizada')
    .in('tipo_venda', ['nfce', 'nfe'])
    .not('cliente_code', 'is', null)
    .gte('criado_em', VIRADA)
    .order('id', { ascending: false })
    .limit(2000);
  if (error) throw falhaDb(error);
  if (!vendas?.length) return { vendas: 0, geradas: 0, erros: [] };
  const { data: lotes, error: e2 } = await supabase.from('hc_cashback_lotes').select('venda_id').in('venda_id', vendas.map((v) => v.id)).eq('origem', 'venda');
  if (e2) throw falhaDb(e2);
  const com = new Set((lotes || []).map((l) => Number(l.venda_id)));
  let geradas = 0;
  const erros = [];
  for (const v of vendas) {
    if (com.has(Number(v.id))) continue;
    try {
      const r = await gerarCashbackDaVenda(v, { por: 'conferência automática' });
      if (r.gerado) geradas += 1;
    } catch (e) {
      erros.push({ venda: v.id, erro: e.message });
    }
  }
  return { vendas: vendas.length, geradas, erros };
}
