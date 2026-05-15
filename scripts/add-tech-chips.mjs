import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import fs from 'node:fs';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });
import pg from 'pg';

const c = new pg.Client({
  host: process.env.SUPABASE_DB_HOST,
  port: 5432,
  user: process.env.SUPABASE_DB_USER,
  password: process.env.SUPABASE_DB_PASSWORD,
  database: process.env.SUPABASE_DB_NAME,
  ssl: { rejectUnauthorized: false },
});
const sql = fs.readFileSync(
  path.resolve(__dirname, '..', 'migrations', 'tech_chips.sql'),
  'utf8',
);
try {
  await c.connect();
  await c.query(sql);
  console.log('OK — tabelas tech_chips criadas/atualizadas.');
  for (const t of ['tech_chips', 'tech_chips_log']) {
    const r = await c.query(`SELECT COUNT(*)::int n FROM ${t}`);
    console.log(`  ${t}: ${r.rows[0].n} rows`);
  }
} catch (e) {
  console.error('ERR:', e.message);
} finally {
  try { await c.end(); } catch {}
}
