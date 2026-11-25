// Cria a marca de escrituração nas duplicatas do HEADCOACH › CONTAS A PAGAR
// (migrations/hc_cp_escrituracao.sql). Só acréscimos: pode rodar de novo.
// Rodar uma vez, na raiz do repositório:  node scripts/migrar-hc-cp-escrituracao.mjs
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import supabase from '../config/supabase.js';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const sql = fs.readFileSync(path.join(aqui, '..', 'migrations', 'hc_cp_escrituracao.sql'), 'utf8');

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
const { error } = await supabase.from('hc_cp_titulos').select('id, escrituracao, escrituracao_em, escrituracao_por').limit(1);
console.log(`\nhc_cp_titulos.escrituracao: ${error ? error.message : 'ok'}`);
console.log(!falhas && !error ? 'PRONTO: marca de escrituração criada nas duplicatas.' : 'TERMINOU COM ERRO: rode de novo (a conexão pode ter caído).');
process.exit(!falhas && !error ? 0 : 1);
