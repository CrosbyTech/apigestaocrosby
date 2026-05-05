// Compara nível de transação: Excel B2R vs Supabase (por cliente + data + vendedor)
import { createRequire } from 'module';
import { createClient } from '@supabase/supabase-js';
import { loadDebugEnv } from './_debugEnv.mjs';
loadDebugEnv();
const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

const sb = createClient('https://wnjapaczjcvhumfikwwe.supabase.co',process.env.SUPABASE_FISCAL_KEY);

const EXCEL_APR1 = 46113, EXCEL_APR22 = 46134;
const OPS4 = [7236,9122,5102,7242];
// Mapeamento nome vendedor Excel → dealer code
const NAME_TO_CODE = {
  'JUCELINO - INTERNO': 288,
  'CLEYTON F': 161,
  'YAGO SMITH': 241,
  'HEYRIDAN': 15,
  'ANDERSON MEDEIROS': 25,
  'MICHEL VINICIO': 165,
  'FELIPE PB': 251,
  'ALDO RAFAEL - INTERNO': 779,
};

function excelDateToStr(serial) {
  const d = new Date(Math.round((serial - 25569) * 86400 * 1000));
  return d.toISOString().slice(0,10);
}

const wb = XLSX.readFile('C:/Users/teccr/Downloads/teste.xlsx');
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, {header:1});
const headers = rows[0];
const data = rows.slice(1).map(r => { const o={}; headers.forEach((h,i)=>o[h]=r[i]); return o; });

const b2rRows = data.filter(r => {
  const canal = String(r['CANAL']||'').trim().toUpperCase();
  const dt = Number(r['Dt. Transação']||0);
  return canal === 'B2R' && dt >= EXCEL_APR1 && dt <= EXCEL_APR22;
});

// Cria um lookup Excel: clientCode+date → { total, sellerName }
const excelTxMap = {};
for (const r of b2rRows) {
  const clientCode = String(parseInt(r['Cod. Cliente']||0));
  const date = excelDateToStr(Number(r['Dt. Transação']));
  const seller = String(r['Nome Vendedor']||'').trim();
  const value = parseFloat(r['Total'])||0;
  const key = `${clientCode}|${date}|${NAME_TO_CODE[seller]||seller}`;
  excelTxMap[key] = { value, seller, dealerCode: NAME_TO_CODE[seller] };
}

// Busca toadas NFs no Supabase no período
const PAGE = 1000;
let allNFs = [], offset = 0;
while (true) {
  const {data: d} = await sb.from('notas_fiscais')
    .select('invoice_code,total_value,items,issue_date,person_code,person_name')
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

// Para cada NF e dealer, cria transactions Supabase
const supTxMap = {};
const supTxDetails = [];
const DEALER_CODES = new Set(Object.values(NAME_TO_CODE));

for (const nf of allNFs) {
  const tv = parseFloat(nf.total_value)||0;
  let allNV = 0;
  const dn = {};
  for (const it of nf.items||[]) for (const p of it.products||[]) {
    const nv = parseFloat(p.netValue)||0;
    const dc = parseInt(p.dealerCode);
    allNV += nv;
    if (!dn[dc]) dn[dc] = 0;
    dn[dc] += nv;
  }
  
  for (const [dcStr, nv] of Object.entries(dn)) {
    const dc = parseInt(dcStr);
    if (!DEALER_CODES.has(dc)) continue;
    const propVal = allNV > 0 ? tv * (nv / allNV) : nv;
    const key = `${nf.person_code}|${nf.issue_date}|${dc}`;
    supTxMap[key] = { value: propVal, netValue: nv, totalValue: tv, nfCode: nf.invoice_code, personName: nf.person_name };
    supTxDetails.push({ key, clientCode: nf.person_code, date: nf.issue_date, dealerCode: dc, propVal, nv, tv, nfCode: nf.invoice_code });
  }
}

// Encontra NFs em Supabase mas NÃO no Excel (por vendedor)
const DEALER_NAMES = Object.fromEntries(Object.entries(NAME_TO_CODE).map(([n,c])=>[c,n]));
const onlySupabase = {};
const onlyExcel = {};
const both = {};

for (const [key, supTx] of Object.entries(supTxMap)) {
  if (excelTxMap[key]) {
    both[key] = { sup: supTx.value, excel: excelTxMap[key].value, diff: supTx.value - excelTxMap[key].value };
  } else {
    const dc = parseInt(key.split('|')[2]);
    if (!onlySupabase[dc]) onlySupabase[dc] = { total: 0, count: 0, items: [] };
    onlySupabase[dc].total += supTx.value;
    onlySupabase[dc].count++;
    onlySupabase[dc].items.push({ key, nfCode: supTx.nfCode, value: supTx.value, clientCode: key.split('|')[0], date: key.split('|')[1] });
  }
}

for (const [key, exTx] of Object.entries(excelTxMap)) {
  if (!supTxMap[key]) {
    const dc = exTx.dealerCode;
    if (!onlyExcel[dc]) onlyExcel[dc] = { total: 0, count: 0, items: [] };
    onlyExcel[dc].total += exTx.value;
    onlyExcel[dc].count++;
    onlyExcel[dc].items.push({ key, value: exTx.value, seller: exTx.seller, clientCode: key.split('|')[0], date: key.split('|')[1] });
  }
}

console.log('=== Transações APENAS no Supabase (não estão no Excel) ===');
for (const [dc, info] of Object.entries(onlySupabase).sort((a,b)=>b[1].total-a[1].total)) {
  console.log(`\n${DEALER_NAMES[dc]||dc}: ${info.count} NFs, R$${info.total.toFixed(2)}`);
  info.items.sort((a,b)=>b.value-a.value).slice(0,10).forEach(i=>console.log(`  NF ${i.nfCode} | ${i.date} | cliente ${i.clientCode} | R$${i.value.toFixed(2)}`));
}

console.log('\n=== Transações APENAS no Excel (não estão no Supabase) ===');
for (const [dc, info] of Object.entries(onlyExcel).sort((a,b)=>b[1].total-a[1].total)) {
  console.log(`\n${DEALER_NAMES[dc]||dc}: ${info.count} rows, R$${info.total.toFixed(2)}`);
  info.items.sort((a,b)=>b.value-a.value).slice(0,5).forEach(i=>console.log(`  ${i.date} | cliente ${i.clientCode} | R$${i.value.toFixed(2)}`));
}

console.log('\n=== Sumarização por vendedor ===');
const sellerDiffs = {};
for (const [dc] of Object.entries(NAME_TO_CODE).map(([n,c])=>[c])) {
  const soSup = (onlySupabase[dc]?.total)||0;
  const soEx = (onlyExcel[dc]?.total)||0;
  const bothSum = Object.entries(both).filter(([k])=>k.endsWith(`|${dc}`)).reduce((s,[,v])=>s+v.diff,0);
  sellerDiffs[dc] = { soSup, soEx, bothDiff: bothSum, net: soSup - soEx + bothSum };
}

for (const name of Object.keys(NAME_TO_CODE)) {
  const dc = NAME_TO_CODE[name];
  const d = sellerDiffs[dc];
  console.log(`${name}: só_sup=+R$${d.soSup.toFixed(2)} só_excel=-R$${d.soEx.toFixed(2)} valor_diff=+R$${d.bothDiff.toFixed(2)} → net=+R$${d.net.toFixed(2)}`);
}
