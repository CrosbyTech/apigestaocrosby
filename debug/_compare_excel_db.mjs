import { createRequire } from 'module';
import fs from 'fs';
const require = createRequire(import.meta.url);
const XLSX = require('./node_modules/xlsx/dist/xlsx.full.min.js');
import { createClient } from '@supabase/supabase-js';
import { loadDebugEnv } from './_debugEnv.mjs';
loadDebugEnv();

const supabase = createClient(
  'https://wnjapaczjcvhumfikwwe.supabase.co',
  process.env.SUPABASE_FISCAL_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// --- 1. Ler Excel ---
const buf = fs.readFileSync('C:/Users/teccr/Downloads/teste.xlsx');
const wb = XLSX.read(buf, { type: 'buffer' });
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

const toDate = s => {
  if (!s) return '';
  const d = new Date((s - 25569) * 86400000);
  return d.toISOString().slice(0, 10);
};

// Agrupa Excel por cliente+data => total
const excelMap = new Map();
let totalExcel = 0;
for (const r of rows) {
  const t = Number(r.Total) || 0;
  if (t <= 0) continue;
  const key = `${r['Cod. Cliente']}_${toDate(r['Dt. Transação'])}`;
  excelMap.set(key, (excelMap.get(key) || 0) + t);
  totalExcel += t;
}
console.log(`EXCEL: ${rows.length} linhas, ${excelMap.size} chaves únicas, Total R$ ${totalExcel.toFixed(2)}`);

// --- 2. Buscar NFs do banco (ops 7236, 9122, 5102, abril) ---
const PAGE = 1000;
let offset = 0;
const allNFs = [];
while (true) {
  const { data, error } = await supabase
    .from('notas_fiscais')
    .select('invoice_code, person_code, total_value, issue_date, operation_code, invoice_status, branch_code')
    .in('operation_code', [7236, 9122, 5102])
    .gte('issue_date', '2026-04-01')
    .lte('issue_date', '2026-04-22')
    .eq('operation_type', 'Output')
    .not('invoice_status', 'eq', 'Canceled')
    .not('invoice_status', 'eq', 'Deleted')
    .lt('person_code', 100000000)
    .range(offset, offset + PAGE - 1);
  if (error) { console.error('ERRO DB:', error); break; }
  allNFs.push(...data);
  if (data.length < PAGE) break;
  offset += PAGE;
}

// Mostrar campos do primeiro registro
if (allNFs.length > 0) {
  console.log('CAMPOS NF:', Object.keys(allNFs[0]).join(' | '));
  console.log('EXEMPLO:', JSON.stringify(allNFs[0]));
}

console.log(`DB: ${allNFs.length} NFs`);

// --- 3. Total do DB com os mesmos filtros do backend ---
let totalDB = allNFs.reduce((s, nf) => s + (Number(nf.total_value) || 0), 0);
console.log(`DB TOTAL (filtros iguais ao backend): R$ ${totalDB.toFixed(2)}`);
console.log(`DIFERENÇA DB - Excel: R$ ${(totalDB - totalExcel).toFixed(2)}`);

// --- 4. Cruzamento por person_code + issue_date ---
// Agrupa DB por person_code+data => total
const dbMap = new Map();
for (const nf of allNFs) {
  const key = `${nf.person_code}_${nf.issue_date}`;
  dbMap.set(key, (dbMap.get(key) || 0) + (Number(nf.total_value) || 0));
}

// O que está no DB mas NÃO está no Excel (por person_code+data)
console.log('\n=== NO BANCO, NÃO NO EXCEL (ou com valor diferente) ===');
let sobraBanco = 0;
for (const [key, dbVal] of dbMap.entries()) {
  const excelVal = excelMap.get(key) || 0;
  const diff = dbVal - excelVal;
  if (Math.abs(diff) > 0.5) {
    const [personCode, date] = key.split('_');
    console.log(`  person_code=${personCode} data=${date} DB=R$${dbVal.toFixed(2)} Excel=R$${excelVal.toFixed(2)} diff=R$${diff.toFixed(2)}`);
    sobraBanco += diff;
  }
}
console.log(`TOTAL diferença DB>Excel: R$ ${sobraBanco.toFixed(2)}`);

// O que está no Excel mas NÃO está no DB
console.log('\n=== NO EXCEL, NÃO NO BANCO (ou com valor diferente) ===');
let sobraExcel = 0;
for (const [key, excelVal] of excelMap.entries()) {
  const dbVal = dbMap.get(key) || 0;
  const diff = excelVal - dbVal;
  if (Math.abs(diff) > 0.5) {
    const [personCode, date] = key.split('_');
    console.log(`  person_code=${personCode} data=${date} Excel=R$${excelVal.toFixed(2)} DB=R$${dbVal.toFixed(2)} diff=R$${diff.toFixed(2)}`);
    sobraExcel += diff;
  }
}
console.log(`TOTAL diferença Excel>DB: R$ ${sobraExcel.toFixed(2)}`);
