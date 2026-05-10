// ─────────────────────────────────────────────────────────────────────────
// Cria a tabela crm_lead_generation_calls no Supabase MAIN (dorztqiunewggydvkjnf)
//
// Pré-requisitos no backend/.env:
//   SUPABASE_DB_HOST=aws-0-sa-east-1.pooler.supabase.com
//   SUPABASE_DB_PORT=5432
//   SUPABASE_DB_USER=postgres.dorztqiunewggydvkjnf
//   SUPABASE_DB_PASSWORD=<senha>
//   SUPABASE_DB_NAME=postgres
//
// Uso:  node backend/scripts/create-crm-lead-generation-calls.mjs
// ─────────────────────────────────────────────────────────────────────────
import 'dotenv/config';
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const {
  SUPABASE_DB_HOST = 'aws-0-sa-east-1.pooler.supabase.com',
  SUPABASE_DB_PORT = '5432',
  SUPABASE_DB_USER = 'postgres.dorztqiunewggydvkjnf',
  SUPABASE_DB_PASSWORD,
  SUPABASE_DB_NAME = 'postgres',
} = process.env;

if (!SUPABASE_DB_PASSWORD) {
  console.error('❌ SUPABASE_DB_PASSWORD não definido no backend/.env');
  process.exit(1);
}

const config = {
  host: SUPABASE_DB_HOST,
  port: Number(SUPABASE_DB_PORT),
  user: SUPABASE_DB_USER,
  password: SUPABASE_DB_PASSWORD,
  database: SUPABASE_DB_NAME,
  ssl: { rejectUnauthorized: false },
};

const sqlPath = path.resolve(
  __dirname,
  '..',
  'migrations',
  'crm_lead_generation_calls.sql',
);
const sql = fs.readFileSync(sqlPath, 'utf8');
console.log('📄 SQL:', sqlPath, `(${sql.length} chars)`);
console.log(`🔌 Conectando em ${config.host}:${config.port} (${config.user})...`);

const client = new pg.Client(config);
try {
  await client.connect();
  console.log('✅ conectado');
  await client.query(sql);
  console.log('✅ DDL aplicado');
  const r = await client.query(
    'SELECT COUNT(*)::int AS n FROM crm_lead_generation_calls',
  );
  console.log(`📊 linhas atuais: ${r.rows[0].n}`);
  console.log('\n🎉 OK — tabela pronta.');
} catch (e) {
  console.error('❌ erro:', e.code || e.name, '-', e.message);
  process.exitCode = 1;
} finally {
  try {
    await client.end();
  } catch {}
}
