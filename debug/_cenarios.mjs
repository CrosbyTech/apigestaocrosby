import supabaseFiscal from './config/supabaseFiscal.js';

// Ops sem 9122 — para comparar com Excel
const OPS_SEM_9122 = [5102, 5202, 1407, 9120, 9121, 9113, 9111, 9001, 9009, 9061, 9067, 9400, 9401, 9420, 9404, 7806, 7809, 7236, 7242, 512];
const OPS_TODOS = [...OPS_SEM_9122, 9122];
const names = { 15: 'HEYRIDAN', 25: 'ANDERSON', 161: 'CLEYTON', 165: 'MICHEL', 241: 'YAGO', 251: 'FELIPE_PB', 288: 'JUCELINO', 779: 'ALDO' };
const excel = { 15: { nfs: 70, total: 20803 }, 25: { nfs: 22, total: 17261 }, 161: { nfs: 53, total: 23520 }, 165: { nfs: 41, total: 14409 }, 241: { nfs: 46, total: 23104 }, 251: { nfs: 24, total: 7565 }, 288: { nfs: 83, total: 28177 }, 779: { nfs: 1, total: 69 } };

async function fetchAll(ops, excludeDate20) {
  let all = [], from = 0, hasMore = true;
  const endDate = excludeDate20 ? '2026-04-19' : '2026-04-20';
  while (hasMore) {
    const { data } = await supabaseFiscal.from('notas_fiscais')
      .select('total_value,items,issue_date')
      .in('operation_code', ops)
      .lt('person_code', 100000000)
      .gte('issue_date', '2026-04-01')
      .lte('issue_date', endDate)
      .range(from, from + 999);
    all.push(...(data || []));
    hasMore = (data?.length === 1000);
    from += 1000;
  }
  return all;
}

function summarize(all, label) {
  const byDealer = {};
  all.forEach(n => {
    const d = new Set();
    (n.items || []).forEach(it => (it.products || []).forEach(p => { if (p.dealerCode) d.add(parseInt(p.dealerCode)); }));
    d.forEach(dc => {
      if (!byDealer[dc]) byDealer[dc] = { nfs: 0, total: 0 };
      byDealer[dc].nfs++;
      byDealer[dc].total += parseFloat(n.total_value || 0);
    });
  });
  
  console.log('\n===', label, '===');
  console.log('Vendedor         | ExcelNFs | Excel R$   | BackNFs | Back R$    | Diff R$');
  let excelSum = 0, backSum = 0;
  Object.keys(names).forEach(d => {
    const bd = byDealer[d] || { nfs: 0, total: 0 };
    const diff = bd.total - excel[d].total;
    console.log(names[d].padEnd(16), excel[d].nfs, 'NFs', 'R$' + excel[d].total.toFixed(0).padStart(7), '|', String(bd.nfs).padStart(4), 'NFs', 'R$' + bd.total.toFixed(0).padStart(7), '| R$' + (diff >= 0 ? '+' : '') + diff.toFixed(0));
    excelSum += excel[d].total;
    backSum += bd.total;
  });
  console.log('TOTAL            ', '   ', 'R$' + excelSum.toFixed(0).padStart(7), '|', '     ', '    ', 'R$' + backSum.toFixed(0).padStart(7), '| R$' + (backSum >= excelSum ? '+' : '') + (backSum - excelSum).toFixed(0));
}

console.log('Comparando Excel vs Backend por cenário:');

const all01_20 = await fetchAll(OPS_TODOS, false);
summarize(all01_20, 'TODOS OPS, 01-20/04');

const all01_19 = await fetchAll(OPS_TODOS, true);
summarize(all01_19, 'TODOS OPS, 01-19/04 (sem 20/04)');

const all01_20_sem9122 = await fetchAll(OPS_SEM_9122, false);
summarize(all01_20_sem9122, 'SEM OP9122, 01-20/04');

const all01_19_sem9122 = await fetchAll(OPS_SEM_9122, true);
summarize(all01_19_sem9122, 'SEM OP9122, 01-19/04');
