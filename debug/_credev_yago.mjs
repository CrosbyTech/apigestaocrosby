// Busca NFs de Credev (Input) para clientes do Yago em abril/2026
// e calcula o faturamento líquido correto
import supabaseFiscal from './config/supabaseFiscal.js';

const DEALER_CODE = 241;
const DE = '2026-04-01';
const ATE = '2026-04-23';

// ─── 1) Total Output do Yago ──────────────────────────────────────────────
const OPS = [5102, 5202, 1407, 9120, 9121, 9122, 9113, 9111, 9001, 9009, 9061, 9067, 9400, 9401, 9420, 9404, 7806, 7809, 7236, 7242, 512];
let allOutput = [], from = 0, hasMore = true;
while (hasMore) {
  const { data } = await supabaseFiscal.from('notas_fiscais')
    .select('total_value,items,issue_date,person_name,person_code,transaction_code,operation_code')
    .in('operation_code', OPS)
    .eq('operation_type', 'Output')
    .not('invoice_status', 'eq', 'Canceled')
    .not('invoice_status', 'eq', 'Deleted')
    .lt('person_code', 100000000)
    .gte('issue_date', DE)
    .lte('issue_date', ATE)
    .range(from, from + 999);
  allOutput.push(...(data || []));
  hasMore = (data?.length === 1000);
  from += 1000;
}
const yagoOutput = allOutput.filter(n => {
  return (n.items || []).some(it => (it.products || [it]).some(p => parseInt(p.dealerCode) === DEALER_CODE));
});
const totalOutput = yagoOutput.reduce((s, n) => s + parseFloat(n.total_value || 0), 0);
const personCodes = [...new Set(yagoOutput.map(n => n.person_code))];

console.log(`=== OUTPUT Yago (${DE} → ${ATE}) ===`);
console.log(` ${yagoOutput.length} NFs  R$${totalOutput.toFixed(2)}`);
console.log(` ${personCodes.length} clientes distintos`);

// ─── 2) Buscar NFs Input (Credev) para TODOS os clientes do Yago ──────────
let allInput = [], fromI = 0, hasMoreI = true;
while (hasMoreI) {
  const { data } = await supabaseFiscal.from('notas_fiscais')
    .select('total_value,items,issue_date,person_name,person_code,transaction_code,operation_code,operation_name,invoice_status')
    .eq('operation_type', 'Input')
    .not('invoice_status', 'eq', 'Canceled')
    .not('invoice_status', 'eq', 'Deleted')
    .in('person_code', personCodes)
    .gte('issue_date', DE)
    .lte('issue_date', ATE)
    .range(fromI, fromI + 999);
  allInput.push(...(data || []));
  hasMoreI = (data?.length === 1000);
  fromI += 1000;
}

// Filtrar só os que têm dealerCode=241 em algum produto
const yagoInput = allInput.filter(n => {
  return (n.items || []).some(it => (it.products || [it]).some(p => parseInt(p.dealerCode) === DEALER_CODE));
});
const totalInput = yagoInput.reduce((s, n) => s + parseFloat(n.total_value || 0), 0);

console.log(`\n=== INPUT/Credev Yago (${DE} → ${ATE}) ===`);
if (yagoInput.length === 0) {
  console.log(' Nenhuma NF Input encontrada para dealerCode=241 no período.');
} else {
  yagoInput.forEach(n => {
    console.log(
      ` TX ${n.transaction_code}  ${String(n.issue_date).slice(5, 10)}  ${String(n.person_name || '').substring(0, 30).padEnd(30)}  cod:${n.person_code}  op:${n.operation_code}  ${n.operation_name?.substring(0,30)}  R$${parseFloat(n.total_value).toFixed(2)}  status:${n.invoice_status}`
    );
  });
  console.log(` TOTAL Credev: ${yagoInput.length} NFs  R$${totalInput.toFixed(2)}`);
}

// ─── 3) Faturamento líquido ───────────────────────────────────────────────
const liquido = totalOutput - totalInput;
console.log(`\n=== RESULTADO FINAL ===`);
console.log(` Output bruto :  R$${totalOutput.toFixed(2)}  (${yagoOutput.length} NFs)`);
console.log(` Input/Credev :  R$${totalInput.toFixed(2)}  (${yagoInput.length} NFs)`);
console.log(` LÍQUIDO      :  R$${liquido.toFixed(2)}`);

// ─── 4) Exibir também sem filtro dealerCode (todo Input dos clientes) ────
const totalInputSemFiltro = allInput.reduce((s, n) => s + parseFloat(n.total_value || 0), 0);
if (allInput.length !== yagoInput.length) {
  console.log(`\n[info] ${allInput.length} NFs Input encontradas para esses clientes sem filtro de dealerCode`);
  console.log(`       R$${totalInputSemFiltro.toFixed(2)} total sem filtro`);
  const extra = allInput.filter(n => !yagoInput.includes(n));
  extra.forEach(n => {
    const dealers = new Set();
    (n.items || []).forEach(it => (it.products || [it]).forEach(p => { if (p.dealerCode) dealers.add(parseInt(p.dealerCode)); }));
    console.log(
      ` [outro dealer] TX ${n.transaction_code}  ${n.person_name?.substring(0, 25)}  dealers:[${[...dealers].join(',')}]  R$${parseFloat(n.total_value).toFixed(2)}`
    );
  });
}
