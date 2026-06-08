/**
 * Job: Atualização automática de faturamento diário
 * Horário: Todo dia às 1:30 AM (fuso horário America/Sao_Paulo)
 * Busca notas fiscais do dia anterior na TOTVS e salva no Supabase Fiscal.
 */

import cron from 'node-cron';
import axios from 'axios';
import { getToken } from '../utils/totvsTokenManager.js';
import { getBranchCodes } from '../totvsrouter/totvsHelper.js';
import { httpsAgent, TOTVS_BASE_URL } from '../totvsrouter/totvsHelper.js';
import supabaseFiscal from '../config/supabaseFiscal.js';

const PAGE_SIZE = 100;
const PAGE_CONCURRENCY = 6;
const BATCH_SIZE = 200;

// ─── Helpers de parsing ────────────────────────────────────────────────────────
const parseDate = (v) => (v ? v.split('T')[0] : null);
const parseIntOrNull = (v) => {
  const n = parseInt(v);
  return isNaN(n) ? null : n;
};
const parseFloatOrNull = (v) => {
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
};

// ─── Busca todas as páginas de um range ───────────────────────────────────────
async function fetchAllPages(
  branchCodeList,
  startIssueDate,
  endIssueDate,
  accessToken,
) {
  const endpoint = `${TOTVS_BASE_URL}/fiscal/v2/invoices/search`;

  const doRequest = async (page, token) =>
    axios.post(
      endpoint,
      {
        filter: { branchCodeList, startIssueDate, endIssueDate },
        expand: 'items',
        page,
        pageSize: PAGE_SIZE,
        order: 'issueDate:desc',
      },
      {
        httpsAgent,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
        timeout: 120000,
      },
    );

  const fetchPage = async (page, retries = 3) => {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const res = await doRequest(page, accessToken);
        return res.data;
      } catch (err) {
        if (err.response?.status === 401) {
          const newToken = await getToken(true);
          accessToken = newToken.access_token;
          const res = await doRequest(page, accessToken);
          return res.data;
        }
        if (attempt < retries) {
          console.warn(
            `⚠️ [faturamento-diario] Retry ${attempt}/${retries} página ${page}`,
          );
          continue;
        }
        throw err;
      }
    }
  };

  const first = await fetchPage(1);
  const items = [...(first?.items || [])];
  const totalPages =
    first?.totalPages ??
    (first?.totalItems ? Math.ceil(first.totalItems / PAGE_SIZE) : 0);

  if (totalPages > 1) {
    const remaining = Array.from({ length: totalPages - 1 }, (_, i) => i + 2);
    for (let i = 0; i < remaining.length; i += PAGE_CONCURRENCY) {
      const batch = remaining.slice(i, i + PAGE_CONCURRENCY);
      const results = await Promise.all(batch.map((p) => fetchPage(p)));
      for (const pd of results) {
        items.push(...(pd?.items || []));
      }
    }
  } else if (first?.hasNext === true) {
    let p = 2;
    while (p <= 500) {
      const pd = await fetchPage(p);
      const pg = pd?.items || [];
      if (pg.length === 0) break;
      items.push(...pg);
      if (!pd?.hasNext || pg.length < PAGE_SIZE) break;
      p++;
    }
  }

  return items;
}

// ─── Mapeia NF para linha do banco ────────────────────────────────────────────
function mapNfToRow(nf) {
  return {
    branch_code: parseIntOrNull(nf.branchCode),
    branch_cnpj: nf.branchCnpj ?? null,
    transaction_code: parseIntOrNull(nf.transactionCode),
    transaction_branch_code: parseIntOrNull(nf.transactionBranchCode),
    transaction_date: parseDate(nf.transactionDate),
    invoice_code: nf.invoiceCode ?? null,
    invoice_sequence: parseIntOrNull(nf.invoiceSequence),
    serial_code: nf.serialCode ?? null,
    invoice_status: nf.invoiceStatus ?? null,
    issue_date: parseDate(nf.issueDate) || parseDate(nf.invoiceDate),
    invoice_date: parseDate(nf.invoiceDate),
    release_date: parseDate(nf.releaseDate),
    exit_time: nf.exitTime ?? null,
    last_change_date: nf.lastchangeDate ?? null,
    max_change_filter_date: nf.maxChangeFilterDate ?? null,
    person_code: parseIntOrNull(nf.personCode),
    person_name: nf.personName ?? null,
    person_cpf_cnpj: nf.person?.personCpfCnpj ?? nf.personCpfCnpj ?? null,
    person: nf.person ?? null,
    origin: nf.origin ?? null,
    document_type_code: parseIntOrNull(nf.documentType),
    operation_type: nf.operationType ?? null,
    operation_code: parseIntOrNull(nf.operationCode),
    operation_name: nf.operatioName ?? nf.operationName ?? null,
    inclusion_component_code: nf.inclusionComponentCode ?? null,
    peripheral_pdv_code: nf.peripheralPdvCode ?? null,
    version_pdv: nf.versionPdv ?? null,
    mobile_version: nf.mobileVersion ?? null,
    id_document_pdv: nf.idDocumentPDV ?? null,
    user_code: parseIntOrNull(nf.userCode),
    terminal_code: parseIntOrNull(nf.terminalCode),
    payment_condition_code: parseIntOrNull(nf.paymentConditionCode),
    payment_condition_name: nf.paymentConditionName ?? null,
    quantity: parseFloatOrNull(nf.quantity),
    product_value: parseFloatOrNull(nf.productValue),
    additional_value: parseFloatOrNull(nf.additionalValue),
    discount_value: parseFloatOrNull(nf.discountValue),
    discount_percentage: parseFloatOrNull(nf.discountPercentage),
    shipping_value: parseFloatOrNull(nf.shippingValue),
    freight_value: parseFloatOrNull(
      nf.shippingCompany?.freightValue ?? nf.freightValue,
    ),
    insurance_value: parseFloatOrNull(nf.insuranceValue),
    other_expenses: parseFloatOrNull(nf.otherExpenses),
    ipi_value: parseFloatOrNull(nf.ipiValue),
    base_icms_value: parseFloatOrNull(nf.baseIcmsValue),
    icms_value: parseFloatOrNull(nf.icmsValue),
    icms_st_value: parseFloatOrNull(nf.icmsStValue),
    icms_sub_st_value: parseFloatOrNull(nf.icmsSubStValue),
    pis_value: parseFloatOrNull(nf.pisValue),
    cofins_value: parseFloatOrNull(nf.cofinsValue),
    total_value: parseFloatOrNull(nf.totalValue),
    seller_cpf: nf.sellerCpf ?? null,
    eletronic_invoice_status:
      nf.eletronic?.electronicInvoiceStatus ??
      nf.eletronicInvoiceStatus ??
      null,
    eletronic: nf.eletronic ?? null,
    shipping_company_code: parseIntOrNull(
      nf.shippingCompany?.shippingCompanyCode ?? nf.shippingCompanyCode,
    ),
    shipping_company_cpf_cnpj:
      nf.shippingCompany?.cpfCnpj ?? nf.shippingCompanyCpfCnpj ?? null,
    shipping_company: nf.shippingCompany ?? null,
    ecf: nf.ecf ?? null,
    sat: nf.sat ?? null,
    production_order: nf.productionOrder ?? null,
    sales_order: nf.salesOrder ?? null,
    payments: nf.payments ?? null,
    observation_nf: nf.observationNF ?? null,
    observation_nfe: nf.observationNFE ?? null,
    referenced_tax_invoice: nf.referencedTaxInvoice ?? null,
    items: nf.items ?? [],
    raw_data: nf,
    synced_at: new Date().toISOString(),
  };
}

// ─── Lógica principal ─────────────────────────────────────────────────────────
// opts.datemin / opts.datemax — YYYY-MM-DD. Se omitidos, usa "ontem" (D-1, comportamento do cron).
// Retorna: { ok, dateRange, totalUpserted, totalProcessed }
export async function executarFaturamentoDiario(opts = {}) {
  let dataMinStr, dataMaxStr;
  if (opts.datemin && opts.datemax) {
    dataMinStr = String(opts.datemin).slice(0, 10);
    dataMaxStr = String(opts.datemax).slice(0, 10);
  } else {
    const ontem = new Date();
    ontem.setDate(ontem.getDate() - 1);
    dataMinStr = ontem.toISOString().split('T')[0];
    dataMaxStr = dataMinStr;
  }
  const startIssueDate = `${dataMinStr}T00:00:00`;
  const endIssueDate = `${dataMaxStr}T23:59:59`;
  const isRange = dataMinStr !== dataMaxStr;
  const label = isRange ? `${dataMinStr} → ${dataMaxStr}` : dataMinStr;

  console.log(`\n🕐 [faturamento-diario] Iniciando atualização para ${label}`);

  const result = { ok: false, dateRange: label, totalUpserted: 0, totalProcessed: 0 };

  try {
    // 1. Obter token
    const tokenData = await getToken();
    if (!tokenData?.access_token) {
      console.error('❌ [faturamento-diario] Não foi possível obter token TOTVS');
      return result;
    }

    // 2. Obter lista de filiais
    const branchCodeList = await getBranchCodes(tokenData.access_token);
    console.log(`🏢 [faturamento-diario] ${branchCodeList.length} filiais encontradas`);

    // 3. Buscar notas fiscais
    const items = await fetchAllPages(
      branchCodeList,
      startIssueDate,
      endIssueDate,
      tokenData.access_token,
    );
    console.log(`📄 [faturamento-diario] ${items.length} notas fiscais obtidas`);

    if (items.length === 0) {
      console.log(`ℹ️ [faturamento-diario] Nenhuma nota fiscal encontrada (${label})`);
      result.ok = true;
      return result;
    }

    // 4. Mapear e filtrar registros válidos
    const rows = items
      .map(mapNfToRow)
      .filter((r) => r.branch_code && r.transaction_code);

    // 5. Deduplicar
    const seen = new Set();
    const uniqueRows = rows.filter((r) => {
      const key = `${r.branch_code}|${r.transaction_code}|${r.invoice_code}|${r.issue_date}|${r.total_value}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    console.log(
      `📊 [faturamento-diario] ${rows.length} registros → ${uniqueRows.length} únicos (${rows.length - uniqueRows.length} duplicados)`,
    );
    result.totalProcessed = uniqueRows.length;

    // 6. Upsert no banco em lotes
    let totalUpserted = 0;
    for (let i = 0; i < uniqueRows.length; i += BATCH_SIZE) {
      const batch = uniqueRows.slice(i, i + BATCH_SIZE);
      const { error, count } = await supabaseFiscal
        .from('notas_fiscais')
        .upsert(batch, {
          onConflict: 'branch_code,transaction_code,invoice_code,issue_date,total_value',
          count: 'exact',
        });

      if (error) {
        console.error(
          `❌ [faturamento-diario] Erro no upsert (lote ${Math.floor(i / BATCH_SIZE) + 1}): ${error.message}`,
        );
        return result;
      }
      totalUpserted += count ?? batch.length;
    }
    result.totalUpserted = totalUpserted;
    result.ok = true;

    console.log(`✅ [faturamento-diario] Concluído: ${totalUpserted} notas fiscais salvas para ${label}\n`);
  } catch (err) {
    console.error(`❌ [faturamento-diario] Erro inesperado:`, err.message);
  }
  return result;
}

// ─── Agendamento: todo dia às 1:30 AM (Brasília) ─────────────────────────────
export function iniciarJobFaturamentoDiario() {
  // Expressão cron: minuto=30, hora=1, qualquer dia
  const task = cron.schedule('30 1 * * *', executarFaturamentoDiario, {
    timezone: 'America/Sao_Paulo',
  });

  console.log(
    '⏰ [faturamento-diario] Job agendado para 01:30 (America/Sao_Paulo) todos os dias',
  );
  return task;
}
