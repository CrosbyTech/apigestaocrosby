// Testa endpoints de pagamento do Wix pra pegar método (cartão/pix/boleto)
import 'dotenv/config';
import axios from 'axios';

const API_KEY = process.env.WIX_API_KEY;
const SITE_ID = process.env.WIX_SITE_ID;
const ACCOUNT_ID = process.env.WIX_ACCOUNT_ID;
const ORDER_ID = '78ee7c47-c8c4-422b-83c4-c879596a2b09'; // pedido #10106 do Bruno

const headers = {
  Authorization: API_KEY,
  'wix-account-id': ACCOUNT_ID,
  'wix-site-id': SITE_ID,
  'Content-Type': 'application/json',
};

// Pega o order ID real
import supabase from './config/supabase.js';
const { data: ped } = await supabase
  .from('wix_pedidos')
  .select('id, numero, raw')
  .order('criado_em', { ascending: false })
  .limit(3);
console.log('IDs de teste:', ped.map((p) => `#${p.numero} = ${p.id}`).join(', '));

// Tenta diferentes endpoints
const tries = [
  {
    nome: 'payment-transactions/v3/list (por orderId)',
    url: 'https://www.wixapis.com/payment-transactions/v3/list-payment-transactions-for-multiple-orders',
    body: { orderIds: ped.map((p) => p.id) },
  },
  {
    nome: 'payments/v1/transactions/query',
    url: 'https://www.wixapis.com/payments/v1/transactions/query',
    body: { query: { filter: { orderId: { $in: ped.map((p) => p.id) } } } },
  },
  {
    nome: `ecom/v1/orders/${ped[0].id} (expand=payments)`,
    method: 'GET',
    url: `https://www.wixapis.com/ecom/v1/orders/${ped[0].id}?expand=payments`,
  },
  {
    nome: `orders/v1/${ped[0].id}`,
    method: 'GET',
    url: `https://www.wixapis.com/orders/v1/${ped[0].id}`,
  },
];

for (const t of tries) {
  console.log(`\n=== ${t.nome} ===`);
  try {
    const r = t.method === 'GET'
      ? await axios.get(t.url, { headers, timeout: 15000 })
      : await axios.post(t.url, t.body, { headers, timeout: 15000 });
    console.log(`✅ HTTP ${r.status}`);
    const txt = JSON.stringify(r.data, null, 2);
    console.log(txt.slice(0, 1500));
    if (txt.length > 1500) console.log('   ... truncated');
  } catch (e) {
    const status = e.response?.status;
    const msg = JSON.stringify(e.response?.data || {}).slice(0, 200);
    console.log(`❌ HTTP ${status}: ${msg}`);
  }
}
process.exit(0);
