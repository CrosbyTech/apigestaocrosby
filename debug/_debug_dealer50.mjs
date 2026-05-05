import axios from 'axios';
import https from 'https';
import { getToken } from './utils/totvsTokenManager.js';

const httpsAgent = new https.Agent({ rejectUnauthorized: false });
const tk = await getToken();
const token = tk.access_token;

// Sale-panel sellers/search retorna lista de vendedores ativos por branch
const r = await axios.post('https://www30.bhan.com.br:9443/api/totvsmoda/sale-panel/v2/sellers-list/search', {
  branchs: [99],
  datemin: '2026-01-01',
  datemax: '2026-12-31',
}, { headers: { Authorization: 'Bearer ' + token }, httpsAgent, timeout: 30000 });

const sellers = r.data?.dataRow || r.data?.items || [];
console.log(`Vendedores branch 99: ${sellers.length}`);
for (const s of sellers) {
  const code = s.seller_code || s.sellerCode || s.code;
  const name = s.seller_name || s.sellerName || s.name;
  if (code === 50 || String(code) === '50' ||
      code === 21 || String(code) === '21' ||
      (name || '').toUpperCase().includes('RAFAEL')) {
    console.log(`  ★ code=${code} | name=${name}`);
  }
}
console.log('\nTodos:');
for (const s of sellers) {
  console.log(`  ${s.seller_code || s.sellerCode || s.code} - ${s.seller_name || s.sellerName || s.name}`);
}
