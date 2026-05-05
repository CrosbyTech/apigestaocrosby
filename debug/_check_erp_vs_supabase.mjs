import { createClient } from '@supabase/supabase-js';
import { loadDebugEnv } from './_debugEnv.mjs';
loadDebugEnv();
import { createRequire } from 'module';
import fs from 'fs';
const require = createRequire(import.meta.url);

const sb = createClient('https://wnjapaczjcvhumfikwwe.supabase.co',process.env.SUPABASE_FISCAL_KEY);
const cache = JSON.parse(fs.readFileSync('.erp_cache.json','utf8'));
const clientes = cache.data?.clientes || [];

const datemin = '2026-04-01';
const datemax = '2026-04-22';
const OPS = [7236, 9122, 5102, 7242];
const TARGETS = { 165:'Michel', 251:'Felipe', 288:'Jucelino', 241:'Yago', 15:'Heyridan', 161:'Cleiton' };

// === ERP cache: por dia, unique clients, sum vlFat
const erpBySeller = {};
for (const c of clientes) {
  for (const t of c.transacoes||[]) {
    if ((t.dtStr||'')<datemin || (t.dtStr||'')>datemax) continue;
    if (t.canal==='varejo') continue;
    const sc = String(t.sellerCode);
    if (!TARGETS[sc]) continue;
    if (!erpBySeller[sc]) erpBySeller[sc] = { total:0, uniqueClients:new Set(), count:0 };
    erpBySeller[sc].total += t.vlFat||0;
    erpBySeller[sc].uniqueClients.add(c.cod);
    erpBySeller[sc].count++;
  }
}

// === Supabase notas_fiscais: per NF, dealers
const PAGE = 1000;
let allNFs = [], offset = 0;
while (true) {
  const { data } = await sb.from('notas_fiscais')
    .select('invoice_code,total_value,issue_date,items')
    .eq('operation_type','Output')
    .not('invoice_status','eq','Canceled')
    .not('invoice_status','eq','Deleted')
    .gte('issue_date', datemin)
    .lte('issue_date', datemax)
    .lt('person_code', 100000000)
    .in('operation_code', OPS)
    .range(offset, offset+PAGE-1);
  if (!data?.length) break;
  allNFs.push(...data);
  if (data.length < PAGE) break;
  offset += PAGE;
}

const supabaseBySeller = {};
for (const nf of allNFs) {
  const nfTotal = parseFloat(nf.total_value)||0;
  const sn = {}; let netFull = 0;
  for (const item of nf.items||[]) {
    for (const p of item.products||[]) {
      const dc = String(parseInt(p.dealerCode));
      const nv = parseFloat(p.netValue)||0;
      netFull += nv;
      if (!sn[dc]) sn[dc] = 0;
      sn[dc] += nv;
    }
  }
  if (netFull <= 0) continue;
  for (const [dc, nv] of Object.entries(sn)) {
    if (!TARGETS[dc]) continue;
    if (!supabaseBySeller[dc]) supabaseBySeller[dc] = { value:0, nfs:0 };
    supabaseBySeller[dc].value += nfTotal * (nv / netFull);
    supabaseBySeller[dc].nfs++;
  }
}

// === Comparação final
console.log('=== Comparação ERP cache (FM/TOTVS) vs Supabase notas_fiscais ===');
console.log(`${'Vendedor'.padEnd(12)} | ${'ERP (FM/vlFat)'.padEnd(22)} | ${'Supabase (prop)'.padEnd(22)} | Diferença`);
console.log('-'.repeat(90));

let totErp = 0, totSup = 0;
for (const [sc, name] of Object.entries(TARGETS)) {
  const erp = erpBySeller[sc];
  const sup = supabaseBySeller[sc];
  const erpVal = erp?.total || 0;
  const supVal = sup?.value || 0;
  const diff = erpVal - supVal;
  totErp += erpVal; totSup += supVal;
  const erpStr = `R$${erpVal.toFixed(2)} (${erp?.count||0} tx, ${erp?.uniqueClients.size||0} cli)`;
  const supStr = `R$${supVal.toFixed(2)} (${sup?.nfs||0} NFs)`;
  const icon = Math.abs(diff) > 1 ? '⚠️' : '✅';
  console.log(`${name.padEnd(12)} | ${erpStr.padEnd(35)} | ${supStr.padEnd(25)} | R$${diff.toFixed(2)} ${icon}`);
}
console.log('-'.repeat(90));
console.log(`${'TOTAL'.padEnd(12)} | R$${totErp.toFixed(2).padEnd(33)} | R$${totSup.toFixed(2).padEnd(23)} | R$${(totErp-totSup).toFixed(2)}`);

// === Verifica: é o fm cache por linha de produto ou por NF?
// Conta o máximo de tx por dia para um único vendedor
const maxMichel = Object.entries((() => {
  const d = {};
  for (const c of clientes) {
    for (const t of c.transacoes||[]) {
      if ((t.dtStr||'')<datemin || (t.dtStr||'')>datemax) continue;
      if (t.canal==='varejo') continue;
      if (String(t.sellerCode)!=='165') continue;
      const day = (t.dtStr||'').slice(0,10);
      if (!d[day]) d[day] = { clients: new Set(), count:0 };
      d[day].clients.add(c.cod);
      d[day].count++;
    }
  }
  return d;
})()).map(([d,v])=>({d, count:v.count, clients:v.clients.size})).sort((a,b)=>b.count-a.count).slice(0,5);
console.log('\nMichel — dias com mais transações ERP:');
maxMichel.forEach(r=>console.log(`  ${r.d}: ${r.count} tx, ${r.clients} clientes únicos`));

// NFs de Michel no Supabase por dia  
const michNFs = {};
for (const nf of allNFs) {
  const hasM = (nf.items||[]).some(it=>(it.products||[]).some(p=>parseInt(p.dealerCode)===165));
  if (!hasM) continue;
  if (!michNFs[nf.issue_date]) michNFs[nf.issue_date] = 0;
  michNFs[nf.issue_date]++;
}
console.log('Michel — NFs Supabase por dia:');
Object.entries(michNFs).sort((a,b)=>a[0].localeCompare(b[0])).forEach(([d,n])=>console.log(`  ${d}: ${n} NFs`));
