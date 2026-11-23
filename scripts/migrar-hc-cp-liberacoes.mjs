// Cria a tabela da HEADCOACH › LIBERAÇÃO DE PAGAMENTO (migrations/hc_cp_liberacoes.sql).
// Só acréscimos (CREATE … IF NOT EXISTS): pode rodar de novo.
// Rodar uma vez, na raiz do repositório:  node scripts/migrar-hc-cp-liberacoes.mjs
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import supabase from '../config/supabase.js';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const sql = fs.readFileSync(path.join(aqui, '..', 'migrations', 'hc_cp_liberacoes.sql'), 'utf8');

// separa os comandos por ";" (sem os comentários)
const comandos = sql
  .split('\n')
  .map((l) => {
    const i = l.indexOf('--');
    return i >= 0 ? l.slice(0, i) : l;
  })
  .join('\n')
  .split(';')
  .map((c) => c.trim())
  .filter(Boolean);

let falhas = 0;
for (const q of comandos) {
  const { error } = await supabase.rpc('exec_sql', { query: q });
  if (error) falhas += 1;
  console.log(error ? `ERRO ${error.message}` : 'ok  ', q.replace(/\s+/g, ' ').slice(0, 100));
}
await supabase.rpc('exec_sql', { query: "notify pgrst, 'reload schema'" });
await new Promise((r) => setTimeout(r, 4000));
const { error } = await supabase.from('hc_cp_liberacoes').select('id, titulo:hc_cp_titulos(id)').limit(1);
console.log(`\nhc_cp_liberacoes: ${error ? error.message : 'ok'}`);
console.log(!falhas && !error ? 'PRONTO: tabela da liberação de pagamento criada.' : 'TERMINOU COM ERRO: rode de novo (a conexão pode ter caído).');
process.exit(!falhas && !error ? 0 : 1);
