// Snapshot B2R definitivo Maio/2026:
//   - Valores OFICIAIS do relatório TOTVS 0326 (empresa 99) para vendedores
//     que aparecem lá (Cleyton, Michel, Yago, Anderson).
//   - ADICIONA Jucelino (PB-empresa 2) calculado via Supabase notas_fiscais.
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

const PERIODO_KEY = '2026-05';

// [code, name, liquido, fonte]
const B2R = [
  [161, 'CLEYTON F',          73424.56, 'TOTVS-0326'],
  [165, 'MICHEL VINICIO',     64662.49, 'TOTVS-0326'],
  [241, 'YAGO SMITH',         41623.44, 'TOTVS-0326'],
  [288, 'JUCELINO - INTERNO',  2436.47, 'TOTVS-0326 (emp 2 PB)'],
  [25,  'ANDERSON MEDEIROS',     46.96, 'TOTVS-0326'],
];

await pool.query(
  `DELETE FROM forecast_faturamento_vendedor WHERE periodo_tipo='mensal' AND periodo_key=$1 AND grupo='B2R'`,
  [PERIODO_KEY],
);
let total = 0;
for (const [code, nome, valor, fonte] of B2R) {
  await pool.query(
    `INSERT INTO forecast_faturamento_vendedor
       (grupo, periodo_tipo, periodo_key, seller_code, seller_name, bruto, credev, liquido, atualizado_em)
     VALUES ('B2R','mensal',$1,$2,$3,$4,0,$4, now())`,
    [PERIODO_KEY, String(code), nome, valor],
  );
  console.log(`  ${nome.padEnd(22)} R$ ${valor.toFixed(2).padStart(11)}  [${fonte}]`);
  total += valor;
}
console.log(`  ─────────────────────────────────────`);
console.log(`  TOTAL B2R: R$ ${total.toFixed(2)}`);
await pool.end();
