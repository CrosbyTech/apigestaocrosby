import { createClient } from '@supabase/supabase-js';
import { loadDebugEnv } from './_debugEnv.mjs';
loadDebugEnv();
const sb = createClient('https://wnjapaczjcvhumfikwwe.supabase.co',process.env.SUPABASE_FISCAL_KEY);

// Mesma lista que _compare_ops.mjs usa como referência
const OPS_REF = [5102, 5202, 1407, 9120, 9121, 9122, 9113, 9111, 9001, 9009, 9061, 9067, 9400, 9401, 9420, 9404, 7806, 7809, 7236, 7242, 512];
// Lista atual do frontend (após nossa correção)
const OPS_FRONTEND = [7236, 9122, 5102, 7242];

const REVENDA_DEALERS = [15, 25, 161, 165, 241, 251, 288, 779];
const NAMES = { 288: 'Jucelino', 161: 'Cleiton', 241: 'Yago', 15: 'Heyridan', 25: 'Anderson', 165: 'Michel', 251: 'Felipe', 779: 'Aldo' };

const datemin = '2026-04-01';
const datemax = '2026-04-22';

const PAGE = 1000;
async function fetchAndCalc(ops) {
  let all = [], offset = 0;
  while (true) {
    const { data } = await sb.from('notas_fiscais')
      .select('invoice_code,total_value,operation_code,operation_name,items')
      .eq('operation_type', 'Output')
      .not('invoice_status', 'eq', 'Canceled')
      .not('invoice_status', 'eq', 'Deleted')
      .gte('issue_date', datemin)
      .lte('issue_date', datemax)
      .lt('person_code', 100000000)
      .in('operation_code', ops)
      .range(offset, offset + PAGE - 1);
    if (!data?.length) break;
    all.push(...data);
    if (data.length < PAGE) break;
    offset += PAGE;
  }

  const sm = {};
  for (const nf of all) {
    if (!nf.items) continue;
    const nfTotal = parseFloat(nf.total_value) || 0;
    const sn = {}; let netTotal = 0;
    for (const item of nf.items) {
      for (const p of (item.products || [])) {
        const dc = parseInt(p.dealerCode);
        if (!REVENDA_DEALERS.includes(dc)) continue;
        const nv = parseFloat(p.netValue) || 0;
        netTotal += nv;
        if (!sn[dc]) sn[dc] = 0;
        sn[dc] += nv;
      }
    }
    // total full para proporção correta
    let netFull = 0;
    for (const item of nf.items) {
      for (const p of (item.products || [])) {
        netFull += parseFloat(p.netValue) || 0;
      }
    }
    if (netFull <= 0) continue;
    for (const [dc, nv] of Object.entries(sn)) {
      if (!sm[dc]) sm[dc] = { value: 0, nfs: 0 };
      sm[dc].value += nfTotal * (nv / netFull);
      sm[dc].nfs++;
    }
  }
  return { sm, nfCount: all.length, totalNFs: all.reduce((s,n)=>s+parseFloat(n.total_value||0),0) };
}

const [ref, front] = await Promise.all([
  fetchAndCalc(OPS_REF),
  fetchAndCalc(OPS_FRONTEND)
]);

const totalRef = Object.values(ref.sm).reduce((s,v)=>s+v.value,0);
const totalFront = Object.values(front.sm).reduce((s,v)=>s+v.value,0);

console.log(`=== Faturamento por vendedor ${datemin} ~ ${datemax} ===\n`);
console.log(`${'Vendedor'.padEnd(12)} | ${'App atual (4 ops)'.padEnd(22)} | ${'Referência (_compare_ops)'.padEnd(22)} | Diferença`);
console.log('-'.repeat(90));

const rows = REVENDA_DEALERS.map(dc => ({
  name: NAMES[dc],
  front: front.sm[dc]?.value || 0,
  ref: ref.sm[dc]?.value || 0,
})).sort((a,b) => b.ref - a.ref);

for (const r of rows) {
  const diff = r.ref - r.front;
  const icon = Math.abs(diff) > 0.01 ? '⚠️' : '✅';
  console.log(`${r.name.padEnd(12)} | R$${r.front.toFixed(2).padEnd(19)} | R$${r.ref.toFixed(2).padEnd(19)} | ${diff > 0.01 ? '+' : ''}R$${diff.toFixed(2)} ${icon}`);
}

console.log('-'.repeat(90));
console.log(`${'TOTAL'.padEnd(12)} | R$${totalFront.toFixed(2).padEnd(19)} | R$${totalRef.toFixed(2).padEnd(19)} | Dif: R$${(totalRef - totalFront).toFixed(2)}`);
console.log(`\nNFs: frontend=${front.nfCount} (R$${front.totalNFs.toFixed(2)}) | referência=${ref.nfCount} (R$${ref.totalNFs.toFixed(2)})`);

// Ops que estão na referência mas NÃO no frontend e têm dealers revenda
console.log('\n=== Ops extras na referência COM dealers revenda ===');
const OPS_EXTRAS = OPS_REF.filter(o => !OPS_FRONTEND.includes(o));
let allExtra = [], offset = 0;
while (true) {
  const { data } = await sb.from('notas_fiscais')
    .select('operation_code,operation_name,total_value,items')
    .eq('operation_type', 'Output')
    .not('invoice_status', 'eq', 'Canceled')
    .not('invoice_status', 'eq', 'Deleted')
    .gte('issue_date', datemin)
    .lte('issue_date', datemax)
    .lt('person_code', 100000000)
    .in('operation_code', OPS_EXTRAS)
    .range(offset, offset + PAGE - 1);
  if (!data?.length) break;
  allExtra.push(...data);
  if (data.length < PAGE) break;
  offset += PAGE;
}
const opExtra = {};
for (const nf of allExtra) {
  let hasRevenda = false;
  for (const item of nf.items || []) {
    for (const p of item.products || []) {
      if (REVENDA_DEALERS.includes(parseInt(p.dealerCode))) hasRevenda = true;
    }
  }
  if (!hasRevenda) continue;
  const k = `${nf.operation_code}|${nf.operation_name||''}`;
  if (!opExtra[k]) opExtra[k] = { count: 0, value: 0 };
  opExtra[k].count++;
  opExtra[k].value += parseFloat(nf.total_value) || 0;
}
if (Object.keys(opExtra).length === 0) {
  console.log('  Nenhuma ops extra tem dealers revenda conhecidos');
} else {
  Object.entries(opExtra).sort((a,b)=>b[1].value-a[1].value).forEach(([k,v]) => {
    const [c,n] = k.split('|');
    console.log(`  op ${c.padEnd(6)} "${n.padEnd(45)}" | ${v.count} NFs | R$${v.value.toFixed(2)}`);
  });
}
