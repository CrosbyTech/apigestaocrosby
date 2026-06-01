// Re-importa snapshot LÍQUIDO oficial (Vl. Faturado por vendedor) — Maio/2026
// MÊS FECHADO (01-31/05), empresa 99. Fonte: relatório TOTVS 0326 atualizado.
import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;
const pool = new Pool({
  host: process.env.SUPABASE_DB_HOST,
  port: parseInt(process.env.SUPABASE_DB_PORT || '5432', 10),
  user: process.env.SUPABASE_DB_USER,
  password: process.env.SUPABASE_DB_PASSWORD,
  database: process.env.SUPABASE_DB_NAME,
  ssl: { rejectUnauthorized: false },
});

const PERIODO_TIPO = 'mensal';
const PERIODO_KEY = '2026-05';

// [grupo, seller_code, seller_name, liquido] — relatório TOTVS 0326 fechado (31/05)
const DADOS = [
  // B2R — Revenda
  ['B2R', 161, 'CLEYTON F', 73424.56],
  ['B2R', 165, 'MICHEL VINICIO', 64662.49],
  ['B2R', 241, 'YAGO SMITH', 41623.44],
  ['B2R', 25, 'ANDERSON MEDEIROS', 46.96],
  // (Jucelino 288 sem vendas em maio fechado — não consta no relatório)
  // B2M — Multimarcas
  ['B2M', 259, 'ARTHUR BARBOSA', 100393.69],
  ['B2M', 177, 'WALTER MULTIMARCAS', 76556.82],
  ['B2M', 65, 'RENATO', 66703.59],
  ['B2M', 26, 'DAVID ALMEIDA', 52427.61],
  ['B2M', 21, 'RAFAEL ARAUJO', 45194.70],
];

// Limpa o período e regrava
await pool.query(
  `DELETE FROM forecast_faturamento_vendedor WHERE periodo_tipo=$1 AND periodo_key=$2`,
  [PERIODO_TIPO, PERIODO_KEY],
);
for (const [grupo, code, nome, liq] of DADOS) {
  await pool.query(
    `INSERT INTO forecast_faturamento_vendedor
       (grupo, periodo_tipo, periodo_key, seller_code, seller_name, bruto, credev, liquido, atualizado_em)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now())
     ON CONFLICT (grupo, periodo_tipo, periodo_key, seller_code)
     DO UPDATE SET seller_name=EXCLUDED.seller_name, liquido=EXCLUDED.liquido,
                   bruto=EXCLUDED.bruto, credev=EXCLUDED.credev, atualizado_em=now()`,
    [grupo, PERIODO_TIPO, PERIODO_KEY, String(code), nome, liq, 0, liq],
  );
}
await pool.query(
  `INSERT INTO forecast_faturamento_vendedor_sync (periodo_tipo, periodo_key, linhas, origem, ok)
   VALUES ($1,$2,$3,'import-manual-maio-fechado', true)`,
  [PERIODO_TIPO, PERIODO_KEY, DADOS.length],
);

const { rows } = await pool.query(
  `SELECT grupo, seller_name, liquido FROM forecast_faturamento_vendedor
   WHERE periodo_tipo=$1 AND periodo_key=$2 ORDER BY grupo, liquido DESC`,
  [PERIODO_TIPO, PERIODO_KEY],
);
console.log(`✅ ${rows.length} linhas em forecast_faturamento_vendedor (${PERIODO_KEY} — mês fechado):`);
let g = '';
let total = 0;
for (const r of rows) {
  if (r.grupo !== g) { g = r.grupo; console.log(`\n  ${g}:`); }
  console.log(`    ${(r.seller_name || '').padEnd(22)} R$ ${Number(r.liquido).toFixed(2).padStart(11)}`);
  total += Number(r.liquido);
}
console.log(`\n  TOTAL: R$ ${total.toFixed(2)}`);
await pool.end();
