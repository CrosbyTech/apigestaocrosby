// Inspeciona campos relacionados a pagamento no raw dos pedidos
import 'dotenv/config';
import supabase from './config/supabase.js';

const { data } = await supabase
  .from('wix_pedidos')
  .select('id, numero, payment_status, raw')
  .order('criado_em', { ascending: false })
  .limit(3);

for (const p of data || []) {
  console.log(`\n=== Pedido #${p.numero} (status pag: ${p.payment_status}) ===`);
  const raw = p.raw || {};
  // Procura campos relacionados a pagamento
  console.log('Campos top-level relacionados a payment:');
  for (const k of Object.keys(raw)) {
    if (/payment|paid|charge|transaction|method/i.test(k)) {
      console.log(`  ${k}:`, JSON.stringify(raw[k]).slice(0, 200));
    }
  }
  // activities (atividades do pedido — geralmente tem o método)
  if (raw.activities) {
    console.log('Activities:');
    for (const a of raw.activities) {
      console.log(`  ${a.type || '?'}: `, JSON.stringify(a).slice(0, 200));
    }
  }
  // balanceSummary (pode ter info de pagamento)
  if (raw.balanceSummary) {
    console.log('balanceSummary:', JSON.stringify(raw.balanceSummary).slice(0, 300));
  }
  // checkoutId pode ter info
  if (raw.checkoutId) console.log('checkoutId:', raw.checkoutId);
}
process.exit(0);
