import { createClient } from '@supabase/supabase-js';
import { loadDebugEnv } from './_debugEnv.mjs';
loadDebugEnv();
const sb = createClient('https://wnjapaczjcvhumfikwwe.supabase.co',process.env.SUPABASE_FISCAL_KEY);

// Busca todas as operações em NFs de saída em abril/2026
const { data, error } = await sb.from('notas_fiscais')
  .select('operation_code,operation_name,total_value')
  .eq('operation_type','Output')
  .not('invoice_status','eq','Canceled')
  .not('invoice_status','eq','Deleted')
  .gte('issue_date','2026-04-01')
  .lte('issue_date','2026-04-23')
  .limit(3000);

if (error) { console.error(error); process.exit(1); }

const ops = {};
for (const nf of data || []) {
  if (!nf.operation_code) continue;
  const k = `${nf.operation_code}|${nf.operation_name || ''}`;
  if (!ops[k]) ops[k] = { count: 0, value: 0 };
  ops[k].count++;
  ops[k].value += parseFloat(nf.total_value) || 0;
}
Object.entries(ops).sort((a,b) => b[1].value - a[1].value).forEach(([k,v]) => {
  const [c,n] = k.split('|');
  console.log(`op ${c.padEnd(6)} | ${(n||'').padEnd(40)} | ${v.count} NFs | R$${v.value.toFixed(2)}`);
});
