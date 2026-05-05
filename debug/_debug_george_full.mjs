import axios from 'axios';
import https from 'https';
import { getToken } from './utils/totvsTokenManager.js';

const httpsAgent = new https.Agent({ rejectUnauthorized: false });
const tk = await getToken();
const token = tk.access_token;

const r = await axios.post('https://www30.bhan.com.br:9443/api/totvsmoda/fiscal/v2/invoices/search', {
  filter: {
    branchCodeList: [99],
    operationType: 'Output',
    operationCodeList: [7235],
    startIssueDate: '2026-04-18T00:00:00',
    endIssueDate: '2026-04-18T23:59:59',
  },
  expand: 'items',
  page: 1,
  pageSize: 100,
}, { headers: { Authorization: 'Bearer ' + token }, httpsAgent, timeout: 60000 });

const nfs = r.data.items || [];
const georgeNf = nfs.find(n => Number(n.personCode) === 115295);
if (georgeNf) {
  // Print all NF top-level fields (não items para não bagunçar)
  const { items, ...header } = georgeNf;
  console.log('Header da NF do GEORGE:');
  console.log(JSON.stringify(header, null, 2));
  console.log('\nItems (1º):');
  if (items?.[0]) {
    const { products, ...itemHdr } = items[0];
    console.log(JSON.stringify(itemHdr, null, 2));
    console.log('\nProducts (1º):');
    if (products?.[0]) console.log(JSON.stringify(products[0], null, 2));
  }
} else {
  console.log('NF não encontrada nesse range');
}
