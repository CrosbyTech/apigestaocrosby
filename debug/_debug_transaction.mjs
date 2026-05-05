import axios from 'axios';
import https from 'https';
import { getToken } from './utils/totvsTokenManager.js';

const httpsAgent = new https.Agent({ rejectUnauthorized: false });
const tk = await getToken();
const token = tk.access_token;

// 1. Dump COMPLETO de um item do fiscal-movement pra ver TODOS os campos
console.log('=== fiscal-movement (1 item completo) ===');
const r1 = await axios.post('https://www30.bhan.com.br:9443/api/totvsmoda/analytics/v2/fiscal-movement/search', {
  filter: {
    branchCodeList: [99],
    startMovementDate: '2026-04-18T00:00:00',
    endMovementDate: '2026-04-18T23:59:59',
  },
  page: 1,
  pageSize: 100,
}, { headers: { Authorization: 'Bearer ' + token }, httpsAgent, timeout: 60000 });
const it = r1.data.items.find(i => Number(i.personCode) === 115295);
if (it) console.log(JSON.stringify(it, null, 2));

// 2. Tenta endpoints relacionados a transações
console.log('\n=== Testa endpoints de transação ===');
const candidates = [
  '/sale-panel/v2/transactions/search',
  '/fiscal/v2/transactions/search',
  '/sale-panel/v2/movements/search',
  '/sale-panel/v2/sale-orders/search',
];
for (const path of candidates) {
  try {
    const r = await axios.post(`https://www30.bhan.com.br:9443/api/totvsmoda${path}`, {
      filter: {
        transactionCodeList: [827993],
        branchCodeList: [99],
      },
      page: 1, pageSize: 10,
    }, { headers: { Authorization: 'Bearer ' + token }, httpsAgent, timeout: 30000 });
    console.log(`✓ ${path}: ${(r.data?.items || []).length} items`);
    if ((r.data?.items || []).length > 0) {
      console.log(JSON.stringify(r.data.items[0], null, 2).slice(0, 1500));
    }
  } catch (err) {
    console.log(`✗ ${path}: ${err.response?.status} ${JSON.stringify(err.response?.data)?.slice(0,150)}`);
  }
}

// 3. fiscal/v2/invoices com expand="items" pra ver campo sellerCode no header
console.log('\n=== fiscal/v2/invoices full header (NF 9818) ===');
const r3 = await axios.post('https://www30.bhan.com.br:9443/api/totvsmoda/fiscal/v2/invoices/search', {
  filter: {
    branchCodeList: [99],
    operationType: 'Output',
    startIssueDate: '2026-04-18T00:00:00',
    endIssueDate: '2026-04-18T23:59:59',
  },
  expand: 'items',
  page: 1, pageSize: 100,
}, { headers: { Authorization: 'Bearer ' + token }, httpsAgent, timeout: 60000 });
const nf = r3.data.items.find(n => Number(n.personCode) === 115295);
if (nf) {
  const { items, ...header } = nf;
  console.log(JSON.stringify(header, null, 2));
}
