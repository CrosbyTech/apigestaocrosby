// Investiga as 38 NFs com gap: quais dealers, de qual vendedor
import { createClient } from '@supabase/supabase-js';
import { loadDebugEnv } from './_debugEnv.mjs';
loadDebugEnv();
const sb = createClient('https://wnjapaczjcvhumfikwwe.supabase.co',process.env.SUPABASE_FISCAL_KEY);

const OPS = [7236,9122,5102,7242];
const datemin = '2026-04-01', datemax = '2026-04-22';
const DEALERS = new Set([288,161,241,15,25,165,251,779]);
const DNAMES = {288:'Jucelino',161:'Cleiton',241:'Yago',15:'Heyridan',25:'Anderson',165:'Michel',251:'Felipe',779:'Aldo'};

const { data: allNFsRaw } = await sb.from('notas_fiscais')
  .select('invoice_code,total_value,person_code,person_name,items,operation_code,issue_date')
  .eq('operation_type','Output')
  .not('invoice_status','eq','Canceled')
  .not('invoice_status','eq','Deleted')
  .gte('issue_date',datemin)
  .lte('issue_date',datemax)
  .lt('person_code',100000000)
  .in('operation_code',OPS);

console.log(`Total NFs: ${(allNFsRaw||[]).length}`);

let totalGap = 0, gapBySeller = {};
const gapNFs = [];

for (const nf of allNFsRaw||[]) {
  const hasDealers = (nf.items||[]).some(it=>(it.products||[]).some(p=>DEALERS.has(parseInt(p.dealerCode))));
  if (!hasDealers) continue;
  
  const tv = parseFloat(nf.total_value)||0;
  let sumNV = 0;
  const dealerNVs = {};
  let totalDealerNV = 0;
  
  for (const it of nf.items||[]) {
    for (const p of it.products||[]) {
      const nv = parseFloat(p.netValue)||0;
      sumNV += nv;
      const dc = String(parseInt(p.dealerCode));
      if (!dealerNVs[dc]) dealerNVs[dc] = 0;
      dealerNVs[dc] += nv;
    }
  }
  
  // dealers revenda vs all
  const revendaDCs = Object.keys(dealerNVs).filter(dc=>DEALERS.has(parseInt(dc)));
  const revendaNV = revendaDCs.reduce((s,dc)=>s+dealerNVs[dc],0);
  
  const gap = tv - sumNV;
  if (Math.abs(gap) < 1) continue;
  
  // O "gap" é distribuído proporcionalmente:
  // → sellers-totals dá ao dealer: tv * (dealerNV / sumNV) 
  // → FM dá ao dealer: dealerNV (just the FM netValue, NOT the gap)
  // → Diferença sellers-totals vs FM:
  //   tv*(dealerNV/sumNV) - dealerNV = dealerNV*(tv/sumNV - 1) = dealerNV*(tv-sumNV)/sumNV
  //   = dealerNV * gap / sumNV
  
  for (const dc of revendaDCs) {
    const revendaShare = dealerNVs[dc] * gap / (sumNV || 1);
    const name = DNAMES[dc] || dc;
    if (!gapBySeller[name]) gapBySeller[name] = 0;
    gapBySeller[name] += revendaShare;
    totalGap += revendaShare;
  }
  
  if (Math.abs(gap) > 5) {
    gapNFs.push({ 
      code: nf.invoice_code, date: nf.issue_date, op: nf.operation_code, 
      tv, sumNV, gap, 
      dealers: revendaDCs.map(dc=>({ name: DNAMES[dc]||dc, nv: dealerNVs[dc]?.toFixed(2), pct: ((dealerNVs[dc]/sumNV)*100).toFixed(1)+'%' }))
    });
  }
}

console.log('\n=== Gap proporcional por vendedor (sellers-totals - FM sum) ===');
console.log('Positivo = sellers-totals dá MAIS que FM; Negativo = FM dá mais que sellers-totals\n');
Object.entries(gapBySeller).sort((a,b)=>b[1]-a[1]).forEach(([n,v])=>console.log(`  ${n}: R$${v.toFixed(2)}`));
console.log(`  TOTAL: R$${Object.values(gapBySeller).reduce((s,v)=>s+v,0).toFixed(2)}`);

console.log('\nNFs com gap > R$5:');
gapNFs.sort((a,b)=>Math.abs(b.gap)-Math.abs(a.gap)).slice(0,15).forEach(n=>{
  console.log(`  NF ${n.code} | ${n.date} | Op ${n.op} | gap=R$${n.gap.toFixed(2)} | dealers: ${n.dealers.map(d=>`${d.name}(${d.pct})`).join(', ')}`);
});
