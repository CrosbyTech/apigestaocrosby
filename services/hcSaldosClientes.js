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
//     entra no CREDEV do cliente naquela empresa; cancelada, sai de novo;
//   • crédito gerado à mão (gerarCredito): owner/admin, com senha e motivo.
// Devoluções ANTERIORES à carga já estão no saldo que veio do TOTVS: só entra
// devolução atendida depois da carga.
// ============================================================================
import supabase from '../config/supabase.js';
import { postTotvs } from './bluecardLimite.js';
import { verificarSenhaAutorizador, AutorizacaoError } from './autorizacaoSenha.js';

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

export async function listarSaldos({ empresa, empresas = null, busca, comSaldo = true } = {}) {
  const out = [];
  for (let de = 0; ; de += 1000) {
    let qy = supabase.from('hc_cliente_saldos').select('*').order('saldo', { ascending: false }).order('cliente_code').range(de, de + 999);
    if (empresa) qy = qy.eq('empresa', Number(empresa));
    else if (empresas) qy = qy.in('empresa', empresas);
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

// ─── crédito gerado à mão (owner/admin) ──────────────────────────────────────
/**
 * Gera CREDEV ou adiantamento para o cliente numa empresa (HeadCoach › Saldos
 * de Clientes, botão GERAR CRÉDITO). Só owner ou admin, com a própria senha e
 * motivo. Fica no extrato como "ajuste" com quem gerou e por quê.
 */
export async function gerarCredito(user, b = {}) {
  if (!['owner', 'admin'].includes(user?.role)) throw new SaldoClienteError('Só owner ou admin gera CREDEV ou adiantamento', 'SEM_PERMISSAO', 403);
  const empresa = parseInt(b.empresa, 10);
  const cliente = parseInt(b.clienteCode, 10);
  const tipo = String(b.tipo || '');
  const bruto = String(b.valor ?? '').trim();
  const valor = round2(Number(bruto.includes(',') ? bruto.replace(/\./g, '').replace(',', '.') : bruto));
  const motivo = String(b.motivo || '').trim();
  if (!(empresa > 0)) throw new SaldoClienteError('Informe a empresa');
  if (!(cliente > 0)) throw new SaldoClienteError('Escolha o cliente');
  if (!TIPOS[tipo]) throw new SaldoClienteError('Escolha CREDEV ou adiantamento');
  if (!(valor > 0)) throw new SaldoClienteError('Informe o valor');
  if (motivo.length < 5) throw new SaldoClienteError('Informe o motivo');
  try {
    await verificarSenhaAutorizador(user?.email, b.senha, ['owner', 'admin']);
  } catch (e) {
    if (e instanceof AutorizacaoError) throw new SaldoClienteError(e.message, e.code, e.status);
    throw e;
  }
  const quem = user?.name || user?.email || null;
  const r = await movimentar({
    empresa,
    cliente,
    tipo,
    valor,
    movimento: 'ajuste',
    referencia: 'gerado no HeadCoach',
    observacao: `${TIPOS[tipo]} gerado por ${quem}: ${motivo}`,
    por: quem,
    nome: b.clienteNome ? String(b.clienteNome).slice(0, 200) : null,
    doc: b.clienteDoc ? String(b.clienteDoc).replace(/\D/g, '') || null : null,
  });
  console.log(`💳 [saldos] ${TIPOS[tipo]} de ${brl(valor)} gerado para o cliente ${cliente} na empresa ${empresa} por ${quem}: ${motivo}`);
  return { empresa, clienteCode: cliente, tipo, valor, saldo: r.saldo };
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

// ─── varredura completa (todos os clientes do cadastro) ──────────────────────
/**
 * Confere no TOTVS o saldo de CREDEV e adiantamento de TODOS os clientes do
 * cadastro (pes_pessoa) na empresa e traz para o HeadCoach quem tem saldo e
 * ainda não foi carregado (Yago, 13/11/2026: a 1ª carga só olhou quem teve
 * título em 2026 e deixou de fora saldos mais antigos). Só leitura no TOTVS.
 *   • cliente já carregado → não mexe (o saldo daqui já está andando);
 *   • cliente sem carga mas com movimento no HeadCoach (devolução creditada,
 *     crédito gerado à mão…) → NÃO carrega sozinho, vai para "revisar" (o
 *     saldo do TOTVS pode já incluir o que entrou aqui e duplicaria).
 */
export async function varrerTodosDoTotvs({ empresa = EMPRESA_CARGA, lote = 500, paralelo = 3, por = 'carga completa (TOTVS)', log = console.log } = {}) {
  // 1) todos os códigos do cadastro
  const codes = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await supabase.from('pes_pessoa').select('code').order('code').range(de, de + 999);
    if (error) throw falhaDb(error);
    for (const p of data || []) {
      const c = Number(p.code);
      if (c > 0) codes.push(c);
    }
    if (!data || data.length < 1000) break;
  }
  const unicos = [...new Set(codes)];
  log(`🔎 ${unicos.length} pessoa(s) no cadastro — conferindo o saldo de cada uma na empresa ${empresa} no TOTVS…`);

  // 2) quem já tem carga e quem já tem movimento no HeadCoach (nesta empresa)
  const movs = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await supabase.from('hc_cliente_saldos_mov').select('cliente_code, tipo, movimento').eq('empresa', empresa).order('id').range(de, de + 999);
    if (error) throw falhaDb(error);
    movs.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  const comCarga = new Set(movs.filter((m) => m.movimento === 'carga_inicial').map((m) => `${m.cliente_code}|${m.tipo}`));
  const comMovimento = new Set(movs.filter((m) => m.movimento !== 'carga_inicial').map((m) => `${m.cliente_code}|${m.tipo}`));

  const r = { pessoas: unicos.length, conferidas: 0, comSaldo: 0, carregados: 0, credev: 0, adiantamento: 0, jaCarregados: 0, revisar: [], erros: [] };
  const consultar = async (lista, tentativa = 1) => {
    try {
      const resp = await postTotvs(
        '/accounts-receivable/v2/customer-financial-balance/search',
        { filter: { customerCodeList: lista }, option: { branchCodeList: [empresa], isRefundCredit: true, isAdvanceAmount: true }, page: 1, pageSize: lista.length },
        { timeout: 180000 },
      );
      return resp.data?.items || [];
    } catch (e) {
      if (tentativa >= 4) throw e;
      await new Promise((ok) => setTimeout(ok, 3000 * tentativa));
      return consultar(lista, tentativa + 1);
    }
  };
  const lotes = [];
  for (let i = 0; i < unicos.length; i += lote) lotes.push(unicos.slice(i, i + lote));
  let proximo = 0;
  const trabalhador = async () => {
    while (proximo < lotes.length) {
      const idx = proximo++;
      const lista = lotes[idx];
      let itens;
      try {
        itens = await consultar(lista);
      } catch (e) {
        r.erros.push({ lote: idx, de: lista[0], ate: lista[lista.length - 1], erro: e.message });
        continue;
      }
      for (const it of itens) {
        const code = Number(it.code);
        const v = (it.values || []).find((x) => Number(x.branchCode) === empresa) || {};
        const saldos = { credev: round2(v.refundCreditValue || 0), adiantamento: round2(v.advanceAmountValue || 0) };
        if (!(saldos.credev > 0) && !(saldos.adiantamento > 0)) continue;
        r.comSaldo += 1;
        for (const tipo of Object.keys(TIPOS)) {
          if (!(saldos[tipo] > 0)) continue;
          const k = `${code}|${tipo}`;
          if (comCarga.has(k)) {
            r.jaCarregados += 1;
            continue;
          }
          if (comMovimento.has(k)) {
            r.revisar.push({ cliente: code, nome: it.name || null, tipo, saldoTotvs: saldos[tipo] });
            continue;
          }
          try {
            const x = await movimentar({
              empresa,
              cliente: code,
              tipo,
              valor: saldos[tipo],
              movimento: 'carga_inicial',
              referencia: `TOTVS ${new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Recife' }).format(new Date())}`,
              observacao: `Saldo de ${TIPOS[tipo]} no TOTVS na carga completa (todos os clientes)`,
              por,
              nome: it.name || null,
              doc: String(it.cpfCnpj || '').replace(/\D/g, '') || null,
            });
            if (x.jaFeito) r.jaCarregados += 1;
            else {
              r.carregados += 1;
              r[tipo] = round2(r[tipo] + saldos[tipo]);
              comCarga.add(k);
            }
          } catch (e) {
            r.erros.push({ cliente: code, tipo, erro: e.message });
          }
        }
      }
      r.conferidas += lista.length;
      if ((idx + 1) % 10 === 0 || r.conferidas === unicos.length) log(`   ${r.conferidas}/${unicos.length} conferida(s) · ${r.carregados} saldo(s) novo(s) · CREDEV ${brl(r.credev)} · adiantamento ${brl(r.adiantamento)}`);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, paralelo) }, trabalhador));
  return r;
}

// ─── acerto pelo relatório do TOTVS (FCCR015 - Saldo de Conta por Pool) ──────
/**
 * Lê o texto do relatório FCCR015 do TOTVS (Saldo de Conta por Pool) e devolve
 * uma linha por pessoa: { cliente, nome, credev, adiantamento } — só as
 * colunas CREDEV e Adiantamento (Saldo e Saldo Concil. são ignorados).
 */
export function lerRelatorioFccr015(texto) {
  const num = (s) => Number(String(s).replace(/\./g, '').replace(',', '.'));
  const rx = /^\s*\d+\s+(\d+)\s+[\d.]+\s+(.*?)\s(\d+)\s+(?:\d{3} -\S+|-)\s+(-?[\d.]+,\d{2})\s+(-?[\d.]+,\d{2})\s+(-?[\d.]+,\d{2})\s+(-?[\d.]+,\d{2})\s*$/;
  const linhas = [];
  let contas = 0;
  for (const l of String(texto).split(/\r?\n/)) {
    if (/^\s*\d+\s+\d+\s+[\d.]+\s/.test(l) && /,\d{2}\s*$/.test(l)) contas += 1;
    const m = l.match(rx);
    if (m) linhas.push({ grupo: Number(m[1]), cliente: Number(m[3]), nome: m[2].trim() || null, credev: num(m[6]), adiantamento: num(m[7]) });
  }
  // linha do total: só os 4 valores (Saldo, Saldo Concil., Credev, Adiantamento)
  const soNumeros = String(texto)
    .split('\n')
    .map((l) => l.match(/^\s+(-?[\d.]+,\d{2})\s+(-?[\d.]+,\d{2})\s+(-?[\d.]+,\d{2})\s+(-?[\d.]+,\d{2})\s*$/))
    .filter(Boolean);
  const tot = soNumeros[soNumeros.length - 1];
  const totais = tot ? { credev: num(tot[3]), adiantamento: num(tot[4]) } : null;
  return { linhas, contas, totais };
}

/**
 * Deixa o saldo de CREDEV/adiantamento da empresa igual ao relatório do TOTVS
 * (Yago, 13/11/2026), mais o que só aconteceu no HeadCoach e o TOTVS não sabe
 * (uso no faturamento, estorno, crédito gerado à mão). Devolução creditada
 * aqui NÃO soma (a devolução também gera o CREDEV no TOTVS, já está no
 * relatório). Quem está aqui e não está no relatório fica com 0 + o que é só
 * do HeadCoach. Negativo no TOTVS vira 0 (aqui não existe saldo negativo).
 * Cada diferença vira um movimento no extrato (carga_inicial para quem ainda
 * não tinha, ajuste para os demais) e valor_inicial passa a ser o do relatório.
 * aplicar=false só simula.
 */
export async function acertarPeloRelatorio({ empresa = EMPRESA_CARGA, linhas, referencia, aplicar = false, por = 'acerto pelo relatório do TOTVS', log = console.log }) {
  const SO_HEADCOACH = new Set(['uso', 'estorno', 'ajuste']);
  const relatorio = new Map(linhas.map((l) => [Number(l.cliente), l]));
  const rows = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await supabase.from('hc_cliente_saldos').select('*').eq('empresa', empresa).range(de, de + 999);
    if (error) throw falhaDb(error);
    rows.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  const clientes = new Set([...relatorio.keys(), ...rows.filter((r) => Number(r.saldo) > 0 || Number(r.valor_inicial) > 0).map((r) => Number(r.cliente_code))]);
  const r = { empresa, clientes: clientes.size, mudancas: [], negativos: [], semMudanca: 0, aplicadas: 0, erros: [], antes: { credev: 0, adiantamento: 0 }, depois: { credev: 0, adiantamento: 0 } };
  for (const cliente of [...clientes].sort((a, b) => a - b)) {
    const rel = relatorio.get(cliente) || null;
    const { data: movs, error } = await supabase.from('hc_cliente_saldos_mov').select('tipo, movimento, valor').eq('empresa', empresa).eq('cliente_code', cliente);
    if (error) throw falhaDb(error);
    for (const tipo of Object.keys(TIPOS)) {
      const atual = rows.find((x) => Number(x.cliente_code) === cliente && x.tipo === tipo);
      const saldoAtual = round2(atual?.saldo || 0);
      const totvsBruto = round2(rel ? rel[tipo] : 0);
      if (totvsBruto < 0) r.negativos.push({ cliente, nome: rel?.nome || null, tipo, valor: totvsBruto });
      const totvs = Math.max(0, totvsBruto);
      const soHc = round2((movs || []).filter((m) => m.tipo === tipo && SO_HEADCOACH.has(m.movimento)).reduce((s, m) => s + Number(m.valor), 0));
      const alvo = Math.max(0, round2(totvs + soHc));
      r.antes[tipo] = round2(r.antes[tipo] + saldoAtual);
      r.depois[tipo] = round2(r.depois[tipo] + alvo);
      const diff = round2(alvo - saldoAtual);
      const temCarga = (movs || []).some((m) => m.tipo === tipo && m.movimento === 'carga_inicial');
      if (Math.abs(diff) < 0.005) {
        r.semMudanca += 1;
        if (aplicar && atual && round2(atual.valor_inicial) !== totvs) await supabase.from('hc_cliente_saldos').update({ valor_inicial: totvs }).eq('empresa', empresa).eq('cliente_code', cliente).eq('tipo', tipo);
        continue;
      }
      const mov = { cliente, nome: atual?.cliente_nome || rel?.nome || null, tipo, antes: saldoAtual, totvs, soHeadcoach: soHc, depois: alvo, diferenca: diff, movimento: !temCarga && diff > 0 ? 'carga_inicial' : 'ajuste' };
      r.mudancas.push(mov);
      if (!aplicar) continue;
      try {
        await movimentar({
          empresa,
          cliente,
          tipo,
          valor: diff,
          movimento: mov.movimento,
          referencia,
          observacao: `Acerto pelo relatório do TOTVS (${referencia}): ${TIPOS[tipo]} no TOTVS ${brl(totvs)}${soHc ? ` + movimentos só do HeadCoach ${brl(soHc)}` : ''}`,
          por,
          nome: atual?.cliente_nome ? null : rel?.nome || null,
        });
        await supabase.from('hc_cliente_saldos').update({ valor_inicial: totvs }).eq('empresa', empresa).eq('cliente_code', cliente).eq('tipo', tipo);
        r.aplicadas += 1;
      } catch (e) {
        r.erros.push({ cliente, tipo, erro: e.message });
      }
    }
  }
  if (aplicar) log(`✅ acerto aplicado: ${r.aplicadas} mudança(s), ${r.erros.length} erro(s)`);
  return r;
}
