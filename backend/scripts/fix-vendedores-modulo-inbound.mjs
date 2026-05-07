// Reclassifica os vendedores inbound:
//   David (26) e Thalis (69) → modulo='inbound_david'
//   Rafael (21)              → modulo='inbound_rafael'
//   Walter (177), Renato (65), Arthur (259) ficam em 'multimarcas'
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

const updates = [
  { totvs_id: 26, modulo: 'inbound_david' }, // David
  { totvs_id: 69, modulo: 'inbound_david' }, // Thalis
  { totvs_id: 21, modulo: 'inbound_rafael' }, // Rafael
];

const client = new pg.Client(config);
try {
  await client.connect();
  console.log('✅ conectado');
  for (const u of updates) {
    const r = await client.query(
      `UPDATE bank.vendedores_integracao
          SET modulo = $1, atualizado_em = NOW()
        WHERE totvs_id::text = $2
        RETURNING totvs_id, nome_vendedor, modulo, ativo`,
      [u.modulo, String(u.totvs_id)],
    );
    if (r.rows.length > 0) {
      console.log(`✅ ${r.rows[0].nome_vendedor} → modulo=${r.rows[0].modulo}`);
    } else {
      console.log(`⚠️ totvs_id=${u.totvs_id} não encontrado`);
    }
  }
  // Mostra estado final
  const r = await client.query(`
    SELECT totvs_id, nome_vendedor, modulo, ativo
      FROM bank.vendedores_integracao
     WHERE totvs_id::text IN ('21','26','65','69','177','259')
     ORDER BY modulo, nome_vendedor
  `);
  console.log('\nEstado final:');
  for (const row of r.rows) {
    console.log(
      `  ${String(row.totvs_id).padStart(4)} | ${String(row.nome_vendedor).padEnd(10)} | modulo=${String(row.modulo).padEnd(18)} | ativo=${row.ativo}`,
    );
  }
} catch (e) {
  console.error('❌', e.message);
} finally {
  try { await client.end(); } catch {}
}
