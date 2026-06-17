// 2ª tentativa com endpoints alternativos
import 'dotenv/config';
import axios from 'axios';

const headers = {
  Authorization: process.env.WIX_API_KEY,
  'wix-account-id': process.env.WIX_ACCOUNT_ID,
  'wix-site-id': process.env.WIX_SITE_ID,
  'Content-Type': 'application/json',
};

const tries = [
  // Wix Cart API
  { nome: 'ecom/v1/carts', method: 'GET', url: 'https://www.wixapis.com/ecom/v1/carts' },
  { nome: 'cart/v1/abandoned-carts/search', url: 'https://www.wixapis.com/cart/v1/abandoned-carts/search', body: { search: { cursorPaging: { limit: 5 } } } },
  // V3 da abandoned checkouts
  { nome: 'v3/abandoned-checkouts/search', url: 'https://www.wixapis.com/v3/abandoned-checkouts/search', body: { search: { cursorPaging: { limit: 5 } } } },
  // Convention "list" em vez de "search"
  { nome: 'ecom/v1/abandoned-checkouts (POST list)', url: 'https://www.wixapis.com/ecom/v1/abandoned-checkouts/list', body: { paging: { limit: 5 } } },
  // Documented in some places as part of e-commerce
  { nome: 'ecom-platform/v1/abandoned-checkouts/search', url: 'https://www.wixapis.com/ecom-platform/v1/abandoned-checkouts/search', body: { search: { cursorPaging: { limit: 5 } } } },
  // App-collection style
  { nome: 'analytics/v1/abandoned-cart', method: 'GET', url: 'https://www.wixapis.com/analytics/v1/abandoned-cart' },
  // Inside Marketing
  { nome: 'marketing/v1/abandoned-cart/search', url: 'https://www.wixapis.com/marketing/v1/abandoned-cart/search', body: { paging: { limit: 5 } } },
];

for (const t of tries) {
  process.stdout.write(`${t.nome.padEnd(50)}`);
  try {
    const r = t.method === 'GET'
      ? await axios.get(t.url, { headers, timeout: 10000 })
      : await axios.post(t.url, t.body, { headers, timeout: 10000 });
    console.log(`✅ HTTP ${r.status}  keys=[${Object.keys(r.data).join(',')}]`);
    if (r.data) console.log(JSON.stringify(r.data, null, 2).slice(0, 800));
  } catch (e) {
    const status = e.response?.status;
    const msg = (e.response?.data?.message || JSON.stringify(e.response?.data || {})).slice(0, 80);
    console.log(`❌ ${status}: ${msg}`);
  }
}
process.exit(0);
