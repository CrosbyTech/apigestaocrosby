// Verifica se existem pedidos PAID no Wix e como vem o método de pagamento
import 'dotenv/config';
import axios from 'axios';

const headers = {
  Authorization: process.env.WIX_API_KEY,
  'wix-account-id': process.env.WIX_ACCOUNT_ID,
  'wix-site-id': process.env.WIX_SITE_ID,
  'Content-Type': 'application/json',
};

// Busca pedidos com paymentStatus = PAID
const r = await axios.post(
  'https://www.wixapis.com/ecom/v1/orders/search',
  {
    search: {
      filter: { paymentStatus: { $in: ['PAID', 'PARTIALLY_PAID'] } },
      cursorPaging: { limit: 5 },
    },
  },
  { headers, timeout: 20000 },
);

const orders = r.data?.orders || [];
console.log(`Pedidos PAID encontrados: ${orders.length}`);

for (const o of orders) {
  console.log(`\n=== #${o.number} (${o.paymentStatus}) ===`);
  // Procura activities relacionadas a pagamento
  const acts = (o.activities || []).filter((a) =>
    /PAID|REFUND|PAYMENT/i.test(a.type || a.activityType || ''),
  );
  for (const a of acts) {
    console.log(`Activity ${a.type}:`, JSON.stringify(a, null, 2).slice(0, 400));
  }
}

// Conta TODOS os status de pagamento que existem
console.log('\n\n=== Distribuição de paymentStatus em todos os pedidos ===');
const r2 = await axios.post(
  'https://www.wixapis.com/ecom/v1/orders/search',
  { search: { cursorPaging: { limit: 100 } } },
  { headers, timeout: 20000 },
);
const all = r2.data?.orders || [];
const dist = {};
for (const o of all) {
  const k = o.paymentStatus || 'unknown';
  dist[k] = (dist[k] || 0) + 1;
}
console.log(dist);
process.exit(0);
