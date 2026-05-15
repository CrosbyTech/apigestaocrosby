import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import fs from 'node:fs';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });
import pg from 'pg';

const cfg = {
  host: process.env.SUPABASE_DB_HOST,
  port: 5432,
  user: process.env.SUPABASE_DB_USER,
  password: process.env.SUPABASE_DB_PASSWORD,
  database: process.env.SUPABASE_DB_NAME,
  ssl: { rejectUnauthorized: false },
};
const sql = fs.readFileSync(
  path.resolve(
    __dirname,
    '..',
    'migrations',
    'forecast_canal_metas_add_justificativa.sql',
  ),
  'utf8',
);

const c = new pg.Client(cfg);
try {
  await c.connect();
  await c.query(sql);
  console.log('OK — coluna justificativa adicionada.');
  const r = await c.query(`
    SELECT column_name, data_type FROM information_schema.columns
     WHERE table_name = 'forecast_canal_metas' AND column_name = 'justificativa'
  `);
  console.table(r.rows);
} catch (e) {
  console.error('ERR:', e.message);
} finally {
  try { await c.end(); } catch {}
}
