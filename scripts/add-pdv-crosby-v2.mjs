// Aplica migrations/pdv_crosby_v2.sql (operações por empresa + movimentação de EPC).
// Precisa de SUPABASE_DB_HOST/USER/PASSWORD/NAME no .env.
// Sem essas variáveis, rode o SQL direto no SQL Editor do Supabase.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import fs from 'node:fs';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });
import pg from 'pg';

if (!process.env.SUPABASE_DB_HOST) {
  console.error(
    'SUPABASE_DB_HOST não definido no .env — abra migrations/pdv_crosby_v2.sql e rode no SQL Editor do Supabase.',
  );
  process.exit(1);
}

const c = new pg.Client({
  host: process.env.SUPABASE_DB_HOST,
  port: 5432,
  user: process.env.SUPABASE_DB_USER,
  password: process.env.SUPABASE_DB_PASSWORD,
  database: process.env.SUPABASE_DB_NAME,
  ssl: { rejectUnauthorized: false },
});
const sql = fs.readFileSync(
  path.resolve(__dirname, '..', 'migrations', 'pdv_crosby_v2.sql'),
  'utf8',
);
try {
  await c.connect();
  await c.query(sql);
  console.log('OK — PDV Crosby v2 aplicada.');
  const cols = await c.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'pdv_fiscal_config' AND column_name LIKE 'operacao%' ORDER BY column_name",
  );
  console.log('  colunas de operação:', cols.rows.map((r) => r.column_name).join(', ') || 'NENHUMA');
  const mov = await c.query('SELECT COUNT(*)::int n FROM pdv_epc_movimentos');
  console.log(`  pdv_epc_movimentos: ${mov.rows[0].n} linha(s)`);
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
