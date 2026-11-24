// Fila de inclusão na Stone aceita liberações do HeadCoach (migrations/stone_inclusoes_hc.sql).
// Uso: node scripts/migrar-stone-inclusoes-hc.mjs
import 'dotenv/config';
import fs from 'node:fs';
import supabase from '../config/supabase.js';

const sql = fs.readFileSync(new URL('../migrations/stone_inclusoes_hc.sql', import.meta.url), 'utf8');
const { error } = await supabase.rpc('exec_sql', { query: sql });
if (error) {
  console.error('ERRO:', error.message);
  process.exit(1);
}
await supabase.rpc('exec_sql', { query: "notify pgrst, 'reload schema'" });
await new Promise((r) => setTimeout(r, 2500));
const a = await supabase.from('stone_inclusoes').select('id, hc_liberacao_id').limit(1);
const b = await supabase.from('hc_cp_liberacoes').select('id, inclusao').limit(1);
console.log('stone_inclusoes.hc_liberacao_id:', a.error ? `ERRO ${a.error.message}` : 'ok', '· hc_cp_liberacoes.inclusao:', b.error ? `ERRO ${b.error.message}` : 'ok');
setTimeout(() => process.exit(0), 200);
