import { getToken } from './utils/totvsTokenManager.js';
import { getBranchCodes, httpsAgent, TOTVS_BASE_URL } from './totvsrouter/totvsHelper.js';
import supabaseFiscal from './config/supabaseFiscal.js';
import axios from 'axios';

const parseDate = (v) => (v ? v.split('T')[0] : null);
const parseIntOrNull = (v) => { const n = parseInt(v); return isNaN(n) ? null : n; };
const parseFloatOrNull = (v) => { const n = parseFloat(v); return isNaN(n) ? null : n; };

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

const { access_token } = await getToken();
const branchCodeList = await getBranchCodes(access_token);

const r = await axios.post(`${TOTVS_BASE_URL}/fiscal/v2/invoices/search`, {
  filter: { branchCodeList, startIssueDate: '2026-04-18T00:00:00', endIssueDate: '2026-04-18T23:59:59', personCodeList: [118666] },
  expand: 'items', page: 1, pageSize: 50
}, { httpsAgent, headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' } });

const nfs = r.data?.items || [];
console.log('TOTVS Raquel 118666 em 18/04:', nfs.length, 'NFs');
nfs.forEach(n => {
  const dealers = new Set();
  (n.items || []).forEach(it => (it.products || []).forEach(p => { if (p.dealerCode) dealers.add(p.dealerCode); }));
  console.log('  tx:', n.transactionCode, 'op:', n.operationCode, 'opName:', n.operationName, 'R$' + n.totalValue, 'status:', n.invoiceStatus, 'dealers:', [...dealers].join(','));
});

// Inserir NF faltante (tx 828012)
const missing = nfs.find(n => n.transactionCode === '828012' || parseInt(n.transactionCode) === 828012);
if (missing) {
  const row = mapNfToRow(missing);
  const { error } = await supabaseFiscal.from('notas_fiscais').upsert(row, { onConflict: 'branch_code,transaction_code,invoice_code,issue_date,total_value' });
  if (error) console.error('❌ Erro upsert:', error.message);
  else console.log('\n✅ NF tx:828012 (R$1389.94) inserida no banco!');
} else {
  console.log('\n⚠️ NF tx:828012 não encontrada na consulta TOTVS');
}
