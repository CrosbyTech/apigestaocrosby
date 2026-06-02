// Debug: testa direto no TOTVS com diferentes filtros pra entender por que
// não retornou NFs.
import 'dotenv/config';
import axios from 'axios';
import { getToken } from '../utils/totvsTokenManager.js';
import { TOTVS_BASE_URL, httpsAgent, getBranchCodes } from '../totvsrouter/totvsHelper.js';

const tk = await getToken();
const token = tk.access_token;
const hoje = new Date();
const sessenta = new Date(hoje);
sessenta.setDate(sessenta.getDate() - 60);
const dmin = sessenta.toISOString().slice(0, 10);
const dmax = hoje.toISOString().slice(0, 10);
console.log(`Range: ${dmin} → ${dmax}\n`);

const branchCodeList = await getBranchCodes(token);
console.log(`Branches: ${branchCodeList.length}`);

// Teste 1: SEM branchCodeList (como tava na rota)
console.log('\n[1] SEM branchCodeList, ops 7254/7007/7255:');
try {
  const r = await axios.post(
    `${TOTVS_BASE_URL}/fiscal/v2/invoices/search`,
    {
      filter: {
        operationCodeList: [7254, 7007, 7255],
        operationType: 'Output',
        startIssueDate: `${dmin}T00:00:00`,
        endIssueDate: `${dmax}T23:59:59`,
      },
      expand: 'items', page: 1, pageSize: 100,
    },
    { headers: { Authorization: `Bearer ${token}` }, httpsAgent, timeout: 60000 },
  );
  console.log(`  ↳ items: ${r.data?.items?.length || 0}, totalItems: ${r.data?.totalItems}, totalPages: ${r.data?.totalPages}`);
  if (r.data?.items?.[0]) console.log('  amostra:', JSON.stringify(r.data.items[0]).slice(0, 200));
} catch (e) { console.log('  err:', e.response?.data?.message || e.message); }

// Teste 2: COM branchCodeList completo
console.log('\n[2] COM branchCodeList, ops 7254/7007/7255:');
try {
  const r = await axios.post(
    `${TOTVS_BASE_URL}/fiscal/v2/invoices/search`,
    {
      filter: {
        branchCodeList,
        operationCodeList: [7254, 7007, 7255],
        operationType: 'Output',
        startIssueDate: `${dmin}T00:00:00`,
        endIssueDate: `${dmax}T23:59:59`,
      },
      expand: 'items', page: 1, pageSize: 100,
    },
    { headers: { Authorization: `Bearer ${token}` }, httpsAgent, timeout: 60000 },
  );
  console.log(`  ↳ items: ${r.data?.items?.length || 0}, totalItems: ${r.data?.totalItems}, totalPages: ${r.data?.totalPages}`);
  if (r.data?.items?.[0]) {
    const i = r.data.items[0];
    console.log(`  amostra: branch=${i.branchCode} op=${i.operationCode} nf=${i.invoiceCode} val=${i.totalValue} cliente=${i.personName}`);
  }
} catch (e) { console.log('  err:', e.response?.data?.message || e.message); }

// Teste 3: Só op 7254 (showroom), 30 dias
const trinta = new Date(hoje);
trinta.setDate(trinta.getDate() - 30);
const dmin30 = trinta.toISOString().slice(0, 10);
console.log(`\n[3] COM branchCodeList, só op 7254, 30 dias (${dmin30} → ${dmax}):`);
try {
  const r = await axios.post(
    `${TOTVS_BASE_URL}/fiscal/v2/invoices/search`,
    {
      filter: {
        branchCodeList,
        operationCodeList: [7254],
        operationType: 'Output',
        startIssueDate: `${dmin30}T00:00:00`,
        endIssueDate: `${dmax}T23:59:59`,
      },
      expand: 'items', page: 1, pageSize: 100,
    },
    { headers: { Authorization: `Bearer ${token}` }, httpsAgent, timeout: 60000 },
  );
  console.log(`  ↳ items: ${r.data?.items?.length || 0}, totalItems: ${r.data?.totalItems}, totalPages: ${r.data?.totalPages}`);
} catch (e) { console.log('  err:', e.response?.data?.message || e.message); }
