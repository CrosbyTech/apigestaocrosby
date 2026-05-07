// Lista vendedores dos canais inbound (David, Thalis, Rafael)
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });
import pg from 'pg';

const config = {
  host: process.env.SUPABASE_DB_HOST,
  port: Number(process.env.SUPABASE_DB_PORT),
  user: process.env.SUPABASE_DB_USER,
  password: process.env.SUPABASE_DB_PASSWORD,
  database: process.env.SUPABASE_DB_NAME,
  ssl: { rejectUnauthorized: false },
};

const client = new pg.Client(config);
try {
  await client.connect();
  const r = await client.query(`
    SELECT totvs_id, nome_vendedor, modulo, ativo
      FROM bank.vendedores_integracao
     WHERE totvs_id::text IN ('21','26','69','177','65','259')
        OR LOWER(nome_vendedor) LIKE '%david%'
        OR LOWER(nome_vendedor) LIKE '%thalis%'
        OR LOWER(nome_vendedor) LIKE '%rafael%'
        OR LOWER(nome_vendedor) LIKE '%walter%'
        OR LOWER(nome_vendedor) LIKE '%renato%'
        OR LOWER(nome_vendedor) LIKE '%arthur%'
     ORDER BY modulo, nome_vendedor
  `);
  console.log('vendedores relacionados a multimarcas/inbound:');
  for (const row of r.rows) {
    console.log(
      `  totvs_id=${String(row.totvs_id).padStart(4)} | ${String(row.nome_vendedor).padEnd(20)} | modulo=${String(row.modulo).padEnd(15)} | ativo=${row.ativo}`,
    );
  }
} catch (e) {
  console.error('❌', e.message);
} finally {
  try { await client.end(); } catch {}
}
