// Preenche cache dos canais que ainda não temos em mes-atual.
// Gap MASSIVO entre chamadas (60s) pra evitar rate-limit TOTVS.
import 'dotenv/config';
import axios from 'axios';
import supabase from './config/supabase.js';

const PERIODOS = [
  { key: 'mes-atual', datemin: '2026-06-01', datemax: '2026-06-15' },
];
const FALTANTES = ['multimarcas', 'inbound_rafael', 'inbound_david', 'showroom', 'franquia', 'bazar', 'novidadesfranquia'];
const BASE = `http://localhost:${process.env.PORT || 4100}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (const p of PERIODOS) {
  for (const canal of FALTANTES) {
    console.log(`▶ ${canal} (${p.key})`);
    try {
      const r = await axios.post(`${BASE}/api/crm/canal-totals?lite=true`,
        { modulo: canal, datemin: p.datemin, datemax: p.datemax },
        { timeout: 240000 });
      const v = Number(r.data?.data?.invoice_value || r.data?.invoice_value || 0);
      if (v > 0) {
        await supabase.from('canal_totals_cache').upsert({
          cache_key: p.key, canal, datemin: p.datemin, datemax: p.datemax,
          valor_liquido: v, valor_bruto: v, credev: 0, invoice_qty: 0,
          atualizado_em: new Date().toISOString(),
        }, { onConflict: 'cache_key,canal' });
        console.log(`  ✅ ${canal} R$ ${v.toFixed(2)} salvo`);
      } else {
        console.log(`  ⚠ ${canal} = 0 (não salvo)`);
      }
    } catch (e) {
      console.log(`  ✗ ${canal}: ${e.message}`);
    }
    console.log('  ⏳ aguardando 60s...');
    await sleep(60000);
  }
}
console.log('✅ fim');
process.exit(0);
