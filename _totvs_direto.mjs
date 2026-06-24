import supabase from './config/supabase.js';

const CANAIS = ['varejo','revenda','multimarcas','inbound_david','inbound_rafael','franquia','business','bazar','showroom','novidadesfranquia','ricardoeletro'];
const HOJE = new Date().toISOString().slice(0,10);
const ANO = HOJE.slice(0,4);
const MES = HOJE.slice(5,7);
const periodos = [
  { key: 'mes-atual',   datemin: `${ANO}-${MES}-01`, datemax: HOJE },
  { key: 'mes-passado', datemin: '2026-05-01',       datemax: '2026-05-31' },
  { key: 'ano-atual',   datemin: `${ANO}-01-01`,     datemax: HOJE },
];

async function pegarCanal(modulo, datemin, datemax) {
  const t0 = Date.now();
  try {
    const r = await fetch('http://localhost:4100/api/crm/canal-totals?lite=true', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ datemin, datemax, modulo, lite: true }),
      signal: AbortSignal.timeout(300000), // 5min
    });
    const j = await r.json();
    const v = Number(j?.data?.invoice_value || 0);
    const dt = ((Date.now() - t0)/1000).toFixed(1);
    return { ok: true, valor: v, tempo: dt };
  } catch (e) {
    return { ok: false, erro: e.message, tempo: ((Date.now()-t0)/1000).toFixed(1) };
  }
}

for (const p of periodos) {
  console.log(`\n=== ${p.key} (${p.datemin} → ${p.datemax}) ===`);
  const rows = [];
  for (const canal of CANAIS) {
    process.stdout.write(`  ${canal.padEnd(22)} `);
    const r = await pegarCanal(canal, p.datemin, p.datemax);
    if (r.ok) {
      console.log(`R$ ${r.valor.toFixed(2).padStart(13)}  (${r.tempo}s)`);
      if (r.valor > 0) rows.push({
        cache_key: p.key, canal, datemin: p.datemin, datemax: p.datemax,
        valor_liquido: r.valor, valor_bruto: r.valor, credev: 0, invoice_qty: 0,
        atualizado_em: new Date().toISOString(),
      });
    } else {
      console.log(`❌ ${r.erro} (${r.tempo}s)`);
    }
  }
  if (rows.length) {
    await supabase.from('canal_totals_cache').upsert(rows, { onConflict: 'cache_key,canal' });
    console.log(`  ✅ salvo ${rows.length} canais, total R$ ${rows.reduce((s,r)=>s+r.valor_liquido,0).toFixed(2)}`);
  }
}
process.exit(0);
