import supabaseFiscal from './config/supabaseFiscal.js';

const OPS = [5102, 5202, 1407, 9120, 9121, 9122, 9113, 9111, 9001, 9009, 9061, 9067, 9400, 9401, 9420, 9404, 7806, 7809, 7236, 7242, 512];
const DEALERS = [15, 25, 161, 165, 241, 251, 288, 779];
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
console.log('Total NFs:', all.length);

// Felipe PB (251): quais ops?
const felipe = all.filter(n => {
  const d = new Set();
  (n.items || []).forEach(it => (it.products || []).forEach(p => { if (p.dealerCode) d.add(parseInt(p.dealerCode)); }));
  return d.has(251);
});
console.log('\nFelipe PB (251) por operacao:');
const opCount = {};
felipe.forEach(n => {
  const k = n.operation_code + '|' + (n.operation_name?.substring(0, 30) || '?');
  if (!opCount[k]) opCount[k] = { count: 0, value: 0 };
  opCount[k].count++;
  opCount[k].value += parseFloat(n.total_value || 0);
});
Object.entries(opCount).sort((a, b) => b[1].value - a[1].value).forEach(([k, v]) =>
  console.log(' op:' + k.split('|')[0].padEnd(6), k.split('|')[1].padEnd(32), v.count, 'NFs R$' + v.value.toFixed(2))
);
console.log('\nExcel Felipe PB: 24 NFs R$7565');

// Heyridan (15): quais ops?
const heyridan = all.filter(n => {
  const d = new Set();
  (n.items || []).forEach(it => (it.products || []).forEach(p => { if (p.dealerCode) d.add(parseInt(p.dealerCode)); }));
  return d.has(15);
});
console.log('\nHeyridan (15) por operacao:');
const opH = {};
heyridan.forEach(n => {
  const k = n.operation_code + '|' + (n.operation_name?.substring(0, 30) || '?');
  if (!opH[k]) opH[k] = { count: 0, value: 0 };
  opH[k].count++;
  opH[k].value += parseFloat(n.total_value || 0);
});
Object.entries(opH).sort((a, b) => b[1].value - a[1].value).forEach(([k, v]) =>
  console.log(' op:' + k.split('|')[0].padEnd(6), k.split('|')[1].padEnd(32), v.count, 'NFs R$' + v.value.toFixed(2))
);
console.log('\nExcel Heyridan: 70 NFs R$20803');
