// Extrai todos os client codes B2L que aparecem como vendas de revendedores
// para criar uma lista de exclusão
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

const REVENDA_SELLERS = new Set(['JUCELINO - INTERNO','CLEYTON F','YAGO SMITH','HEYRIDAN','ANDERSON MEDEIROS','MICHEL VINICIO','FELIPE PB','ALDO RAFAEL - INTERNO']);
const EXCEL_APR1=46113, EXCEL_APR22=46134;
function excelDateToStr(s) { return new Date(Math.round((s-25569)*86400*1000)).toISOString().slice(0,10); }

const wb = XLSX.readFile('C:/Users/teccr/Downloads/teste.xlsx');
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws,{header:1});
const headers = rows[0];
const data = rows.slice(1).map(r=>{const o={};headers.forEach((h,i)=>o[h]=r[i]);return o;});

// B2R codes dos nossos vendedores
const b2rCodes = new Set();
const b2lCodes = new Set();
const b2lForOurSellers = [];

for (const r of data) {
  const canal = String(r['CANAL']||'').trim().toUpperCase();
  const dt = Number(r['Dt. Transação']||0);
  if (dt < EXCEL_APR1 || dt > EXCEL_APR22) continue;
  const seller = String(r['Nome Vendedor']||'').trim();
  const clientCode = parseInt(r['Cod. Cliente'])||0;
  const clientName = String(r['CLIENTE']||'').trim();
  const tipo = String(r['Ds. Tipo Cliente']||'').trim();
  const value = parseFloat(r['Total'])||0;
  
  if (canal === 'B2R') b2rCodes.add(clientCode);
  if (canal === 'B2L') b2lCodes.add(clientCode);
  
  // B2L de vendedores que são nossos revendedores
  if (canal === 'B2L' && REVENDA_SELLERS.has(seller)) {
    b2lForOurSellers.push({ clientCode, clientName, seller, tipo, value, date: excelDateToStr(dt) });
  }
}

// Clientes que aparecem em B2L mas NÃO em B2R (exclusivos do canal B2L)
const exclusiveB2L = [...b2lCodes].filter(c => !b2rCodes.has(c));
const b2lIntersect = [...b2lCodes].filter(c => b2rCodes.has(c));

console.log(`Total clientes B2R: ${b2rCodes.size}`);
console.log(`Total clientes B2L: ${b2lCodes.size}`);
console.log(`B2L exclusivos (nunca B2R): ${exclusiveB2L.length}`);
console.log(`Em ambos: ${b2lIntersect.length}`);

console.log('\n=== B2L de nossos vendedores (incorretamente no B2R do sistema) ===');
const clientSummary = {};
for (const r of b2lForOurSellers) {
  const key = r.clientCode;
  if (!clientSummary[key]) clientSummary[key] = { name: r.clientName, tipo: r.tipo, seller: r.seller, total: 0, count: 0 };
  clientSummary[key].total += r.value;
  clientSummary[key].count++;
}
const allB2LCodes = [];
for (const [code, info] of Object.entries(clientSummary).sort((a,b)=>b[1].total-a[1].total)) {
  console.log(`  ${code} | ${info.name} | ${info.tipo} | vendedor: ${info.seller} | R$${info.total.toFixed(2)} (${info.count} vendas)`);
  allB2LCodes.push(parseInt(code));
}
console.log(`\nTotal B2L para nossos vendedores: R$${Object.values(clientSummary).reduce((s,v)=>s+v.total,0).toFixed(2)}`);
console.log(`\n// Lista de exclusão B2L (person_codes)`);
console.log(`const B2L_PERSON_CODES_EXCLUSION = [${allB2LCodes.join(', ')}]; // ${allB2LCodes.length} clientes`);
