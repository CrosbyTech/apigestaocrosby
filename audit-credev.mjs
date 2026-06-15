import 'dotenv/config';
import supabase from './config/supabase.js';
import axios from 'axios';

const BASE = 'http://localhost:4100';

// 1. Banco antigo — soma de credev dez/2025 por canal
console.log('=== [BANCO] faturamento_diario_canal · dez/2025 ===');
const r1 = await supabase
  .from('faturamento_diario_canal')
  .select('canal, valor, credev, valor_bruto')
  .gte('data', '2025-12-01').lte('data', '2025-12-31');
const aggDb = {};
for (const r of r1.data || []) {
  const c = r.canal;
  if (!aggDb[c]) aggDb[c] = { valor: 0, credev: 0, bruto: 0 };
  aggDb[c].valor += Number(r.valor || 0);
  aggDb[c].credev += Number(r.credev || 0);
  aggDb[c].bruto += Number(r.valor_bruto || 0);
}
console.log(`${'canal'.padEnd(20)}${'liquido'.padStart(14)}${'credev'.padStart(14)}${'bruto'.padStart(14)}`);
for (const [c, v] of Object.entries(aggDb).sort((a,b)=>b[1].valor-a[1].valor)) {
  console.log(`${c.padEnd(20)}${v.valor.toFixed(2).padStart(14)}${v.credev.toFixed(2).padStart(14)}${v.bruto.toFixed(2).padStart(14)}`);
}

// 2. Endpoint atual /fat-seg para o mês inteiro
console.log('\n=== [/fat-seg] dez/2025 inteiro ===');
try {
  const r2 = await axios.post(`${BASE}/api/crm/faturamento-por-segmento`,
    { datemin: '2025-12-01', datemax: '2025-12-31' },
    { timeout: 240000 });
  const d = r2.data?.data || r2.data;
  console.log(`${'canal'.padEnd(20)}${'liquido'.padStart(14)}${'credev'.padStart(14)}`);
  const canais = new Set([
    ...Object.keys(d.segmentos || {}),
    ...Object.keys(d.credev_por_segmento || {}),
  ]);
  for (const c of [...canais].sort()) {
    const v = Number(d.segmentos?.[c] || 0);
    const cr = Number(d.credev_por_segmento?.[c] || 0);
    if (v === 0 && cr === 0) continue;
    console.log(`${c.padEnd(20)}${v.toFixed(2).padStart(14)}${cr.toFixed(2).padStart(14)}`);
  }
  console.log('total liquido:', d.total_liquido);
  console.log('credev total:', d.credev_total);
} catch (e) {
  console.error('fat-seg falhou:', e.message);
}
