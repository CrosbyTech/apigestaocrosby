// Aplica migrations/pdv_crosby.sql (PDV Crosby — vendas HeadCoach + notas fiscais).
// Idempotente: CREATE TABLE IF NOT EXISTS / CREATE OR REPLACE FUNCTION.
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
  path.resolve(__dirname, '..', 'migrations', 'pdv_crosby.sql'),
  'utf8',
);
try {
  await c.connect();
  await c.query(sql);
  console.log('OK — tabelas do PDV Crosby criadas/atualizadas.');
  for (const t of ['pdv_fiscal_config', 'pdv_vendas', 'pdv_venda_itens', 'pdv_venda_pagamentos', 'pdv_notas_fiscais']) {
    const r = await c.query(`SELECT COUNT(*)::int n FROM ${t}`);
    console.log(`  ${t}: ${r.rows[0].n} linha(s)`);
  }
  const f = await c.query(
    "SELECT proname FROM pg_proc WHERE proname = 'pdv_fiscal_proximo_numero'",
  );
  console.log(`  função pdv_fiscal_proximo_numero: ${f.rowCount ? 'ok' : 'AUSENTE'}`);
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
