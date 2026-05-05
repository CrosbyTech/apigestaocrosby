import { createClient } from '@supabase/supabase-js';
import { loadDebugEnv } from './_debugEnv.mjs';
loadDebugEnv();
const sb = createClient('https://wnjapaczjcvhumfikwwe.supabase.co',process.env.SUPABASE_FISCAL_KEY);

const { data } = await sb.from('notas_fiscais')
  .select('branch_code, operation_code, operation_name, total_value, dealer_code, user_code, items')
  .eq('branch_code', 111)
  .eq('operation_type', 'Output')
  .not('invoice_status','eq','Canceled')
  .not('invoice_status','eq','Deleted')
  .gte('issue_date','2025-01-01')
  .limit(500);

console.log('Total NFs branch 111:', (data||[]).length);

const userMap = {};
for (const nf of data||[]) {
  const u = String(nf.user_code ?? 'null');
  if (!userMap[u]) userMap[u] = { count:0, total:0 };
  userMap[u].count++;
  userMap[u].total += parseFloat(nf.total_value)||0;
}
console.log('user_code distribuicao:');
for (const [k,v] of Object.entries(userMap).sort((a,b)=>b[1].total-a[1].total)) {
  console.log('  user_code='+k+': '+v.count+' NFs R$'+v.total.toFixed(2));
}

console.log('\nAmostra 3 NFs:');
for (const nf of (data||[]).slice(0,3)) {
  const dealers = [];
  for (const it of nf.items||[]) for (const p of (it.products||[])) dealers.push(p.dealerCode);
  console.log('  op='+nf.operation_code+' dealer_code='+nf.dealer_code+' user_code='+nf.user_code+' items_dealers='+([...new Set(dealers)].join(',')||'none'));
}
