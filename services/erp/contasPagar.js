// Contas a pagar no formato da API TOTVS v2 (accounts-payable/v2).
//
//   mapDuplicata(item)                 DuplicateOutModel → linha de accounts_payable_duplicates
//   gravarDuplicatas(items, extra)     upsert em lote (expense[] vira linhas por trigger)
//   buscarEGravar(filter, ctx)         percorre duplicates/search e grava
//   syncIncremental(ctx)               alterações + janela de emissão + janela de liquidação
//   syncPeriodo(ctx, {desde, ate})     carga histórica por emissão (janelas mensais)
//   registrarComando(...)              log de create/group enviado pelo HeadCoach
//   sincronizarDuplicata(...)          relê no TOTVS uma duplicata recém-criada e grava (origem headcoach)
//
// Por que três buscas no incremental (sondado em 17/10/2026):
//   * filter.change {inDuplicate} não traz todas as inclusões (13–16/10: só
//     141 de 244 lançadas apareceram nele);
//   * não existe filtro por data de entrada (startEntryDate é ignorado);
//   * a emissão pode ser bem anterior ao lançamento (5% com mais de 30 dias),
//     por isso a janela móvel de emissão (ERP_AP_JANELA_EMISSAO_DIAS, padrão 120);
//   * pagamentos lançados com data retroativa entram pela janela de liquidação.
import { paginar, fmtTotvsDate, totvs } from './totvsClient.js';
import { supabase, upsertLote, dedupe, agora, digits } from './db.js';

export const SEARCH_PATH = '/accounts-payable/v2/duplicates/search';
export const PAGE_SIZE = 100; // limite da API para duplicates/search
export const MARCO_ZERO = process.env.ERP_MARCO_ZERO || '2026-10-17T03:00:00Z'; // 00:00 BRT

const janelaEmissaoDias = () => Math.max(7, parseInt(process.env.ERP_AP_JANELA_EMISSAO_DIAS || '120', 10));
const janelaLiquidacaoDias = () => Math.max(1, parseInt(process.env.ERP_AP_JANELA_LIQUIDACAO_DIAS || '10', 10));

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const ts = (v) => (v ? String(v).slice(0, 19) : null); // TIMESTAMP sem fuso, como o TOTVS devolve

/** DuplicateOutModel → linha (nomes da API em snake_case). Não envia `origem`: preserva o que já está gravado. */
export function mapDuplicata(it) {
  return {
    branch_code: num(it.branchCode),
    supplier_code: num(it.supplierCode),
    duplicate_code: num(it.duplicateCode),
    installment_code: num(it.installmentCode),
    supplier_cpf_cnpj: digits(it.supplierCpfCnpj),
    bearer_code: num(it.bearerCode),
    entry_date: ts(it.entryDate),
    issue_date: ts(it.issueDate),
    due_date: ts(it.dueDate),
    settlement_date: ts(it.settlementDate),
    arrival_date: ts(it.arrivalDate),
    status: it.status ?? null,
    duplicate_value: num(it.duplicateValue),
    fees_value: num(it.feesValue),
    discount_value: num(it.discountValue),
    paid_value: num(it.paidValue),
    expense: Array.isArray(it.expense) ? it.expense : [],
    inclusion_type: num(it.inclusionType),
    user_inclusion_code: num(it.userInclusionCode),
    user_inclusion_name: it.userInclusionName ?? null,
    max_change_filter_date: ts(it.maxChangeFilterDate),
    dados: it,
    sincronizado_em: agora(),
  };
}

const chave = (r) => `${r.branch_code}|${r.supplier_code}|${r.duplicate_code}|${r.installment_code}`;

export async function gravarDuplicatas(items, extra = {}) {
  const rows = dedupe(
    items.map((it) => ({ ...mapDuplicata(it), ...extra })).filter((r) => r.branch_code != null && r.supplier_code != null && r.duplicate_code != null && r.installment_code != null),
    chave,
  );
  if (!rows.length) return 0;
  return upsertLote('accounts_payable_duplicates', rows, 'branch_code,supplier_code,duplicate_code,installment_code', { chunk: 200 });
}

async function branchCodes(ctx) {
  if (ctx?.empresasTodas?.length) return ctx.empresasTodas;
  const { data } = await supabase.from('erp_empresas').select('code').limit(2000);
  const codes = (data || []).map((e) => e.code);
  if (!codes.length) throw new Error('erp_empresas vazia — rode o sync de empresas antes do contas a pagar');
  return codes;
}

/** Percorre duplicates/search com o filtro dado (branchCodeList é sempre incluído) e grava cada página. */
export async function buscarEGravar(filter, ctx = {}, rotulo = '') {
  const branchCodeList = await branchCodes(ctx);
  let gravados = 0;
  const r = await paginar({
    path: SEARCH_PATH,
    data: { filter: { branchCodeList, ...filter } },
    pageSize: PAGE_SIZE,
    log: (m) => ctx.log?.(`${rotulo}${m}`),
    onPage: async (items) => {
      gravados += await gravarDuplicatas(items);
    },
  });
  return { gravados, paginas: r.paginas, count: r.count };
}

const diasAtras = (d, n) => new Date(new Date(d).getTime() - n * 86400000);

/** Incremental: alterações desde o cursor + janela de emissão + janela de liquidação. */
export async function syncIncremental(ctx) {
  const ate = ctx.cursorAte || new Date();
  const desde = ctx.cursorDesde || new Date(MARCO_ZERO);
  const fim = fmtTotvsDate(ate);

  const alt = await buscarEGravar({ change: { startDate: fmtTotvsDate(desde), endDate: fim, inDuplicate: true } }, ctx, '[alterações] ');
  const emi = await buscarEGravar({ startIssueDate: fmtTotvsDate(diasAtras(ate, janelaEmissaoDias())), endIssueDate: fim }, ctx, '[emissão] ');
  const liq = await buscarEGravar({ startSettlementDate: fmtTotvsDate(diasAtras(ate, janelaLiquidacaoDias())), endSettlementDate: fim }, ctx, '[liquidação] ');

  return {
    registros: alt.gravados + emi.gravados + liq.gravados,
    paginas: alt.paginas + emi.paginas + liq.paginas,
    totalTotvs: null, // incremental não tem total comparável com a tabela inteira
    detalhes: {
      alteracoes: alt.gravados,
      janela_emissao: { dias: janelaEmissaoDias(), gravados: emi.gravados, totvs: emi.count },
      janela_liquidacao: { dias: janelaLiquidacaoDias(), gravados: liq.gravados, totvs: liq.count },
    },
  };
}

/** Carga por emissão em janelas mensais (a API aceita qualquer intervalo, mas mensal mantém as páginas curtas e permite retomar). */
export async function syncPeriodo(ctx, { desde, ate = new Date() }) {
  const inicio = new Date(`${String(desde).slice(0, 10)}T00:00:00`);
  const fim = new Date(ate);
  let gravados = 0;
  let paginas = 0;
  let total = 0;
  const meses = [];
  for (let d = new Date(inicio.getFullYear(), inicio.getMonth(), 1); d <= fim; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
    const a = d < inicio ? inicio : d;
    const ultimo = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59);
    const b = ultimo > fim ? fim : ultimo;
    const r = await buscarEGravar({ startIssueDate: fmtTotvsDate(a), endIssueDate: fmtTotvsDate(b) }, ctx, `[${a.toISOString().slice(0, 7)}] `);
    gravados += r.gravados;
    paginas += r.paginas;
    total += r.count || 0;
    meses.push({ mes: a.toISOString().slice(0, 7), totvs: r.count || 0, gravados: r.gravados });
    ctx.log?.(`  ${a.toISOString().slice(0, 7)}: ${r.gravados} parcelas (TOTVS ${r.count ?? '?'})`);
  }
  return { registros: gravados, paginas, totalTotvs: total, detalhes: { desde: String(desde).slice(0, 10), meses } };
}

// ─── Escritas do HeadCoach ─────────────────────────────────────────────────

/** Registra o comando enviado ao TOTVS (create/group) — nunca lança erro. */
export async function registrarComando({ command, payload, sucesso, http_status = null, resposta = null, erro = null, usuario = null, origem_tabela = null, origem_id = null }) {
  try {
    const { error } = await supabase.from('accounts_payable_commands').insert({
      command,
      branch_cnpj: digits(payload?.branchCnpj),
      supplier_cpf_cnpj: digits(payload?.supplierCpfCnpj),
      duplicate_code: num(payload?.duplicateCode),
      payload: payload ?? {},
      sucesso,
      http_status,
      resposta,
      erro: erro ? String(erro).slice(0, 2000) : null,
      usuario,
      origem_tabela,
      origem_id: origem_id != null ? String(origem_id) : null,
    });
    if (error) console.warn(`[contas-pagar] registrar comando: ${error.message}`);
  } catch (e) {
    console.warn(`[contas-pagar] registrar comando: ${e.message}`);
  }
}

const enumInt = (v) => (v === undefined || v === null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);

/**
 * Depois que o TOTVS aceita uma duplicata criada pelo HeadCoach, busca as
 * parcelas dela no próprio TOTVS (dados oficiais, com supplierCode etc.) e grava
 * com origem 'headcoach' + o comando enviado. Nunca lança erro.
 */
export async function sincronizarDuplicata({ branchCnpj, supplierCpfCnpj, duplicateCode, comando = null }) {
  try {
    const cnpj = digits(branchCnpj);
    const doc = digits(supplierCpfCnpj);
    let branchCodeList = [];
    if (cnpj) {
      const { data } = await supabase.from('erp_empresas').select('code').eq('cnpj', cnpj);
      branchCodeList = (data || []).map((e) => e.code);
    }
    if (!branchCodeList.length) branchCodeList = await branchCodes({});
    const d = await totvs('post', SEARCH_PATH, {
      data: { filter: { branchCodeList, duplicateCodeList: [Number(duplicateCode)] }, page: 1, pageSize: PAGE_SIZE },
    });
    const items = (d?.items || []).filter((it) => !doc || digits(it.supplierCpfCnpj) === doc);
    if (!items.length) {
      console.warn(`[contas-pagar] duplicata ${duplicateCode} ainda não aparece na busca do TOTVS — o job grava na próxima rodada`);
      return 0;
    }
    const porParcela = new Map((comando?.installments || []).map((i) => [Number(i.installmentCode), i]));
    let n = 0;
    for (const it of items) {
      const inst = porParcela.get(Number(it.installmentCode)) || {};
      n += await gravarDuplicatas([it], {
        origem: 'headcoach',
        comando,
        branch_cnpj: cnpj,
        document_type: enumInt(inst.Document ?? inst.document),
        prevision_type: enumInt(inst.Prevision ?? inst.prevision),
        stage_type: enumInt(inst.Stage ?? inst.stage),
        observation: inst.observation ?? comando?.observation ?? null,
      });
    }
    return n;
  } catch (e) {
    console.warn(`[contas-pagar] sincronizar duplicata ${duplicateCode}: ${e.message}`);
    return 0;
  }
}
