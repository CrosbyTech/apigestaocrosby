import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

const wb = XLSX.readFile('C:/Users/teccr/Downloads/faturado b2r abril.xlsx');
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws);

// Yago = 'YAGO SMITH' na coluna Nome Vendedor
const yago = rows.filter(r => String(r['Nome Vendedor'] || '').toUpperCase().includes('YAGO'));

console.log('=== YAGO no Excel:', yago.length, 'linhas ===');
console.log('Colunas:', Object.keys(rows[0]).join(', '));
console.log('');

// Listar todas as NFs
yago.sort((a, b) => {
  const da = String(a['Dt. Transação'] || '');
  const db = String(b['Dt. Transação'] || '');
  return da.localeCompare(db);
}).forEach(r => {
  const dt = r['Dt. Transação'] || '';
  const cli = r['CLIENTE'] || '';
  const cod = r['Cod. Cliente'] || '';
  const val = r['Total'] || '';
  console.log(' dt:', dt, '| cod:', cod, '| cli:', String(cli).substring(0, 25), '| R$', typeof val === 'number' ? val.toFixed(2) : val);
});

const total = yago.reduce((s, r) => s + parseFloat(r['Total'] || 0), 0);
console.log('\nTOTAL Excel Yago:', yago.length, 'NFs R$' + total.toFixed(2));
