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
  path.resolve(__dirname, '..', 'migrations', 'forecast_comparativo_ref.sql'),
  'utf8',
);

// Valores de referência Mai/2025 conforme planilha do gerente
const ANO = 2025;
const MES = 5;
const DIA_ACUM = 13;
const REFS = [
  // [canal, valor_full, valor_acumulado]
  ['multimarcas',   166751.69,  33350.34], // B2M
  ['revenda',       422793.30,  84558.66], // B2R
  ['varejo',        276363.10,  55272.62], // B2C
  ['ricardoeletro',      0.00,      0.00], // RICARDO ELETRO (sem dados em 2025)
  ['showroom',      700465.77, 140093.15], // SHOWROOM
  ['franquia',      536323.39, 107264.68], // B2L (mapeado para franquia)
  ['bazar',              0.00,      0.00], // BAZAR (sem dados em 2025)
];

try {
  await c.connect();
  await c.query(sql);
  console.log('OK — tabela forecast_comparativo_ref criada/atualizada.');

  for (const [canal, full, acum] of REFS) {
    await c.query(
      `INSERT INTO forecast_comparativo_ref
            (canal, ano, mes, valor_full, valor_acumulado, dia_acumulado, atualizado_em, atualizado_por)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), 'seed-script')
       ON CONFLICT (canal, ano, mes)
         DO UPDATE SET valor_full = EXCLUDED.valor_full,
                       valor_acumulado = EXCLUDED.valor_acumulado,
                       dia_acumulado = EXCLUDED.dia_acumulado,
                       atualizado_em = NOW(),
                       atualizado_por = 'seed-script'`,
      [canal, ANO, MES, full, acum, DIA_ACUM],
    );
    console.log(`  ${canal.padEnd(15)} full=R$${full.toFixed(2).padStart(11)}  acum=R$${acum.toFixed(2).padStart(11)}`);
  }

  console.log('\n— Conteúdo da tabela —');
  const r = await c.query(
    `SELECT canal, ano, mes, valor_full, valor_acumulado, dia_acumulado
       FROM forecast_comparativo_ref
      ORDER BY ano, mes, canal`,
  );
  for (const row of r.rows) {
    console.log(
      `  ${row.canal.padEnd(15)} ${row.ano}-${String(row.mes).padStart(2,'0')}  ` +
      `full=R$${Number(row.valor_full).toFixed(2).padStart(11)}  ` +
      `acum(dia ${row.dia_acumulado})=R$${Number(row.valor_acumulado).toFixed(2).padStart(11)}`,
    );
  }
} catch (e) {
  console.error('ERR:', e.message);
} finally {
  try { await c.end(); } catch {}
}
