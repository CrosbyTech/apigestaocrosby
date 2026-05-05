// Encontra todos os clientes no ERP que NÃO têm NFs no Supabase com as 4 ops
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

// ERP: clientes por vendedor
const erpClientBySeller = {};
const erpValByClient = {};
for (const sel of Object.keys(TARGETS)) erpClientBySeller[sel] = new Set();

for (const c of clientes) {
  for (const t of c.transacoes||[]) {
    if ((t.dtStr||'')<datemin || (t.dtStr||'')>datemax) continue;
    if (t.canal==='varejo') continue;
    const sc = String(t.sellerCode);
    if (!TARGETS[sc]) continue;
    erpClientBySeller[sc].add(String(c.cod));
    const key = `${sc}_${c.cod}`;
    if (!erpValByClient[key]) erpValByClient[key] = 0;
    erpValByClient[key] += t.vlFat||0;
  }
}

// Supabase: clientes por vendedor (4 ops)
const { data: allNFsRaw } = await sb.from('notas_fiscais')
  .select('invoice_code,total_value,person_code,items,operation_code,issue_date')
  .eq('operation_type','Output')
  .not('invoice_status','eq','Canceled')
  .not('invoice_status','eq','Deleted')
  .gte('issue_date',datemin)
  .lte('issue_date',datemax)
  .lt('person_code',100000000)
  .in('operation_code',OPS4);

const sbClientBySeller = {};
for (const sel of Object.keys(TARGETS)) sbClientBySeller[sel] = new Set();

for (const nf of allNFsRaw||[]) {
  for (const it of nf.items||[]) {
    for (const p of it.products||[]) {
      const dc = String(parseInt(p.dealerCode));
      if (!TARGETS[dc]) continue;
      sbClientBySeller[dc].add(String(nf.person_code));
    }
  }
}

// Diferença: clientes no ERP mas não no Supabase (4 ops)
console.log('=== Clientes no ERP mas SEM NFs nas 4 ops Supabase ===\n');
let totalMissingErpVal = 0;

for (const [sc, name] of Object.entries(TARGETS)) {
  const erpSet = erpClientBySeller[sc];
  const sbSet = sbClientBySeller[sc];
  const onlyERP = [...erpSet].filter(c=>!sbSet.has(c));
  const onlySB = [...sbSet].filter(c=>!erpSet.has(c));
  
  if (onlyERP.length === 0 && onlySB.length === 0) {
    console.log(`${name}: ✅ todos os clientes batem`);
    continue;
  }
  
  const missingVal = onlyERP.reduce((s,c)=>s+(erpValByClient[`${sc}_${c}`]||0),0);
  totalMissingErpVal += missingVal;
  console.log(`${name}: ${onlyERP.length} clientes só no ERP, R$${missingVal.toFixed(2)} faltando`);
  
  if (onlyERP.length > 0) {
    // Busca NF para esses clientes com qualquer op no Supabase
    const { data: extraNFs } = await sb.from('notas_fiscais')
      .select('invoice_code,total_value,operation_code,issue_date,person_code,person_name')
      .gte('issue_date',datemin)
      .lte('issue_date',datemax)
      .in('person_code',onlyERP.map(Number));
    
    for (const clientCode of onlyERP) {
      const clientNFs = (extraNFs||[]).filter(n=>String(n.person_code)===clientCode);
      const erpVal = erpValByClient[`${sc}_${clientCode}`]||0;
      if (clientNFs.length > 0) {
        console.log(`  Cliente ${clientCode}: ERP R$${erpVal.toFixed(2)} | Supabase ${clientNFs.length} NF(s) com ops: ${clientNFs.map(n=>`${n.operation_code}(R$${parseFloat(n.total_value).toFixed(2)})`).join(', ')}`);
      } else {
        console.log(`  Cliente ${clientCode}: ERP R$${erpVal.toFixed(2)} | Supabase: NENHUMA NF em abril`);
      }
    }
  }
  if (onlySB.length > 0) {
    console.log(`  Só Supabase: ${onlySB.slice(0,5).join(', ')}...`);
  }
  console.log();
}
console.log(`\nTotal ERP não contabilizado (clientes só no ERP): R$${totalMissingErpVal.toFixed(2)}`);
