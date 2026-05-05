import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const XLSX = require('xlsx');
import supabaseFiscal from './config/supabaseFiscal.js';

// === Excel ===
const wb = XLSX.readFile('C:/Users/teccr/Downloads/faturado b2r abril.xlsx');
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws);

// Converter serial Excel → data YYYY-MM-DD
const excelDateToStr = (serial) => {
  if (!serial || typeof serial !== 'number') return String(serial || '');
  const date = new Date(Math.round((serial - 25569) * 86400 * 1000));
  return date.toISOString().split('T')[0];
};

const excelYago = rows
  .filter(r => String(r['Nome Vendedor'] || '').toUpperCase().includes('YAGO'))
  .map(r => ({
    dt: excelDateToStr(r['Dt. Transação']),
    cod: parseInt(r['Cod. Cliente'] || 0),
    cli: String(r['CLIENTE'] || '').substring(0, 30),
    val: parseFloat(r['Total'] || 0),
    nf: r['Nº NF'] || r['Num. NF'] || r['NF'] || r['Nota Fiscal'] || r['Número NF'] || r['Nf'] || r['N. NF'] || null,
    raw: r,
  }));

// === Backend ===
const OPS = [5102, 5202, 1407, 9120, 9121, 9122, 9113, 9111, 9001, 9009, 9061, 9067, 9400, 9401, 9420, 9404, 7806, 7809, 7236, 7242, 512];
let all = [], from = 0, hasMore = true;
while (hasMore) {
  const { data } = await supabaseFiscal.from('notas_fiscais')
    .select('total_value,items,issue_date,person_name,person_code,transaction_code,operation_code')
    .in('operation_code', OPS)
    .eq('operation_type', 'Output')
    .not('invoice_status', 'eq', 'Canceled')
    .not('invoice_status', 'eq', 'Deleted')
    .lt('person_code', 100000000)
    .gte('issue_date', '2026-04-01')
    .lte('issue_date', '2026-04-20')
    .range(from, from + 999);
  all.push(...(data || []));
  hasMore = (data?.length === 1000);
  from += 1000;
}

const backYago = all
  .filter(n => {
    const d = new Set();
    (n.items || []).forEach(it => (it.products || []).forEach(p => { if (p.dealerCode) d.add(parseInt(p.dealerCode)); }));
    return d.has(241);
  })
  .map(n => ({
    dt: n.issue_date,
    cod: parseInt(n.person_code),
    cli: String(n.person_name || '').substring(0, 30),
    val: parseFloat(n.total_value || 0),
    tx: n.transaction_code,
    op: n.operation_code,
  }));

// === Diff por cliente/data ===
// Agrupar Excel por cod+dt (somando valores)
const excelMap = {};
excelYago.forEach(r => {
  const k = `${r.dt}|${r.cod}`;
  if (!excelMap[k]) excelMap[k] = { dt: r.dt, cod: r.cod, cli: r.cli, val: 0, count: 0, nfs: [], raws: [] };
  excelMap[k].val += r.val;
  excelMap[k].count++;
  excelMap[k].nfs.push(r.nf);
  excelMap[k].raws.push(r.raw);
});

// Agrupar Backend por cod+dt
const backMap = {};
backYago.forEach(r => {
  const k = `${r.dt}|${r.cod}`;
  if (!backMap[k]) backMap[k] = { dt: r.dt, cod: r.cod, cli: r.cli, val: 0, count: 0, txs: [], ops: new Set() };
  backMap[k].val += r.val;
  backMap[k].count++;
  backMap[k].txs.push(r.tx);
  backMap[k].ops.add(r.op);
});

// Comparar
const allKeys = new Set([...Object.keys(excelMap), ...Object.keys(backMap)]);

console.log('=== DIFF YAGO: Excel vs Backend (por cli/data) ===\n');

let extraBack = [], faltaBack = [], diverge = [];

for (const k of [...allKeys].sort()) {
  const ex = excelMap[k];
  const bk = backMap[k];
  if (!ex) {
    extraBack.push({ ...bk, diff: bk.val });
  } else if (!bk) {
    faltaBack.push({ ...ex, diff: -ex.val });
  } else {
    const diff = bk.val - ex.val;
    if (Math.abs(diff) > 0.5) {
      diverge.push({ dt: ex.dt, cod: ex.cod, cli: ex.cli, exVal: ex.val, exCount: ex.count, bkVal: bk.val, bkCount: bk.count, diff, txs: bk.txs, ops: [...bk.ops] });
    }
  }
}

console.log('=== EXTRA NO BACKEND (não está no Excel) ===');
extraBack.sort((a, b) => a.dt.localeCompare(b.dt)).forEach(r =>
  console.log(' dt:', r.dt, 'cod:', r.cod, r.cli, r.count, 'NFs R$' + r.val.toFixed(2), 'txs:', r.txs.join(','), 'ops:', [...r.ops].join(','))
);
console.log(' Subtotal extra:', extraBack.length, 'entradas R$' + extraBack.reduce((s, r) => s + r.val, 0).toFixed(2));

console.log('\n=== FALTA NO BACKEND (está no Excel, não no backend) ===');
faltaBack.sort((a, b) => a.dt.localeCompare(b.dt)).forEach(r => {
  console.log(' dt:', r.dt, 'cod:', r.cod, r.cli, 'R$' + r.val.toFixed(2), '| NF(s) Excel:', r.nfs.join(','));
  r.raws.forEach(raw => console.log('   colunas Excel:', JSON.stringify(raw)));
});
console.log(' Subtotal faltando:', faltaBack.length, 'entradas R$' + faltaBack.reduce((s, r) => s + r.val, 0).toFixed(2));

console.log('\n=== VALORES DIVERGENTES (mesmo cli/data, valor diferente) ===');
diverge.sort((a, b) => a.dt.localeCompare(b.dt)).forEach(r =>
  console.log(' dt:', r.dt, 'cod:', r.cod, r.cli, '| Excel:', r.exCount, 'NFs R$' + r.exVal.toFixed(2), '| Back:', r.bkCount, 'NFs R$' + r.bkVal.toFixed(2), '| diff: R$' + r.diff.toFixed(2), '| txs:', r.txs.join(','))
);

const excelTotal = excelYago.reduce((s, r) => s + r.val, 0);
const backTotal = backYago.reduce((s, r) => s + r.val, 0);
console.log('\n=== TOTAIS ===');
console.log(' Excel:', excelYago.length, 'NFs R$' + excelTotal.toFixed(2));
console.log(' Backend:', backYago.length, 'NFs R$' + backTotal.toFixed(2));
console.log(' Diff: R$' + (backTotal - excelTotal).toFixed(2));
