// Valida as duas correções: branch_code!=2 + netValue direto
import { createRequire } from 'module';
import { createClient } from '@supabase/supabase-js';
import { loadDebugEnv } from './_debugEnv.mjs';
loadDebugEnv();
const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

const sb = createClient('https://wnjapaczjcvhumfikwwe.supabase.co',process.env.SUPABASE_FISCAL_KEY);
const OPS4 = [7236,9122,5102,7242];
const DEALERS = {288:'Jucelino',161:'Cleiton',241:'Yago',15:'Heyridan',25:'Anderson',165:'Michel',251:'Felipe',779:'Aldo'};
const NAME_TO_CODE = {'JUCELINO - INTERNO':288,'CLEYTON F':161,'YAGO SMITH':241,'HEYRIDAN':15,'ANDERSON MEDEIROS':25,'MICHEL VINICIO':165,'FELIPE PB':251,'ALDO RAFAEL - INTERNO':779};
const EXCEL_APR1=46113, EXCEL_APR22=46134;
function excelDateToStr(s) { return new Date(Math.round((s-25569)*86400*1000)).toISOString().slice(0,10); }

// === Excel B2R ===
const wb = XLSX.readFile('C:/Users/teccr/Downloads/teste.xlsx');
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws,{header:1});
const headers = rows[0];
const data = rows.slice(1).map(r=>{const o={};headers.forEach((h,i)=>o[h]=r[i]);return o;});
const b2rRows = data.filter(r=>String(r['CANAL']||'').trim().toUpperCase()==='B2R'&&Number(r['Dt. Transação']||0)>=EXCEL_APR1&&Number(r['Dt. Transação']||0)<=EXCEL_APR22);
const excelBySeller = {};
for (const r of b2rRows) {
  const sc = String(NAME_TO_CODE[String(r['Nome Vendedor']||'').trim()]||0);
  if (!excelBySeller[sc]) excelBySeller[sc] = 0;
  excelBySeller[sc] += parseFloat(r['Total'])||0;
}
const excelTotal = Object.values(excelBySeller).reduce((s,v)=>s+v,0);

// === Supabase (novas regras: branch_code!=2, netValue direto) ===
const PAGE = 1000;
let allNFs = [], offset = 0;
while (true) {
  const {data:d} = await sb.from('notas_fiscais')
    .select('invoice_code,total_value,items,issue_date,person_code,branch_code')
    .eq('operation_type','Output')
    .not('invoice_status','eq','Canceled')
    .not('invoice_status','eq','Deleted')
    .gte('issue_date','2026-04-01')
    .lte('issue_date','2026-04-22')
    .lt('person_code',100000000)
    .in('operation_code',OPS4)
    .neq('branch_code', 2)  // FIX 1: exclui franquia/B2L
    .range(offset,offset+PAGE-1);
  if (!d?.length) break;
  allNFs.push(...d);
  if (d.length<PAGE) break;
  offset+=PAGE;
}

const supBySeller = {};
for (const nf of allNFs) {
  for (const it of nf.items||[]) {
    for (const p of it.products||[]) {
      const dc = String(parseInt(p.dealerCode));
      if (!DEALERS[dc]) continue;
      const nv = parseFloat(p.netValue)||0; // FIX 2: netValue direto
      if (!supBySeller[dc]) supBySeller[dc] = 0;
      supBySeller[dc] += nv;
    }
  }
}
const supTotal = Object.values(supBySeller).reduce((s,v)=>s+v,0);

// === Comparativo final ===
console.log('=== Resultado após correções (branch_code!=2 + netValue) ===\n');
console.log(`${'Vendedor'.padEnd(22)} | ${'Excel B2R'.padEnd(14)} | ${'Supabase(novo)'.padEnd(14)} | Diferença | Status`);
console.log('-'.repeat(82));

let totEx=0, totSup=0;
for (const [name, exCode] of Object.entries(NAME_TO_CODE)) {
  const sc = String(exCode);
  const ex = excelBySeller[sc]||0;
  const sup = supBySeller[sc]||0;
  const diff = sup - ex;
  totEx+=ex; totSup+=sup;
  const pct = ex>0 ? ((diff/ex)*100).toFixed(1)+'%' : '-';
  const icon = Math.abs(diff)<1 ? '✅' : (Math.abs(diff)<200 ? '⚠️' : '❌');
  console.log(`${name.padEnd(22)} | R$${ex.toFixed(2).padEnd(12)} | R$${sup.toFixed(2).padEnd(12)} | R$${diff>=0?'+':''}${diff.toFixed(2).padEnd(10)} ${icon} (${pct})`);
}
console.log('-'.repeat(82));
console.log(`${'TOTAL'.padEnd(22)} | R$${totEx.toFixed(2).padEnd(12)} | R$${totSup.toFixed(2).padEnd(12)} | R$${(totSup-totEx)>=0?'+':''}${(totSup-totEx).toFixed(2)}`);
console.log(`\nExcel total: R$${excelTotal.toFixed(2)}`);
console.log(`Supabase novo total: R$${supTotal.toFixed(2)}`);
console.log(`Gap final: R$${(supTotal-excelTotal).toFixed(2)} (${((supTotal-excelTotal)/excelTotal*100).toFixed(2)}%)`);
