// Re-importa B2R (revenda) do mês de Maio/2026 puxando TODAS as filiais
// revenda [2, 5, 75, 99, 200] — não só empresa 99. Garante que Jucelino,
// Felipe PB, Enri PB e outros que vendem em PB tenham faturamento contado.
// Fonte: Supabase notas_fiscais (bruto Output - returns).
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';

const sFiscal = createClient(process.env.SUPABASE_FISCAL_URL, process.env.SUPABASE_FISCAL_KEY);
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
const REVENDA_OPS = [7236, 9122, 5102, 7242, 9061, 9001, 9121, 512];
const REVENDA_BRANCHS = [2, 5, 75, 99, 200];
const DMIN = '2026-05-01', DMAX = '2026-05-31';

const B2R_SELLERS = {
  25:   'ANDERSON MEDEIROS',
  15:   'HEYRIDAN',
  161:  'CLEYTON F',
  165:  'MICHEL VINICIO',
  241:  'YAGO SMITH',
  779:  'ALDO',
  288:  'JUCELINO - INTERNO',
  251:  'FELIPE PB',
  131:  'VEND 131',
  94:   'ENRI PB',
  1924: 'MATHEUS CLOSER',
  7044: 'LUIZ',
};

async function sumSeller(sellerCode) {
  let off = 0, total = 0;
  while (true) {
    const { data } = await sFiscal.from('notas_fiscais')
      .select('total_value, invoice_status')
      .eq('operation_type', 'Output')
      .gte('issue_date', DMIN).lte('issue_date', DMAX)
      .in('operation_code', REVENDA_OPS)
      .in('branch_code', REVENDA_BRANCHS)
      .eq('dealer_code', sellerCode)
      .range(off, off + 999);
    if (!data?.length) break;
    for (const n of data) {
      if (n.invoice_status === 'Canceled' || n.invoice_status === 'Deleted') continue;
      total += Number(n.total_value || 0);
    }
    if (data.length < 1000) break;
    off += 1000;
  }
  return total;
}

// 1) Apaga só o B2R (mantém B2M já importado)
await pool.query(
  `DELETE FROM forecast_faturamento_vendedor WHERE periodo_tipo='mensal' AND periodo_key=$1 AND grupo='B2R'`,
  [PERIODO_KEY],
);

// 2) Calcula bruto para cada vendedor B2R
console.log(`\n📊 B2R Maio/2026 — filiais [${REVENDA_BRANCHS.join(',')}]:`);
let totalB2R = 0;
const inserts = [];
for (const [code, nome] of Object.entries(B2R_SELLERS)) {
  const total = await sumSeller(Number(code));
  if (total > 0) {
    inserts.push({ code: Number(code), nome, valor: total });
    console.log(`   ${nome.padEnd(22)} R$ ${total.toFixed(2).padStart(11)}`);
    totalB2R += total;
  }
}
console.log(`   ─────────────────────────────────────`);
console.log(`   TOTAL: R$ ${totalB2R.toFixed(2)}`);

// 3) Insere no Supabase
for (const r of inserts) {
  await pool.query(
    `INSERT INTO forecast_faturamento_vendedor
       (grupo, periodo_tipo, periodo_key, seller_code, seller_name, bruto, credev, liquido, atualizado_em)
     VALUES ('B2R','mensal',$1,$2,$3,$4,0,$4, now())`,
    [PERIODO_KEY, String(r.code), r.nome, r.valor],
  );
}
await pool.query(
  `INSERT INTO forecast_faturamento_vendedor_sync (periodo_tipo, periodo_key, linhas, origem, ok)
   VALUES ('mensal',$1,$2,'import-b2r-completo-supabase', true)`,
  [PERIODO_KEY, inserts.length],
);
console.log(`\n✅ ${inserts.length} linhas B2R atualizadas no Supabase.`);
await pool.end();
