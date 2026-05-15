// Aplica migration uazapi_instance_status_history.sql no banco UAzapi
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import fs from 'node:fs';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });
import pg from 'pg';

const cfg = {
  host: process.env.UAZAPI_DB_HOST,
  port: Number(process.env.UAZAPI_DB_PORT) || 5432,
  user: process.env.UAZAPI_DB_USER,
  password: process.env.UAZAPI_DB_PASSWORD,
  database: process.env.UAZAPI_DB_NAME,
  ssl: false,
};
const sql = fs.readFileSync(
  path.resolve(__dirname, '..', 'migrations', 'uazapi_instance_status_history.sql'),
  'utf8',
);

const c = new pg.Client(cfg);
try {
  await c.connect();
  await c.query(sql);
  console.log('OK — uazapi_instance_status_history criada/já existe.');
  const r = await c.query(`SELECT COUNT(*)::int AS n FROM uazapi_instance_status_history`);
  console.log(`  rows: ${r.rows[0].n}`);
} catch (e) {
  console.error('ERR:', e.message);
} finally {
  try { await c.end(); } catch {}
}
