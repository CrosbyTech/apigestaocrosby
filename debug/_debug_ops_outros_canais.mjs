import { createClient } from '@supabase/supabase-js';
import { loadDebugEnv } from './_debugEnv.mjs';
loadDebugEnv();

const supabase = createClient(
  'https://wnjapaczjcvhumfikwwe.supabase.co',
  process.env.SUPABASE_FISCAL_KEY
);

// Vendedores por canal (cod TOTVS)
const VENDEDORES = {
  multimarcas: [177, 65, 21, 26, 259, 69],  // Walter, Renato, Rafael, David, Arthur, Thalis
  franquia: [],  // franquia filtra por branchCode, não vendedor
};

// Operações "puras" declaradas pelo usuário
const OPS_VALIDAS = {
  multimarcas: new Set([7235, 7241]),
  franquia: new Set([7234, 7240]),
};

// Filiais franquia (6xxx)
const BRANCH_FRANQUIA_MIN = 6000;

const START = '2026-04-01';
const END   = '2026-04-30';

async function fetchOps(canal) {
  let query = supabase
    .from('notas_fiscais')
    .select('operation_code, seller_code, branch_code, total_value, invoice_code')
    .gte('issue_date', START)
    .lte('issue_date', END);

  if (canal === 'multimarcas') {
    query = query.in('seller_code', VENDEDORES.multimarcas);
  } else if (canal === 'franquia') {
    query = query.gte('branch_code', BRANCH_FRANQUIA_MIN);
  }

  const { data, error } = await query;
  if (error) { console.error(canal, error.message); return; }

  // Agrupar por operation_code
  const grouped = {};
  for (const nf of data) {
    const op = nf.operation_code;
    if (!grouped[op]) grouped[op] = { total: 0, count: 0, nfs: [] };
    grouped[op].total += Number(nf.total_value || 0);
    grouped[op].count++;
    if (grouped[op].nfs.length < 3) grouped[op].nfs.push(nf.invoice_code);
  }

  const validas = OPS_VALIDAS[canal];
  console.log(`\n=== ${canal.toUpperCase()} — operações em abril/2026 ===`);
  console.log('Ops válidas declaradas:', [...validas]);

  const fora = [];
  for (const [op, info] of Object.entries(grouped).sort((a,b)=>b[1].total-a[1].total)) {
    const isValid = validas.has(Number(op));
    const tag = isValid ? '✅' : '⚠️  FORA';
    console.log(`  ${tag} Op ${op}: R$${info.total.toFixed(2)} (${info.count} NFs) ex: ${info.nfs.join(', ')}`);
    if (!isValid) fora.push({ op, ...info });
  }

  if (fora.length === 0) {
    console.log('  → Nenhuma operação fora das válidas!');
  } else {
    console.log(`\n  TOTAL fora: R$${fora.reduce((s,f)=>s+f.total,0).toFixed(2)}`);
  }
}

await fetchOps('multimarcas');
await fetchOps('franquia');
