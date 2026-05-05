// Compara Excel (B2R) vs Supabase sellers-totals por vendedor
import { createRequire } from 'module';
import { createClient } from '@supabase/supabase-js';
import { loadDebugEnv } from './_debugEnv.mjs';
loadDebugEnv();
const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

const sb = createClient('https://wnjapaczjcvhumfikwwe.supabase.co',process.env.SUPABASE_FISCAL_KEY);

// Excel: data serial
// April 1 2026 = 46113, April 22 2026 = 46134
const EXCEL_APR1  = 46113;
const EXCEL_APR22 = 46134;

const wb = XLSX.readFile('C:/Users/teccr/Downloads/teste.xlsx');
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, {header:1});
const headers = rows[0];
const data = rows.slice(1).map(r => {
  const obj = {};
  headers.forEach((h,i) => obj[h] = r[i]);
  return obj;
});

// Converte serial Excel para YYYY-MM-DD
function excelDateToStr(serial) {
  if (!serial) return null;
  const date = new Date(Math.round((serial - 25569) * 86400 * 1000));
  return date.toISOString().slice(0,10);
}

// Filtra B2R no período
const b2rRows = data.filter(r => {
  const canal = String(r['CANAL']||'').trim().toUpperCase();
  const dt = Number(r['Dt. Transação']||0);
  return canal === 'B2R' && dt >= EXCEL_APR1 && dt <= EXCEL_APR22;
});

console.log(`Total linhas B2R (01-22/04): ${b2rRows.length}`);

// Agrupa por vendedor
const excelBySeller = {};
for (const row of b2rRows) {
  const seller = String(row['Nome Vendedor']||'').trim();
  const value = parseFloat(row['Total'])||0;
  const dt = excelDateToStr(Number(row['Dt. Transação']));
  if (!excelBySeller[seller]) excelBySeller[seller] = { total:0, count:0, dates:new Set(), clients:new Set() };
  excelBySeller[seller].total += value;
  excelBySeller[seller].count++;
  excelBySeller[seller].dates.add(dt);
  excelBySeller[seller].clients.add(String(row['Cod. Cliente']));
}

// Total geral B2R no Excel
const excelTotal = Object.values(excelBySeller).reduce((s,v)=>s+v.total,0);
console.log(`Total B2R Excel 01-22/04: R$${excelTotal.toFixed(2)}\n`);

console.log('=== B2R por vendedor no Excel ===');
Object.entries(excelBySeller)
  .sort((a,b)=>b[1].total-a[1].total)
  .forEach(([name,v])=>{
    console.log(`  ${name}: R$${v.total.toFixed(2)} (${v.count} vendas, ${v.clients.size} clientes, dias: ${[...v.dates].sort().join(', ')})`);
  });

// Supabase: sellers-totals
const OPS4 = [7236,9122,5102,7242];
const DEALERS = {288:'Jucelino',161:'Cleiton',241:'Yago',15:'Heyridan',25:'Anderson',165:'Michel',251:'Felipe',779:'Aldo'};
const PAGE = 1000;
let allNFs = [], offset = 0;
while (true) {
  const {data: d} = await sb.from('notas_fiscais')
    .select('invoice_code,total_value,items,issue_date,person_code')
    .eq('operation_type','Output')
    .not('invoice_status','eq','Canceled')
    .not('invoice_status','eq','Deleted')
    .gte('issue_date','2026-04-01')
    .lte('issue_date','2026-04-22')
    .lt('person_code',100000000)
    .in('operation_code',OPS4)
    .range(offset,offset+PAGE-1);
  if (!d?.length) break;
  allNFs.push(...d);
  if (d.length<PAGE) break;
  offset+=PAGE;
}

const supabaseBySeller = {};
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
    if (!supabaseBySeller[dc]) supabaseBySeller[dc] = 0;
    supabaseBySeller[dc] += tv*(nv/allNV);
  }
}

console.log(`\nTotal Supabase 01-22/04: R$${Object.values(supabaseBySeller).reduce((s,v)=>s+v,0).toFixed(2)}`);

// Mapeia nome Excel → dealer code (manual, baseado nos nomes que aparecem)
// Vamos mostrar todos e deixar usuário verificar
console.log('\n=== Busca de correspondência de nomes ===');
const allExcelSellers = Object.keys(excelBySeller);
console.log('Nomes no Excel:', allExcelSellers);
console.log('Dealers Supabase:', Object.entries(DEALERS).map(([c,n])=>`${n}(${c})`).join(', '));

// Tenta match automático por similaridade
const DEALER_NAMES_UPPER = {};
for (const [code, name] of Object.entries(DEALERS)) {
  DEALER_NAMES_UPPER[name.toUpperCase()] = code;
}

console.log('\n=== Comparativo por vendedor ===');
console.log('(match automático por nome — verifique se correto)\n');
console.log(`${'Vendedor Excel'.padEnd(22)} | ${'Excel B2R'.padEnd(15)} | ${'Supabase'.padEnd(15)} | Diferença`);
console.log('-'.repeat(75));

let totExcel=0, totSup=0;

for (const [excelName, excelData] of Object.entries(excelBySeller).sort((a,b)=>b[1].total-a[1].total)) {
  // Match por substring
  const excelUpper = excelName.toUpperCase();
  let matchedCode = null;
  for (const [nameU, code] of Object.entries(DEALER_NAMES_UPPER)) {
    // tenta se qualquer parte do nome dealer está no nome Excel
    const firstName = nameU.split(' ')[0];
    if (excelUpper.includes(firstName) || excelUpper.startsWith(firstName.slice(0,5))) {
      matchedCode = code;
      break;
    }
  }
  // CLEYTON / CLEITON
  if (excelUpper.includes('CLEYT') || excelUpper.includes('CLEIT')) matchedCode = '161';
  if (excelUpper.includes('MICHEL')) matchedCode = '165';
  if (excelUpper.includes('JUCELINO') || excelUpper.includes('JUCEL')) matchedCode = '288';
  if (excelUpper.includes('YAGO')) matchedCode = '241';
  if (excelUpper.includes('HEYRIDAN') || excelUpper.includes('HEYRI')) matchedCode = '15';
  if (excelUpper.includes('ANDERSON') || excelUpper.includes('ANDER') || excelUpper.includes('ANDRD')) matchedCode = '25';
  if (excelUpper.includes('FELIPE') || excelUpper.includes('FELIP')) matchedCode = '251';
  if (excelUpper.includes('ALDO')) matchedCode = '779';

  const supVal = matchedCode ? (supabaseBySeller[matchedCode]||0) : 0;
  const exVal = excelData.total;
  const diff = exVal - supVal;
  totExcel += exVal; totSup += supVal;
  const match = matchedCode ? `→ ${DEALERS[matchedCode]}(${matchedCode})` : '❓ sem match';
  const icon = Math.abs(diff)<1 ? '✅' : (Math.abs(diff)<100 ? '⚠️' : '❌');
  console.log(`${excelName.padEnd(22)} | R$${exVal.toFixed(2).padEnd(13)} | R$${supVal.toFixed(2).padEnd(13)} | R$${diff.toFixed(2)} ${icon} ${match}`);
}
console.log('-'.repeat(75));
console.log(`${'TOTAL'.padEnd(22)} | R$${totExcel.toFixed(2).padEnd(13)} | R$${totSup.toFixed(2).padEnd(13)} | R$${(totExcel-totSup).toFixed(2)}`);
