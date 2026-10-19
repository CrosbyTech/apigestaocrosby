// Contas a receber no formato da API TOTVS v2 (accounts-receivable/v2).
//
//   mapTitulo(item)                     DocumentModel → linha de accounts_receivable_documents
//   gravarTitulos(items)                upsert em lote (invoice[] vira linhas por trigger)
//   syncIncremental(ctx)                alterações desde o cursor + janelas curtas de segurança
//   syncPeriodo(ctx, {desde, ate})      carga histórica por emissão (janelas mensais)
//   registrarComando(...)               log de baixa / cobrança / boleto / PIX enviados pelo HeadCoach
//   sincronizarTitulos(chaves)          relê no TOTVS títulos tocados pelo HeadCoach e grava
//   espelharEscritaAR(path, payload, r) gancho usado por postTotvs e pelas rotas de baixa/boleto
//
// Diferente do contas a pagar (sondado em 17/10/2026): aqui o filtro de
// alteração traz as inclusões (409 de 409 emitidos no dia) e as baixas (178 de
// 178 pagos no dia). As janelas de emissão e pagamento são só margem de segurança.
// Pegadinhas: startSettlementDate é IGNORADO (devolve 1,37 milhão de títulos),
// o filtro de pagamento é startPaymentDate/endPaymentDate; startIssueDate só
// filtra com endIssueDate junto; pageSize aceita 1000; expand útil = invoice,classifications.
import { paginar, fmtTotvsDate, totvs } from './totvsClient.js';
import { supabase, upsertLote, dedupe, agora, digits } from './db.js';

export const SEARCH_PATH = '/accounts-receivable/v2/documents/search';
export const PAGE_SIZE = 1000;
export const EXPAND = 'invoice,classifications';
export const MARCO_ZERO = process.env.ERP_MARCO_ZERO || '2026-10-17T03:00:00Z';

const janelaEmissaoDias = () => Math.max(1, parseInt(process.env.ERP_AR_JANELA_EMISSAO_DIAS || '3', 10));
const janelaPagamentoDias = () => Math.max(1, parseInt(process.env.ERP_AR_JANELA_PAGAMENTO_DIAS || '3', 10));

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const dia = (v) => (v ? String(v).slice(0, 10) : null);
const ts = (v) => (v ? String(v).slice(0, 19) : null);
const jsonOuNull = (v) => (v === undefined ? null : v);
const fmtDia = (d) => new Date(d).toISOString().slice(0, 10);

/** DocumentModel → linha. Não envia `origem` (preserva 'headcoach'). */
export function mapTitulo(it) {
  return {
    branch_code: num(it.branchCode),
    customer_code: num(it.customerCode),
    receivable_code: num(it.receivableCode),
    installment_code: num(it.installmentCode),
    customer_cpf_cnpj: digits(it.customerCpfCnpj),
    max_change_filter_date: ts(it.maxChangeFilterDate),
    expired_date: dia(it.expiredDate),
    payment_date: dia(it.paymentDate),
    issue_date: dia(it.issueDate),
    settlement_branch_code: num(it.settlementBranchCode),
    settlement_date: dia(it.settlementDate),
    settlement_sequence: num(it.settlementSequence),
    status: num(it.status),
    document_type: num(it.documentType),
    billing_type: num(it.billingType),
    discharge_type: num(it.dischargeType),
    charge_type: num(it.chargeType),
    origin_installment: jsonOuNull(it.originInstallment),
    bearer_code: num(it.bearerCode),
    bearer_name: it.bearerName ?? null,
    installment_value: num(it.installmentValue),
    paid_value: num(it.paidValue),
    net_value: num(it.netValue),
    discount_value: num(it.discountValue),
    rebate_value: num(it.rebateValue),
    interest_value: num(it.interestValue),
    assessment_value: num(it.assessmentValue),
    bar_code: it.barCode ?? null,
    digitable_line: it.digitableLine ?? null,
    our_number: num(it.ourNumber),
    dac_our_number: it.dacOurNumber != null ? String(it.dacOurNumber) : null,
    qr_code_pix: it.qrCodePix ?? null,
    discharge_user: num(it.dischargeUser),
    registration_user: num(it.registrationUser),
    charge_account: jsonOuNull(it.chargeAccount),
    calculated_values: jsonOuNull(it.calculatedValues),
    check_data: jsonOuNull(it.check),
    invoice: jsonOuNull(it.invoice),
    commissions: jsonOuNull(it.commissions),
    classifications: jsonOuNull(it.classifications),
    dados: it,
    sincronizado_em: agora(),
  };
}

const chave = (r) => `${r.branch_code}|${r.customer_code}|${r.receivable_code}|${r.installment_code}`;

export async function gravarTitulos(items, extra = {}) {
  const rows = dedupe(
    items
      .map((it) => ({ ...mapTitulo(it), ...extra }))
      .filter((r) => r.branch_code != null && r.customer_code != null && r.receivable_code != null && r.installment_code != null),
    chave,
  );
  if (!rows.length) return 0;
  return upsertLote('accounts_receivable_documents', rows, 'branch_code,customer_code,receivable_code,installment_code', { chunk: 500 });
}

/** Percorre documents/search com o filtro dado e grava cada página. */
export async function buscarEGravar(filter, ctx = {}, rotulo = '') {
  let gravados = 0;
  const r = await paginar({
    path: SEARCH_PATH,
    data: { filter, expand: EXPAND },
    pageSize: PAGE_SIZE,
    log: (m) => ctx.log?.(`${rotulo}${m}`),
    onPage: async (items) => {
      gravados += await gravarTitulos(items);
    },
  });
  return { gravados, paginas: r.paginas, count: r.count };
}

const diasAtras = (d, n) => new Date(new Date(d).getTime() - n * 86400000);

export async function syncIncremental(ctx) {
  const ate = ctx.cursorAte || new Date();
  const desde = ctx.cursorDesde || new Date(MARCO_ZERO);
  const alt = await buscarEGravar({ change: { startDate: fmtTotvsDate(desde), endDate: fmtTotvsDate(ate), inReceivable: true } }, ctx, '[alterações] ');
  const emi = await buscarEGravar({ startIssueDate: fmtDia(diasAtras(ate, janelaEmissaoDias())), endIssueDate: fmtDia(ate) }, ctx, '[emissão] ');
  const pag = await buscarEGravar({ startPaymentDate: fmtDia(diasAtras(ate, janelaPagamentoDias())), endPaymentDate: fmtDia(ate) }, ctx, '[pagamento] ');
  return {
    registros: alt.gravados + emi.gravados + pag.gravados,
    paginas: alt.paginas + emi.paginas + pag.paginas,
    totalTotvs: null,
    detalhes: {
      alteracoes: { gravados: alt.gravados, totvs: alt.count },
      janela_emissao: { dias: janelaEmissaoDias(), gravados: emi.gravados, totvs: emi.count },
      janela_pagamento: { dias: janelaPagamentoDias(), gravados: pag.gravados, totvs: pag.count },
    },
  };
}

/** Carga histórica por emissão, mês a mês, em todas as empresas. */
export async function syncPeriodo(ctx, { desde, ate = new Date() }) {
  const inicio = new Date(`${String(desde).slice(0, 10)}T00:00:00`);
  const fim = new Date(ate);
  let gravados = 0;
  let paginas = 0;
  let total = 0;
  const meses = [];
  for (let d = new Date(inicio.getFullYear(), inicio.getMonth(), 1); d <= fim; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
    const a = d < inicio ? inicio : d;
    const ultimo = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    const b = ultimo > fim ? fim : ultimo;
    const mes = `${a.getFullYear()}-${String(a.getMonth() + 1).padStart(2, '0')}`;
    const r = await buscarEGravar({ startIssueDate: fmtDia(a), endIssueDate: fmtDia(b) }, ctx, `[${mes}] `);
    gravados += r.gravados;
    paginas += r.paginas;
    total += r.count || 0;
    meses.push({ mes, totvs: r.count || 0, gravados: r.gravados });
    ctx.log?.(`  ${mes}: ${r.gravados} parcelas (TOTVS ${r.count ?? '?'})`);
  }
  return { registros: gravados, paginas, totalTotvs: total, detalhes: { desde: String(desde).slice(0, 10), meses } };
}

// ─── Escritas do HeadCoach ─────────────────────────────────────────────────

// bank-slip fica de fora: só gera o PDF de um boleto já registrado (consulta,
// chamada o dia todo pelo job de cobrança) e não muda o título.
const COMANDOS = {
  '/accounts-receivable/v2/invoices-payment': 'invoices-payment',
  '/accounts-receivable/v2/documents/change-charge-type': 'change-charge-type',
  '/accounts-receivable/v2/payment-link': 'payment-link',
};
export const comandoDoPath = (path) => COMANDOS[String(path || '').replace(/^https?:\/\/[^/]+\/api\/totvsmoda/, '')] || null;

/** Títulos que um comando toca (para reler no TOTVS depois). */
export function titulosDoComando(command, payload = {}) {
  if (command === 'invoices-payment') {
    return (payload.invoices || []).map((i) => ({ branchCode: num(i.branchCode), customerCode: num(i.customerCode), receivableCode: num(i.receivableCode), installmentCode: num(i.installmentCode) }));
  }
  if (command === 'change-charge-type') {
    return [{ branchCode: num(payload.branchCode), customerCode: num(payload.customerCode), receivableCode: num(payload.receivableCode), installmentCode: num(payload.installmentCode) }];
  }
  // bank-slip e payment-link usam installmentNumber e podem vir só com CPF/CNPJ
  return [{ branchCode: num(payload.branchCode), customerCode: num(payload.customerCode), customerCpfCnpj: digits(payload.customerCpfCnpj), receivableCode: num(payload.receivableCode), installmentCode: num(payload.installmentNumber ?? payload.installmentCode) }];
}

// resposta de bank-slip é o PDF em base64 — não vale guardar no log
const resumirResposta = (command, data) => {
  if (data == null) return null;
  if (command === 'bank-slip') return { tamanho: typeof data === 'string' ? data.length : JSON.stringify(data).length };
  return data;
};

export async function registrarComando({ command, payload, sucesso, http_status = null, resposta = null, erro = null, usuario = null, origem_tabela = null, origem_id = null }) {
  try {
    const t = titulosDoComando(command, payload)[0] || {};
    const { error } = await supabase.from('accounts_receivable_commands').insert({
      command,
      branch_code: t.branchCode ?? null,
      customer_code: t.customerCode ?? null,
      customer_cpf_cnpj: t.customerCpfCnpj ?? digits(payload?.customerCpfCnpj),
      receivable_code: t.receivableCode ?? null,
      installment_code: t.installmentCode ?? null,
      payload: payload ?? {},
      sucesso,
      http_status,
      resposta: resumirResposta(command, resposta),
      erro: erro ? String(erro).slice(0, 2000) : null,
      usuario,
      origem_tabela,
      origem_id: origem_id != null ? String(origem_id) : null,
    });
    if (error) console.warn(`[contas-receber] registrar comando: ${error.message}`);
  } catch (e) {
    console.warn(`[contas-receber] registrar comando: ${e.message}`);
  }
}

/** Relê no TOTVS os títulos indicados e grava (nunca lança erro). */
export async function sincronizarTitulos(titulos) {
  let n = 0;
  for (const t of titulos || []) {
    if (!t?.receivableCode) continue;
    try {
      const filter = { receivableCodeList: [t.receivableCode] };
      if (t.branchCode) filter.branchCodeList = [t.branchCode];
      if (t.customerCode) filter.customerCodeList = [t.customerCode];
      else if (t.customerCpfCnpj) filter.customerCpfCnpjList = [t.customerCpfCnpj];
      const d = await totvs('post', SEARCH_PATH, { data: { filter, expand: EXPAND, page: 1, pageSize: 100 } });
      const items = (d?.items || []).filter((i) => !t.installmentCode || Number(i.installmentCode) === Number(t.installmentCode));
      n += await gravarTitulos(items);
    } catch (e) {
      console.warn(`[contas-receber] sincronizar título ${t.receivableCode}/${t.installmentCode}: ${e.message}`);
    }
  }
  return n;
}

/**
 * Gancho de escrita: registra o comando e relê os títulos afetados, em
 * background, sem afetar quem chamou.
 */
export function espelharEscritaAR(path, payload, { sucesso, http_status = null, resposta = null, erro = null, usuario = null, origem_tabela = null, origem_id = null } = {}) {
  const command = comandoDoPath(path);
  if (!command) return;
  setImmediate(() => {
    (async () => {
      await registrarComando({ command, payload, sucesso, http_status, resposta, erro, usuario, origem_tabela, origem_id });
      if (sucesso) await sincronizarTitulos(titulosDoComando(command, payload));
    })().catch((e) => console.warn('[contas-receber] espelho:', e.message));
  });
}
