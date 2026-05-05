import { getToken } from './utils/totvsTokenManager.js';
import { getBranchCodes, httpsAgent, TOTVS_BASE_URL } from './totvsrouter/totvsHelper.js';
import supabaseFiscal from './config/supabaseFiscal.js';
import axios from 'axios';

const PAGE_SIZE = 100;
const BATCH_SIZE = 200;
const parseDate = (v) => (v ? v.split('T')[0] : null);
const parseIntOrNull = (v) => { const n = parseInt(v); return isNaN(n) ? null : n; };
const parseFloatOrNull = (v) => { const n = parseFloat(v); return isNaN(n) ? null : n; };

async function fetchAllPages(branchCodeList, startIssueDate, endIssueDate, accessToken) {
  const endpoint = `${TOTVS_BASE_URL}/fiscal/v2/invoices/search`;
  const doRequest = async (page) => axios.post(endpoint, {
    filter: { branchCodeList, startIssueDate, endIssueDate },
    expand: 'items', page, pageSize: PAGE_SIZE, order: 'issueDate:desc'
  }, { httpsAgent, headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } });

  const first = await doRequest(1);
  const total = first.data?.total || 0;
  const pages = Math.ceil(total / PAGE_SIZE);
  const all = [...(first.data?.items || [])];
  for (let p = 2; p <= pages; p++) {
    const r = await doRequest(p);
    all.push(...(r.data?.items || []));
  }
  return all;
}

const mapNfToRow = (nf) => ({
  branch_code: parseIntOrNull(nf.branchCode),
  transaction_code: parseIntOrNull(nf.transactionCode),
  invoice_code: nf.invoiceCode || null,
  serial_code: nf.serialCode || null,
  issue_date: parseDate(nf.issueDate),
  transaction_date: parseDate(nf.transactionDate),
  transaction_branch_code: parseIntOrNull(nf.transactionBranchCode),
  invoice_status: nf.invoiceStatus || null,
  branch_cnpj: nf.branchCnpj || null,
  person_code: parseIntOrNull(nf.personCode),
  person_name: nf.personName || null,
  operation_name: nf.operationName || null,
  operation_code: parseIntOrNull(nf.operationCode),
  operation_type: nf.operationType || null,
  total_value: parseFloatOrNull(nf.totalValue),
  product_value: parseFloatOrNull(nf.productValue),
  discount_value: parseFloatOrNull(nf.discountValue),
  discount_percentage: parseFloatOrNull(nf.discountPercentage),
  freight_value: parseFloatOrNull(nf.freightValue),
  insurance_value: parseFloatOrNull(nf.insuranceValue),
  other_expenses: parseFloatOrNull(nf.otherExpenses),
  ipi_value: parseFloatOrNull(nf.ipiValue),
  icms_st_value: parseFloatOrNull(nf.icmsStValue),
  pis_value: parseFloatOrNull(nf.pisValue),
  cofins_value: parseFloatOrNull(nf.cofinsValue),
  quantity: parseFloatOrNull(nf.quantity),
  items: nf.items || [],
  raw_data: nf,
});

const datas = ['2026-04-18', '2026-04-19', '2026-04-20', '2026-04-21', '2026-04-22'];

const tokenData = await getToken();
if (!tokenData?.access_token) { console.error('❌ Token falhou'); process.exit(1); }
const branchCodeList = await getBranchCodes(tokenData.access_token);
console.log(`✅ Token OK | ${branchCodeList.length} filiais`);

for (const data of datas) {
  const start = `${data}T00:00:00`;
  const end   = `${data}T23:59:59`;
  console.log(`\n📅 Buscando ${data}...`);

  const items = await fetchAllPages(branchCodeList, start, end, tokenData.access_token);
  console.log(`  → ${items.length} NFs da TOTVS`);
  if (!items.length) continue;

  const rows = items.map(mapNfToRow).filter(r => r.branch_code && r.transaction_code);

  const seen = new Set();
  const uniqueRows = rows.filter(r => {
    const k = `${r.branch_code}|${r.transaction_code}|${r.invoice_code}|${r.issue_date}|${r.total_value}`;
    if (seen.has(k)) return false; seen.add(k); return true;
  });

  let upserted = 0;
  for (let i = 0; i < uniqueRows.length; i += BATCH_SIZE) {
    const batch = uniqueRows.slice(i, i + BATCH_SIZE);
    const { error, count } = await supabaseFiscal.from('notas_fiscais').upsert(batch, {
      onConflict: 'branch_code,transaction_code,invoice_code,issue_date,total_value',
      count: 'exact'
    });
    if (error) { console.error(`  ❌ Upsert erro: ${error.message}`); break; }
    upserted += count ?? batch.length;
  }
  console.log(`  ✅ ${upserted} NFs salvas para ${data}`);
}

console.log('\n🎉 Sincronização concluída!');
