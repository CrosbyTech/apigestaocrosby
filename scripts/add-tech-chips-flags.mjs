// Adiciona colunas tem_api e tem_whatsapp na tabela tech_chips
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
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

try {
  await c.connect();
  await c.query(`
    ALTER TABLE tech_chips
      ADD COLUMN IF NOT EXISTS tem_api BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS tem_whatsapp BOOLEAN NOT NULL DEFAULT FALSE
  `);
  console.log('OK — colunas tem_api e tem_whatsapp adicionadas.');
  const r = await c.query(
    `SELECT column_name, data_type, column_default
       FROM information_schema.columns
      WHERE table_name = 'tech_chips' AND column_name IN ('tem_api', 'tem_whatsapp')`,
  );
  console.table(r.rows);
} catch (e) {
  console.error('ERR:', e.message);
} finally {
  try { await c.end(); } catch {}
}
