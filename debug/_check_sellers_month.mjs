import { createClient } from '@supabase/supabase-js';
import { loadDebugEnv } from './_debugEnv.mjs';
loadDebugEnv();
const sb = createClient('https://wnjapaczjcvhumfikwwe.supabase.co',process.env.SUPABASE_FISCAL_KEY);

// Testa período mais longo (1 mês) — igual ao que a aba Performance usa
const datemin = '2026-04-01';
const datemax = '2026-04-23';
const operations = [7236, 9122, 5102]; // operações revenda do FRONTEND

const PAGE = 1000;
let allNFs = [], offset = 0;
while (true) {
  const { data, error } = await sb.from('notas_fiscais')
    .select('invoice_code,total_value,operation_code,items,issue_date')
    .eq('operation_type', 'Output')
    .not('invoice_status', 'eq', 'Canceled')
    .not('invoice_status', 'eq', 'Deleted')
    .gte('issue_date', datemin)
    .lte('issue_date', datemax)
    .in('operation_code', operations)
    .range(offset, offset + PAGE - 1);
  if (error) { console.error(error); break; }
  allNFs.push(...(data || []));
  if (data.length < PAGE) break;
  offset += PAGE;
}

let totalNFsValue = 0, skipadasNetZero = 0, totalAtribuido = 0;
const sellerMap = {};

for (const nf of allNFs) {
  totalNFsValue += parseFloat(nf.total_value) || 0;

  if (!nf.items || !Array.isArray(nf.items)) { skipadasNetZero++; continue; }

  const nfTotal = parseFloat(nf.total_value) || 0;
  const sellerNet = {};
  let netTotal = 0;

  for (const item of nf.items) {
    const prods = Array.isArray(item.products) ? item.products : [];
    for (const p of prods) {
      const dc = String(p.dealerCode);
      if (!dc || dc === 'undefined') continue;
      const nv = parseFloat(p.netValue) || 0;
      const qty = parseFloat(p.quantity) || 1;
      netTotal += nv;
      if (!sellerNet[dc]) sellerNet[dc] = { net: 0, qty: 0 };
      sellerNet[dc].net += nv;
      sellerNet[dc].qty += qty;
    }
  }

  if (netTotal <= 0) {
    skipadasNetZero++;
    continue;
  }

  for (const [dc, info] of Object.entries(sellerNet)) {
    const share = info.net / netTotal;
    const val = nfTotal * share;
    if (!sellerMap[dc]) sellerMap[dc] = { value: 0, nfs: 0 };
    sellerMap[dc].value += val;
    sellerMap[dc].nfs++;
    totalAtribuido += val;
  }
}

console.log(`=== Período ${datemin} ~ ${datemax} (ops ${operations.join(',')}) ===`);
console.log(`Total NFs: ${allNFs.length} | Valor total: R$${totalNFsValue.toFixed(2)}`);
console.log(`Skipadas (netValue=0): ${skipadasNetZero} | NF value perdida: R$${(totalNFsValue - totalAtribuido).toFixed(2)}`);
console.log(`Total atribuído: R$${totalAtribuido.toFixed(2)}\n`);
console.log('Vendedores (por faturamento atribuído):');
Object.entries(sellerMap).sort((a,b)=>b[1].value-a[1].value).forEach(([dc,v]) => {
  console.log(`  Dealer ${dc.padEnd(5)} | ${v.nfs} NFs | R$${v.value.toFixed(2)}`);
});

// Agora compara com o total_value puro (sem distribuição proporcional)
console.log('\n=== Comparação: Total puro (sem proporcional) ===');
const rawMap = {};
for (const nf of allNFs) {
  const dealers = new Set();
  for (const item of nf.items || []) {
    for (const p of item.products || []) {
      if (p.dealerCode) dealers.add(String(p.dealerCode));
    }
  }
  if (dealers.size === 0) continue;
  for (const dc of dealers) {
    if (!rawMap[dc]) rawMap[dc] = { value: 0, nfs: 0 };
    rawMap[dc].value += parseFloat(nf.total_value) || 0;
    rawMap[dc].nfs++;
  }
}
Object.entries(rawMap).sort((a,b)=>b[1].value-a[1].value).forEach(([dc,v]) => {
  const proportional = sellerMap[dc]?.value || 0;
  const diff = v.value - proportional;
  console.log(`  Dealer ${dc.padEnd(5)} | ${v.nfs} NFs | Total bruto: R$${v.value.toFixed(2)} | Proporcional: R$${proportional.toFixed(2)} | Dif: R$${diff.toFixed(2)}`);
});
