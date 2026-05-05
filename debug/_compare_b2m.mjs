// Compara Excel (B2M = multimarcas) vs Supabase por vendedor
import { createRequire } from 'module';
import { createClient } from '@supabase/supabase-js';
import { loadDebugEnv } from './_debugEnv.mjs';
loadDebugEnv();
const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

const sb = createClient('https://wnjapaczjcvhumfikwwe.supabase.co', process.env.SUPABASE_FISCAL_KEY);

const EXCEL_APR1  = 46113;
const EXCEL_APR22 = 46134;
const OPS_MULTI   = [7235, 7241];

// ─── Ler Excel ────────────────────────────────────────────────────────────────
const wb   = XLSX.readFile('C:/Users/teccr/Downloads/teste.xlsx');
const ws   = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
const headers = rows[0];
console.log('Headers:', headers);

const data = rows.slice(1).map(r => {
  const obj = {};
  headers.forEach((h, i) => obj[h] = r[i]);
  return obj;
});

// Colunas possíveis (nomes exatos do Excel)
const cCANAL  = headers.find(h => String(h).includes('CANAL')) || 'CANAL';
const cDT     = headers.find(h => String(h).includes('Transação') || String(h).includes('Data')) || 'Dt. Transação';
const cSELLER = headers.find(h => String(h).toLowerCase().includes('vendedor')) || 'Nome Vendedor';
const cTOTAL  = headers.find(h => String(h) === 'Total' || String(h).includes('Total')) || 'Total';
const cCLIENTE= headers.find(h => String(h) === 'Cod. Cliente' || String(h).includes('Cod')) || 'Cod. Cliente';

console.log(`\nColunas usadas: CANAL=${cCANAL}, DT=${cDT}, SELLER=${cSELLER}, TOTAL=${cTOTAL}`);

const b2mRows = data.filter(r => {
  const canal = String(r[cCANAL] || '').trim().toUpperCase();
  const dt    = Number(r[cDT] || 0);
  return canal === 'B2M' && dt >= EXCEL_APR1 && dt <= EXCEL_APR22;
});

console.log(`\nLinhas B2M (01-22/04) no Excel: ${b2mRows.length}`);

const excelBySeller = {};
for (const row of b2mRows) {
  const seller = String(row[cSELLER] || '').trim();
  const value  = parseFloat(row[cTOTAL]) || 0;
  if (!excelBySeller[seller]) excelBySeller[seller] = 0;
  excelBySeller[seller] += value;
}

const excelTotal = Object.values(excelBySeller).reduce((s, v) => s + v, 0);
console.log(`Total B2M Excel: R$${excelTotal.toFixed(2)}`);
console.log('\n=== B2M por vendedor (Excel) ===');
Object.entries(excelBySeller).sort((a, b) => b[1] - a[1]).forEach(([name, val]) =>
  console.log(`  ${name}: R$${val.toFixed(2)}`)
);

// ─── Supabase ─────────────────────────────────────────────────────────────────
let allNFs = [], offset = 0;
while (true) {
  const { data: d } = await sb.from('notas_fiscais')
    .select('invoice_code,total_value,items,issue_date,person_code')
    .eq('operation_type', 'Output')
    .not('invoice_status', 'eq', 'Canceled')
    .not('invoice_status', 'eq', 'Deleted')
    .gte('issue_date', '2026-04-01')
    .lte('issue_date', '2026-04-22')
    .in('operation_code', OPS_MULTI)
    .range(offset, offset + 999);
  if (!d?.length) break;
  allNFs.push(...d);
  if (d.length < 1000) break;
  offset += 1000;
}
console.log(`\nNFs multimarcas no Supabase (01-22/04): ${allNFs.length}`);

const supBySeller = {};
for (const nf of allNFs) {
  const tv = parseFloat(nf.total_value) || 0;
  let allNV = 0;
  const dn = {};
  for (const it of nf.items || []) {
    for (const p of it.products || []) {
      const nv = parseFloat(p.netValue) || 0;
      const dc = String(parseInt(p.dealerCode));
      allNV += nv;
      if (!dn[dc]) dn[dc] = 0;
      dn[dc] += nv;
    }
  }
  if (allNV <= 0) continue;
  for (const [dc, nv] of Object.entries(dn)) {
    if (!supBySeller[dc]) supBySeller[dc] = { value: 0, nfCount: 0 };
    supBySeller[dc].value += tv * (nv / allNV);
    supBySeller[dc].nfCount++;
  }
}

// Buscar nomes dos vendedores
const { data: vendedores } = await sb.from('vendedores_integracao')
  .select('totvs_id,nome,modulo')
  .in('totvs_id', Object.keys(supBySeller));

const nomeByCode = {};
const moduloByCode = {};
for (const v of vendedores || []) {
  nomeByCode[String(v.totvs_id)] = v.nome;
  moduloByCode[String(v.totvs_id)] = v.modulo;
}

const supTotal = Object.values(supBySeller).reduce((s, v) => s + v.value, 0);
const supTotalMulti = Object.entries(supBySeller)
  .filter(([dc]) => moduloByCode[dc] === 'multimarcas')
  .reduce((s, [, v]) => s + v.value, 0);

console.log(`Total Supabase (todos dealers): R$${supTotal.toFixed(2)}`);
console.log(`Total Supabase (só multimarcas): R$${supTotalMulti.toFixed(2)}`);

console.log('\n=== Por dealerCode no Supabase ===');
Object.entries(supBySeller).sort((a, b) => b[1].value - a[1].value).forEach(([dc, info]) => {
  const nome = nomeByCode[dc] || `Dealer ${dc}`;
  const modulo = moduloByCode[dc] || '?';
  console.log(`  ${dc} ${nome} [${modulo}]: R$${info.value.toFixed(2)} (${info.nfCount} NFs)`);
});

console.log('\n=== COMPARATIVO ===');
console.log(`Excel B2M total:               R$${excelTotal.toFixed(2)}`);
console.log(`Supabase multimarcas total:     R$${supTotalMulti.toFixed(2)}`);
console.log(`Gap (Supa - Excel):             R$${(supTotalMulti - excelTotal).toFixed(2)}`);
