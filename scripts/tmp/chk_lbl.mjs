import 'dotenv/config';
import supabase from '../../config/supabase.js';
const out = {};
for (let f = 0; ; f += 1000) {
  const { data } = await supabase.from('contas_pagar_pagos_conciliacao').select('banco').order('id').range(f, f + 999);
  for (const r of data || []) out[r.banco] = (out[r.banco] || 0) + 1;
  if (!data || data.length < 1000) break;
}
console.log(JSON.stringify(out));
process.exit(0);
