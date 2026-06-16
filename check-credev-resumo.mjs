// Verifica credev em faturamento_transacao_historico para junho
import 'dotenv/config';
import supabase from './config/supabase.js';

const { data } = await supabase
  .from('faturamento_transacao_historico')
  .select('canal, vl_fat, credev, total')
  .gte('data_transacao', '2026-06-01')
  .lte('data_transacao', '2026-06-15');

const porCanal = {};
for (const r of data || []) {
  const c = r.canal || 'null';
  if (!porCanal[c]) porCanal[c] = { vl_fat: 0, credev: 0, total: 0, n: 0 };
  porCanal[c].vl_fat += Number(r.vl_fat || 0);
  porCanal[c].credev += Number(r.credev || 0);
  porCanal[c].total += Number(r.total || 0);
  porCanal[c].n += 1;
}

console.log(`faturamento_transacao_historico (01-15/06): ${data.length} NFs`);
for (const [k, v] of Object.entries(porCanal).sort((a, b) => b[1].vl_fat - a[1].vl_fat)) {
  console.log(`  ${k.padEnd(25)} ${v.n.toString().padStart(4)} NFs  vl_fat=${v.vl_fat.toFixed(2).padStart(12)}  credev=${v.credev.toFixed(2).padStart(10)}  total=${v.total.toFixed(2).padStart(12)}`);
}

console.log('\n--- canal_totals_cache mes-atual ---');
const { data: cache } = await supabase
  .from('canal_totals_cache')
  .select('*')
  .eq('cache_key', 'mes-atual');
for (const r of cache || []) {
  console.log(`  ${r.canal.padEnd(25)} valor_liquido=${Number(r.valor_liquido || 0).toFixed(2).padStart(12)}  valor_bruto=${Number(r.valor_bruto || 0).toFixed(2).padStart(12)}  credev=${Number(r.credev || 0).toFixed(2).padStart(10)}`);
}
process.exit(0);
