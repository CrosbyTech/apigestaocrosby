// Faturamento 2026 YTD por canal — direto do Supabase notas_fiscais
// (sem credev em payments — apenas bruto Output das ops do canal).
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const s = createClient(process.env.SUPABASE_FISCAL_URL, process.env.SUPABASE_FISCAL_KEY);
const DMIN = '2026-01-01';
const DMAX = new Date().toISOString().slice(0, 10);

const CANAIS = [
  ['varejo',    [1, 2, 55, 510, 511, 1511, 521, 1521, 522, 545, 546, 548, 555, 9001, 9009, 9017, 9027, 9061, 9062, 9063, 9064, 9065, 9067, 9400, 9401, 9402, 9403, 9404, 9405, 9420, 9005, 9026, 1101, 1205, 1210]],
  ['revenda',   [7236, 9122, 5102, 7242, 9061, 9001, 9121, 512]],
  ['multimarcas', [7235, 7241, 9127]],
  ['franquia',  [7234, 7240, 7802, 9124, 7259]],
  ['business',  [7237, 7269, 7279, 7277]],
  ['showroom',  [7254, 7007]],
  ['novidadesfranquia', [7255]],
  ['bazar',     [887]],
];

console.log(`📊 FATURAMENTO 2026 YTD (${DMIN} → ${DMAX}) — bruto Supabase, sem credev em payments\n`);

async function brutoCanal(ops) {
  let off = 0, total = 0, qtd = 0;
  while (off < 50000) {
    const { data } = await s.from('notas_fiscais')
      .select('total_value, invoice_status')
      .eq('operation_type', 'Output')
      .gte('issue_date', DMIN).lte('issue_date', DMAX)
      .in('operation_code', ops)
      .range(off, off + 999);
    if (!data?.length) break;
    for (const n of data) {
      if (n.invoice_status === 'Canceled' || n.invoice_status === 'Deleted') continue;
      total += Number(n.total_value || 0);
      qtd++;
    }
    if (data.length < 1000) break;
    off += 1000;
  }
  return { total, qtd };
}

const results = await Promise.all(CANAIS.map(async ([nome, ops]) => {
  const r = await brutoCanal(ops);
  return [nome, r.total, r.qtd];
}));

let grandTotal = 0;
results.sort((a, b) => b[1] - a[1]);
const f = n => Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
for (const [nome, total, qtd] of results) {
  console.log(`  ${nome.padEnd(22)} R$ ${f(total).padStart(14)}  (${qtd} NFs)`);
  grandTotal += total;
}
console.log('─'.repeat(60));
console.log(`  TOTAL                  R$ ${f(grandTotal).padStart(14)}`);
console.log(`\n⚠️  Supabase pode estar com sync atrasado pros últimos 1-2 dias.`);
console.log(`⚠️  Sem returns subtraídos · sem credev em payments · sem Recife Mall.`);
