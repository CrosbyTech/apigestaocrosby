import { createClient } from '@supabase/supabase-js';
import { loadDebugEnv } from './_debugEnv.mjs';
loadDebugEnv();
const sb = createClient('https://wnjapaczjcvhumfikwwe.supabase.co',process.env.SUPABASE_FISCAL_KEY);

// Busca NF de 2026-04-22 com total em torno de 2145 (data do cache: sellerCode 180, branchCode 111)
const { data: nf2145 } = await sb.from('notas_fiscais')
  .select('branch_code, operation_code, operation_name, total_value, dealer_code, user_code, person_code, person_name, items')
  .eq('issue_date','2026-04-22')
  .gte('total_value', 2100)
  .lte('total_value', 2200)
  .eq('operation_type','Output')
  .not('invoice_status','eq','Canceled');
console.log('NFs ~2145 em 2026-04-22:');
for (const nf of nf2145||[]) {
  const dealers = [];
  for (const it of nf.items||[]) for (const p of (it.products||[])) dealers.push(p.dealerCode);
  console.log('  branch='+nf.branch_code+' op='+nf.operation_code+' dealer_code='+nf.dealer_code+' user_code='+nf.user_code+' total='+nf.total_value+' person='+nf.person_code+' items_dealers='+([...new Set(dealers)].join(',')||'none'));
}

// Busca todas NFs com user_code=180 em qualquer branch
const { data: u180 } = await sb.from('notas_fiscais')
  .select('branch_code, operation_code, operation_name, total_value, dealer_code, user_code')
  .eq('user_code', 180)
  .eq('operation_type','Output')
  .not('invoice_status','eq','Canceled')
  .gte('issue_date','2025-01-01')
  .limit(100);
const agg = {};
for (const nf of u180||[]) {
  const k = 'branch='+nf.branch_code+' op='+nf.operation_code+' ('+nf.operation_name+') dealer='+nf.dealer_code;
  if (!agg[k]) agg[k] = {count:0, total:0};
  agg[k].count++;
  agg[k].total += parseFloat(nf.total_value)||0;
}
console.log('\nNFs com user_code=180 ('+( u180||[]).length+' total):');
for (const [k,v] of Object.entries(agg).sort((a,b)=>b[1].total-a[1].total)) {
  console.log('  '+k+': '+v.count+' NFs R$'+v.total.toFixed(2));
}
