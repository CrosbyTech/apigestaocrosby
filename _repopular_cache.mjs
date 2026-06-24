import supabase from './config/supabase.js';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
dotenv.config();
const fiscal = createClient(process.env.SUPABASE_FISCAL_URL, process.env.SUPABASE_FISCAL_KEY);

// Configs alinhadas com CANAL_CONFIG do crm.routes.js
const CONFIGS = {
  varejo:           { ops: [545,546,548,510,511,521,522,9001,9009,9017,9027,1], branchs: [2,5,55,65,87,88,90,93,94,95,97], sellers: null },
  revenda:          { ops: [7236,9122,5102,7242,9061,9001,9121,512], branchs: [2,5,75,99,200], sellers: [25,15,161,165,241,779,288,251,131,94,1924,7044] },
  multimarcas:      { ops: [7235,7241,9127,200], branchs: [99,2,95,87,88,90,94,97], excludeSellers: [21,26,69] },
  inbound_david:    { ops: [7235,7241,9127], branchs: [99,2,95,87,88,90,94,97], sellers: [26,69] },
  inbound_rafael:   { ops: [7235,7241,9127], branchs: [99], sellers: [21] },
  franquia:         { ops: [7234,7240,7802,9124,7259], branchs: null, excludeSellers: [21,26,69] }, // allbranchs
  business:         { ops: [7237,7269,7279,7277], branchs: null, sellers: [20] }, // FIX: só dealer 20
  bazar:            { ops: [7253], branchs: null, sellers: null },
  showroom:         { ops: [7254,7007], branchs: null, sellers: null },
  novidadesfranquia:{ ops: [7255], branchs: null, sellers: null },
  ricardoeletro:    { ops: [5102], branchs: [11,111], sellers: null },
};

function getDominantDealer(items) {
  const cnt = new Map();
  for (const it of items || []) for (const p of it.products || []) {
    if (p.dealerCode != null) cnt.set(Number(p.dealerCode), (cnt.get(Number(p.dealerCode)) || 0) + 1);
  }
  if (!cnt.size) return null;
  return [...cnt.entries()].sort((a,b)=>b[1]-a[1])[0][0];
}

async function calcCanalPeriodo(canal, cfg, datemin, datemax) {
  let q = fiscal.from('notas_fiscais')
    .select('total_value, dealer_code, branch_code, operation_code, items, person_code, operation_type, invoice_status')
    .gte('issue_date', datemin)
    .lte('issue_date', datemax)
    .in('operation_code', cfg.ops)
    .neq('invoice_status', 'Canceled')
    .neq('invoice_status', 'Deleted');
  if (cfg.branchs) q = q.in('branch_code', cfg.branchs);
  const { data } = await q;
  let total = 0;
  let nfs = 0;
  for (const nf of data || []) {
    const dealer = getDominantDealer(nf.items) ?? Number(nf.dealer_code);
    if (cfg.sellers && !cfg.sellers.includes(dealer)) continue;
    if (cfg.excludeSellers && cfg.excludeSellers.includes(dealer)) continue;
    // Recife Mall (29541) excluído de franquia/novidades/showroom desde 01/05
    if ((canal === 'franquia' || canal === 'novidadesfranquia' || canal === 'showroom') && nf.person_code === 29541 && datemin >= '2026-05-01') continue;
    if (nf.operation_type === 'Input') total -= Number(nf.total_value || 0);
    else total += Number(nf.total_value || 0);
    nfs++;
  }
  return { total: Math.max(0, total), nfs };
}

const HOJE = new Date().toISOString().slice(0,10);
const ANO = HOJE.slice(0,4);
const MES = HOJE.slice(5,7);
const periodos = [
  { key: 'mes-atual',   datemin: `${ANO}-${MES}-01`, datemax: HOJE },
  { key: 'mes-passado', datemin: '2026-05-01',        datemax: '2026-05-31' },
  { key: 'ano-atual',   datemin: `${ANO}-01-01`,      datemax: HOJE },
];

for (const p of periodos) {
  console.log(`\n=== ${p.key} (${p.datemin} → ${p.datemax}) ===`);
  const rows = [];
  for (const [canal, cfg] of Object.entries(CONFIGS)) {
    const r = await calcCanalPeriodo(canal, cfg, p.datemin, p.datemax);
    console.log(`  ${r.total > 0 ? '✓' : '·'} ${canal.padEnd(20)} R$ ${r.total.toFixed(2).padStart(13)}  (${r.nfs} NFs)`);
    if (r.total > 0) {
      rows.push({
        cache_key: p.key, canal, datemin: p.datemin, datemax: p.datemax,
        valor_liquido: r.total, valor_bruto: r.total, credev: 0, invoice_qty: r.nfs,
        atualizado_em: new Date().toISOString(),
      });
    }
  }
  if (rows.length) {
    await supabase.from('canal_totals_cache').upsert(rows, { onConflict: 'cache_key,canal' });
    console.log(`  ✅ salvo: ${rows.length} canais R$ ${rows.reduce((s,r)=>s+r.valor_liquido,0).toFixed(2)}`);
  }
}
process.exit(0);
