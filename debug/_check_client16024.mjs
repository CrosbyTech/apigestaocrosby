import fs from 'fs';
import { createClient } from '@supabase/supabase-js';
import { loadDebugEnv } from './_debugEnv.mjs';
loadDebugEnv();
const sb = createClient('https://wnjapaczjcvhumfikwwe.supabase.co',process.env.SUPABASE_FISCAL_KEY);
const cache = JSON.parse(fs.readFileSync('.erp_cache.json','utf8'));

const cl = cache.data.clientes.find(c=>String(c.cod)==='16024');
console.log('ERP client 16024:', JSON.stringify(cl?.info||{}));
const txAll = (cl?.transacoes||[]).filter(t=>(t.dtStr||'')>='2026-04-01'&&(t.dtStr||'')<='2026-04-22');
console.log('Todas tx abril 16024:', txAll.length);
txAll.forEach(t=>console.log(`  ${t.dtStr} seller=${t.sellerCode} vlFat=${(t.vlFat||0).toFixed(2)} canal=${t.canal}`));

const { data } = await sb.from('notas_fiscais')
  .select('invoice_code,total_value,operation_code,issue_date,items')
  .eq('person_code',16024)
  .gte('issue_date','2026-04-01')
  .lte('issue_date','2026-04-22');
console.log(`\nSupabase NFs para 16024: ${data?.length}`);
for (const nf of data||[]) {
  const dcs = new Set();
  for (const it of nf.items||[]) for (const p of it.products||[]) dcs.add(parseInt(p.dealerCode));
  console.log(`  NF ${nf.invoice_code} | ${nf.issue_date} | Op ${nf.operation_code} | R$${parseFloat(nf.total_value).toFixed(2)} | dealers ${[...dcs]}`);
}
