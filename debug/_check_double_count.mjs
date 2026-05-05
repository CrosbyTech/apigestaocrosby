import { createClient } from '@supabase/supabase-js';
import { loadDebugEnv } from './_debugEnv.mjs';
loadDebugEnv();
const sb = createClient('https://wnjapaczjcvhumfikwwe.supabase.co',process.env.SUPABASE_FISCAL_KEY);

// Verifica se há NFs com MÚLTIPLOS dealers revenda (o que causaria double-counting no seller-customers)
const datemin = '2026-04-01';
const datemax = '2026-04-23';
const OPS = [7236, 9122, 5102];
const REVENDA_DEALERS = new Set([15, 25, 161, 165, 241, 251, 288, 779]);

const PAGE = 1000;
let all = [], offset = 0;
while (true) {
  const { data } = await sb.from('notas_fiscais')
    .select('invoice_code,total_value,issue_date,items')
    .eq('operation_type', 'Output')
    .not('invoice_status', 'eq', 'Canceled')
    .not('invoice_status', 'eq', 'Deleted')
    .gte('issue_date', datemin)
    .lte('issue_date', datemax)
    .in('operation_code', OPS)
    .range(offset, offset + PAGE - 1);
  if (!data?.length) break;
  all.push(...data);
  if (data.length < PAGE) break;
  offset += PAGE;
}

let multiDealerNFs = 0;
let doubleCountValue = 0;
const NAMES = { 288: 'Jucelino', 161: 'Cleiton', 241: 'Yago', 15: 'Heyridan', 25: 'Anderson', 165: 'Michel', 251: 'Felipe', 779: 'Aldo' };

for (const nf of all) {
  const dealers = new Set();
  for (const item of nf.items || []) {
    for (const p of item.products || []) {
      const dc = parseInt(p.dealerCode);
      if (REVENDA_DEALERS.has(dc)) dealers.add(dc);
    }
  }
  if (dealers.size > 1) {
    multiDealerNFs++;
    const names = [...dealers].map(d => NAMES[d] || d).join(' + ');
    const nfTotal = parseFloat(nf.total_value) || 0;
    doubleCountValue += nfTotal;
    console.log(`  NF ${nf.invoice_code} (${nf.issue_date}) R$${nf.total_value} — dealers: [${names}]`);
  }
}

console.log(`\nTotal NFs (ops revenda, ${datemin}~${datemax}): ${all.length}`);
console.log(`NFs com múltiplos dealers revenda: ${multiDealerNFs}`);
if (multiDealerNFs > 0) {
  console.log(`Valor dessas NFs (dupla contagem no seller-customers): R$${doubleCountValue.toFixed(2)}`);
  console.log('⚠️  Esses clientes apareceriam com valor total em ambos os vendedores no modal de clientes');
} else {
  console.log('✅ Nenhuma NF com duplo dealer revenda — sem double-counting no seller-customers');
}

// Checa também: total no seller-customers vs sellers-totals para Jucelino
// seller-customers: soma full total_value de cada NF que tem dealer 288
// sellers-totals: distribui proporcionalmente
console.log('\n=== seller-customers (full value) vs sellers-totals (proporcional) para dealer 288 ===');
let customerTotal = 0, proportionalTotal = 0;
for (const nf of all) {
  const sn = {}; let netTotal = 0;
  let hasDealer288 = false;
  for (const item of nf.items || []) {
    for (const p of item.products || []) {
      const dc = String(p.dealerCode);
      if (!dc || dc === 'undefined') continue;
      const nv = parseFloat(p.netValue) || 0;
      netTotal += nv;
      if (!sn[dc]) sn[dc] = 0;
      sn[dc] += nv;
      if (dc === '288') hasDealer288 = true;
    }
  }
  const nfTotal = parseFloat(nf.total_value) || 0;
  if (hasDealer288) {
    customerTotal += nfTotal; // full value (seller-customers)
    if (netTotal > 0) {
      proportionalTotal += nfTotal * (sn['288'] / netTotal); // proporcional (sellers-totals)
    }
  }
}
console.log(`  seller-customers (full): R$${customerTotal.toFixed(2)}`);
console.log(`  sellers-totals (proporcional): R$${proportionalTotal.toFixed(2)}`);
console.log(`  Diferença: R$${(customerTotal - proportionalTotal).toFixed(2)}`);
