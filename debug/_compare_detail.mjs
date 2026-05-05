// Análise focada: Felipe após Apr 10, + casos anômalos Jucelino
import { createRequire } from 'module';
import { createClient } from '@supabase/supabase-js';
import { loadDebugEnv } from './_debugEnv.mjs';
loadDebugEnv();
const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

const sb = createClient('https://wnjapaczjcvhumfikwwe.supabase.co',process.env.SUPABASE_FISCAL_KEY);
const OPS4 = [7236,9122,5102,7242];

// === 1. Felipe NFs de 11-22/04 em Supabase (não estão no Excel)
console.log('=== Felipe: NFs de 11-22/04 no Supabase (faltam no Excel) ===');
const { data: felipeNFs } = await sb.from('notas_fiscais')
  .select('invoice_code,total_value,issue_date,person_code,person_name,items,operation_code')
  .eq('operation_type','Output')
  .not('invoice_status','eq','Canceled')
  .not('invoice_status','eq','Deleted')
  .gte('issue_date','2026-04-11')
  .lte('issue_date','2026-04-22')
  .lt('person_code',100000000)
  .in('operation_code',OPS4);

const felipeOnlyNFs = (felipeNFs||[]).filter(nf=>(nf.items||[]).some(it=>(it.products||[]).some(p=>parseInt(p.dealerCode)===251)));
let felipeExtra = 0;
for (const nf of felipeOnlyNFs) {
  const tv = parseFloat(nf.total_value)||0;
  let allNV=0, felipeNV=0;
  for (const it of nf.items||[]) for (const p of it.products||[]) {
    const nv=parseFloat(p.netValue)||0;
    allNV+=nv;
    if (parseInt(p.dealerCode)===251) felipeNV+=nv;
  }
  const prop = allNV>0 ? tv*(felipeNV/allNV) : tv;
  felipeExtra += prop;
  console.log(`  NF ${nf.invoice_code} | ${nf.issue_date} | Op ${nf.operation_code} | ${nf.person_name} | R$${prop.toFixed(2)}`);
}
console.log(`Felipe 11-22/04 total: R$${felipeExtra.toFixed(2)}`);

// === 2. Jucelino: NF 27742 (SHAYANNE - cliente 12097)
console.log('\n=== NF 27742 - Jucelino / SHAYANNE (cliente 12097) ===');
const { data: nf27742 } = await sb.from('notas_fiscais')
  .select('invoice_code,total_value,issue_date,person_code,person_name,operation_code,items')
  .eq('invoice_code','27742');
for (const nf of nf27742||[]) {
  const tv = parseFloat(nf.total_value)||0;
  let allNV=0,jNV=0;
  for (const it of nf.items||[]) for (const p of it.products||[]) {
    const nv=parseFloat(p.netValue)||0;
    allNV+=nv;
    if (parseInt(p.dealerCode)===288) jNV+=nv;
  }
  const prop = allNV>0 ? tv*(jNV/allNV) : tv;
  console.log(`  NF ${nf.invoice_code} | ${nf.issue_date} | Op ${nf.operation_code} | ${nf.person_name} | total_value=${tv.toFixed(2)} | Jucelino prop=R$${prop.toFixed(2)}`);
  console.log(`  → Esta NF é de cliente franquia (12097) mas com op ${nf.operation_code} — aparece no Supabase como revenda mas Excel classifica como B2L`);
}

// === 3. Jucelino NF 27684 (cliente 70078)
console.log('\n=== NF 27684 - Jucelino / cliente 70078 ===');
const { data: nf27684 } = await sb.from('notas_fiscais')
  .select('invoice_code,total_value,issue_date,person_code,person_name,operation_code,items')
  .eq('invoice_code','27684');
for (const nf of nf27684||[]) {
  const tv = parseFloat(nf.total_value)||0;
  let allNV=0,jNV=0;
  const dcs = new Set();
  for (const it of nf.items||[]) for (const p of it.products||[]) {
    const nv=parseFloat(p.netValue)||0;
    allNV+=nv;
    dcs.add(parseInt(p.dealerCode));
    if (parseInt(p.dealerCode)===288) jNV+=nv;
  }
  const prop = allNV>0 ? tv*(jNV/allNV) : tv;
  console.log(`  NF ${nf.invoice_code} | ${nf.issue_date} | Op ${nf.operation_code} | ${nf.person_name} | total_value=${tv.toFixed(2)} | dealers: ${[...dcs].join(',')} | Jucelino prop=R$${prop.toFixed(2)}`);
}

// Verifica se cliente 70078 está no Excel B2R
const wb = XLSX.readFile('C:/Users/teccr/Downloads/teste.xlsx');
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, {header:1}).slice(1);
const headers = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {header:1})[0];
const EXCEL_APR1=46113, EXCEL_APR22=46134;
function excelDateToStr(s) { return new Date(Math.round((s-25569)*86400*1000)).toISOString().slice(0,10); }
const data = rows.map(r=>{const o={};headers.forEach((h,i)=>o[h]=r[i]);return o;});
const client70078 = data.filter(r=>parseInt(r['Cod. Cliente'])===70078);
console.log(`\nCliente 70078 no Excel (qualquer canal): ${client70078.length} linhas`);
client70078.forEach(r=>console.log(`  ${excelDateToStr(r['Dt. Transação'])} | ${r['CANAL']} | ${r['Nome Vendedor']} | R$${r['Total']}`));

// === 4. Verifica qual valor a coluna "Total" do Excel representa: totalValue ou netValue?
console.log('\n=== Validação: Excel Total = totalValue ou netValue? ===');
// Pega 5 clientes B2R do Excel e compara com Supabase
const b2rSample = data.filter(r=>String(r['CANAL']||'').trim()==='B2R'&&Number(r['Dt. Transação']||0)>=EXCEL_APR1&&Number(r['Dt. Transação']||0)<=EXCEL_APR22).slice(0,10);
for (const r of b2rSample) {
  const clientCode = parseInt(r['Cod. Cliente']);
  const date = excelDateToStr(Number(r['Dt. Transação']));
  const excelVal = parseFloat(r['Total'])||0;
  const sellerName = String(r['Nome Vendedor']||'').trim();
  
  const {data: nfs} = await sb.from('notas_fiscais')
    .select('invoice_code,total_value,items,operation_code')
    .eq('person_code',clientCode)
    .eq('issue_date',date)
    .in('operation_code',OPS4)
    .not('invoice_status','eq','Canceled')
    .not('invoice_status','eq','Deleted');
  
  if (!nfs?.length) {
    console.log(`  ${sellerName} | cliente ${clientCode} | ${date} | Excel R$${excelVal.toFixed(2)} | Supabase: SEM NF`);
    continue;
  }
  
  for (const nf of nfs) {
    const tv = parseFloat(nf.total_value)||0;
    let allNV=0,selNV=0;
    const DEALER_BY_SELLER = {'JUCELINO - INTERNO':288,'CLEYTON F':161,'YAGO SMITH':241,'HEYRIDAN':15,'ANDERSON MEDEIROS':25,'MICHEL VINICIO':165,'FELIPE PB':251,'ALDO RAFAEL - INTERNO':779};
    const dc = DEALER_BY_SELLER[sellerName];
    for (const it of nf.items||[]) for (const p of it.products||[]) {
      const nv=parseFloat(p.netValue)||0;
      allNV+=nv;
      if (parseInt(p.dealerCode)===dc) selNV+=nv;
    }
    const propTV = allNV>0 ? tv*(selNV/allNV) : tv;
    const match_tv = Math.abs(propTV - excelVal) < 1 ? '✅ TV' : '';
    const match_nv = Math.abs(selNV - excelVal) < 1 ? '✅ NV' : '';
    console.log(`  ${sellerName} | ${clientCode} | ${date} | Excel=${excelVal.toFixed(2)} | propTV=${propTV.toFixed(2)} ${match_tv} | sellerNV=${selNV.toFixed(2)} ${match_nv} | NF=${nf.invoice_code}`);
  }
}
