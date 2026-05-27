// Roda um arquivo SQL no Supabase Postgres direto.
// Uso: node scripts/run-migration.mjs <arquivo.sql>
//      node scripts/run-migration.mjs migrations/tech_patrimonio.sql
import 'dotenv/config';
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';

const arquivo = process.argv[2];
if (!arquivo) {
  console.error('Uso: node scripts/run-migration.mjs <caminho-do-sql>');
  process.exit(1);
}

const fullPath = path.resolve(arquivo);
if (!fs.existsSync(fullPath)) {
  console.error(`Arquivo não encontrado: ${fullPath}`);
  process.exit(1);
}
const sql = fs.readFileSync(fullPath, 'utf-8');

const { Pool } = pg;
const pool = new Pool({
  host: process.env.SUPABASE_DB_HOST,
  port: parseInt(process.env.SUPABASE_DB_PORT || '5432', 10),
  user: process.env.SUPABASE_DB_USER,
  password: process.env.SUPABASE_DB_PASSWORD,
  database: process.env.SUPABASE_DB_NAME,
  ssl: { rejectUnauthorized: false },
  // Migrations costumam ser pesadas — timeout generoso
  statement_timeout: 60000,
  query_timeout: 60000,
});

console.log(`📜 Executando ${path.basename(fullPath)} (${sql.length} bytes)...`);
console.log(`   → ${process.env.SUPABASE_DB_HOST}:${process.env.SUPABASE_DB_PORT}/${process.env.SUPABASE_DB_NAME}`);
console.log();

const client = await pool.connect();
try {
  // Roda o SQL inteiro como uma única transação (recomendado pra DDL)
  await client.query('BEGIN');
  await client.query(sql);
  await client.query('COMMIT');
  console.log('✅ Migration executada com sucesso!');
} catch (err) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('❌ Erro na migration:', err.message);
  if (err.detail) console.error('   detalhe:', err.detail);
  if (err.hint) console.error('   hint:', err.hint);
  process.exit(1);
} finally {
  client.release();
  await pool.end();
}
