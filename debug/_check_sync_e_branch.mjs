import { createClient } from '@supabase/supabase-js';
import { loadDebugEnv } from './_debugEnv.mjs';
loadDebugEnv();
const sb = createClient('https://wnjapaczjcvhumfikwwe.supabase.co',process.env.SUPABASE_FISCAL_KEY);

// Verifica se há NFs emitidas NO PERÍODO que ainda NÃO estão sincronizadas no Supabase
// Compara contagem por dia vs o esperado (se última sync foi até quando?)

const datemin = '2026-04-01';
const datemax = '2026-04-22';
const OPS = [7236, 9122, 5102, 7242];

// 1) Contagem por dia no Supabase
const { data: nfsDia } = await sb.from('notas_fiscais')
  .select('issue_date, invoice_code, total_value, operation_code, branch_code')
  .eq('operation_type', 'Output')
  .not('invoice_status', 'eq', 'Canceled')
  .not('invoice_status', 'eq', 'Deleted')
  .gte('issue_date', datemin)
  .lte('issue_date', datemax)
  .lt('person_code', 100000000)
  .in('operation_code', OPS)
  .order('issue_date', { ascending: true });

// Por dia
const byDay = {};
for (const nf of nfsDia || []) {
  const d = nf.issue_date;
  if (!byDay[d]) byDay[d] = { count: 0, value: 0, branches: new Set() };
  byDay[d].count++;
  byDay[d].value += parseFloat(nf.total_value) || 0;
  byDay[d].branches.add(nf.branch_code);
}
console.log('=== NFs por dia (ops revenda) no Supabase ===');
let total = 0;
Object.entries(byDay).forEach(([d,v]) => {
  total += v.value;
  console.log(`  ${d}: ${v.count} NFs | R$${v.value.toFixed(2)}`);
});
console.log(`TOTAL: R$${total.toFixed(2)} em ${nfsDia?.length} NFs`);

// 2) Últimas NFs adicionadas (para ver se sync está atualizado)
const { data: recentes } = await sb.from('notas_fiscais')
  .select('invoice_code, issue_date, total_value, operation_code, created_at')
  .eq('operation_type', 'Output')
  .in('operation_code', OPS)
  .order('created_at', { ascending: false })
  .limit(10);

console.log('\n=== Últimas 10 NFs adicionadas ao Supabase (por created_at) ===');
for (const nf of recentes || []) {
  console.log(`  NF ${nf.invoice_code} | issue: ${nf.issue_date} | op ${nf.operation_code} | R$${nf.total_value} | criada: ${nf.created_at}`);
}

// 3) Verifica se há NFs com invoice_code alto (recentes) que possam estar faltando
const { data: altosIds } = await sb.from('notas_fiscais')
  .select('invoice_code, issue_date, total_value, operation_code, branch_code')
  .eq('operation_type', 'Output')
  .not('invoice_status', 'eq', 'Canceled')
  .not('invoice_status', 'eq', 'Deleted')
  .gte('issue_date', '2026-04-20')
  .lte('issue_date', '2026-04-22')
  .in('operation_code', OPS)
  .order('invoice_code', { ascending: false })
  .limit(20);

console.log('\n=== NFs recentes (20-22/04) por invoice_code desc ===');
for (const nf of altosIds || []) {
  console.log(`  NF ${nf.invoice_code} | ${nf.issue_date} | op ${nf.operation_code} | R$${nf.total_value} | branch ${nf.branch_code}`);
}

// 4) Também conta sem filtro de ops — total geral revenda por dia (branch_code=2)
const { data: branch2 } = await sb.from('notas_fiscais')
  .select('issue_date, total_value, operation_code, operation_name')
  .eq('operation_type', 'Output')
  .eq('branch_code', 2)
  .not('invoice_status', 'eq', 'Canceled')
  .not('invoice_status', 'eq', 'Deleted')
  .gte('issue_date', datemin)
  .lte('issue_date', datemax)
  .lt('person_code', 100000000);

const byOp = {};
for (const nf of branch2 || []) {
  const k = `${nf.operation_code}|${nf.operation_name||''}`;
  if (!byOp[k]) byOp[k] = { count: 0, value: 0 };
  byOp[k].count++;
  byOp[k].value += parseFloat(nf.total_value) || 0;
}
const totalBranch2 = Object.values(byOp).reduce((s,v)=>s+v.value,0);
console.log(`\n=== BRANCH 2 (filial revenda) — todas as ops ${datemin}~${datemax} ===`);
console.log(`Total: R$${totalBranch2.toFixed(2)} em ${branch2?.length} NFs`);
Object.entries(byOp).sort((a,b)=>b[1].value-a[1].value).slice(0, 15).forEach(([k,v]) => {
  const [c,n] = k.split('|');
  console.log(`  op ${c.padEnd(6)} | ${(n||'').padEnd(45)} | ${v.count} NFs | R$${v.value.toFixed(2)}`);
});
