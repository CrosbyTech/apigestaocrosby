/**
 * Diagnóstico: compara faturamento do Supabase nos dias 20 e 21/04/2026
 * com os dados do Excel "faturado b2r abril.xlsx"
 */
import supabaseFiscal from './config/supabaseFiscal.js';

// Operações B2R / revenda (mesmas do OPERATIONS_POR_MODULO)
const OPS_REVENDA = [
  7236, 7242, 9120, 9121, 9122, 9113, 9111, 9001, 9009, 9061, 9067,
  9400, 9401, 9420, 9404, 7806, 7809, 5102, 5202, 1407, 512,
];

async function queryDia(date) {
  let allNFs = [];
  let offset = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await supabaseFiscal
      .from('notas_fiscais')
      .select('invoice_code,branch_code,person_code,person_name,total_value,operation_code,invoice_status,operation_type,items')
      .gte('issue_date', date)
      .lte('issue_date', date)
      .range(offset, offset + PAGE - 1);

    if (error) { console.error('Erro Supabase:', error.message); break; }
    allNFs = allNFs.concat(data);
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return allNFs;
}

function summarize(nfs, label) {
  console.log(`\n=== ${label} — ${nfs.length} NFs no banco ===`);

  const byStatus = {};
  for (const nf of nfs) {
    const s = nf.invoice_status || 'null';
    if (!byStatus[s]) byStatus[s] = { count: 0, total: 0 };
    byStatus[s].count++;
    byStatus[s].total += parseFloat(nf.total_value) || 0;
  }
  console.log('Por status:');
  for (const [s, info] of Object.entries(byStatus)) {
    console.log(`  ${s}: ${info.count} NFs, R$ ${info.total.toFixed(2)}`);
  }

  // Filtrar só Output + não canceladas + operações revenda
  const valid = nfs.filter(
    n => n.operation_type === 'Output'
      && n.invoice_status !== 'Canceled'
      && n.invoice_status !== 'Deleted'
      && OPS_REVENDA.includes(n.operation_code)
  );

  let totalValido = 0;
  console.log(`\nNFs Output não-canceladas revenda: ${valid.length}`);
  for (const nf of valid) {
    const val = parseFloat(nf.total_value) || 0;
    totalValido += val;
    // Detecta vendedor via dealerCode nos items
    const dealers = new Set();
    for (const item of nf.items || []) {
      for (const p of item.products || []) {
        if (p.dealerCode) dealers.add(String(p.dealerCode));
      }
    }
    console.log(`  NF ${nf.invoice_code} | person=${nf.person_code} | ops=${nf.operation_code} | val=R$${val.toFixed(2)} | dealers=[${[...dealers].join(',')}]`);
  }
  console.log(`  TOTAL VÁLIDO: R$ ${totalValido.toFixed(2)}`);

  // Também mostrar as que têm operation_type=Input no mesmo dia
  const inputs = nfs.filter(n => n.operation_type === 'Input');
  if (inputs.length > 0) {
    let totalInput = 0;
    console.log(`\nNFs Input (devoluções) no dia: ${inputs.length}`);
    for (const nf of inputs) {
      const val = parseFloat(nf.total_value) || 0;
      totalInput += val;
      console.log(`  NF ${nf.invoice_code} | person=${nf.person_code} | ops=${nf.operation_code} | status=${nf.invoice_status} | val=R$${val.toFixed(2)}`);
    }
    console.log(`  TOTAL INPUT (devoluções): R$ ${totalInput.toFixed(2)}`);
  }

  return totalValido;
}

// ─── Dados do Excel para comparação ──────────────────────────────────────────
const EXCEL_DIA_20 = {
  total: 7604.79,
  vendas: [
    { cod: 117556, vendedor: 'JUCELINO - INTERNO', val: 1343.00 },
    { cod: 10179,  vendedor: 'JUCELINO - INTERNO', val: 792.30 },
    { cod: 25555,  vendedor: 'JUCELINO - INTERNO', val: 263.04 },
    { cod: 65969,  vendedor: 'JUCELINO - INTERNO', val: 150.84 },
    { cod: 35585,  vendedor: 'CLEYTON F',          val: 2016.31 },
    { cod: 16974,  vendedor: 'HEYRIDAN',           val: 868.08 },
    { cod: 31917,  vendedor: 'YAGO SMITH',         val: 561.66 },
    { cod: 118381, vendedor: 'HEYRIDAN',           val: 525.10 },
    { cod: 44267,  vendedor: 'YAGO SMITH',         val: 475.38 },
    { cod: 12687,  vendedor: 'HEYRIDAN',           val: 347.76 },
    { cod: 6557,   vendedor: 'CLEYTON F',          val: 90.29 },
    { cod: 166,    vendedor: 'MICHEL VINICIO',     val: 74.44 },
    { cod: 12924,  vendedor: 'HEYRIDAN',           val: 49.65 },
    { cod: 38681,  vendedor: 'YAGO SMITH',         val: 46.94 },
    { cod: 24774,  vendedor: 'YAGO SMITH',         val: 0.00 },
  ]
};

// ─── Main ─────────────────────────────────────────────────────────────────────
console.log('Consultando Supabase...\n');

const [nfs20, nfs21] = await Promise.all([
  queryDia('2026-04-20'),
  queryDia('2026-04-21'),
]);

const total20 = summarize(nfs20, 'DIA 20/04/2026');
const total21 = summarize(nfs21, 'DIA 21/04/2026');

// Comparação com Excel
console.log('\n' + '='.repeat(60));
console.log('COMPARAÇÃO COM EXCEL');
console.log('='.repeat(60));
console.log(`Dia 20/04 — Excel: R$ ${EXCEL_DIA_20.total.toFixed(2)} | Supabase: R$ ${total20.toFixed(2)} | Diff: R$ ${(total20 - EXCEL_DIA_20.total).toFixed(2)}`);
console.log(`Dia 21/04 — Excel: R$ 0.00 | Supabase: R$ ${total21.toFixed(2)}`);

// Verifica quais person_codes do Excel NÃO estão no Supabase dia 20
const personCodesSupabase20 = new Set(
  nfs20
    .filter(n => n.operation_type === 'Output' && n.invoice_status !== 'Canceled' && n.invoice_status !== 'Deleted')
    .map(n => n.person_code)
);
console.log('\nClientes do Excel dia 20 que NÃO aparecem no Supabase (Output, não cancelado):');
let faltando = 0;
for (const v of EXCEL_DIA_20.vendas) {
  if (!personCodesSupabase20.has(v.cod)) {
    console.log(`  FALTANDO: person_code=${v.cod} vendedor=${v.vendedor} val=R$${v.val.toFixed(2)}`);
    faltando++;
  }
}
if (faltando === 0) console.log('  Todos os clientes do Excel estão no Supabase.');
