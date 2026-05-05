import supabaseFiscal from './config/supabaseFiscal.js';
import XLSX from 'xlsx';

// ─── Dados do Excel ───────────────────────────────────────────────────────────
const wb = XLSX.readFile('C:/Users/teccr/Downloads/faturamento semana 4.xlsx');
const ws = wb.Sheets[wb.SheetNames[0]];
const excelRows = XLSX.utils.sheet_to_json(ws, { defval: '' }).filter(r => r['Dt. Transação'] && r['CLIENTE']);

const excelTotal = excelRows.reduce((s,r) => s + (Number(r.Total)||0), 0);
console.log('=== EXCEL ===');
console.log('Linhas:', excelRows.length, '  Total: R$', excelTotal.toFixed(2));

const excelPorVendedor = {};
for (const r of excelRows) {
  const v = r['Nome Vendedor'] || 'SEM';
  excelPorVendedor[v] = (excelPorVendedor[v]||0) + (Number(r.Total)||0);
}
console.log('\nExcel por vendedor (top 15):');
Object.entries(excelPorVendedor).sort((a,b)=>b[1]-a[1]).forEach(([v,t])=>console.log(' ',v.padEnd(35), t.toFixed(2)));

// ─── Dados do Supabase ────────────────────────────────────────────────────────
console.log('\n=== SUPABASE (notas_fiscais 20-22/04) ===');

let allNFs = [];
let offset = 0;
while (true) {
  const { data, error } = await supabaseFiscal
    .from('notas_fiscais')
    .select('branch_code,operation_code,issue_date,total_value,items')
    .gte('issue_date','2026-04-20')
    .lte('issue_date','2026-04-22')
    .eq('operation_type','Output')
    .not('invoice_status','eq','Canceled')
    .not('invoice_status','eq','Deleted')
    .range(offset, offset + 999);
  if (error) { console.error(error); process.exit(1); }
  allNFs = allNFs.concat(data);
  if (data.length < 1000) break;
  offset += 1000;
}

const dbTotal = allNFs.reduce((s,r) => s + (parseFloat(r.total_value)||0), 0);
console.log('NFs:', allNFs.length, '  Total: R$', dbTotal.toFixed(2));

// Por branch_code
const byBranch = {};
for (const r of allNFs) { byBranch[r.branch_code] = (byBranch[r.branch_code]||0) + (parseFloat(r.total_value)||0); }
console.log('\nPor branch_code:');
Object.entries(byBranch).sort((a,b)=>b[1]-a[1]).forEach(([b,v])=>console.log(' branch',b.toString().padEnd(6),v.toFixed(2)));

// Por operation_code
const byOp = {};
for (const r of allNFs) { byOp[r.operation_code] = (byOp[r.operation_code]||0) + (parseFloat(r.total_value)||0); }
console.log('\nPor operation_code (top 20):');
Object.entries(byOp).sort((a,b)=>b[1]-a[1]).slice(0,20).forEach(([op,v])=>console.log(' op',op.toString().padEnd(7),v.toFixed(2)));

// ─── Operações que podem corresponder ao Excel (atacado B2B) ─────────────────
// Multimarcas: 7235, 7241 | Franquia: 7234, 7240 | Revenda: 9120, 9121, 5102, 5202, 7236, 7242...
const B2B_OPS = [7235, 7241, 7234, 7240, 9120, 9121, 9122, 9113, 9111, 9001, 9009, 9061, 9067,
  9400, 9401, 9420, 9404, 7806, 7809, 5102, 5202, 1407, 512, 7236, 7242];
const b2bNFs = allNFs.filter(r => B2B_OPS.includes(Number(r.operation_code)));
const b2bTotal = b2bNFs.reduce((s,r) => s + (parseFloat(r.total_value)||0), 0);
console.log('\n=== B2B/ATACADO (ops filtradas) ===');
console.log('NFs B2B:', b2bNFs.length, '  Total: R$', b2bTotal.toFixed(2));

// ─── Diferença ────────────────────────────────────────────────────────────────
console.log('\n=== COMPARATIVO ===');
console.log('Excel total:           R$', excelTotal.toFixed(2));
console.log('Supabase total (ALL):  R$', dbTotal.toFixed(2));
console.log('Supabase B2B OPS:      R$', b2bTotal.toFixed(2));
console.log('Diferença Excel vs B2B:', (b2bTotal - excelTotal).toFixed(2));
