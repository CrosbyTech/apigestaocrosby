// Investiga quais NFs têm dealerCode 26 (David) em operações multimarcas
import { createClient } from '@supabase/supabase-js';
import { loadDebugEnv } from './_debugEnv.mjs';
loadDebugEnv();

const sb = createClient('https://wnjapaczjcvhumfikwwe.supabase.co', process.env.SUPABASE_FISCAL_KEY);

const OPS = [7235, 7241];
const MULTI_DEALERS = ['259','21','69','65','26','177'];
const TARGET_DEALERS = ['21','26','50']; // dealers com valores suspeitos

const { data: nfs } = await sb.from('notas_fiscais')
  .select('invoice_code,total_value,items,issue_date,person_code,operation_code')
  .eq('operation_type', 'Output')
  .not('invoice_status', 'eq', 'Canceled')
  .not('invoice_status', 'eq', 'Deleted')
  .gte('issue_date', '2026-04-01')
  .lte('issue_date', '2026-04-22')
  .in('operation_code', OPS);

const DEALER_NAMES = {
  '259': 'Arthur', '21': 'Rafael', '26': 'David', '65': 'Renato', '177': 'Walter', '50': '?50'
};

console.log(`Total NFs: ${nfs?.length}`);
console.log('\n=== NFs com dealerCode 26 (David) ===');
for (const nf of nfs || []) {
  const allDealers = new Set();
  let dealer26net = 0, totalNet = 0;
  for (const it of nf.items || []) {
    for (const p of it.products || []) {
      const dc = String(parseInt(p.dealerCode));
      const nv = parseFloat(p.netValue) || 0;
      allDealers.add(dc);
      totalNet += nv;
      if (dc === '26') dealer26net += nv;
    }
  }
  if (dealer26net === 0) continue;
  const tv = parseFloat(nf.total_value) || 0;
  const share = totalNet > 0 ? dealer26net / totalNet : 0;
  const david_value = tv * share;
  const dealerList = [...allDealers].join(',');
  console.log(`  NF ${nf.invoice_code} | op=${nf.operation_code} | dt=${nf.issue_date} | total=${tv.toFixed(2)} | David share=${(share*100).toFixed(1)}% = R$${david_value.toFixed(2)} | dealers=[${dealerList}]`);
}

console.log('\n=== NFs com dealerCode 50 ===');
for (const nf of nfs || []) {
  const allDealers = new Set();
  let dealer50net = 0, totalNet = 0;
  for (const it of nf.items || []) {
    for (const p of it.products || []) {
      const dc = String(parseInt(p.dealerCode));
      const nv = parseFloat(p.netValue) || 0;
      allDealers.add(dc);
      totalNet += nv;
      if (dc === '50') dealer50net += nv;
    }
  }
  if (dealer50net === 0) continue;
  const tv = parseFloat(nf.total_value) || 0;
  const share = totalNet > 0 ? dealer50net / totalNet : 0;
  const dealerList = [...allDealers].join(',');
  console.log(`  NF ${nf.invoice_code} | op=${nf.operation_code} | dt=${nf.issue_date} | total=${tv.toFixed(2)} | D50 share=${(share*100).toFixed(1)}% | dealers=[${dealerList}]`);
}

console.log('\n=== Por dealer: quais dealers coexistem em cada NF ===');
const comb = {};
for (const nf of nfs || []) {
  const allDealers = new Set();
  for (const it of nf.items || []) {
    for (const p of it.products || []) {
      const dc = String(parseInt(p.dealerCode));
      allDealers.add(dc);
    }
  }
  const key = [...allDealers].sort().join('+');
  if (!comb[key]) comb[key] = { count: 0, total: 0 };
  comb[key].count++;
  comb[key].total += parseFloat(nf.total_value) || 0;
}
Object.entries(comb).sort((a, b) => b[1].total - a[1].total).forEach(([k, v]) =>
  console.log(`  [${k}]: ${v.count} NFs = R$${v.total.toFixed(2)}`)
);
