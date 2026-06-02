// Importa referência de faturamento Junho/2025 pro Comparativo Anual.
// Valores oficiais do relatório TOTVS (com "Entrada 1° Pedido" R$60.000
// somado a FRANQUIA conforme regra do gestor).
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

const ANO = 2025;
const MES = 6;
const DIAS_NO_MES = 30; // junho

// [canal, valor_full] — relatório oficial TOTVS Junho/2025
// FRANQUIA já inclui R$60.000 de "Entrada 1° Pedido Franquia"
const DADOS = [
  ['franquia',    1281422.59], // 1.221.422,59 + 60.000 (entrada 1º pedido)
  ['revenda',      497037.75],
  ['varejo',       397751.01],
  ['multimarcas',  151531.69],
];

// Acumulado = pro-rateado por dias até hoje (junho/2026)
const hoje = new Date();
const diaHoje =
  hoje.getUTCFullYear() === 2026 && hoje.getUTCMonth() + 1 === MES
    ? hoje.getUTCDate()
    : DIAS_NO_MES;

await pool.query(
  `DELETE FROM forecast_comparativo_ref WHERE ano=$1 AND mes=$2`,
  [ANO, MES],
);
let total = 0;
console.log(`📥 Importando referência Junho/${ANO} (valores do print, sem pró-rateio):\n`);
for (const [canal, valorFull] of DADOS) {
  // Mantém acumulado = cheio (valor de referência do print).
  // Quando o gestor enviar valores acumulados específicos, atualizar.
  const acumulado = valorFull;
  await pool.query(
    `INSERT INTO forecast_comparativo_ref
       (ano, mes, canal, valor_full, valor_acumulado, dia_acumulado, atualizado_em)
     VALUES ($1,$2,$3,$4,$5,$6, now())`,
    [ANO, MES, canal, valorFull, acumulado, DIAS_NO_MES],
  );
  console.log(`  ${canal.padEnd(14)} R$ ${valorFull.toFixed(2).padStart(12)}`);
  total += valorFull;
}
console.log(`\n  TOTAL FULL: R$ ${total.toFixed(2)}`);
console.log(`✅ Referência Junho/${ANO} inserida no Supabase.`);
await pool.end();
