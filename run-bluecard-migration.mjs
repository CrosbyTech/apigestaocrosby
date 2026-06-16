// Aplica migration bluecard_cvv.sql via conexão direta Postgres
import 'dotenv/config';
import pg from 'pg';
import fs from 'fs';

const sql = fs.readFileSync('./migrations/bluecard_cvv.sql', 'utf8');

const client = new pg.Client({
  host: process.env.SUPABASE_DB_HOST,
  port: Number(process.env.SUPABASE_DB_PORT || 5432),
  user: process.env.SUPABASE_DB_USER,
  password: process.env.SUPABASE_DB_PASSWORD,
  database: process.env.SUPABASE_DB_NAME,
  ssl: { rejectUnauthorized: false },
});

try {
  await client.connect();
  console.log('✓ Conectado ao Postgres');
  await client.query(sql);
  console.log('✓ Migration aplicada');

  // Verifica
  const r = await client.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'bluecard_leads' AND column_name = 'cvv'
  `);
  if (r.rows.length > 0) {
    console.log(`✓ Coluna cvv existe (${r.rows[0].data_type})`);
  } else {
    console.log('⚠ Coluna cvv não encontrada após migration');
  }

  // Gera CVV pros leads existentes que ainda não têm
  const upd = await client.query(`
    UPDATE bluecard_leads
    SET cvv = LPAD((100 + (RANDOM() * 900)::int)::text, 3, '0')
    WHERE cvv IS NULL
    RETURNING id
  `);
  console.log(`✓ ${upd.rowCount} leads existentes receberam CVV`);
} catch (e) {
  console.error('❌ Erro:', e.message);
  process.exit(1);
} finally {
  await client.end();
}
process.exit(0);
