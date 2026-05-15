// Aplica migration p/ adicionar coluna meta_kind em crm_seller_metas
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
const sql = fs.readFileSync(
  path.resolve(__dirname, '..', 'migrations', 'crm_seller_metas_add_kind.sql'),
  'utf8',
);
const c = new pg.Client(cfg);
try {
  await c.connect();
  await c.query(sql);
  console.log('OK — meta_kind aplicado.');
  const r = await c.query(`
    SELECT meta_kind, COUNT(*)::int AS n
      FROM crm_seller_metas
     GROUP BY meta_kind
     ORDER BY meta_kind
  `);
  console.table(r.rows);
} catch (e) {
  console.error('ERR:', e.message);
} finally {
  try { await c.end(); } catch {}
}
