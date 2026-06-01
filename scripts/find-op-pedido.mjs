// Lista todas operações usadas em NFs Output em 2026 (qualquer empresa)
// ordenadas por uso, pra achar a "Entrada 1° Pedido Franquia"
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
const s = createClient(process.env.SUPABASE_FISCAL_URL, process.env.SUPABASE_FISCAL_KEY);

const porOp = {};
let off = 0;
while (off < 30000) {
  const { data } = await s.from('notas_fiscais')
    .select('operation_code, operation_name, total_value')
    .eq('operation_type', 'Output')
    .not('invoice_status', 'eq', 'Canceled')
    .gte('issue_date', '2026-01-01')
    .lte('issue_date', '2026-05-31')
    .range(off, off + 999);
  if (!data?.length) break;
  for (const n of data) {
    const op = n.operation_code;
    if (!porOp[op]) porOp[op] = { nome: n.operation_name, total: 0, qtd: 0 };
    porOp[op].total += Number(n.total_value || 0);
    porOp[op].qtd++;
  }
  if (data.length < 1000) break;
  off += 1000;
}
const sorted = Object.entries(porOp).sort((a, b) => b[1].total - a[1].total);
console.log('Top 25 ops por volume (jan-mai 2026):');
for (const [code, v] of sorted.slice(0, 25)) {
  console.log(`  ${String(code).padStart(5)} - ${(v.nome || '').slice(0, 40).padEnd(40)} R$ ${v.total.toFixed(2).padStart(13)} (${v.qtd} NFs)`);
}
