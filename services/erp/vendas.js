// Vendas no formato da API TOTVS v2 — transações (general/v2/transactions).
//
//   mapTransacao(item)                  TransactionModel → linha de general_transactions
//   gravarTransacoes(items)             upsert (items[] e installment[] viram linhas por trigger)
//   syncIncremental(ctx)                alterações desde o cursor, empresa por empresa (290)
//   syncPeriodo(ctx, {desde, ate})      carga histórica por data de alteração (janelas de 30 dias)
//   sincronizarTransacao(...)           relê uma transação no TOTVS e grava
//   espelharEscritaVendas(url, ...)     gancho do callTotvs do PDV: transação, recebimento e bônus
//
// Sondado em 17–19/10/2026:
//   * a busca é GET e aceita UMA empresa por chamada (BranchCodeList=95);
//   * com empresa, exige TransactionDate ou StartChangeDate+EndChangeDate;
//   * janela de alteração ≤ 31 dias; PageSize ≤ 500;
//   * o filtro de alteração traz as transações novas (34/34 na 95, 5/5 na 90);
//   * Expand útil: installment, originDestination, additionalInformation
//     (items e classifications já vêm sempre; relatedFiscalDocument veio sempre null);
//   * uma passada pelas 290 empresas leva ~2 min.
import { paginar, fmtTotvsDate, totvs, TotvsHttpError } from './totvsClient.js';
import { supabase, upsertLote, dedupe, agora } from './db.js';

export const SEARCH_PATH = '/general/v2/transactions/search';
export const PAGE_SIZE = 500;
export const EXPAND = 'items,installment,classifications,originDestination,additionalInformation,relatedFiscalDocument';
export const JANELA_MAX_DIAS = 30;
export const MARCO_ZERO = process.env.ERP_MARCO_ZERO || '2026-10-17T03:00:00Z';

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const dia = (v) => (v ? String(v).slice(0, 10) : null);
const ts = (v) => (v ? String(v).slice(0, 19) : null);
const json = (v) => (v === undefined ? null : v);

/** TransactionModel → linha (não envia `origem`). */
export function mapTransacao(it) {
  return {
    branch_code: num(it.branchCode),
    transaction_code: num(it.transactionCode),
    transaction_date: dia(it.transactionDate),
    customer_code: num(it.customerCode),
    representative_code: num(it.representativeCode),
    lastchange_date: ts(it.lastchangeDate),
    operation_code: num(it.operationCode),
    seller_code: num(it.sellerCode),
    guide_code: num(it.guideCode),
    payment_condition_code: num(it.paymentConditionCode),
    price_table_code: num(it.priceTableCode),
    status: num(it.status),
    gross_amount_value: num(it.grossAmountValue),
    total_value: num(it.totalValue),
    discount_value: num(it.discountValue),
    max_change_filter_date: ts(it.maxChangeFilterDate),
    classifications: json(it.classifications),
    items: Array.isArray(it.items) ? it.items : [],
    origin_destination: json(it.originDestination),
    additional_information: json(it.additionalInformation),
    installment: Array.isArray(it.installment) ? it.installment : [],
    settlement_code: json(it.settlementCode),
    modality: json(it.modality),
    transaction_type: json(it.transactionType),
    related_fiscal_document: json(it.relatedFiscalDocument),
    dados: it,
    sincronizado_em: agora(),
  };
}

const chave = (r) => `${r.branch_code}|${r.transaction_code}`;

export async function gravarTransacoes(items) {
  const rows = dedupe(items.map(mapTransacao).filter((r) => r.branch_code != null && r.transaction_code != null), chave);
  if (!rows.length) return 0;
  return upsertLote('general_transactions', rows, 'branch_code,transaction_code', { chunk: 200 });
}

let cacheEmpresas = { em: 0, codes: [] };
export async function todasEmpresas() {
  if (cacheEmpresas.codes.length && Date.now() - cacheEmpresas.em < 30 * 60000) return cacheEmpresas.codes;
  const { data, error } = await supabase.from('erp_empresas').select('code').order('code').limit(2000);
  if (error) throw new Error(`erp_empresas: ${error.message}`);
  const codes = (data || []).map((e) => e.code);
  if (!codes.length) throw new Error('erp_empresas vazia — rode o sync de empresas antes');
  cacheEmpresas = { em: Date.now(), codes };
  return codes;
}

/** Quebra [desde, ate] em janelas de no máximo JANELA_MAX_DIAS. */
export function janelas(desde, ate, dias = JANELA_MAX_DIAS) {
  const out = [];
  let a = new Date(desde);
  const fim = new Date(ate);
  while (a < fim) {
    const b = new Date(Math.min(a.getTime() + dias * 86400000 - 1000, fim.getTime()));
    out.push([a, b]);
    a = new Date(b.getTime() + 1000);
  }
  return out;
}

/**
 * Busca as transações alteradas no intervalo em todas as empresas.
 * Erro 4xx de uma empresa (sem permissão etc.) é anotado e a empresa é pulada;
 * erro 5xx/rede interrompe para o cursor não avançar sem os dados.
 */
async function buscarPorAlteracao(ctx, desde, ate, rotulo = '') {
  const empresas = await todasEmpresas();
  let gravados = 0;
  let paginas = 0;
  let totvsTotal = 0;
  const empresasComMovimento = [];
  const puladas = [];
  for (const [a, b] of janelas(desde, ate)) {
    for (const branch of empresas) {
      try {
        const r = await paginar({
          method: 'get',
          path: SEARCH_PATH,
          params: { BranchCodeList: branch, StartChangeDate: fmtTotvsDate(a), EndChangeDate: fmtTotvsDate(b), Expand: EXPAND },
          pageSize: PAGE_SIZE,
          onPage: async (items) => {
            gravados += await gravarTransacoes(items);
          },
        });
        paginas += r.paginas;
        if (r.count) {
          totvsTotal += r.count;
          empresasComMovimento.push(branch);
        }
      } catch (e) {
        if (e instanceof TotvsHttpError && !e.retryable) {
          puladas.push({ branch, erro: e.message.slice(0, 200) });
          continue;
        }
        throw e;
      }
    }
    ctx.log?.(`${rotulo}${fmtTotvsDate(a).slice(0, 10)}→${fmtTotvsDate(b).slice(0, 10)}: ${gravados} gravadas até aqui`);
  }
  return { gravados, paginas, totvsTotal, empresasComMovimento: [...new Set(empresasComMovimento)], puladas };
}

export async function syncIncremental(ctx) {
  const ate = ctx.cursorAte || new Date();
  const desde = ctx.cursorDesde || new Date(MARCO_ZERO);
  const r = await buscarPorAlteracao(ctx, desde, ate, '[alterações] ');
  return {
    registros: r.gravados,
    paginas: r.paginas,
    totalTotvs: null,
    detalhes: { totvs: r.totvsTotal, empresas_com_movimento: r.empresasComMovimento.length, puladas: r.puladas },
  };
}

/** Carga histórica: cada transação aparece uma vez, na janela da sua última alteração. */
export async function syncPeriodo(ctx, { desde, ate = new Date() }) {
  const r = await buscarPorAlteracao(ctx, new Date(`${String(desde).slice(0, 10)}T00:00:00`), new Date(ate), '[histórico] ');
  return {
    registros: r.gravados,
    paginas: r.paginas,
    totalTotvs: r.totvsTotal,
    detalhes: { desde: String(desde).slice(0, 10), empresas_com_movimento: r.empresasComMovimento.length, puladas: r.puladas },
  };
}

// ─── Escritas do HeadCoach ─────────────────────────────────────────────────

export async function sincronizarTransacao({ branchCode, transactionCode, transactionDate }) {
  try {
    if (!branchCode || !transactionCode) return 0;
    const data = dia(transactionDate) || new Date().toISOString().slice(0, 10);
    const d = await totvs('get', SEARCH_PATH, {
      params: { BranchCodeList: Number(branchCode), TransactionCodeList: Number(transactionCode), TransactionDate: data, Expand: EXPAND, Page: 1, PageSize: 5 },
    });
    return gravarTransacoes(d?.items || []);
  } catch (e) {
    console.warn(`[vendas] reler transação ${branchCode}/${transactionCode}: ${e.message}`);
    return 0;
  }
}

async function registrar(tabela, row) {
  try {
    const { error } = await supabase.from(tabela).insert(row);
    if (error) console.warn(`[vendas] ${tabela}: ${error.message}`);
  } catch (e) {
    console.warn(`[vendas] ${tabela}: ${e.message}`);
  }
}

const PATHS = {
  '/general/v2/transactions': 'transactions',
  '/general/v2/transaction-receiving': 'transaction-receiving',
  '/person/v2/bonus-consume': 'bonus-consume',
  '/person/v2/bonus-due-date': 'bonus-due-date',
};
export const comandoVendasDoUrl = (url) => PATHS[String(url || '').replace(/^https?:\/\/[^/]+\/api\/totvsmoda/, '').replace(/\?.*$/, '')] || null;

/** Extrai {branchCode, transactionCode, transactionDate} da resposta do insert. */
export function transacaoDaResposta(payload = {}, resposta = {}) {
  const r = (Array.isArray(resposta) ? resposta[0] : resposta) || {};
  const t = r.transaction || r;
  return {
    branchCode: num(t.branchCode ?? payload.branchCode),
    transactionCode: num(t.transactionCode ?? t.code ?? payload.transactionCode),
    transactionDate: dia(t.transactionDate ?? payload.transactionDate),
  };
}

/**
 * Gancho do callTotvs do PDV. Registra o comando e, em caso de sucesso,
 * relê a transação / o saldo de bônus. Background, nunca lança erro.
 */
export function espelharEscritaVendas(url, payload, { sucesso, http_status = null, resposta = null, erro = null } = {}) {
  const command = comandoVendasDoUrl(url);
  if (!command) return;
  setImmediate(() => {
    (async () => {
      const base = { payload: payload ?? {}, sucesso, http_status, resposta, erro: erro ? String(erro).slice(0, 2000) : null };
      if (command === 'transactions' || command === 'transaction-receiving') {
        const t = transacaoDaResposta(payload, resposta);
        await registrar('general_transaction_commands', { command, branch_code: t.branchCode, transaction_code: t.transactionCode, transaction_date: t.transactionDate, ...base });
        if (sucesso) await sincronizarTransacao(t);
        return;
      }
      await registrar('person_bonus_commands', {
        command,
        person_code: num(payload?.personCode),
        branch_code: num(payload?.branchCode),
        value: num(payload?.usedValue ?? payload?.bonusValue),
        ...base,
      });
      if (sucesso && payload?.personCode) {
        const { atualizarSaldoPessoa } = await import('./bonus.js');
        await atualizarSaldoPessoa(Number(payload.personCode), 'comando');
      }
    })().catch((e) => console.warn('[vendas] espelho:', e.message));
  });
}
