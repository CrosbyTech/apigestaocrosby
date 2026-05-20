// Cria tabelas forecast_credev_overrides e forecast_credev_overrides_log
// Uso: node backend/scripts/create-credev-overrides.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import fs from 'node:fs';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });
import pg from 'pg';

const cfg = {
  host: process.env.SUPABASE_DB_HOST,
  port: Number(process.env.SUPABASE_DB_PORT),
  user: process.env.SUPABASE_DB_USER,
  password: process.env.SUPABASE_DB_PASSWORD,
  database: process.env.SUPABASE_DB_NAME,
  ssl: { rejectUnauthorized: false },
};

const sqlPath = path.resolve(__dirname, '..', 'migrations', 'forecast_credev_overrides.sql');
const sql = fs.readFileSync(sqlPath, 'utf8');

const client = new pg.Client(cfg);
try {
  await client.connect();
  console.log('Connected.');
  await client.query(sql);
  console.log('OK — tables forecast_credev_overrides + log criadas/atualizadas.');
  const r = await client.query('SELECT COUNT(*)::int AS n FROM forecast_credev_overrides');
  const r2 = await client.query('SELECT COUNT(*)::int AS n FROM forecast_credev_overrides_log');
  console.log(`Rows overrides: ${r.rows[0].n} · log: ${r2.rows[0].n}`);
} catch (e) {
  console.error('ERR:', e.message);
  process.exitCode = 1;
} finally {
  try { await client.end(); } catch {}
}
