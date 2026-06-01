// Busca operações na faixa 7200-7290 que possam ser "Entrada 1° Pedido Franquia"
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
const s = createClient(process.env.SUPABASE_FISCAL_URL, process.env.SUPABASE_FISCAL_KEY);

const { data } = await s.from('notas_fiscais')
  .select('operation_code, operation_name')
  .gte('operation_code', 7200).lte('operation_code', 7300)
  .limit(2000);
const map = new Map();
for (const r of data || []) {
  if (!map.has(r.operation_code)) map.set(r.operation_code, r.operation_name);
}
console.log('Ops na faixa 7200-7300:');
for (const [code, nome] of [...map.entries()].sort((a, b) => a[0] - b[0])) {
  console.log(`  ${String(code).padStart(5)} - ${nome || ''}`);
}
