import supabaseFiscal from './config/supabaseFiscal.js';

const OPS = [5102, 5202, 1407, 9120, 9121, 9122, 9113, 9111, 9001, 9009, 9061, 9067, 9400, 9401, 9420, 9404, 7806, 7809, 7236, 7242, 512];

let all = [], from = 0, hasMore = true;
while (hasMore) {
  const { data } = await supabaseFiscal.from('notas_fiscais')
    .select('total_value,items,issue_date,person_name,person_code,transaction_code,operation_code,operation_name')
    .in('operation_code', OPS)
    .eq('operation_type', 'Output')
    .not('invoice_status', 'eq', 'Canceled')
    .not('invoice_status', 'eq', 'Deleted')
    .lt('person_code', 100000000)
    .gte('issue_date', '2026-04-01')
    .lte('issue_date', '2026-04-23')
    .range(from, from + 999);
  all.push(...(data || []));
  hasMore = (data?.length === 1000);
  from += 1000;
}

const yago = all.filter(n => {
  const d = new Set();
  (n.items || []).forEach(it => (it.products || []).forEach(p => { if (p.dealerCode) d.add(parseInt(p.dealerCode)); }));
  return d.has(241);
});

// Por operação
console.log('=== YAGO (241) por operação ===');
const byOp = {};
yago.forEach(n => {
  const k = n.operation_code + '|' + (n.operation_name?.substring(0, 35) || '?');
  if (!byOp[k]) byOp[k] = { count: 0, value: 0 };
  byOp[k].count++;
  byOp[k].value += parseFloat(n.total_value || 0);
});
Object.entries(byOp).sort((a, b) => b[1].value - a[1].value).forEach(([k, v]) =>
  console.log(' op:' + k.split('|')[0].padEnd(6), k.split('|')[1].padEnd(36), v.count, 'NFs R$' + v.value.toFixed(2))
);
const total = yago.reduce((s, n) => s + parseFloat(n.total_value || 0), 0);
console.log(' TOTAL:', yago.length, 'NFs R$' + total.toFixed(2));
console.log(' Excel Yago: 46 NFs R$23.104');

// Por data
console.log('\n=== YAGO por data ===');
const byDate = {};
yago.forEach(n => {
  if (!byDate[n.issue_date]) byDate[n.issue_date] = { count: 0, value: 0 };
  byDate[n.issue_date].count++;
  byDate[n.issue_date].value += parseFloat(n.total_value || 0);
});
Object.entries(byDate).sort((a, b) => a[0].localeCompare(b[0])).forEach(([d, v]) =>
  console.log(' ', d, v.count, 'NFs R$' + v.value.toFixed(2))
);

// Listagem completa das NFs de Yago
console.log('\n=== YAGO — NFs completas ===');
yago.sort((a, b) => a.issue_date.localeCompare(b.issue_date)).forEach(n => {
  const d = new Set();
  (n.items || []).forEach(it => (it.products || []).forEach(p => { if (p.dealerCode) d.add(parseInt(p.dealerCode)); }));
  console.log(' dt:', n.issue_date, 'tx:', n.transaction_code, 'op:', n.operation_code, 'R$' + parseFloat(n.total_value).toFixed(2), 'cli:', n.person_code, n.person_name?.substring(0, 25), 'dealers:', [...d].join(','));
});
