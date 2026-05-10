// Marca o Thalis (totvs_id=69) como inativo na tabela de vendedores.
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
  console.log('✅ conectado');

  // Descobre a tabela base da view v_vendedores_integracao
  const viewDef = await client.query(`
    SELECT pg_get_viewdef('public.v_vendedores_integracao', true) AS def
  `);
  console.log('📋 view def (preview):');
  console.log(viewDef.rows[0]?.def?.slice(0, 800) || '(view não encontrada)');
  console.log('---');

  // Mostra o registro atual antes
  const before = await client.query(
    `SELECT totvs_id, nome_vendedor, modulo, ativo FROM bank.vendedores_integracao WHERE totvs_id = $1`,
    [69],
  );
  console.log('🔍 antes:', before.rows[0] || '(não encontrado)');

  const r = await client.query(
    `UPDATE bank.vendedores_integracao
        SET ativo = false, atualizado_em = NOW()
      WHERE totvs_id = $1
      RETURNING totvs_id, nome_vendedor, modulo, ativo`,
    [69],
  );
  if (r.rows.length > 0) {
    console.log('✅ atualizado:', r.rows[0]);
  } else {
    console.error('❌ totvs_id=69 não encontrado em bank.vendedores_integracao');
    process.exitCode = 1;
  }
} catch (e) {
  console.error('❌ erro:', e.code || e.name, '-', e.message);
  process.exitCode = 1;
} finally {
  try { await client.end(); } catch {}
}
