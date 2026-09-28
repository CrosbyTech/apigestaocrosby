// Aplica migrations/devolucoes_mercadoria.sql. Precisa de SUPABASE_DB_* no .env;
// sem isso, rode o SQL no SQL Editor do Supabase.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import fs from 'node:fs';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });
import pg from 'pg';

if (!process.env.SUPABASE_DB_HOST) {
  console.error('SUPABASE_DB_HOST não definido — rode migrations/devolucoes_mercadoria.sql no SQL Editor do Supabase.');
  process.exit(1);
}
const c = new pg.Client({
  host: process.env.SUPABASE_DB_HOST,
  port: 5432,
  user: process.env.SUPABASE_DB_USER,
  password: process.env.SUPABASE_DB_PASSWORD,
  database: process.env.SUPABASE_DB_NAME,
  ssl: { rejectUnauthorized: false },
});
const sql = fs.readFileSync(path.resolve(__dirname, '..', 'migrations', 'devolucoes_mercadoria.sql'), 'utf8');
try {
  await c.connect();
  await c.query(sql);
  const r = await c.query('SELECT COUNT(*)::int n FROM devolucoes_mercadoria');
  console.log(`OK — devolucoes_mercadoria pronta (${r.rows[0].n} linha(s)).`);
} catch (e) {
  console.error('ERR:', e.message);
  process.exitCode = 1;
} finally {
  try { await c.end(); } catch { /* ignore */ }
}
