import { createClient } from '@supabase/supabase-js';
import { loadDebugEnv } from './_debugEnv.mjs';
loadDebugEnv();

const sb = createClient(
  'https://wnjapaczjcvhumfikwwe.supabase.co',
  process.env.SUPABASE_FISCAL_KEY
);

const SELLERS = { 161: 'Cleiton', 15: 'Heyridan', 251: 'Felipe', 25: 'Anderson', 288: 'Jucelino', 241: 'Yago' };
const OPS_REVENDA = new Set([7236,7242,9120,9121,9122,9113,9111,9001,9009,9061,9067,9400,9401,9420,9404,7806,7809,5102,5202,1407,512]);
const BLUE_HOUSE = new Set([7281,7272,7273,7282,7289,7280,7248,8402,7271,7274,7283]);

let allNFs = [];
let offset = 0;
while (true) {
  const { data, error } = await sb.from('notas_fiscais')
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
console.log(`NFs carregadas: ${allNFs.length}`);

const extra = {};
for (const nf of allNFs) {
  if (OPS_REVENDA.has(nf.operation_code)) continue;
  if (BLUE_HOUSE.has(nf.operation_code)) continue;
  if (!nf.items) continue;

  const nfTotal = parseFloat(nf.total_value) || 0;
  let netTotal = 0;
  const sellerNet = {};

  for (const item of nf.items) {
    for (const p of (item.products || [])) {
      const dc = parseInt(p.dealerCode);
      const nv = parseFloat(p.netValue) || 0;
      netTotal += nv;
      if (SELLERS[dc]) sellerNet[dc] = (sellerNet[dc] || 0) + nv;
    }
  }

  if (!Object.keys(sellerNet).length || netTotal <= 0) continue;

  const key = nf.operation_code;
  if (!extra[key]) extra[key] = { name: nf.operation_name, value: 0, bySeller: {} };
  for (const [dc, nv] of Object.entries(sellerNet)) {
    const v = nfTotal * (nv / netTotal);
    extra[key].value += v;
    extra[key].bySeller[SELLERS[dc]] = (extra[key].bySeller[SELLERS[dc]] || 0) + v;
  }
}

let total = 0;
console.log('\n=== OPS FORA DO FILTRO (sem Blue House) ===');
Object.entries(extra)
  .sort((a, b) => b[1].value - a[1].value)
  .forEach(([op, info]) => {
    console.log(`[${op}] ${info.name}`);
    console.log(`  SUBTOTAL: R$${info.value.toFixed(2)}`);
    Object.entries(info.bySeller)
      .sort((a, b) => b[1] - a[1])
      .forEach(([n, v]) => console.log(`    - ${n.padEnd(12)}: R$${v.toFixed(2)}`));
    total += info.value;
  });

console.log(`\nTOTAL FALTANTE: R$${total.toFixed(2)}`);
console.log(`\nDiferença esperada: ~R$2.025`);
console.log(`Diferença encontrada: R$${total.toFixed(2)}`);
