// Marca vendedores como inativos via totvs_id.
// Uso: node backend/scripts/set-vendedores-inativo.mjs <id1> [<id2> ...]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });
import pg from 'pg';

const ids = process.argv.slice(2).map(Number).filter(Boolean);
if (ids.length === 0) {
  console.error('Uso: node set-vendedores-inativo.mjs <totvs_id> [<totvs_id> ...]');
  process.exit(1);
}

const cfg = {
  host: process.env.SUPABASE_DB_HOST,
  port: Number(process.env.SUPABASE_DB_PORT),
  user: process.env.SUPABASE_DB_USER,
  password: process.env.SUPABASE_DB_PASSWORD,
  database: process.env.SUPABASE_DB_NAME,
  ssl: { rejectUnauthorized: false },
};

const client = new pg.Client(cfg);
try {
  await client.connect();
  for (const id of ids) {
    const r = await client.query(
      `UPDATE bank.vendedores_integracao
          SET ativo = false, atualizado_em = NOW()
        WHERE totvs_id::text = $1
        RETURNING totvs_id, nome_vendedor, modulo, ativo`,
      [String(id)],
    );
    if (r.rows.length > 0) console.log(`OK ${id}:`, r.rows[0]);
    else console.log(`SKIP ${id}: não encontrado`);
  }
} catch (e) {
  console.error('ERR:', e.message);
} finally {
  try { await client.end(); } catch {}
}
