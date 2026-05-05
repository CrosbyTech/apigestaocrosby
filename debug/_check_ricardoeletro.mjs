import { createClient } from '@supabase/supabase-js';
import { loadDebugEnv } from './_debugEnv.mjs';
loadDebugEnv();
const sb = createClient('https://wnjapaczjcvhumfikwwe.supabase.co',process.env.SUPABASE_FISCAL_KEY);
const { data } = await sb.from('notas_fiscais')
  .select('branch_code, operation_code, operation_name, total_value, dealer_code, items')
  .eq('operation_type', 'Output')
  .not('invoice_status','eq','Canceled')
  .not('invoice_status','eq','Deleted')
  .gte('issue_date','2025-01-01')
  .limit(5000);
const rows = (data||[]).filter(nf => nf.dealer_code === 180);
const ops = {};
for (const nf of rows) {
  const key = `branch ${nf.branch_code} | op ${nf.operation_code} - ${nf.operation_name}`;
  if (!ops[key]) ops[key] = { count:0, total:0 };
  ops[key].count++;
  ops[key].total += parseFloat(nf.total_value)||0;
}
console.log('NFs com dealer_code=180 (nivel NF):');
if (Object.keys(ops).length === 0) console.log('  (nenhuma)');
for (const [k,v] of Object.entries(ops).sort((a,b)=>b[1].total-a[1].total)) {
  console.log(`  ${k}: ${v.count} NFs, R$${v.total.toFixed(2)}`);
}
