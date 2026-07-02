import { createClient } from '@supabase/supabase-js';
import supabase from './config/supabase.js';
const sbf = createClient(process.env.SUPABASE_FISCAL_URL, process.env.SUPABASE_FISCAL_KEY);

async function pagAll(query) {
  let all = [], from = 0;
  while (true) {
    const { data } = await query.range(from, from + 999);
    if (!data?.length) break;
    all.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return all;
}

// Regras por canal — ops/branches/sellers usados pelo canal_totals
const RULES = {
  varejo: {
    ops: [545,546,548,510,511,521,522,9001,9009,9017,9027,1,5919],
    branchs: [2,5,55,65,87,88,90,93,94,95,97],
    excludeSellers: [21,26,69],
  },
  revenda: {
    ops: [7236,9122,5102,7242,9061,9001,9121,512],
    branchs: [2,5,75,99,200],
    sellers: [25,15,161,165,241,779,288,251,131,94,1924,7044],
  },
  multimarcas: {
    ops: [7235,7241,9127,200],
    branchs: [99,2,95,87,88,90,94,97],
    excludeSellers: [21,26,69],
  },
  inbound_david: {
    ops: [7235,7241,9127],
    branchs: [99,2,95,87,88,90,94,97],
    sellers: [26,69],
  },
  inbound_rafael: {
    ops: [7235,7241,9127],
    branchs: [99],
    sellers: [21],
  },
  franquia: {
    ops: [7234,7240,7802,9124,7259],
    branchs: null, // all
    excludeSellers: [21,26,69],
  },
};

async function calcularCanalBruto(cfg) {
  let q = sbf.from('notas_fiscais')
    .select('dealer_code, branch_code, total_value, operation_type, invoice_status')
    .gte('issue_date', '2026-06-01').lte('issue_date', '2026-06-30')
    .in('operation_code', cfg.ops);
  if (cfg.branchs) q = q.in('branch_code', cfg.branchs);
  const rows = await pagAll(q);
  const valid = rows.filter((n) => n.invoice_status !== 'Canceled' && n.invoice_status !== 'Deleted');
  const filtered = valid.filter((n) => {
    const d = Number(n.dealer_code);
    if (cfg.sellers && !cfg.sellers.includes(d)) return false;
    if (cfg.excludeSellers && cfg.excludeSellers.includes(d)) return false;
    return true;
  });
  let output = 0, input = 0;
  for (const n of filtered) {
    const v = Number(n.total_value || 0);
    if (n.operation_type === 'Output') output += v; else input += v;
  }
  return { output, input, liquido: output - input, count: filtered.length };
}

async function main() {
  // Carrega snapshots
  const { data: snaps } = await supabase
    .from('forecast_canal_snapshot')
    .select('canal, valor_oficial')
    .eq('period_type', 'mensal').eq('period_key', '2026-06').eq('ativo', true);
  const snapMap = Object.fromEntries((snaps || []).map(s => [s.canal, Number(s.valor_oficial)]));

  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║  VALIDAÇÃO SNAPSHOTS JUNHO/2026 - notas_fiscais Supabase             ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝\n');

  for (const [canal, cfg] of Object.entries(RULES)) {
    const r = await calcularCanalBruto(cfg);
    const snap = snapMap[canal];
    console.log(`▸ ${canal.toUpperCase()}`);
    console.log(`  Ops: [${cfg.ops.join(',')}]`);
    console.log(`  Branchs: ${cfg.branchs ? '[' + cfg.branchs.join(',') + ']' : 'todas'}`);
    if (cfg.sellers) console.log(`  Sellers ALLOW: [${cfg.sellers.join(',')}]`);
    if (cfg.excludeSellers) console.log(`  Sellers EXCLUDE: [${cfg.excludeSellers.join(',')}]`);
    console.log(`  NFs válidas: ${r.count}`);
    console.log(`  Output (Saída):  R$ ${r.output.toFixed(2)}`);
    console.log(`  Input  (Entrada):R$ ${r.input.toFixed(2)}`);
    console.log(`  → BRUTO (S−E):   R$ ${r.liquido.toFixed(2)}`);
    if (snap != null) {
      const diff = snap - r.liquido;
      const pct = r.liquido > 0 ? (diff / r.liquido * 100).toFixed(1) : '?';
      console.log(`  ⚑ SNAPSHOT:       R$ ${snap.toFixed(2)}`);
      console.log(`  Δ Snap−Bruto:    R$ ${diff.toFixed(2)}  (${pct}%)`);
    } else {
      console.log(`  ⚑ SNAPSHOT: (nenhum)`);
    }
    console.log();
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
