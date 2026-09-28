// Aplica migrations/stone_conciliacao.sql (cache dos arquivos Stone + vínculos manuais).
// Idempotente: CREATE TABLE IF NOT EXISTS.
// Requer SUPABASE_DB_HOST / USER / PASSWORD / NAME no .env (ou rode o SQL no editor do Supabase).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import fs from 'node:fs';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });
import pg from 'pg';

if (!process.env.SUPABASE_DB_HOST) {
  console.error(
    'SUPABASE_DB_HOST não definido. Rode o conteúdo de migrations/stone_conciliacao.sql no SQL Editor do Supabase.',
  );
  process.exit(1);
}

const c = new pg.Client({
  host: process.env.SUPABASE_DB_HOST,
  port: Number(process.env.SUPABASE_DB_PORT || 5432),
  user: process.env.SUPABASE_DB_USER,
  password: process.env.SUPABASE_DB_PASSWORD,
  database: process.env.SUPABASE_DB_NAME,
  ssl: { rejectUnauthorized: false },
});
const sql = fs.readFileSync(
  path.resolve(__dirname, '..', 'migrations', 'stone_conciliacao.sql'),
  'utf8',
);
try {
  await c.connect();
  await c.query(sql);
  console.log('OK — tabelas da Conciliação Stone criadas/atualizadas.');
  for (const t of ['stone_conciliacao_arquivos', 'stone_conciliacao_vinculos']) {
    const r = await c.query(`SELECT COUNT(*)::int n FROM ${t}`);
    console.log(`  ${t}: ${r.rows[0].n} linha(s)`);
  }
} catch (e) {
  console.error('ERR:', e.message);
  process.exitCode = 1;
} finally {
  try {
    await c.end();
  } catch {
    /* ignore */
  }
}
