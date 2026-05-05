import supabaseFiscal from './config/supabaseFiscal.js';

const OPS = [5102, 5202, 1407, 9120, 9121, 9122, 9113, 9111, 9001, 9009, 9061, 9067, 9400, 9401, 9420, 9404, 7806, 7809, 7236, 7242, 512];
const names = { 15: 'HEYRIDAN', 25: 'ANDERSON', 161: 'CLEYTON', 165: 'MICHEL', 241: 'YAGO', 251: 'FELIPE_PB', 288: 'JUCELINO', 779: 'ALDO' };

let all = [], from = 0, hasMore = true;
while (hasMore) {
  const { data } = await supabaseFiscal.from('notas_fiscais')
    .select('total_value,items,issue_date,person_name,operation_code,operation_name,transaction_code')
    .in('operation_code', OPS)
    .lt('person_code', 100000000)
    .gte('issue_date', '2026-04-01')
    .lte('issue_date', '2026-04-20')
    .range(from, from + 999);
  all.push(...(data || []));
  hasMore = (data?.length === 1000);
  from += 1000;
}

// Todas as NFs op 9122 — quais dealers?
const nfs9122 = all.filter(n => n.operation_code === 9122);
console.log('=== OP 9122 — todos os dealers ===');
const dealerMap9122 = {};
nfs9122.forEach(n => {
  const d = new Set();
  (n.items || []).forEach(it => (it.products || []).forEach(p => { if (p.dealerCode) d.add(parseInt(p.dealerCode)); }));
  [...d].forEach(dc => {
    if (!dealerMap9122[dc]) dealerMap9122[dc] = { count: 0, value: 0 };
    dealerMap9122[dc].count++;
    dealerMap9122[dc].value += parseFloat(n.total_value || 0);
  });
});
Object.entries(dealerMap9122).sort((a, b) => b[1].value - a[1].value).forEach(([d, v]) =>
  console.log(' dealer', d, names[d] ? '('+names[d]+')' : '', '->', v.count, 'NFs R$' + v.value.toFixed(2))
);

// Heyridan: datas das NFs extras
console.log('\n=== Heyridan (15) — todas as datas ===');
const hNfs = all.filter(n => {
  const d = new Set();
  (n.items || []).forEach(it => (it.products || []).forEach(p => { if (p.dealerCode) d.add(parseInt(p.dealerCode)); }));
  return d.has(15);
});
const byDate = {};
hNfs.forEach(n => {
  const k = n.issue_date;
  if (!byDate[k]) byDate[k] = { count: 0, value: 0 };
  byDate[k].count++;
  byDate[k].value += parseFloat(n.total_value || 0);
});
Object.entries(byDate).sort((a, b) => a[0].localeCompare(b[0])).forEach(([d, v]) =>
  console.log(' ', d, v.count, 'NFs R$' + v.value.toFixed(2))
);
console.log(' Total:', hNfs.length, 'NFs R$' + hNfs.reduce((s, n) => s + parseFloat(n.total_value || 0), 0).toFixed(2));

// Jucelino: breakdown por op
console.log('\n=== Jucelino (288) por operacao ===');
const jNfs = all.filter(n => {
  const d = new Set();
  (n.items || []).forEach(it => (it.products || []).forEach(p => { if (p.dealerCode) d.add(parseInt(p.dealerCode)); }));
  return d.has(288);
});
const opJ = {};
jNfs.forEach(n => {
  const k = n.operation_code + '|' + (n.operation_name?.substring(0, 30) || '?');
  if (!opJ[k]) opJ[k] = { count: 0, value: 0 };
  opJ[k].count++;
  opJ[k].value += parseFloat(n.total_value || 0);
});
Object.entries(opJ).sort((a, b) => b[1].value - a[1].value).forEach(([k, v]) =>
  console.log(' op:' + k.split('|')[0].padEnd(6), k.split('|')[1].padEnd(32), v.count, 'NFs R$' + v.value.toFixed(2))
);
console.log(' Total:', jNfs.length, 'NFs R$' + jNfs.reduce((s, n) => s + parseFloat(n.total_value || 0), 0).toFixed(2));
console.log(' Excel Jucelino: 83 NFs R$28177');
