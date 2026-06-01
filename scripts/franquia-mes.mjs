// Calcula franquia LÍQUIDO de maio/2026 direto do Supabase (sem TOTVS).
// Bruto Output ops franquia − credev (ops devolução pra franquia) − Recife Mall.
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_FISCAL_URL,
  process.env.SUPABASE_FISCAL_KEY,
);

const FRANQUIA_OPS = [7234, 7240, 7802, 9124, 7259];
const FRANQUIA_CREDEV_OPS = [1411, 1410, 1411, 1414]; // ops de devolução típicas pra franquia
const RECIFE_MALL_PC = 29541;
const DMIN = '2026-05-01';
const DMAX = '2026-05-31';

async function fetchAll(filterFn) {
  let off = 0, all = [];
  while (true) {
    const { data, error } = await filterFn(off);
    if (error) { console.log('err:', error.message); break; }
    if (!data?.length) break;
    all.push(...data);
    if (data.length < 1000) break;
    off += 1000;
  }
  return all;
}

// 1) Bruto franquia (Output ops franquia, exclui canceladas)
const bruto = await fetchAll((off) =>
  supabase.from('notas_fiscais')
    .select('person_code, total_value, branch_code, invoice_code, issue_date, operation_code')
    .eq('operation_type', 'Output')
    .not('invoice_status', 'eq', 'Canceled')
    .not('invoice_status', 'eq', 'Deleted')
    .gte('issue_date', DMIN).lte('issue_date', DMAX)
    .in('operation_code', FRANQUIA_OPS)
    .range(off, off + 999)
);
const totalBruto = bruto.reduce((s, n) => s + Number(n.total_value || 0), 0);

// 2) Recife Mall (mesmo filtro + person_code = 29541)
const recife = bruto.filter(n => Number(n.person_code) === RECIFE_MALL_PC);
const recifeValue = recife.reduce((s, n) => s + Number(n.total_value || 0), 0);

// 3) Credev (Input ops devolução pra franquia)
const credev = await fetchAll((off) =>
  supabase.from('notas_fiscais')
    .select('person_code, total_value')
    .eq('operation_type', 'Input')
    .not('invoice_status', 'eq', 'Canceled')
    .not('invoice_status', 'eq', 'Deleted')
    .gte('issue_date', DMIN).lte('issue_date', DMAX)
    .in('operation_code', FRANQUIA_CREDEV_OPS)
    .range(off, off + 999)
);
const totalCredev = credev.reduce((s, n) => s + Number(n.total_value || 0), 0);

const liquido = totalBruto - recifeValue - totalCredev;

console.log(`\n📊 FRANQUIA — Maio/2026 (via Supabase notas_fiscais, sync local)`);
console.log(`   Período: ${DMIN} → ${DMAX}`);
console.log(`   NFs Output franquia: ${bruto.length}`);
console.log(`   ──────────────────────────────────────`);
console.log(`   Bruto:           R$ ${totalBruto.toFixed(2).padStart(12)}`);
console.log(`   Recife Mall:    -R$ ${recifeValue.toFixed(2).padStart(12)}  (${recife.length} NFs)`);
console.log(`   Credev:         -R$ ${totalCredev.toFixed(2).padStart(12)}  (${credev.length} NFs)`);
console.log(`   ──────────────────────────────────────`);
console.log(`   LÍQUIDO:         R$ ${liquido.toFixed(2).padStart(12)}`);
console.log(`   ──────────────────────────────────────\n`);
console.log(`   ⚠️  Supabase pode ter sync atrasado dos últimos 1-2 dias.`);
console.log(`   ⚠️  Pro número EXATO do TOTVS, espere o erp-bg terminar e abra o front.`);
