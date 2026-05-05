import { createClient } from '@supabase/supabase-js';
import { loadDebugEnv } from './_debugEnv.mjs';
loadDebugEnv();

const sb = createClient(
  'https://wnjapaczjcvhumfikwwe.supabase.co',
  process.env.SUPABASE_FISCAL_KEY
);

// totvs_id dos vendedores B2R (revenda)
const REVENDA_SELLERS = new Set([288, 161, 241, 15, 25, 165, 251, 779, 131]);

// Operations já no filtro
const OPS_REVENDA = new Set([
  7236,7242,9120,9121,9122,9113,9111,9001,9009,9061,9067,
  9400,9401,9420,9404,7806,7809,5102,5202,1407,512
]);

let allNFs = [];
let offset = 0;
while (true) {
  const { data, error } = await sb
    .from('notas_fiscais')
    .select('operation_code,operation_name,total_value,items')
    .eq('operation_type', 'Output')
    .not('invoice_status', 'eq', 'Canceled')
    .not('invoice_status', 'eq', 'Deleted')
    .gte('issue_date', '2026-04-01')
    .lte('issue_date', '2026-04-22')
    .range(offset, offset + 999);

  if (error) { console.error(error); break; }
  allNFs = allNFs.concat(data);
  if (data.length < 1000) break;
  offset += 1000;
}

console.log(`Total NFs carregadas: ${allNFs.length}`);

// Agrega por operation_code: NFs que têm vendedores B2R mas op fora do filtro
const extra = {};

for (const nf of allNFs) {
  if (!nf.items || !Array.isArray(nf.items)) continue;
  const opCode = nf.operation_code;
  if (OPS_REVENDA.has(opCode)) continue;

  const nfTotal = parseFloat(nf.total_value) || 0;
  let netTotal = 0;
  let netRevendedor = 0;
  const sellerBreakdown = {};

  for (const item of nf.items) {
    for (const p of (item.products || [])) {
      const dc = parseInt(p.dealerCode);
      const nv = parseFloat(p.netValue) || 0;
      netTotal += nv;
      if (REVENDA_SELLERS.has(dc)) {
        netRevendedor += nv;
        sellerBreakdown[dc] = (sellerBreakdown[dc] || 0) + nv;
      }
    }
  }

  if (netRevendedor > 0 && netTotal > 0) {
    const share = netRevendedor / netTotal;
    const val = nfTotal * share;

    if (!extra[opCode]) extra[opCode] = {
      name: nf.operation_name,
      value: 0,
      sellers: {}
    };
    extra[opCode].value += val;

    for (const [dc, nv] of Object.entries(sellerBreakdown)) {
      const selShare = nv / netTotal;
      extra[opCode].sellers[dc] = (extra[opCode].sellers[dc] || 0) + (nfTotal * selShare);
    }
  }
}

const SELLER_NAMES = {
  288: 'Jucelino', 161: 'Cleiton', 241: 'Yago', 15: 'Heyridan',
  25: 'Anderson', 165: 'Michel', 251: 'Felipe', 779: 'Aldo', 131: 'Agenor'
};

console.log('\n=== OPERATION CODES FORA DO FILTRO COM VENDEDORES B2R ===');
let total = 0;
Object.entries(extra)
  .sort((a, b) => b[1].value - a[1].value)
  .forEach(([op, info]) => {
    console.log(`\n[${op}] ${info.name}`);
    console.log(`  TOTAL: R$${info.value.toFixed(2)}`);
    for (const [dc, v] of Object.entries(info.sellers).sort((a,b) => b[1]-a[1])) {
      console.log(`    ${(SELLER_NAMES[dc]||'Seller '+dc).padEnd(15)} R$${v.toFixed(2)}`);
    }
    total += info.value;
  });

console.log(`\nTOTAL FORA DO FILTRO: R$${total.toFixed(2)}`);
console.log(`\n=== RESUMO: adicionar esses ops ao filtro fecha a diferença de ~R$2.025 ===`);
