import { createClient } from '@supabase/supabase-js';
import { loadDebugEnv } from './_debugEnv.mjs';
loadDebugEnv();
const sb = createClient('https://wnjapaczjcvhumfikwwe.supabase.co',process.env.SUPABASE_FISCAL_KEY);

const datemin = '2026-04-01';
const datemax = '2026-04-23';

// FRONTEND envia apenas essas 3 operações para sellers-totals
const OPS_FRONTEND = [7236, 9122, 5102];

// BACKEND classifica como revenda em OPERACOES_REVENDA (usado no ERP cache)
const OPS_REVENDA_BACKEND = [
  5102, 5202, 1407, 9120, 9121, 9122, 9113, 9111, 9001, 9009, 9061, 9067,
  9400, 9401, 9420, 9404, 7806, 7809, 7236, 7242, 512
];

// Ops que estão no backend mas NÃO no frontend
const OPS_FALTANDO = OPS_REVENDA_BACKEND.filter(o => !OPS_FRONTEND.includes(o));
console.log('Ops revenda no backend MAS NÃO no frontend:', OPS_FALTANDO);

const PAGE = 1000;
async function fetchNFs(ops) {
  let all = [], offset = 0;
  while (true) {
    const { data, error } = await sb.from('notas_fiscais')
      .select('invoice_code,total_value,operation_code,operation_name,items,branch_code')
      .eq('operation_type', 'Output')
      .not('invoice_status', 'eq', 'Canceled')
      .not('invoice_status', 'eq', 'Deleted')
      .gte('issue_date', datemin)
      .lte('issue_date', datemax)
      .lt('person_code', 100000000)
      .in('operation_code', ops)
      .range(offset, offset + PAGE - 1);
    if (error || !data) break;
    all.push(...data);
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

function calcSellers(nfs) {
  const sm = {};
  for (const nf of nfs) {
    if (!nf.items) continue;
    const nfTotal = parseFloat(nf.total_value) || 0;
    const sn = {}; let netTotal = 0;
    for (const item of nf.items) {
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
      if (!sm[dc]) sm[dc] = 0;
      sm[dc] += nfTotal * (nv / netTotal);
    }
  }
  return sm;
}

const [nfsFrontend, nfsFaltando] = await Promise.all([
  fetchNFs(OPS_FRONTEND),
  fetchNFs(OPS_FALTANDO)
]);

const smFrontend = calcSellers(nfsFrontend);
const smFaltando = calcSellers(nfsFaltando);

// Dealers conhecidos
const DEALERS = { 288: 'Jucelino', 161: 'Cleiton', 241: 'Yago', 15: 'Heyridan', 25: 'Anderson', 165: 'Michel', 251: 'Felipe', 779: 'Aldo' };

console.log(`\n=== Comparação por vendedor (Abril 2026) ===`);
const allDealers = new Set([...Object.keys(smFrontend), ...Object.keys(smFaltando)]);
const rows = [...allDealers]
  .filter(dc => DEALERS[parseInt(dc)])
  .map(dc => ({
    dc, name: DEALERS[parseInt(dc)] || dc,
    atual: smFrontend[dc] || 0,
    faltando: smFaltando[dc] || 0,
    total: (smFrontend[dc] || 0) + (smFaltando[dc] || 0)
  }))
  .sort((a,b) => b.total - a.total);

console.log(`${'Vendedor'.padEnd(12)} | ${'Performance atual'.padEnd(20)} | ${'Ops faltando'.padEnd(20)} | ${'Total correto'.padEnd(20)} | Dif%`);
console.log('-'.repeat(90));
for (const r of rows) {
  const pct = r.total > 0 ? ((r.faltando / r.total) * 100).toFixed(1) : '0';
  console.log(`${r.name.padEnd(12)} | R$${r.atual.toFixed(2).padEnd(17)} | R$${r.faltando.toFixed(2).padEnd(17)} | R$${r.total.toFixed(2).padEnd(17)} | ${pct}% faltando`);
}

console.log('\n=== Ops faltando — breakdown por operação ===');
const opBreakdown = {};
for (const nf of nfsFaltando) {
  const k = `${nf.operation_code}|${nf.operation_name||''}`;
  if (!opBreakdown[k]) opBreakdown[k] = { count: 0, value: 0 };
  opBreakdown[k].count++;
  opBreakdown[k].value += parseFloat(nf.total_value) || 0;
}
Object.entries(opBreakdown).sort((a,b)=>b[1].value-a[1].value).forEach(([k,v]) => {
  const [c,n] = k.split('|');
  console.log(`  op ${c.padEnd(6)} | ${(n||'').padEnd(45)} | ${v.count} NFs | R$${v.value.toFixed(2)}`);
});
