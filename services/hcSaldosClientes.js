// ============================================================================
// HEADCOACH › SALDOS DE CLIENTES — CREDEV e ADIANTAMENTO (Yago, 13/11/2026)
// Saldo próprio do HeadCoach por cliente + empresa (tabelas em
// migrations/hc_saldos_clientes.sql). Quem mexe:
//   • carga inicial (carregarDoTotvs): clientes com CREDEV (tipo 20) ou
//     adiantamento (tipo 10) na empresa 99 em 2026, com o saldo do TOTVS;
//   • Faturamento / Faturamento Brejinho (usarNaVenda): forma "Credev" e
//     "Adiantamento" consomem daqui, nunca mais do TOTVS;
//   • nota cancelada / pedido refaturado (estornarVenda): o que a venda gastou volta;
//   • devolução atendida (creditarDevolucao / sincronizarDevolucoes): o valor
//     entra no CREDEV do cliente naquela empresa; cancelada, sai de novo.
// Devoluções ANTERIORES à carga já estão no saldo que veio do TOTVS: só entra
// devolução atendida depois da carga.
// ============================================================================
import supabase from '../config/supabase.js';
import { postTotvs } from './bluecardLimite.js';

export class SaldoClienteError extends Error {
  constructor(message, code = 'SALDO_CLIENTE', status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export const TIPOS = { credev: 'Credev', adiantamento: 'Adiantamento' };
// forma de pagamento da venda → tipo de saldo
export const FORMA_PARA_TIPO = { credito_loja: 'credev', adiantamento: 'adiantamento' };
export const EMPRESA_CARGA = 99;

const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function falhaDb(error) {
  const msg = String(error?.message || '');
  if (/relation .* does not exist|could not find the (table|function)|schema cache|function .* does not exist/i.test(msg)) {
    return new SaldoClienteError('Os saldos de CREDEV/adiantamento do HeadCoach ainda não estão liberados: rode "node scripts/migrar-hc-saldos-clientes.mjs" na pasta da API.', 'MIGRATION_PENDING', 503);
  }
  const m = msg.match(/SALDO_INSUFICIENTE: (.*)/);
  if (m) return new SaldoClienteError(m[1], 'SALDO_INSUFICIENTE', 409);
  return new SaldoClienteError(msg || 'Erro no banco', 'DB_ERROR', 500);
}
async function q(promessa) {
  const { data, error } = await promessa;
  if (error) throw falhaDb(error);
  return data;
}
async function movimentar({ empresa, cliente, tipo, valor, movimento, vendaId = null, devolucaoId = null, referencia = null, observacao = null, por = null, nome = null, doc = null }) {
  const { data, error } = await supabase.rpc('hc_saldo_movimentar', {
    p_empresa: Number(empresa),
    p_cliente: Number(cliente),
    p_tipo: tipo,
    p_valor: round2(valor),
    p_movimento: movimento,
    p_venda: vendaId,
    p_devolucao: devolucaoId,
    p_referencia: referencia,
    p_observacao: observacao,
    p_por: por,
    p_nome: nome,
    p_doc: doc,
  });
  if (error) {
    if (/duplicate key|hc_cli_saldos_mov_(carga|dev)/i.test(error.message)) return { jaFeito: true };
    throw falhaDb(error);
  }
  return { saldo: Number(data) };
}

// ─── consulta ────────────────────────────────────────────────────────────────
/** Saldo de CREDEV e adiantamento do cliente numa empresa. */
export async function saldoDoCliente(cliente, empresa = EMPRESA_CARGA) {
  const rows = await q(supabase.from('hc_cliente_saldos').select('tipo, saldo, cliente_nome').eq('cliente_code', Number(cliente)).eq('empresa', Number(empresa)));
  const out = { clienteCode: Number(cliente), empresa: Number(empresa), credev: 0, adiantamento: 0, nome: null };
  for (const r of rows || []) {
    out[r.tipo] = round2(r.saldo);
    out.nome = out.nome || r.cliente_nome || null;
  }
  out.total = round2(out.credev + out.adiantamento);
  return out;
}

export async function listarSaldos({ empresa, busca, comSaldo = true } = {}) {
  const out = [];
  for (let de = 0; ; de += 1000) {
    let qy = supabase.from('hc_cliente_saldos').select('*').order('saldo', { ascending: false }).order('cliente_code').range(de, de + 999);
    if (empresa) qy = qy.eq('empresa', Number(empresa));
    if (comSaldo) qy = qy.gt('saldo', 0);
    const b = String(busca || '').trim();
    if (b) qy = /^\d+$/.test(b) ? qy.eq('cliente_code', Number(b)) : qy.ilike('cliente_nome', `%${b.replace(/[%_,()]/g, ' ')}%`);
    const lote = await q(qy);
    out.push(...(lote || []));
    if (!lote || lote.length < 1000) break;
  }
  // uma linha por cliente+empresa, com CREDEV e adiantamento lado a lado
  const porCliente = new Map();
  for (const r of out) {
    const k = `${r.empresa}|${r.cliente_code}`;
    if (!porCliente.has(k)) porCliente.set(k, { empresa: r.empresa, clienteCode: Number(r.cliente_code), nome: r.cliente_nome, cpfCnpj: r.cliente_cpf_cnpj, credev: 0, adiantamento: 0, credevInicial: 0, adiantamentoInicial: 0, atualizadoEm: r.atualizado_em });
    const c = porCliente.get(k);
    c[r.tipo] = round2(r.saldo);
    c[`${r.tipo}Inicial`] = round2(r.valor_inicial);
    c.nome = c.nome || r.cliente_nome;
    if (r.atualizado_em > c.atualizadoEm) c.atualizadoEm = r.atualizado_em;
  }
  const lista = [...porCliente.values()].map((c) => ({ ...c, total: round2(c.credev + c.adiantamento) })).sort((a, b) => b.total - a.total);
  const totais = lista.reduce((t, c) => ({ clientes: t.clientes + 1, credev: round2(t.credev + c.credev), adiantamento: round2(t.adiantamento + c.adiantamento) }), { clientes: 0, credev: 0, adiantamento: 0 });
  return { lista, totais };
}

export async function extratoDoCliente(cliente, empresa = null) {
  let qy = supabase.from('hc_cliente_saldos_mov').select('*').eq('cliente_code', Number(cliente)).order('id', { ascending: false }).limit(500);
  if (empresa) qy = qy.eq('empresa', Number(empresa));
  return q(qy);
}

// ─── faturamento ─────────────────────────────────────────────────────────────
/** Quanto a venda vai usar de cada saldo (pelas formas de pagamento). */
export function usoDosPagamentos(pagamentos = []) {
  const uso = { credev: 0, adiantamento: 0 };
  for (const p of pagamentos) {
    const tipo = FORMA_PARA_TIPO[p.forma];
    if (tipo) uso[tipo] = round2(uso[tipo] + Number(p.valor || 0));
  }
  return uso;
}

/** Confere se o cliente tem saldo para o que a venda vai usar (antes de gravar). */
export async function conferirSaldo({ cliente, empresa, uso }) {
  if (!(uso.credev > 0) && !(uso.adiantamento > 0)) return;
  const s = await saldoDoCliente(cliente, empresa);
  for (const tipo of Object.keys(TIPOS)) {
    if (uso[tipo] > s[tipo] + 0.005) {
      throw new SaldoClienteError(`${TIPOS[tipo]} usado (${brl(uso[tipo])}) é maior que o saldo do cliente na empresa ${empresa} no HeadCoach (${brl(s[tipo])})`, 'SALDO_INSUFICIENTE', 409);
    }
  }
}

/** Consome os saldos que a venda usou. Se um falhar, devolve o que já tinha saído. */
export async function usarNaVenda({ venda, uso, por = null }) {
  const feitos = [];
  try {
    for (const tipo of Object.keys(TIPOS)) {
      if (!(uso[tipo] > 0)) continue;
      await movimentar({
        empresa: venda.empresa,
        cliente: venda.cliente_code,
        tipo,
        valor: -uso[tipo],
        movimento: 'uso',
        vendaId: venda.id,
        referencia: venda.numero_site || null,
        observacao: `Faturamento${venda.numero_site ? ` ${venda.numero_site}` : ''} (transação nº ${venda.id})`,
        por,
        nome: venda.cliente_nome || null,
        doc: venda.cliente_cpf_cnpj || null,
      });
      feitos.push(tipo);
    }
  } catch (e) {
    if (feitos.length) await estornarVenda(venda.id, 'Falha ao usar o saldo na venda', por).catch(() => {});
    throw e;
  }
  if (feitos.length) console.log(`💳 [saldos] venda ${venda.id}: ${feitos.map((t) => `${TIPOS[t]} ${brl(uso[t])}`).join(' + ')} do cliente ${venda.cliente_code}`);
  return feitos;
}

/** Devolve ao cliente o que estas vendas gastaram (nota cancelada, pedido refaturado). */
export async function estornarVenda(vendaId, motivo = null, por = null) {
  const { data, error } = await supabase.rpc('hc_saldo_estornar_venda', { p_venda: Number(vendaId), p_motivo: motivo, p_por: por });
  if (error) throw falhaDb(error);
  const total = round2(data || 0);
  if (total > 0) console.log(`💳 [saldos] venda ${vendaId}: ${brl(total)} devolvido ao cliente (${motivo || 'estorno'})`);
  return total;
}
export async function estornarVendas(vendaIds, motivo = null, por = null) {
  let total = 0;
  for (const id of [...new Set((vendaIds || []).map(Number).filter(Boolean))]) total = round2(total + (await estornarVenda(id, motivo, por)));
  return total;
}

// ─── devoluções ──────────────────────────────────────────────────────────────
async function inicioDosSaldos() {
  const { data } = await supabase.from('hc_cliente_saldos_mov').select('em').eq('movimento', 'carga_inicial').order('em').limit(1);
  return data?.[0]?.em ? new Date(data[0].em).toISOString() : null;
}

/**
 * Devolução atendida (status 4) → soma ao CREDEV do cliente na empresa da
 * devolução. Cancelada (6) depois de creditada → sai de novo (até o que tiver).
 * Só conta devolução atendida DEPOIS da carga inicial (as de antes já estão no
 * saldo que veio do TOTVS).
 */
export async function creditarDevolucao(trx, { inicio = undefined, por = null } = {}) {
  if (!trx?.id || !trx.cliente_code || !(Number(trx.total) > 0)) return { acao: 'nada' };
  const ini = inicio === undefined ? await inicioDosSaldos() : inicio;
  if (!ini) return { acao: 'nada', motivo: 'carga inicial ainda não feita' };
  const quando = trx.atendida_em || trx.criado_em ? new Date(trx.atendida_em || trx.criado_em).toISOString() : null;
  const movs = await q(supabase.from('hc_cliente_saldos_mov').select('movimento, valor').eq('devolucao_trx_id', trx.id));
  const creditada = (movs || []).find((m) => m.movimento === 'devolucao');
  const desfeita = (movs || []).some((m) => m.movimento === 'devolucao_cancelada');
  const base = {
    empresa: trx.empresa,
    cliente: trx.cliente_code,
    tipo: 'credev',
    devolucaoId: trx.id,
    referencia: trx.transacao_code ? `devolução ${trx.empresa}/${trx.transacao_code}` : `devolução nº ${trx.id}`,
    nome: trx.cliente_nome || null,
    por: por || trx.criado_por || null,
  };
  if (Number(trx.transacao_status) === 4 && !creditada) {
    if (quando && quando < ini) return { acao: 'nada', motivo: 'devolução anterior à carga (já está no saldo do TOTVS)' };
    const r = await movimentar({ ...base, valor: trx.total, movimento: 'devolucao', observacao: `Devolução atendida${trx.nf_numero ? ` (NF ${trx.nf_numero})` : ''}` });
    if (!r.jaFeito) console.log(`💳 [saldos] devolução ${trx.id}: +${brl(trx.total)} de CREDEV para o cliente ${trx.cliente_code} na empresa ${trx.empresa}`);
    return { acao: r.jaFeito ? 'nada' : 'creditada' };
  }
  if (Number(trx.transacao_status) === 6 && creditada && !desfeita) {
    const s = await saldoDoCliente(trx.cliente_code, trx.empresa);
    const tirar = round2(Math.min(Number(creditada.valor), s.credev));
    if (!(tirar > 0)) return { acao: 'nada', motivo: 'o crédito da devolução já foi usado' };
    const r = await movimentar({ ...base, valor: -tirar, movimento: 'devolucao_cancelada', observacao: `Devolução cancelada${tirar < Number(creditada.valor) ? ` (só ${brl(tirar)} ainda estava no saldo)` : ''}` });
    return { acao: r.jaFeito ? 'nada' : 'descreditada' };
  }
  return { acao: 'nada' };
}

/** Para chamar quando a devolução muda de status: nunca lança erro. */
export function devolucaoEmSegundoPlano(trxId) {
  (async () => {
    const { data } = await supabase.from('devolucoes_transacoes').select('*').eq('id', Number(trxId)).maybeSingle();
    if (data) await creditarDevolucao(data);
  })().catch((e) => {
    if (e.code !== 'MIGRATION_PENDING') console.error(`[saldos] devolução ${trxId}:`, e.message);
  });
}

/** Varre as devoluções atendidas/canceladas depois da carga (job). */
export async function sincronizarDevolucoes() {
  const ini = await inicioDosSaldos();
  if (!ini) return { creditadas: 0, descreditadas: 0 };
  // atendidas depois da carga (atendida_em; sem ela, a data do registro)
  const atendidas = await q(
    supabase.from('devolucoes_transacoes').select('*').eq('transacao_status', 4).or(`atendida_em.gte.${ini},and(atendida_em.is.null,criado_em.gte.${ini})`).order('id'),
  );
  // já creditadas e ainda não desfeitas: confere se foram canceladas
  const movs = await q(supabase.from('hc_cliente_saldos_mov').select('devolucao_trx_id, movimento').in('movimento', ['devolucao', 'devolucao_cancelada']));
  const desfeitas = new Set((movs || []).filter((m) => m.movimento === 'devolucao_cancelada').map((m) => Number(m.devolucao_trx_id)));
  const abertas = [...new Set((movs || []).filter((m) => m.movimento === 'devolucao' && !desfeitas.has(Number(m.devolucao_trx_id))).map((m) => Number(m.devolucao_trx_id)))];
  const canceladas = abertas.length ? await q(supabase.from('devolucoes_transacoes').select('*').in('id', abertas).eq('transacao_status', 6)) : [];
  const trxs = [...(atendidas || []), ...(canceladas || [])];
  const r = { creditadas: 0, descreditadas: 0, erros: [] };
  for (const t of trxs) {
    try {
      const x = await creditarDevolucao(t, { inicio: ini });
      if (x.acao === 'creditada') r.creditadas += 1;
      if (x.acao === 'descreditada') r.descreditadas += 1;
    } catch (e) {
      r.erros.push({ devolucao: t.id, erro: e.message });
    }
  }
  return r;
}

// ─── carga inicial do TOTVS (empresa 99, clientes com CREDEV/adiantamento em 2026) ───
async function paginaDocs(filter, page, tentativa = 1) {
  try {
    const r = await postTotvs('/accounts-receivable/v2/documents/search', { filter, page, pageSize: 100 }, { timeout: 120000 });
    return r.data || {};
  } catch (e) {
    if (tentativa >= 3) throw e;
    await new Promise((ok) => setTimeout(ok, 1500 * tentativa));
    return paginaDocs(filter, page, tentativa + 1);
  }
}
async function clientesComTitulos({ empresa, tipoDocumento, ano, ate }) {
  const clientes = new Set();
  for (let m = 1; m <= 12; m += 1) {
    const ini = `${ano}-${String(m).padStart(2, '0')}-01`;
    if (ini > ate) break;
    let fim = new Date(Date.UTC(ano, m, 0)).toISOString().slice(0, 10);
    if (fim > ate) fim = ate;
    const filter = { branchCodeList: [empresa], documentTypeList: [tipoDocumento], startIssueDate: `${ini}T00:00:00`, endIssueDate: `${fim}T23:59:59` };
    const p1 = await paginaDocs(filter, 1);
    const itens = [...(p1.items || [])];
    for (let p = 2; p <= (p1.totalPages || 1); p += 1) itens.push(...((await paginaDocs(filter, p)).items || []));
    for (const t of itens) if (Number(t.customerCode) > 0) clientes.add(Number(t.customerCode));
  }
  return clientes;
}

/**
 * Carga inicial: acha no TOTVS os clientes com CREDEV (tipo 20) ou
 * adiantamento (tipo 10) na empresa em 2026 e grava o saldo que o TOTVS
 * mostra agora (customer-financial-balance) — só leitura no TOTVS. Pode
 * rodar de novo: cliente já carregado não é carregado outra vez.
 */
export async function carregarDoTotvs({ empresa = EMPRESA_CARGA, ano = 2026, por = 'carga inicial (TOTVS)', log = console.log } = {}) {
  const ate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Recife' }).format(new Date());
  log(`🔎 Procurando clientes com CREDEV e adiantamento na empresa ${empresa} em ${ano}…`);
  const [c20, c10] = await Promise.all([clientesComTitulos({ empresa, tipoDocumento: 20, ano, ate }), clientesComTitulos({ empresa, tipoDocumento: 10, ano, ate })]);
  const codes = [...new Set([...c20, ...c10])];
  log(`   CREDEV: ${c20.size} cliente(s) · adiantamento: ${c10.size} cliente(s) · ${codes.length} distintos`);
  const r = { clientes: codes.length, comSaldo: 0, credev: 0, adiantamento: 0, carregados: 0, jaCarregados: 0, zerados: 0, erros: [] };
  for (let i = 0; i < codes.length; i += 50) {
    const lote = codes.slice(i, i + 50);
    const resp = await postTotvs(
      '/accounts-receivable/v2/customer-financial-balance/search',
      { filter: { customerCodeList: lote }, option: { branchCodeList: [empresa], isRefundCredit: true, isAdvanceAmount: true }, page: 1, pageSize: 100 },
      { timeout: 120000 },
    );
    const itens = resp.data?.items || [];
    const vistos = new Set();
    for (const it of itens) {
      const code = Number(it.code);
      vistos.add(code);
      const v = (it.values || []).find((x) => Number(x.branchCode) === empresa) || {};
      const saldos = { credev: round2(v.refundCreditValue || 0), adiantamento: round2(v.advanceAmountValue || 0) };
      const nome = it.name || null;
      const doc = String(it.cpfCnpj || '').replace(/\D/g, '') || null;
      if (saldos.credev > 0 || saldos.adiantamento > 0) r.comSaldo += 1;
      for (const tipo of Object.keys(TIPOS)) {
        try {
          if (saldos[tipo] > 0) {
            const x = await movimentar({ empresa, cliente: code, tipo, valor: saldos[tipo], movimento: 'carga_inicial', referencia: `TOTVS ${ate}`, observacao: `Saldo de ${TIPOS[tipo]} no TOTVS na carga (clientes com ${TIPOS[tipo]} em ${ano})`, por, nome, doc });
            if (x.jaFeito) r.jaCarregados += 1;
            else {
              r.carregados += 1;
              r[tipo] = round2(r[tipo] + saldos[tipo]);
            }
          } else if ((tipo === 'credev' ? c20 : c10).has(code)) {
            // teve no ano mas está zerado hoje: entra na tabela com saldo 0
            const { error } = await supabase.from('hc_cliente_saldos').upsert({ empresa, cliente_code: code, tipo, cliente_nome: nome, cliente_cpf_cnpj: doc }, { onConflict: 'empresa,cliente_code,tipo', ignoreDuplicates: true });
            if (error) throw falhaDb(error);
            r.zerados += 1;
          }
        } catch (e) {
          r.erros.push({ cliente: code, tipo, erro: e.message });
        }
      }
    }
    // cliente que o TOTVS não devolveu no saldo: entra zerado
    for (const code of lote.filter((c) => !vistos.has(c))) {
      for (const tipo of Object.keys(TIPOS)) {
        if (!(tipo === 'credev' ? c20 : c10).has(code)) continue;
        const { error } = await supabase.from('hc_cliente_saldos').upsert({ empresa, cliente_code: code, tipo }, { onConflict: 'empresa,cliente_code,tipo', ignoreDuplicates: true });
        if (error) r.erros.push({ cliente: code, tipo, erro: error.message });
        else r.zerados += 1;
      }
    }
    log(`   ${Math.min(i + 50, codes.length)}/${codes.length} cliente(s) conferido(s)…`);
  }
  return r;
}
