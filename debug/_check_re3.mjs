import { createClient } from '@supabase/supabase-js';
import { loadDebugEnv } from './_debugEnv.mjs';
loadDebugEnv();
const sb = createClient('https://wnjapaczjcvhumfikwwe.supabase.co',process.env.SUPABASE_FISCAL_KEY);

// Todas as NFs da branch 11 Output
const { data } = await sb.from('notas_fiscais')
  .select('branch_code, operation_code, operation_name, total_value, dealer_code, user_code, items, person_code')
  .eq('branch_code', 11)
  .eq('operation_type', 'Output')
  .not('invoice_status','eq','Canceled')
  .not('invoice_status','eq','Deleted')
  .gte('issue_date','2025-01-01')
  .limit(500);

console.log('Total NFs branch 11:', (data||[]).length);

const ops = {};
for (const nf of data||[]) {
  // dealer real via items
  const netByDealer = {};
  for (const it of nf.items||[]) for (const p of (it.products||[])) {
    const dc = parseInt(p.dealerCode);
    if (!dc) continue;
    netByDealer[dc] = (netByDealer[dc]||0) + (parseFloat(p.netValue)||0);
  }
  const entries = Object.entries(netByDealer);
  const dealerReal = entries.length ? Number(entries.sort((a,b)=>b[1]-a[1])[0][0]) : nf.dealer_code;
  const key = 'op='+nf.operation_code+' ('+nf.operation_name+') dealer='+dealerReal+' user='+nf.user_code;
  if (!ops[key]) ops[key] = { count:0, total:0 };
  ops[key].count++;
  ops[key].total += parseFloat(nf.total_value)||0;
}
console.log('Distribuicao de ops/dealers:');
for (const [k,v] of Object.entries(ops).sort((a,b)=>b[1].total-a[1].total)) {
  console.log('  '+k+': '+v.count+' NFs R$'+v.total.toFixed(2));
}
