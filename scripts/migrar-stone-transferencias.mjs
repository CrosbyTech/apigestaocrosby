// Cria as tabelas da transferência entre contas da Stone (stone_contas, stone_transferencias).
// Uso: node scripts/migrar-stone-transferencias.mjs
import 'dotenv/config';
import fs from 'node:fs';
import supabase from '../config/supabase.js';

const sql = fs.readFileSync(new URL('../migrations/stone_transferencias.sql', import.meta.url), 'utf8');
const { error } = await supabase.rpc('exec_sql', { query: sql });
if (error) {
  console.error('ERRO:', error.message);
  process.exit(1);
}
await supabase.rpc('exec_sql', { query: "notify pgrst, 'reload schema'" });
await new Promise((r) => setTimeout(r, 2500));
for (const t of ['stone_contas', 'stone_transferencias']) {
  const { count, error: e } = await supabase.from(t).select('*', { count: 'exact', head: true });
  console.log(t, e ? `ERRO ${e.message}` : `ok (${count} linha(s))`);
}
setTimeout(() => process.exit(0), 200);
