// Cadastra o planejamento mensal de Maio/2026 enviado pelo usuário.
// Mapeamento canais:
//   B2R → revenda
//   B2M → multimarcas
//   B2C → varejo
//   B2L Pronta → franquia
//   B2M INBOUND → inbound_david
//   BAZAR → bazar
//   RICARDO ELETRO → ricardoeletro
//   B2L → PULADO (ambíguo, definir depois)
//
// Semanas: SEM1=W19, SEM2=W20, SEM3=W21, SEM4=W22
//
// Grava em forecast_canal_metas (period_type='mensal' OU 'semanal').
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });
import pg from 'pg';

const MONTH_KEY = '2026-05';
const WEEKS = ['2026-W19', '2026-W20', '2026-W21', '2026-W22'];

// canal: [mensal, sem1, sem2, sem3, sem4]
const PLAN = {
  revenda:       [220000.00,  30487.74,  50000.00,  70000.00,  70000.00],
  multimarcas:   [503712.03, 125928.01, 125928.01, 125928.01, 125928.01],
  varejo:        [407440.00, 114083.20, 101860.00,  93711.20,  97785.60],
  franquia:      [250000.00,  62500.00,  62500.00,  62500.00,  62500.00], // B2L Pronta
  inbound_david: [120830.00,  20000.00,  20000.00,  40415.00,  40415.00], // B2M INBOUND
  bazar:         [ 25172.86,  15000.00,      0.00,      0.00,  10172.86],
  ricardoeletro: [  6041.49,   1510.37,   1510.37,   1510.37,   1510.37],
};

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

  let inserted = 0;
  let updated = 0;

  for (const [canal, [mensal, ...semanas]] of Object.entries(PLAN)) {
    // Mensal
    const rM = await c.query(
      `INSERT INTO forecast_canal_metas (canal, period_type, period_key, valor_meta, updated_at, updated_by)
            VALUES ($1, 'mensal', $2, $3, NOW(), 'cadastro-script')
        ON CONFLICT (canal, period_type, period_key)
            DO UPDATE SET valor_meta = EXCLUDED.valor_meta,
                          updated_at = NOW(),
                          updated_by = 'cadastro-script'
        RETURNING xmax = 0 AS inserted`,
      [canal, MONTH_KEY, mensal],
    );
    if (rM.rows[0].inserted) inserted += 1;
    else updated += 1;

    // Semanais
    for (let i = 0; i < WEEKS.length; i++) {
      const wk = WEEKS[i];
      const val = semanas[i];
      const rW = await c.query(
        `INSERT INTO forecast_canal_metas (canal, period_type, period_key, valor_meta, updated_at, updated_by)
              VALUES ($1, 'semanal', $2, $3, NOW(), 'cadastro-script')
          ON CONFLICT (canal, period_type, period_key)
              DO UPDATE SET valor_meta = EXCLUDED.valor_meta,
                            updated_at = NOW(),
                            updated_by = 'cadastro-script'
          RETURNING xmax = 0 AS inserted`,
        [canal, wk, val],
      );
      if (rW.rows[0].inserted) inserted += 1;
      else updated += 1;
    }

    console.log(
      `✓ ${canal.padEnd(15)}  mensal=R$${mensal.toFixed(2).padStart(11)}  +  4 semanas`,
    );
  }

  console.log(`\n${inserted} inseridos / ${updated} atualizados`);

  // Mostra resultado
  const r = await c.query(
    `SELECT canal, period_type, period_key, valor_meta
       FROM forecast_canal_metas
      WHERE (period_type = 'mensal' AND period_key = $1)
         OR (period_type = 'semanal' AND period_key = ANY($2::text[]))
      ORDER BY canal, period_type DESC, period_key`,
    [MONTH_KEY, WEEKS],
  );
  console.log('\nResumo no banco:');
  for (const row of r.rows) {
    console.log(`  ${row.canal.padEnd(15)} ${row.period_type.padEnd(7)} ${row.period_key.padEnd(10)} R$${Number(row.valor_meta).toFixed(2)}`);
  }
} catch (e) {
  console.error('ERR:', e.message);
} finally {
  try { await c.end(); } catch {}
}
