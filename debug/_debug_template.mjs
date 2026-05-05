import supabaseFiscal from './config/supabaseFiscal.js';

const ops = [5102,5202,1407,9120,9121,9113,9111,7806,7809,7236,7242,512];
const { data, error } = await supabaseFiscal
  .from('notas_fiscais')
  .select('total_value,branch_code,operation_code,invoice_status')
  .eq('operation_type','Output')
  .eq('invoice_status','Issued')
  .gte('issue_date','2026-01-01')
  .lte('issue_date','2026-04-16')
  .in('operation_code', ops);

if (error) { console.error(error); process.exit(1); }

const totalValue = data.reduce((s,r) => s + (parseFloat(r.total_value)||0), 0);
console.log(`NFs Issued: ${data.length}, total_value: R$ ${totalValue.toFixed(2)}`);

// Por filial
const byBranch = {};
for (const r of data) {
  const b = r.branch_code;
  if (!byBranch[b]) byBranch[b] = { count: 0, total: 0 };
  byBranch[b].count++;
  byBranch[b].total += parseFloat(r.total_value) || 0;
}
const sorted = Object.entries(byBranch).sort((a,b) => b[1].total - a[1].total);
console.log('\nPor filial:');
for (const [b, info] of sorted) {
  console.log(`  Filial ${b}: ${info.count} NFs, R$ ${info.total.toFixed(2)}`);
}

// Também listar por status (incluindo Canceled/Deleted)
const { data: allStatus } = await supabaseFiscal
  .from('notas_fiscais')
  .select('total_value,invoice_status')
  .eq('operation_type','Output')
  .gte('issue_date','2026-01-01')
  .lte('issue_date','2026-04-16')
  .in('operation_code', ops);

const byStatus = {};
for (const r of allStatus) {
  const s = r.invoice_status || 'null';
  if (!byStatus[s]) byStatus[s] = { count: 0, total: 0 };
  byStatus[s].count++;
  byStatus[s].total += parseFloat(r.total_value) || 0;
}
console.log('\nPor status:');
for (const [s, info] of Object.entries(byStatus)) {
  console.log(`  ${s}: ${info.count} NFs, R$ ${info.total.toFixed(2)}`);
}
