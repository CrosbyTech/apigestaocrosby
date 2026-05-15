// Aplica migration uazapi_messages_media_columns.sql no banco UAzapi
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
  path.resolve(__dirname, '..', 'migrations', 'uazapi_messages_media_columns.sql'),
  'utf8',
);

const c = new pg.Client(cfg);
try {
  await c.connect();
  await c.query(sql);
  console.log('OK — colunas de mídia adicionadas.');
  const r = await c.query(`
    SELECT column_name, data_type
      FROM information_schema.columns
     WHERE table_name = 'messages'
       AND column_name LIKE 'media_%'
     ORDER BY column_name`);
  console.table(r.rows);
} catch (e) {
  console.error('ERR:', e.message);
} finally {
  try { await c.end(); } catch {}
}
