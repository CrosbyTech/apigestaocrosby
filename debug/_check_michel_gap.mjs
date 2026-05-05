// Investiga o gap restante após explicar o efeito de total_value > sum(NV)
// Hipótese: ERP cache inclui ops ALÉM de [7236,9122,5102,7242] para Michel
import { createClient } from '@supabase/supabase-js';
import { loadDebugEnv } from './_debugEnv.mjs';
loadDebugEnv();
import fs from 'fs';

const sb = createClient('https://wnjapaczjcvhumfikwwe.supabase.co',process.env.SUPABASE_FISCAL_KEY);
const cache = JSON.parse(fs.readFileSync('.erp_cache.json','utf8'));
const clientes = cache.data?.clientes || [];

const datemin = '2026-04-01', datemax = '2026-04-22';
const OPS4 = [7236,9122,5102,7242];
const TARGETS = {165:'Michel',251:'Felipe',288:'Jucelino',241:'Yago',15:'Heyridan',161:'Cleiton',25:'Anderson'};

// ERP cache: por canal
console.log('=== ERP cache - Michel por canal ===');
const michTx = [];
for (const c of clientes) {
  for (const t of c.transacoes||[]) {
    if ((t.dtStr||'')<datemin || (t.dtStr||'')>datemax) continue;
    if (String(t.sellerCode)!=='165') continue;
    michTx.push({...t, clientCode: c.cod});
  }
}
const byCanal = {};
for (const tx of michTx) {
  const canal = tx.canal||'(null)';
  if (!byCanal[canal]) byCanal[canal] = {count:0, total:0};
  byCanal[canal].count++; byCanal[canal].total+=tx.vlFat||0;
}
Object.entries(byCanal).forEach(([c,v])=>console.log(`  ${c}: ${v.count} tx, R$${v.total.toFixed(2)}`));

// NFs de Michel nos 4 ops no Supabase
const { data: michNFs } = await sb.from('notas_fiscais')
  .select('invoice_code,total_value,person_code,items,operation_code,issue_date')
  .eq('operation_type','Output')
  .not('invoice_status','eq','Canceled')
  .not('invoice_status','eq','Deleted')
  .gte('issue_date',datemin)
  .lte('issue_date',datemax)
  .lt('person_code',100000000)
  .in('operation_code',OPS4);

// Calcula o valor atribuído a Michel em sellers-totals
let michSupabaseProp = 0;
for (const nf of michNFs||[]) {
  const hasMichel = (nf.items||[]).some(it=>(it.products||[]).some(p=>parseInt(p.dealerCode)===165));
  if (!hasMichel) continue;
  const tv = parseFloat(nf.total_value)||0;
  let michNV = 0, allNV = 0;
  for (const it of nf.items||[]) for (const p of it.products||[]) {
    const nv = parseFloat(p.netValue)||0;
    allNV += nv;
    if (parseInt(p.dealerCode)===165) michNV += nv;
  }
  if (allNV > 0) michSupabaseProp += tv * (michNV / allNV);
}
console.log(`\nMichel sellers-totals (4 ops, proporcional): R$${michSupabaseProp.toFixed(2)}`);

// Calcula sum(products.netValue) para Michel nas 4 ops
let michNVSum = 0;
for (const nf of michNFs||[]) {
  for (const it of nf.items||[]) for (const p of it.products||[]) {
    if (parseInt(p.dealerCode)===165) michNVSum += parseFloat(p.netValue)||0;
  }
}
console.log(`Michel sum(products.netValue) (4 ops): R$${michNVSum.toFixed(2)}`);

// ERP cache Michel (todos os canais exceto varejo)
const michErpTotal = michTx.filter(t=>t.canal!=='varejo').reduce((s,t)=>s+(t.vlFat||0),0);
console.log(`Michel ERP cache (não-varejo): R$${michErpTotal.toFixed(2)}`);
console.log(`\nGap ERP - supabase_prop = R$${(michErpTotal - michSupabaseProp).toFixed(2)}`);
console.log(`Gap ERP - NVsum = R$${(michErpTotal - michNVSum).toFixed(2)}`);

// Tenta identificar: quais clientes da Michel no ERP NÃO têm NF no Supabase?
const michClientERP = new Set();
for (const t of michTx) if (t.canal!=='varejo') michClientERP.add(String(t.clientCode));
const michClientsNF = new Set();
for (const nf of michNFs||[]) {
  const has = (nf.items||[]).some(it=>(it.products||[]).some(p=>parseInt(p.dealerCode)===165));
  if (has) michClientsNF.add(String(nf.person_code));
}
const onlyInERP = [...michClientERP].filter(c=>!michClientsNF.has(c));
const onlyInNF = [...michClientsNF].filter(c=>!michClientERP.has(c));
console.log(`\nClientes Michel no ERP: ${michClientERP.size}`);
console.log(`Clientes Michel no Supabase (4 ops): ${michClientsNF.size}`);
console.log(`Só no ERP (${onlyInERP.length}): ${onlyInERP.slice(0,10).join(', ')}`);
console.log(`Só no Supabase (${onlyInNF.length}): ${onlyInNF.slice(0,10).join(', ')}`);

// Busca NFs no Supabase para clientes que estão só no ERP
if (onlyInERP.length > 0) {
  const {data:extraNFs} = await sb.from('notas_fiscais')
    .select('invoice_code,total_value,operation_code,issue_date,person_code')
    .eq('operation_type','Output')
    .not('invoice_status','eq','Canceled')
    .gte('issue_date',datemin)
    .lte('issue_date',datemax)
    .in('person_code',onlyInERP.slice(0,20).map(Number));
  console.log(`\nNFs no Supabase para clientes "só ERP" de Michel: ${extraNFs?.length||0}`);
  (extraNFs||[]).slice(0,10).forEach(n=>console.log(`  NF ${n.invoice_code} | ${n.issue_date} | Op ${n.operation_code} | R$${parseFloat(n.total_value).toFixed(2)} | cliente ${n.person_code}`));
}
