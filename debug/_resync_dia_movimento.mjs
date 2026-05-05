/**
 * Re-sync manual de um dia específico usando MOVEMENT date (saída física)
 * em vez de ISSUE date (emissão).
 *
 * Necessário porque algumas NFs (especialmente branch 200 / PB-Outlet) têm
 * issueDate em outro dia mas movementDate no dia que aparece no Sale Panel.
 *
 * Uso: node _resync_dia_movimento.mjs 2025-04-01
 */
import { getToken } from './utils/totvsTokenManager.js';
import { getBranchCodes, httpsAgent, TOTVS_BASE_URL } from './totvsrouter/totvsHelper.js';
import supabaseFiscal from './config/supabaseFiscal.js';
import axios from 'axios';

const targetDate = process.argv[2];
if (!targetDate || !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
  console.error('Uso: node _resync_dia_movimento.mjs YYYY-MM-DD');
  process.exit(1);
}

const startMov = `${targetDate}T00:00:00`;
const endMov = `${targetDate}T23:59:59`;

const PAGE_SIZE = 100;
const PAGE_CONCURRENCY = 6;
const BATCH_SIZE = 200;

const parseDate = (v) => (v ? v.split('T')[0] : null);
const parseIntOrNull = (v) => { const n = parseInt(v); return isNaN(n) ? null : n; };
const parseFloatOrNull = (v) => { const n = parseFloat(v); return isNaN(n) ? null : n; };

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
    operation_name: nf.operationName ?? null,
    operation_model: nf.operationModel ?? null,
    cfop: parseIntOrNull(nf.cfop),
    dealer_code: parseIntOrNull(nf.sellerCode),
    payment_condition_code: parseIntOrNull(nf.paymentConditionCode),
    total_value: parseFloatOrNull(nf.totalValue),
    gross_value: parseFloatOrNull(nf.grossValue),
    net_value: parseFloatOrNull(nf.netValue),
    discount_value: parseFloatOrNull(nf.discountValue),
    addition_value: parseFloatOrNull(nf.additionValue),
    freight_value: parseFloatOrNull(nf.freightValue),
    insurance_value: parseFloatOrNull(nf.insuranceValue),
    other_expenses_value: parseFloatOrNull(nf.otherExpensesValue),
    icms_value: parseFloatOrNull(nf.icmsValue),
    icms_st_value: parseFloatOrNull(nf.icmsStValue),
    icms_base_value: parseFloatOrNull(nf.icmsBaseValue),
    ipi_value: parseFloatOrNull(nf.ipiValue),
    pis_value: parseFloatOrNull(nf.pisValue),
    cofins_value: parseFloatOrNull(nf.cofinsValue),
    nfe_status: nf.nfeStatus ?? null,
    nfe_protocol: nf.nfeProtocol ?? null,
    nfe_authorization_date: parseDate(nf.nfeAuthorizationDate),
    nfe_chave: nf.nfeKey ?? null,
    nfe_returned_value: parseFloatOrNull(nf.nfeReturnedValue),
    observation_nf: nf.observationNF ?? null,
    observation_nfe: nf.observationNFE ?? null,
    referenced_tax_invoice: nf.referencedTaxInvoice ?? null,
    items: nf.items ?? [],
    raw_data: nf,
    synced_at: new Date().toISOString(),
  };
}

// Busca lista de invoiceCodes via fiscal-movement (que respeita movementDate)
async function fetchInvoiceCodesByMovement(branchCodeList, accessToken) {
  const endpoint = `${TOTVS_BASE_URL}/analytics/v2/fiscal-movement/search`;
  const allInvoiceKeys = new Set();

  const fetchPage = async (page) => {
    const res = await axios.post(endpoint, {
      filter: {
        branchCodeList,
        startMovementDate: startMov,
        endMovementDate: endMov,
      },
      page,
      pageSize: PAGE_SIZE,
    }, {
      httpsAgent,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
      timeout: 120000,
    });
    return res.data;
  };

  const first = await fetchPage(1);
  const items = [...(first?.items || [])];
  const totalPages = first?.totalPages ?? (first?.totalItems ? Math.ceil(first.totalItems / PAGE_SIZE) : 0);
  console.log(`  fiscal-movement página 1/${totalPages} — ${first?.totalItems ?? '?'} itens`);

  if (totalPages > 1) {
    const remaining = Array.from({ length: totalPages - 1 }, (_, i) => i + 2);
    for (let i = 0; i < remaining.length; i += PAGE_CONCURRENCY) {
      const batch = remaining.slice(i, i + PAGE_CONCURRENCY);
      const results = await Promise.all(batch.map(fetchPage));
      for (const pd of results) items.push(...(pd?.items || []));
      console.log(`  fiscal-movement páginas ${batch[0]}-${batch[batch.length-1]}/${totalPages} OK`);
    }
  }

  // Coleta keys: branchCode + invoiceCode + transactionCode (se disponíveis)
  for (const it of items) {
    if (it.branchCode && (it.invoiceCode || it.transactionCode)) {
      allInvoiceKeys.add(`${it.branchCode}|${it.transactionCode || it.invoiceCode}`);
    }
  }
  return { items, allInvoiceKeys };
}

// Busca a NF completa via fiscal/v2/invoices/search por keys
async function fetchInvoiceByKey(branchCode, transactionCode, accessToken) {
  const endpoint = `${TOTVS_BASE_URL}/fiscal/v2/invoices/search`;
  const res = await axios.post(endpoint, {
    filter: {
      branchCodeList: [branchCode],
      transactionCodeList: [transactionCode],
    },
    expand: 'items',
    page: 1,
    pageSize: 10,
  }, {
    httpsAgent,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
    timeout: 60000,
  }).catch(() => ({ data: { items: [] } }));
  return res.data?.items || [];
}

// ─── Main ─────────────────────────────────────────────────────────────────────
console.log(`\n🔄 Re-sync por MOVEMENT date - dia ${targetDate} (${startMov} → ${endMov})`);

const tokenData = await getToken();
if (!tokenData?.access_token) { console.error('❌ Token não obtido'); process.exit(1); }

const branchCodeList = await getBranchCodes(tokenData.access_token);
console.log(`🏢 ${branchCodeList.length} filiais`);

const { allInvoiceKeys } = await fetchInvoiceCodesByMovement(branchCodeList, tokenData.access_token);
console.log(`📋 ${allInvoiceKeys.size} NFs únicas com movement em ${targetDate}`);

// Busca NFs completas via fiscal/v2/invoices/search por (branch + transaction)
const allItems = [];
const keysList = [...allInvoiceKeys];
console.log('📥 Buscando NFs completas...');
for (let i = 0; i < keysList.length; i += PAGE_CONCURRENCY) {
  const batch = keysList.slice(i, i + PAGE_CONCURRENCY);
  const results = await Promise.all(batch.map((k) => {
    const [branchCode, transactionCode] = k.split('|').map(Number);
    return fetchInvoiceByKey(branchCode, transactionCode, tokenData.access_token);
  }));
  for (const arr of results) allItems.push(...arr);
  if ((i + PAGE_CONCURRENCY) % 60 === 0) console.log(`  ${Math.min(i+PAGE_CONCURRENCY, keysList.length)}/${keysList.length} chamadas...`);
}
console.log(`📄 ${allItems.length} NFs detalhadas obtidas`);

if (allItems.length === 0) { console.log('Nenhuma NF retornada.'); process.exit(0); }

const rows = allItems.map(mapNfToRow).filter(r => r.branch_code && r.transaction_code);
const seen = new Set();
const uniqueRows = rows.filter(r => {
  const key = `${r.branch_code}|${r.transaction_code}|${r.invoice_code}|${r.issue_date}|${r.total_value}`;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});
console.log(`📊 ${rows.length} → ${uniqueRows.length} únicos`);

let totalUpserted = 0;
for (let i = 0; i < uniqueRows.length; i += BATCH_SIZE) {
  const batch = uniqueRows.slice(i, i + BATCH_SIZE);
  const { error, count } = await supabaseFiscal
    .from('notas_fiscais')
    .upsert(batch, {
      onConflict: 'branch_code,transaction_code,invoice_code,issue_date,total_value',
      count: 'exact',
    });
  if (error) { console.error(`❌ Erro upsert lote: ${error.message}`); process.exit(1); }
  totalUpserted += count ?? batch.length;
  console.log(`  Lote ${Math.floor(i/BATCH_SIZE)+1}: ${count ?? batch.length} NFs salvas`);
}

console.log(`\n✅ Concluído: ${totalUpserted} NFs upserted (movement date) para ${targetDate}`);
