import { createClient } from '@supabase/supabase-js';
import { loadDebugEnv } from './_debugEnv.mjs';
loadDebugEnv();
const sb = createClient('https://wnjapaczjcvhumfikwwe.supabase.co',process.env.SUPABASE_FISCAL_KEY);

const datemin = '2026-04-01';
const datemax = '2026-04-22'; // até dia 22

const REVENDA_DEALERS = new Set([15, 25, 161, 165, 241, 251, 288, 779]);
const NAMES = { 288: 'Jucelino', 161: 'Cleiton', 241: 'Yago', 15: 'Heyridan', 25: 'Anderson', 165: 'Michel', 251: 'Felipe', 779: 'Aldo' };

// === 1) Total com filtragem por operação (atual no frontend: [7236, 9122, 5102, 7242])
const OPS_FRONTEND = [7236, 9122, 5102, 7242];
// === 2) Total SEM filtro de operação (qualquer NF que tenha esses dealers)

const PAGE = 1000;
async function fetchNFs(ops = null) {
  let all = [], offset = 0;
  while (true) {
    let q = sb.from('notas_fiscais')
      .select('invoice_code,total_value,operation_code,operation_name,items,issue_date')
      .eq('operation_type', 'Output')
      .not('invoice_status', 'eq', 'Canceled')
      .not('invoice_status', 'eq', 'Deleted')
      .gte('issue_date', datemin)
      .lte('issue_date', datemax)
      .lt('person_code', 100000000)
      .range(offset, offset + PAGE - 1);
    if (ops) q = q.in('operation_code', ops);
    const { data, error } = await q;
    if (error || !data?.length) break;
    all.push(...data);
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

function calcDealers(nfs) {
  const sm = {};
  for (const nf of nfs) {
    if (!nf.items) continue;
    const nfTotal = parseFloat(nf.total_value) || 0;
    const sn = {}; let netTotal = 0;
    for (const item of nf.items) {
      for (const p of (item.products || [])) {
        const dc = parseInt(p.dealerCode);
        if (!REVENDA_DEALERS.has(dc)) continue;
        const nv = parseFloat(p.netValue) || 0;
        netTotal += nv;
        if (!sn[dc]) sn[dc] = { net: 0, qty: 0 };
        sn[dc].net += nv;
        sn[dc].qty += parseFloat(p.quantity) || 1;
      }
    }
    // Para calcular proporcional, precisa do total INCLUDING non-revenda dealers
    let netTotalFull = 0;
    for (const item of nf.items) {
      for (const p of (item.products || [])) {
        netTotalFull += parseFloat(p.netValue) || 0;
      }
    }
    if (netTotalFull <= 0) continue;
    for (const [dc, info] of Object.entries(sn)) {
      if (!sm[dc]) sm[dc] = { value: 0, nfs: new Set() };
      sm[dc].value += nfTotal * (info.net / netTotalFull);
      sm[dc].nfs.add(nf.invoice_code);
    }
  }
  return sm;
}

const [nfsFrontend, nfsAll] = await Promise.all([
  fetchNFs(OPS_FRONTEND),
  fetchNFs(null) // sem filtro de op
]);

const smFrontend = calcDealers(nfsFrontend);
const smAll = calcDealers(nfsAll);

const totalFrontend = Object.values(smFrontend).reduce((s,v)=>s+v.value,0);
const totalAll = Object.values(smAll).reduce((s,v)=>s+v.value,0);

console.log(`=== Faturamento Revenda ${datemin} ~ ${datemax} ===\n`);
console.log(`${'Vendedor'.padEnd(12)} | ${'Frontend (4 ops)'.padEnd(20)} | ${'Todas ops'.padEnd(20)} | Diferença`);
console.log('-'.repeat(80));

const allDealers = new Set([...Object.keys(smFrontend), ...Object.keys(smAll)]);
const rows = [...allDealers]
  .filter(dc => REVENDA_DEALERS.has(parseInt(dc)))
  .map(dc => ({
    dc, name: NAMES[parseInt(dc)] || `Dealer ${dc}`,
    frontend: smFrontend[dc]?.value || 0,
    all: smAll[dc]?.value || 0,
  }))
  .sort((a,b) => b.all - a.all);

for (const r of rows) {
  const diff = r.all - r.frontend;
  const diffStr = diff > 0.01 ? `+R$${diff.toFixed(2)} ⚠️` : '✅';
  console.log(`${r.name.padEnd(12)} | R$${r.frontend.toFixed(2).padEnd(17)} | R$${r.all.toFixed(2).padEnd(17)} | ${diffStr}`);
}

console.log('-'.repeat(80));
console.log(`${'TOTAL'.padEnd(12)} | R$${totalFrontend.toFixed(2).padEnd(17)} | R$${totalAll.toFixed(2).padEnd(17)} | Dif: R$${(totalAll - totalFrontend).toFixed(2)}`);

// Mostra quais ops extras tem dealers revenda
console.log('\n=== Operações fora do filtro que têm dealers revenda ===');
const extraOps = {};
for (const nf of nfsAll) {
  if (OPS_FRONTEND.includes(nf.operation_code)) continue;
  for (const item of nf.items || []) {
    for (const p of item.products || []) {
      const dc = parseInt(p.dealerCode);
      if (!REVENDA_DEALERS.has(dc)) continue;
      const k = `${nf.operation_code}|${nf.operation_name||'(sem nome)'}`;
      if (!extraOps[k]) extraOps[k] = { count: 0, value: 0, dealers: new Set() };
      extraOps[k].value += parseFloat(nf.total_value) || 0;
      extraOps[k].dealers.add(NAMES[dc]);
      extraOps[k].count++;
    }
  }
}
// dedup by invoice
const extraOpsDedup = {};
for (const nf of nfsAll) {
  if (OPS_FRONTEND.includes(nf.operation_code)) continue;
  let nfTotal = parseFloat(nf.total_value) || 0;
  for (const item of nf.items || []) {
    for (const p of item.products || []) {
      const dc = parseInt(p.dealerCode);
      if (!REVENDA_DEALERS.has(dc)) continue;
      const k = `${nf.operation_code}|${nf.operation_name||'(sem nome)'}`;
      if (!extraOpsDedup[k]) extraOpsDedup[k] = { nfs: new Set(), value: 0, dealers: new Set() };
      if (!extraOpsDedup[k].nfs.has(nf.invoice_code)) {
        extraOpsDedup[k].nfs.add(nf.invoice_code);
        extraOpsDedup[k].value += nfTotal;
      }
      extraOpsDedup[k].dealers.add(NAMES[dc]);
    }
  }
}
Object.entries(extraOpsDedup).sort((a,b)=>b[1].value-a[1].value).forEach(([k,v]) => {
  const [c,n] = k.split('|');
  console.log(`  op ${c.padEnd(6)} "${n.padEnd(45)}" | ${v.nfs.size} NFs | R$${v.value.toFixed(2)} | dealers: ${[...v.dealers].join(', ')}`);
});
