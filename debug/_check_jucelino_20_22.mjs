import { createClient } from '@supabase/supabase-js';
import { loadDebugEnv } from './_debugEnv.mjs';
loadDebugEnv();
const sb = createClient('https://wnjapaczjcvhumfikwwe.supabase.co',process.env.SUPABASE_FISCAL_KEY);

const datemin = '2026-04-20';
const datemax = '2026-04-22';
const operations = [7236, 9122, 5102]; // OPERATIONS_POR_MODULO.revenda

const { data, error } = await sb.from('notas_fiscais')
  .select('items,total_value,operation_code,branch_code,invoice_code,issue_date,person_code,person_name')
  .eq('operation_type', 'Output')
  .not('invoice_status', 'eq', 'Canceled')
  .not('invoice_status', 'eq', 'Deleted')
  .gte('issue_date', datemin)
  .lte('issue_date', datemax)
  .in('operation_code', operations);

if (error) { console.error(error); process.exit(1); }

console.log(`NFs encontradas (op ${operations.join(',')}): ${data.length}`);

const sellerMap = {};
for (const nf of data) {
  if (!nf.items) continue;
  const nfTotal = parseFloat(nf.total_value) || 0;
  const sellerNet = {};
  let totalNet = 0;
  for (const item of nf.items) {
    for (const p of item.products || []) {
      const dc = String(p.dealerCode);
      if (!dc || dc === 'undefined') continue;
      const nv = parseFloat(p.netValue) || 0;
      totalNet += nv;
      if (!sellerNet[dc]) sellerNet[dc] = 0;
      sellerNet[dc] += nv;
    }
  }
  if (totalNet <= 0) continue;
  for (const [dc, net] of Object.entries(sellerNet)) {
    const share = net / totalNet;
    if (!sellerMap[dc]) sellerMap[dc] = { value: 0, nfs: 0 };
    sellerMap[dc].value += nfTotal * share;
    sellerMap[dc].nfs++;
  }
}

console.log('\nVendedores nesse período (20-22/04, ops revenda):');
Object.entries(sellerMap).sort((a,b)=>b[1].value-a[1].value).forEach(([dc,v]) => {
  console.log(`  Dealer ${dc.padEnd(5)} | ${v.nfs} NFs | R$${v.value.toFixed(2)}`);
});

// Verifica NFs de Jucelino (288) especificamente
console.log('\n=== NFs de Jucelino (288) nesse período com qualquer op ===');
const { data: allNFs } = await sb.from('notas_fiscais')
  .select('invoice_code,operation_code,operation_name,total_value,issue_date,person_code,person_name,items')
  .eq('operation_type','Output')
  .not('invoice_status','eq','Canceled')
  .not('invoice_status','eq','Deleted')
  .gte('issue_date', datemin)
  .lte('issue_date', datemax)
  .limit(1000);

for (const nf of allNFs || []) {
  const hasJucelino = (nf.items || []).some(item => 
    (item.products || []).some(p => parseInt(p.dealerCode) === 288)
  );
  if (!hasJucelino) continue;
  const inRevenda = operations.includes(nf.operation_code);
  console.log(` NF ${nf.invoice_code} | op ${nf.operation_code} "${nf.operation_name||''}" | R$${nf.total_value} | ${nf.person_name} | ${inRevenda ? '✅ REVENDA' : '❌ não inclusa'}`);
}
