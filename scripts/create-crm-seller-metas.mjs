// Cria tabela crm_seller_metas no Supabase main.
// Uso: node backend/scripts/create-crm-seller-metas.mjs
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

const sqlPath = path.resolve(__dirname, '..', 'migrations', 'crm_seller_metas.sql');
const sql = fs.readFileSync(sqlPath, 'utf8');

const client = new pg.Client(cfg);
try {
  await client.connect();
  console.log('Connected.');
  await client.query(sql);
  console.log('OK — table crm_seller_metas created/updated.');
  const r = await client.query('SELECT COUNT(*)::int AS n FROM crm_seller_metas');
  console.log(`Rows: ${r.rows[0].n}`);
} catch (e) {
  console.error('ERR:', e.message);
  process.exitCode = 1;
} finally {
  try { await client.end(); } catch {}
}
