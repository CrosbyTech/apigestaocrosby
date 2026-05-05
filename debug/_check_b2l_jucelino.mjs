import { createClient } from '@supabase/supabase-js';
import { loadDebugEnv } from './_debugEnv.mjs';
loadDebugEnv();
const sb = createClient('https://wnjapaczjcvhumfikwwe.supabase.co',process.env.SUPABASE_FISCAL_KEY);

// Cliente SHAYANNE DE OLIVEIRA SILVA, #12097, compra 22/04/2026, R$1.631
const { data, error } = await sb.from('notas_fiscais')
  .select('invoice_code,operation_code,operation_name,total_value,issue_date,items')
  .eq('person_code', 12097)
  .eq('issue_date', '2026-04-22')
  .eq('operation_type','Output')
  .limit(10);

if (error) { console.error(error); process.exit(1); }

for (const nf of data || []) {
  console.log(`NF ${nf.invoice_code} | op ${nf.operation_code} | "${nf.operation_name}" | R$${nf.total_value}`);
  // Dealers nessa NF
  const dealers = new Set();
  for (const item of nf.items || []) {
    for (const p of item.products || []) {
      if (p.dealerCode) dealers.add(p.dealerCode);
    }
  }
  console.log('  Dealers:', [...dealers].join(', '));
}

// Também buscar todas as operações de Jucelino (dealerCode 288) nesse período
console.log('\n=== Todas as ops de Jucelino (288) em abril/2026 ===');
const { data: all } = await sb.from('notas_fiscais')
  .select('invoice_code,operation_code,operation_name,total_value,issue_date,person_code,person_name,items')
  .eq('operation_type','Output')
  .not('invoice_status','eq','Canceled')
  .not('invoice_status','eq','Deleted')
  .gte('issue_date','2026-04-20')
  .lte('issue_date','2026-04-23')
  .limit(500);

const ops = {};
for (const nf of all || []) {
  const hasJucelino = (nf.items || []).some(item => 
    (item.products || []).some(p => parseInt(p.dealerCode) === 288)
  );
  if (!hasJucelino) continue;
  const k = `${nf.operation_code}|${nf.operation_name || ''}`;
  if (!ops[k]) ops[k] = { count: 0, value: 0 };
  ops[k].count++;
  ops[k].value += parseFloat(nf.total_value) || 0;
}
Object.entries(ops).sort((a,b) => b[1].value - a[1].value).forEach(([k,v]) => {
  const [c,n] = k.split('|');
  console.log(`  op ${c.padEnd(6)} | ${(n||'').padEnd(45)} | ${v.count} NFs | R$${v.value.toFixed(2)}`);
});
