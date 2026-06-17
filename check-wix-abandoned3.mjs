import 'dotenv/config';
import axios from 'axios';

const headers = {
  Authorization: process.env.WIX_API_KEY,
  'wix-account-id': process.env.WIX_ACCOUNT_ID,
  'wix-site-id': process.env.WIX_SITE_ID,
  'Content-Type': 'application/json',
};

const tries = [
  { nome: 'GET abandoned-cart/v1/abandoned-carts', method: 'GET', url: 'https://www.wixapis.com/abandoned-cart/v1/abandoned-carts' },
  { nome: 'POST abandoned-cart/v1/abandoned-carts/query', url: 'https://www.wixapis.com/abandoned-cart/v1/abandoned-carts/query', body: { query: {} } },
  { nome: 'POST abandoned-cart/v1/abandoned-carts/search', url: 'https://www.wixapis.com/abandoned-cart/v1/abandoned-carts/search', body: { search: {} } },
  { nome: 'POST abandoned-cart/v3/abandoned-checkouts/query', url: 'https://www.wixapis.com/abandoned-cart/v3/abandoned-checkouts/query', body: { query: {} } },
  // E também 'crm' tem alguns
  { nome: 'POST crm/v3/abandoned-checkouts/search', url: 'https://www.wixapis.com/crm/v3/abandoned-checkouts/search', body: { search: {} } },
  // E o "wix-ecom-backend" pattern
  { nome: 'GET ecom/v1/abandoned-checkouts', method: 'GET', url: 'https://www.wixapis.com/ecom/v1/abandoned-checkouts' },
];

for (const t of tries) {
  process.stdout.write(`${t.nome.padEnd(55)} `);
  try {
    const r = t.method === 'GET'
      ? await axios.get(t.url, { headers, timeout: 10000 })
      : await axios.post(t.url, t.body || {}, { headers, timeout: 10000 });
    console.log(`✅ ${r.status}`);
    console.log('   keys:', Object.keys(r.data));
    if (r.data) console.log('   ' + JSON.stringify(r.data, null, 2).slice(0, 600));
  } catch (e) {
    const status = e.response?.status;
    const msg = (e.response?.data?.message || JSON.stringify(e.response?.data?.details || e.response?.data || {})).slice(0, 80);
    console.log(`❌ ${status}: ${msg}`);
  }
}
process.exit(0);
