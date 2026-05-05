import { createClient } from '@supabase/supabase-js';
import { loadDebugEnv } from './_debugEnv.mjs';
loadDebugEnv();
const sb = createClient('https://wnjapaczjcvhumfikwwe.supabase.co',process.env.SUPABASE_FISCAL_KEY);

const datemin = '2026-04-20';
const datemax = '2026-04-22';
const operations = [7236, 9122, 5102]; // revenda ops do frontend

const { data, error } = await sb.from('notas_fiscais')
  .select('invoice_code,total_value,operation_code,items')
  .eq('operation_type', 'Output')
  .not('invoice_status', 'eq', 'Canceled')
  .not('invoice_status', 'eq', 'Deleted')
  .gte('issue_date', datemin)
  .lte('issue_date', datemax)
  .in('operation_code', operations);

if (error) { console.error(error); process.exit(1); }

let totalNFs = 0, skipadasSemItems = 0, skipadasNetZero = 0, processadas = 0;
let totalNFsValue = 0, totalAtribuido = 0;
const sellerMap = {};

for (const nf of data || []) {
  totalNFs++;
  totalNFsValue += parseFloat(nf.total_value) || 0;

  if (!nf.items || !Array.isArray(nf.items)) {
    skipadasSemItems++;
    continue;
  }

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
    console.log(`  ⚠️  NF ${nf.invoice_code} [op ${nf.operation_code}] R$${nf.total_value} — SKIPADA (netValueTotal=0)`);
    // Mostra o conteúdo dos items para ver o problema
    const sampleItem = nf.items[0];
    const sampleProd = sampleItem?.products?.[0];
    if (sampleProd) {
      console.log(`     Exemplo produto: dealerCode=${sampleProd.dealerCode}, netValue=${sampleProd.netValue}, grossValue=${sampleProd.grossValue}, quantity=${sampleProd.quantity}`);
    } else {
      console.log(`     items[0]:`, JSON.stringify(sampleItem)?.substring(0, 200));
    }
    continue;
  }

  processadas++;
  for (const [dc, info] of Object.entries(sellerNet)) {
    const share = info.net / netTotal;
    const val = nfTotal * share;
    if (!sellerMap[dc]) sellerMap[dc] = { value: 0, nfs: 0 };
    sellerMap[dc].value += val;
    sellerMap[dc].nfs++;
    totalAtribuido += val;
  }
}

console.log(`\n=== RESUMO ===`);
console.log(`Total NFs: ${totalNFs} | Valor total NFs: R$${totalNFsValue.toFixed(2)}`);
console.log(`Processadas: ${processadas} | Skipadas sem items: ${skipadasSemItems} | Skipadas netValue=0: ${skipadasNetZero}`);
console.log(`Total atribuído a vendedores: R$${totalAtribuido.toFixed(2)}`);
console.log(`Diferença (não atribuído): R$${(totalNFsValue - totalAtribuido).toFixed(2)}`);

console.log(`\nVendedores:`);
Object.entries(sellerMap).sort((a,b)=>b[1].value-a[1].value).forEach(([dc,v]) => {
  console.log(`  Dealer ${dc.padEnd(5)} | ${v.nfs} NFs | R$${v.value.toFixed(2)}`);
});
