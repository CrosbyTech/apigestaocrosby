import 'dotenv/config';
import supabase from '../../config/supabase.js';
for (const n of ['4623321606','4625784513','4618452484','4606067725','4619988511','4631101714','4627646458']) {
  const { data } = await supabase.from('accounts_receivable_commands').select('id,branch_code,customer_code,receivable_code,payload,usuario,origem_tabela,criado_em').filter('payload->payments->0->card->>nsu', 'eq', n).limit(2);
  for (const r of data || []) { const c = r.payload.payments[0]; console.log(n, r.branch_code, r.customer_code, r.receivable_code, 'paidType', c.paidType, c.card.cardOperator, c.card.cardBrand, c.card.installmentQuantity, 'liq', r.payload.branchCode, r.usuario, r.origem_tabela, r.criado_em.slice(0,10)); }
  if (!data?.length) console.log(n, 'sem comando registrado');
}
process.exit(0);
