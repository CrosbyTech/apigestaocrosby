// Procura o endpoint Wix de carrinhos abandonados
import 'dotenv/config';
import axios from 'axios';

const headers = {
  Authorization: process.env.WIX_API_KEY,
  'wix-account-id': process.env.WIX_ACCOUNT_ID,
  'wix-site-id': process.env.WIX_SITE_ID,
  'Content-Type': 'application/json',
};

const tries = [
  { nome: 'ecom/v1/abandoned-checkouts/search', url: 'https://www.wixapis.com/ecom/v1/abandoned-checkouts/search', body: { search: { cursorPaging: { limit: 5 } } } },
  { nome: 'ecom/v1/checkouts/search?abandoned', url: 'https://www.wixapis.com/ecom/v1/checkouts/search', body: { search: { filter: { abandoned: { $eq: true } }, cursorPaging: { limit: 5 } } } },
  { nome: 'ecom/v1/checkouts/list-abandoned', url: 'https://www.wixapis.com/ecom/v1/checkouts/list-abandoned', body: { cursorPaging: { limit: 5 } } },
  { nome: 'stores/v1/abandoned-carts/query', url: 'https://www.wixapis.com/stores/v1/abandoned-carts/query', body: { query: { paging: { limit: 5 } } } },
  { nome: 'shipping/v1/abandoned-checkouts/list', url: 'https://www.wixapis.com/abandoned-checkouts/v1/abandoned-checkouts/list', body: {} },
  { nome: 'ecommerce-data-extension/v1', url: 'https://www.wixapis.com/ecom/v1/cart-recovery/abandoned-checkouts', method: 'GET' },
];

for (const t of tries) {
  console.log(`\n=== ${t.nome} ===`);
  try {
    const r = t.method === 'GET'
      ? await axios.get(t.url, { headers, timeout: 15000 })
      : await axios.post(t.url, t.body, { headers, timeout: 15000 });
    console.log(`✅ HTTP ${r.status}`);
    const list = r.data?.abandonedCheckouts || r.data?.checkouts || r.data?.abandonedCarts || r.data?.items || r.data?.results || [];
    console.log(`Total retornados: ${list.length}`);
    if (list[0]) {
      console.log('1º:', JSON.stringify(list[0], null, 2).slice(0, 600));
    }
    break;
  } catch (e) {
    const status = e.response?.status;
    const msg = JSON.stringify(e.response?.data || {}).slice(0, 200);
    console.log(`❌ HTTP ${status}: ${msg}`);
  }
}
process.exit(0);
