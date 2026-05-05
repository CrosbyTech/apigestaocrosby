import { createClient } from '@supabase/supabase-js';
import { loadDebugEnv } from './_debugEnv.mjs';
loadDebugEnv();
const sb = createClient('https://wnjapaczjcvhumfikwwe.supabase.co',process.env.SUPABASE_FISCAL_KEY);

const datemin = '2026-04-01';
const datemax = '2026-04-23';

// Ops faltando no frontend mas presentes no OPERACOES_REVENDA do backend
const OPS_FALTANDO = [5202, 1407, 9120, 9121, 9113, 9111, 9001, 9009, 9061, 9067, 9400, 9401, 9420, 9404, 7806, 7809, 7242, 512];

const DEALERS = { 288: 'Jucelino', 161: 'Cleiton', 241: 'Yago', 15: 'Heyridan', 25: 'Anderson', 165: 'Michel', 251: 'Felipe', 779: 'Aldo' };

const PAGE = 1000;
let all = [], offset = 0;
while (true) {
  const { data } = await sb.from('notas_fiscais')
    .select('invoice_code,total_value,operation_code,operation_name,items,branch_code')
    .eq('operation_type', 'Output')
    .not('invoice_status', 'eq', 'Canceled')
    .not('invoice_status', 'eq', 'Deleted')
    .gte('issue_date', datemin)
    .lte('issue_date', datemax)
    .lt('person_code', 100000000)
    .in('operation_code', OPS_FALTANDO)
    .range(offset, offset + PAGE - 1);
  if (!data?.length) break;
  all.push(...data);
  if (data.length < PAGE) break;
  offset += PAGE;
}

// Quais dealers estão nessas NFs?
const dealerMap = {};
for (const nf of all) {
  const nfTotal = parseFloat(nf.total_value) || 0;
  const sn = {}; let netTotal = 0;
  for (const item of nf.items || []) {
    for (const p of (item.products || [])) {
      const dc = String(p.dealerCode);
      if (!dc || dc === 'undefined') continue;
      const nv = parseFloat(p.netValue) || 0;
      netTotal += nv;
      if (!sn[dc]) sn[dc] = 0;
      sn[dc] += nv;
    }
  }
  if (netTotal <= 0) continue;
  for (const [dc, nv] of Object.entries(sn)) {
    if (!dealerMap[dc]) dealerMap[dc] = { value: 0, nfs: 0 };
    dealerMap[dc].value += nfTotal * (nv / netTotal);
    dealerMap[dc].nfs++;
  }
}

console.log('=== Dealers nas "ops faltando" (NÃO estão no frontend) ===');
console.log(`Total NFs: ${all.length} | Valor: R$${all.reduce((s,n)=>s+parseFloat(n.total_value||0),0).toFixed(2)}\n`);
Object.entries(dealerMap)
  .sort((a,b)=>b[1].value-a[1].value)
  .slice(0, 20)
  .forEach(([dc,v]) => {
    const name = DEALERS[parseInt(dc)] || `Dealer ${dc}`;
    const isKnown = !!DEALERS[parseInt(dc)];
    console.log(`  ${isKnown ? '⭐' : '  '} Dealer ${dc.padEnd(5)} (${name.padEnd(12)}) | ${v.nfs} NFs | R$${v.value.toFixed(2)}`);
  });

// Branchcode das NFs faltando — para entender se são filias específicas
const branchCount = {};
for (const nf of all) {
  const k = nf.branch_code;
  branchCount[k] = (branchCount[k] || 0) + 1;
}
console.log('\nFiliais (branch_code) nessas NFs:');
Object.entries(branchCount).sort((a,b)=>b[1]-a[1]).forEach(([k,v]) => console.log(`  branch ${k}: ${v} NFs`));
