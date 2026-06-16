import 'dotenv/config';
import supabase from './config/supabase.js';

const { data, error } = await supabase
  .from('faturamento_diario_canal')
  .select('canal, valor, valor_bruto, credev, data')
  .gte('data', '2026-06-01')
  .lte('data', '2026-06-15');

if (error) { console.error(error); process.exit(1); }

const porCanal = {};
for (const r of data || []) {
  const c = r.canal;
  if (!porCanal[c]) porCanal[c] = { valor: 0, bruto: 0, credev: 0, n: 0 };
  porCanal[c].valor += Number(r.valor || 0);
  porCanal[c].bruto += Number(r.valor_bruto || 0);
  porCanal[c].credev += Number(r.credev || 0);
  porCanal[c].n += 1;
}

console.log(`Linhas totais: ${data.length}`);
console.log('Por canal:');
for (const [k, v] of Object.entries(porCanal).sort((a,b)=>b[1].valor-a[1].valor)) {
  console.log(`  ${k.padEnd(20)} valor=${v.valor.toFixed(2).padStart(12)}  bruto=${v.bruto.toFixed(2).padStart(12)}  credev=${v.credev.toFixed(2).padStart(10)}  (${v.n} dias)`);
}
process.exit(0);
