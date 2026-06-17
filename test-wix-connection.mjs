// Teste de conexão com Wix — valida credenciais e lista alguns pedidos
import 'dotenv/config';
import axios from 'axios';

const API_KEY = process.env.WIX_API_KEY;
const SITE_ID = process.env.WIX_SITE_ID;
const ACCOUNT_ID = process.env.WIX_ACCOUNT_ID;

if (!API_KEY || !SITE_ID || !ACCOUNT_ID) {
  console.error('❌ Faltam credenciais no .env');
  process.exit(1);
}

const headers = {
  Authorization: API_KEY,
  'wix-account-id': ACCOUNT_ID,
  'wix-site-id': SITE_ID,
  'Content-Type': 'application/json',
};

// Tenta os endpoints atuais (eCommerce v1) e legacy (Stores v2)
const endpoints = [
  {
    nome: 'eCommerce v1 (atual)',
    url: 'https://www.wixapis.com/ecom/v1/orders/search',
    body: { search: { cursorPaging: { limit: 5 } } },
  },
  {
    nome: 'Stores v2 (legacy)',
    url: 'https://www.wixapis.com/stores/v2/orders/query',
    body: { query: { paging: { limit: 5 } } },
  },
];

for (const ep of endpoints) {
  console.log(`\n=== ${ep.nome} ===`);
  console.log(`POST ${ep.url}`);
  try {
    const r = await axios.post(ep.url, ep.body, { headers, timeout: 20000 });
    console.log(`✅ HTTP ${r.status}`);
    const orders = r.data?.orders || [];
    const meta = r.data?.metadata || r.data?.metaData || {};
    console.log(`   Total: ${meta.totalCount ?? 'n/a'}  |  Retornados: ${orders.length}`);
    if (orders.length > 0) {
      console.log(`\n📦 Últimos pedidos:`);
      for (const o of orders.slice(0, 5)) {
        const num = o.number || o.id?.slice(0, 8);
        const date = (o._createdDate || o.dateCreated || '').slice(0, 10);
        const customer = o.billingInfo?.contactDetails?.firstName || o.buyerInfo?.firstName || o.recipientInfo?.contactDetails?.firstName || '(sem nome)';
        const lastName = o.billingInfo?.contactDetails?.lastName || o.buyerInfo?.lastName || '';
        const total = o.priceSummary?.total?.formattedAmount || o.totals?.total || o.totalPrice?.formattedValue || '?';
        const status = o.status || o.fulfillmentStatus || '?';
        console.log(`   #${num}  ${date}  ${customer} ${lastName}  ${total}  [${status}]`);
      }
    }
    // Mostra um pedido completo (primeiro) pra entender o shape
    if (orders[0]) {
      console.log(`\n📄 Shape do 1º pedido (campos disponíveis):`);
      console.log('   ', Object.keys(orders[0]).join(', '));
    }
    break; // Achou um endpoint que funciona, para
  } catch (e) {
    const status = e.response?.status;
    const msg = e.response?.data?.message || e.response?.data?.error_description || e.message;
    console.log(`❌ HTTP ${status || 'err'}: ${msg}`);
    if (e.response?.data) {
      const detail = JSON.stringify(e.response.data).slice(0, 300);
      console.log(`   ${detail}`);
    }
  }
}

process.exit(0);
