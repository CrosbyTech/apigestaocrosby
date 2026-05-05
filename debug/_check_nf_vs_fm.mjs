// Investiga: April 6 Michel - 66 tx ERP vs 2 NFs Supabase
// Compara total_value NF vs sum(FM netValue) por cliente+dia

import { createClient } from '@supabase/supabase-js';
import { loadDebugEnv } from './_debugEnv.mjs';
loadDebugEnv();
import fs from 'fs';

const sb = createClient('https://wnjapaczjcvhumfikwwe.supabase.co',process.env.SUPABASE_FISCAL_KEY);
const cache = JSON.parse(fs.readFileSync('.erp_cache.json','utf8'));
const clientes = cache.data?.clientes || [];

// NFs de Michel no dia 06/04
const { data: nfs606 } = await sb.from('notas_fiscais')
  .select('invoice_code,total_value,person_code,person_name,items,operation_code')
  .eq('operation_type','Output')
  .not('invoice_status','eq','Canceled')
  .not('invoice_status','eq','Deleted')
  .eq('issue_date','2026-04-06')
  .in('operation_code',[7236,9122,5102,7242]);

const michNFs606 = (nfs606||[]).filter(nf=>(nf.items||[]).some(it=>(it.products||[]).some(p=>parseInt(p.dealerCode)===165)));
console.log(`NFs de Michel em 06/04: ${michNFs606.length}`);

for (const nf of michNFs606) {
  console.log(`\nNF ${nf.invoice_code} | Op ${nf.operation_code} | Cliente ${nf.person_code} (${nf.person_name})`);
  console.log(`  total_value (NF header): R$${parseFloat(nf.total_value).toFixed(2)}`);
  
  let sumNetValue = 0, products = 0;
  for (const item of nf.items||[]) {
    for (const p of item.products||[]) {
      sumNetValue += parseFloat(p.netValue)||0;
      products++;
    }
  }
  console.log(`  sum(products.netValue): R$${sumNetValue.toFixed(2)} (${products} produtos)`);
  console.log(`  Diferença: R$${(parseFloat(nf.total_value)-sumNetValue).toFixed(2)}`);
  
  // Busca no ERP cache transações do mesmo cliente no dia 06/04
  const erpClient = clientes.find(c=>String(c.cod)===String(nf.person_code));
  if (!erpClient) { console.log('  ERP: cliente NÃO encontrado no cache'); continue; }
  const erpTxDay = (erpClient.transacoes||[]).filter(t=>(t.dtStr||'').startsWith('2026-04-06') && t.canal!=='varejo');
  const erpSum = erpTxDay.reduce((s,t)=>s+(t.vlFat||0),0);
  console.log(`  ERP: ${erpTxDay.length} transações, sum(vlFat): R$${erpSum.toFixed(2)}`);
  
  // Primeiras transações ERP para ver o que são
  const firstTx = erpTxDay.slice(0,5);
  for (const tx of firstTx) {
    console.log(`    ERP tx: vlFat=${tx.vlFat?.toFixed(2)} canal=${tx.canal} qty=${tx.quantity} seller=${tx.sellerCode}`);
  }
}

// Agora: visão geral por NF - calcula gap para TODOS os vendedores
console.log('\n\n=== Gap por NF: total_value vs sum(products.netValue) ===');
const OPS = [7236,9122,5102,7242];
const datemin = '2026-04-01', datemax = '2026-04-22';

const { data: allNFsRaw } = await sb.from('notas_fiscais')
  .select('invoice_code,total_value,person_code,items,operation_code,issue_date')
  .eq('operation_type','Output')
  .not('invoice_status','eq','Canceled')
  .not('invoice_status','eq','Deleted')
  .gte('issue_date',datemin)
  .lte('issue_date',datemax)
  .lt('person_code',100000000)
  .in('operation_code',OPS);

const DEALERS = new Set([288,161,241,15,25,165,251,779]);
let totalNFValue=0, totalProductNetValue=0, gapNFs=[];

for (const nf of allNFsRaw||[]) {
  const hasDealers = (nf.items||[]).some(it=>(it.products||[]).some(p=>DEALERS.has(parseInt(p.dealerCode))));
  if (!hasDealers) continue;
  
  const tv = parseFloat(nf.total_value)||0;
  let sumNV = 0;
  for (const it of nf.items||[]) for (const p of it.products||[]) sumNV += parseFloat(p.netValue)||0;
  
  totalNFValue += tv;
  totalProductNetValue += sumNV;
  const gap = tv - sumNV;
  if (Math.abs(gap) > 5) gapNFs.push({ code: nf.invoice_code, date: nf.issue_date, op: nf.operation_code, tv, sumNV, gap });
}
console.log(`Total NF total_value (com dealers revenda): R$${totalNFValue.toFixed(2)}`);
console.log(`Total sum(products.netValue) (com dealers revenda): R$${totalProductNetValue.toFixed(2)}`);
console.log(`Diferença: R$${(totalNFValue - totalProductNetValue).toFixed(2)}`);
console.log(`\nNFs com gap > R$5 (${gapNFs.length}):`);
gapNFs.slice(0,20).forEach(n=>console.log(`  NF ${n.code} | ${n.date} | Op ${n.op} | total_value=${n.tv.toFixed(2)} sumNV=${n.sumNV.toFixed(2)} gap=${n.gap.toFixed(2)}`));
