import { createClient } from '@supabase/supabase-js';
import { loadDebugEnv } from './_debugEnv.mjs';
loadDebugEnv();
const sb = createClient('https://wnjapaczjcvhumfikwwe.supabase.co',process.env.SUPABASE_FISCAL_KEY);

const MISSING = [
  {client: 16024, name:'Michel 16024', date:'2026-04-22'},
  {client: 9100, name:'Yago 9100', date:'2026-04-22'},
  {client: 70125, name:'Jucelino 70125', date:'2026-04-18'},
  {client: 20133, name:'Heyridan 20133', date:'2026-04-18'},
  {client: 16388, name:'Anderson 16388', date:'2026-04-22'},
];

for (const m of MISSING) {
  const {data} = await sb.from('notas_fiscais')
    .select('invoice_code,total_value,operation_code,issue_date,invoice_status,person_name,items')
    .eq('person_code',m.client)
    .gte('issue_date','2026-04-01')
    .lte('issue_date','2026-04-30');
  if (!data?.length) {
    console.log(`❌ ${m.name}: AINDA sem NF no Supabase`);
  } else {
    data.forEach(nf=>{
      const dcs = new Set();
      for (const it of nf.items||[]) for (const p of it.products||[]) dcs.add(parseInt(p.dealerCode));
      console.log(`✅ ${m.name}: NF ${nf.invoice_code} | ${nf.issue_date} | Op ${nf.operation_code} | ${nf.invoice_status} | R$${parseFloat(nf.total_value).toFixed(2)} | dealers:${[...dcs].join(',')}`);
    });
  }
}

// Novo total sellers-totals (para comparar)
const OPS4 = [7236,9122,5102,7242];
const DEALERS = {288:'Jucelino',161:'Cleiton',241:'Yago',15:'Heyridan',25:'Anderson',165:'Michel',251:'Felipe',779:'Aldo'};
const PAGE = 1000;
let allNFs = [], offset = 0;
while (true) {
  const {data} = await sb.from('notas_fiscais')
    .select('invoice_code,total_value,items')
    .eq('operation_type','Output')
    .not('invoice_status','eq','Canceled')
    .not('invoice_status','eq','Deleted')
    .gte('issue_date','2026-04-01')
    .lte('issue_date','2026-04-22')
    .lt('person_code',100000000)
    .in('operation_code',OPS4)
    .range(offset,offset+PAGE-1);
  if (!data?.length) break;
  allNFs.push(...data);
  if (data.length<PAGE) break;
  offset+=PAGE;
}
const totals = {};
for (const nf of allNFs) {
  const tv = parseFloat(nf.total_value)||0;
  let allNV = 0;
  const dn = {};
  for (const it of nf.items||[]) for (const p of it.products||[]) {
    const nv = parseFloat(p.netValue)||0;
    const dc = String(parseInt(p.dealerCode));
    allNV += nv;
    if (!dn[dc]) dn[dc] = 0;
    dn[dc] += nv;
  }
  if (allNV<=0) continue;
  for (const [dc,nv] of Object.entries(dn)) {
    if (!DEALERS[dc]) continue;
    if (!totals[dc]) totals[dc] = 0;
    totals[dc] += tv*(nv/allNV);
  }
}
console.log('\n=== Novo total sellers-totals após re-sync ===');
let grand = 0;
for (const [dc,name] of Object.entries(DEALERS)) {
  const v = totals[dc]||0;
  grand += v;
  if (v>0) console.log(`  ${name}: R$${v.toFixed(2)}`);
}
console.log(`  TOTAL: R$${grand.toFixed(2)}`);
