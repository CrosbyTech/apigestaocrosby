// Procura operações com "primeiro pedido" / "entrada pedido" no nome
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
const s = createClient(process.env.SUPABASE_FISCAL_URL, process.env.SUPABASE_FISCAL_KEY);

// Lista operations distintas com texto similar
const { data } = await s.from('notas_fiscais')
  .select('operation_code, operation_name')
  .or('operation_name.ilike.%primeiro pedido%,operation_name.ilike.%entrada%pedido%,operation_name.ilike.%1 pedido%,operation_name.ilike.%1° pedido%')
  .limit(30);

const map = new Map();
for (const r of data || []) {
  if (!map.has(r.operation_code)) map.set(r.operation_code, r.operation_name);
}
console.log('Operações encontradas:');
for (const [code, nome] of map) {
  console.log(`  ${String(code).padStart(5)} - ${nome}`);
}

// Também procura operações de junho/2025 com valor próximo de R$60.000
console.log('\nOps com volumes altos em junho/2025 (não-franquia):');
const FRANQUIA_OPS = new Set([7234, 7240, 7802, 9124, 7259]);
const { data: jun } = await s.from('notas_fiscais')
  .select('operation_code, operation_name, total_value')
  .eq('operation_type', 'Output')
  .gte('issue_date', '2025-06-01').lte('issue_date', '2025-06-30')
  .not('invoice_status', 'eq', 'Canceled')
  .limit(5000);
const porOp = {};
for (const n of jun || []) {
  const op = n.operation_code;
  if (FRANQUIA_OPS.has(op)) continue;
  if (!porOp[op]) porOp[op] = { nome: n.operation_name, total: 0, qtd: 0 };
  porOp[op].total += Number(n.total_value || 0);
  porOp[op].qtd++;
}
const top = Object.entries(porOp)
  .filter(([, v]) => v.total >= 10000 && v.total <= 100000)
  .sort((a, b) => Math.abs(60000 - b[1].total) - Math.abs(60000 - a[1].total));
console.log('Candidatos (volume entre R$10k e R$100k):');
for (const [code, v] of top.slice(0, 15)) {
  console.log(`  ${String(code).padStart(5)} - ${(v.nome || '').padEnd(40)} R$ ${v.total.toFixed(2).padStart(12)} (${v.qtd} NFs)`);
}
