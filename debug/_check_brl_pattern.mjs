// Verifica raw_data das NFs para encontrar campo de tipo de cliente
// E verifica padrão nos nomes: revendedores têm CPF/CNPJ no início do nome
import { createClient } from '@supabase/supabase-js';
import { loadDebugEnv } from './_debugEnv.mjs';
loadDebugEnv();
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

const sb = createClient('https://wnjapaczjcvhumfikwwe.supabase.co',process.env.SUPABASE_FISCAL_KEY);

// Pega raw_data de 2 clientes: DANILLA (B2L) e LUCIVANIA (B2R)
const { data: nfs } = await sb.from('notas_fiscais')
  .select('invoice_code,person_code,person_name,operation_code,raw_data')
  .in('person_code',[70078,48353])
  .in('operation_code',[7236,9122,5102,7242])
  .gte('issue_date','2026-04-01')
  .lte('issue_date','2026-04-22')
  .not('invoice_status','eq','Canceled')
  .limit(4);

for (const nf of nfs||[]) {
  console.log(`\n=== NF ${nf.invoice_code} | ${nf.person_name} (${nf.person_code}) | Op ${nf.operation_code} ===`);
  const rd = nf.raw_data||{};
  // Campos relevantes do raw_data (excluindo items para não poluir)
  const { items, ...rdShort } = rd;
  console.log(JSON.stringify(rdShort, null, 2));
}

// Padrão: revendedores geralmente têm CPF/CNPJ no nome no TOTVS
// Verifica padrão de nomes para B2R do Excel
const wb = XLSX.readFile('C:/Users/teccr/Downloads/teste.xlsx');
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, {header:1});
const headers = rows[0];
const data = rows.slice(1).map(r=>{const o={};headers.forEach((h,i)=>o[h]=r[i]);return o;});

const EXCEL_APR1=46113, EXCEL_APR22=46134;
const b2rRows = data.filter(r=>String(r['CANAL']||'').trim().toUpperCase()==='B2R'&&Number(r['Dt. Transação']||0)>=EXCEL_APR1&&Number(r['Dt. Transação']||0)<=EXCEL_APR22);
const b2lRows = data.filter(r=>String(r['CANAL']||'').trim().toUpperCase()==='B2L'&&Number(r['Dt. Transação']||0)>=EXCEL_APR1&&Number(r['Dt. Transação']||0)<=EXCEL_APR22);

// Analisa Ds. Tipo Cliente
const b2rTypes = {};
const b2lTypes = {};
b2rRows.forEach(r=>{const t=r['Ds. Tipo Cliente']||'?'; b2rTypes[t]=(b2rTypes[t]||0)+1;});
b2lRows.forEach(r=>{const t=r['Ds. Tipo Cliente']||'?'; b2lTypes[t]=(b2lTypes[t]||0)+1;});
console.log('\n=== Tipos de cliente B2R no Excel ===');
Object.entries(b2rTypes).forEach(([t,n])=>console.log(`  ${t}: ${n} vendas`));
console.log('\n=== Tipos de cliente B2L no Excel (para comparar) ===');
Object.entries(b2lTypes).forEach(([t,n])=>console.log(`  ${t}: ${n} vendas`));

// Verifica se os nomes B2R têm padrão diferente dos B2L
// Pega nomes únicos de clientes B2R do Excel e verifica no Supabase
const b2rClientNames = [...new Set(b2rRows.map(r=>r['CLIENTE']))];
const b2lClientNames = [...new Set(b2lRows.map(r=>r['CLIENTE']||''))];

// Padrão de nome: começa com dígitos (CPF/CNPJ) ou não
const b2rWithDoc = b2rClientNames.filter(n=>/^\d/.test(n));
const b2rWithoutDoc = b2rClientNames.filter(n=>!/^\d/.test(n));
console.log(`\nB2R: ${b2rClientNames.length} clientes únicos`);
console.log(`  Com doc no início do nome: ${b2rWithDoc.length}`);
console.log(`  Sem doc no início: ${b2rWithoutDoc.length}`);
console.log('  Sem doc exemplos:', b2rWithoutDoc.slice(0,8));

const b2lWithDoc = b2lClientNames.filter(n=>/^\d/.test(n));
console.log(`\nB2L: ${b2lClientNames.length} clientes únicos`);
console.log(`  Com doc no início do nome: ${b2lWithDoc.length}`);
console.log(`  Sem doc: ${b2lClientNames.length - b2lWithDoc.length}`);
console.log('  Com doc exemplos:', b2lWithDoc.slice(0,5));
console.log('  Sem doc exemplos:', b2lClientNames.filter(n=>!/^\d/.test(n)).slice(0,5));

// Agora: verifica person_name no Supabase de B2R vs B2L
// Pega os codes B2R e B2L do Excel
const b2rCodes = new Set(b2rRows.map(r=>String(parseInt(r['Cod. Cliente']))));
const b2lCodes = new Set(b2lRows.map(r=>String(parseInt(r['Cod. Cliente']))));
// Interseção: clientes que aparecem em AMBOS
const both = [...b2rCodes].filter(c=>b2lCodes.has(c));
console.log(`\nClientes que aparecem em AMBOS B2R e B2L: ${both.length}`);
console.log(both.slice(0,10));

// Clientes B2L que compraram com ops revenda
const b2lOpsRevenda = b2lRows.filter(r=>{
  const canal = String(r['CANAL']||'').toUpperCase();
  return canal === 'B2L';
});
const b2lSellerRevenda = {};
b2lOpsRevenda.forEach(r=>{
  const s = r['Nome Vendedor'];
  if (!b2lSellerRevenda[s]) b2lSellerRevenda[s] = 0;
  b2lSellerRevenda[s] += parseFloat(r['Total'])||0;
});
console.log('\nB2L por vendedor (total de valor que está sendo excluído do B2R):');
Object.entries(b2lSellerRevenda).sort((a,b)=>b[1]-a[1]).forEach(([s,v])=>console.log(`  ${s}: R$${v.toFixed(2)}`));
