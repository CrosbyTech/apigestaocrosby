// Alarga nr_fat para bigint (migrations/nr_fat_bigint.sql). Pode rodar de novo.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import supabase from '../config/supabase.js';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const sql = fs.readFileSync(path.join(aqui, '..', 'migrations', 'nr_fat_bigint.sql'), 'utf8');
const comandos = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').split(';').map((c) => c.trim()).filter(Boolean);
let falhas = 0;
for (const q of comandos) {
  const { error } = await supabase.rpc('exec_sql', { query: q });
  if (error) falhas += 1;
  console.log(error ? `ERRO ${error.message}` : 'ok  ', q);
}
process.exit(falhas ? 1 : 0);
