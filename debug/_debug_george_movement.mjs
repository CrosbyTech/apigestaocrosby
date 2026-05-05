import axios from 'axios';
import https from 'https';
import { getToken } from './utils/totvsTokenManager.js';

const httpsAgent = new https.Agent({ rejectUnauthorized: false });
const tk = await getToken();
const token = tk.access_token;

// fiscal-movement: retorna sellerCode no header
const r = await axios.post('https://www30.bhan.com.br:9443/api/totvsmoda/analytics/v2/fiscal-movement/search', {
  filter: {
    branchCodeList: [99],
    startMovementDate: '2026-04-18T00:00:00',
    endMovementDate: '2026-04-18T23:59:59',
  },
  page: 1,
  pageSize: 100,
}, { headers: { Authorization: 'Bearer ' + token }, httpsAgent, timeout: 60000 });

const items = r.data.items || [];
const georgeItems = items.filter(it => Number(it.personCode) === 115295);
console.log(`fiscal-movement 18/04 branch 99: ${items.length} itens`);
console.log(`Itens GEORGE (person 115295): ${georgeItems.length}`);
for (const it of georgeItems) {
  console.log(JSON.stringify({
    branchCode: it.branchCode,
    transactionCode: it.transactionCode,
    movementDate: it.movementDate,
    operationCode: it.operationCode,
    operationModel: it.operationModel,
    personCode: it.personCode,
    personName: it.personName,
    sellerCode: it.sellerCode,
    sellerName: it.sellerName,
    netValue: it.netValue,
    grossValue: it.grossValue,
    totalValue: it.totalValue,
  }, null, 2));
}

// Tenta também sale-panel/sellers/search com sellers=[21] para confirmar o que ele retorna
console.log('\n--- sale-panel/v2/sellers/search com sellers=[21] ---');
const r2 = await axios.post('https://www30.bhan.com.br:9443/api/totvsmoda/sale-panel/v2/sellers/search', {
  branchs: [99],
  operations: [7235, 7241, 9127],
  sellers: [21],
  datemin: '2026-04-01',
  datemax: '2026-04-30',
}, { headers: { Authorization: 'Bearer ' + token }, httpsAgent, timeout: 60000 });
console.log(JSON.stringify(r2.data, null, 2).slice(0, 2000));
