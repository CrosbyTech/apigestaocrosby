// Valida o impacto da exclusão dos clientes B2L (12097, 70078)
import { createClient } from '@supabase/supabase-js';
import { loadDebugEnv } from './_debugEnv.mjs';
loadDebugEnv();

const supabaseFiscal = createClient(
  'https://wnjapaczjcvhumfikwwe.supabase.co',
  process.env.SUPABASE_FISCAL_KEY,
);

const datemin = '2026-04-01';
const datemax = '2026-04-22';
const OPS_REVENDA = [7236, 9122, 5102, 7242];
const B2L_PERSON_CODES = [12097, 70078];

async function fetchAll(filterB2L) {
  let allNFs = [];
  let offset = 0;
  while (true) {
    let query = supabaseFiscal
      .from('notas_fiscais')
      .select('items,total_value,operation_code,branch_code,invoice_code,issue_date,person_code')
      .eq('operation_type', 'Output')
      .not('invoice_status', 'eq', 'Canceled')
      .not('invoice_status', 'eq', 'Deleted')
      .gte('issue_date', datemin)
      .lte('issue_date', datemax)
      .in('operation_code', OPS_REVENDA);

    if (filterB2L) {
      query = query.not('person_code', 'in', `(${B2L_PERSON_CODES.join(',')})`);
    }

    const { data, error } = await query.range(offset, offset + 999);
    if (error) throw error;
    allNFs = allNFs.concat(data);
    if (data.length < 1000) break;
    offset += 1000;
  }
  return allNFs;
}

function calcTotal(nfs) {
  const sellerMap = {};
  for (const nf of nfs) {
    if (!nf.items || !Array.isArray(nf.items)) continue;
    const nfTotalValue = parseFloat(nf.total_value) || 0;
    const sellerNetValues = {};
    let nfNetValueTotal = 0;
    for (const item of nf.items) {
      const prods = Array.isArray(item.products) ? item.products : [];
      for (const p of prods) {
        const dc = String(p.dealerCode);
        if (!dc || dc === 'undefined') continue;
        const nv = parseFloat(p.netValue) || 0;
        nfNetValueTotal += nv;
        if (!sellerNetValues[dc]) sellerNetValues[dc] = { net: 0 };
        sellerNetValues[dc].net += nv;
      }
    }
    if (nfNetValueTotal <= 0) continue;
    for (const [dc, info] of Object.entries(sellerNetValues)) {
      if (!sellerMap[dc]) sellerMap[dc] = 0;
      sellerMap[dc] += nfTotalValue * (info.net / nfNetValueTotal);
    }
  }
  return sellerMap;
}

const SELLER_NAMES = {
  '288': 'JUCELINO',
  '161': 'CLEYTON F',
  '241': 'YAGO SMITH',
  '15':  'HEYRIDAN',
  '25':  'ANDERSON MEDEIROS',
  '165': 'MICHEL VINICIO',
  '251': 'FELIPE PB',
  '779': 'ALDO RAFAEL',
};

const [withB2L, withoutB2L] = await Promise.all([fetchAll(false), fetchAll(true)]);

const mapWith = calcTotal(withB2L);
const mapWithout = calcTotal(withoutB2L);

const allDealers = new Set([...Object.keys(mapWith), ...Object.keys(mapWithout)]);
const relevantDealers = [...allDealers].filter(dc => SELLER_NAMES[dc]);

let totalWith = 0, totalWithout = 0;
console.log('\nImpacto da exclusão B2L por vendedor:');
console.log('Vendedor          | COM B2L    | SEM B2L    | Diferença');
console.log('------------------+------------+------------+-----------');
for (const dc of relevantDealers.sort((a,b) => Number(a)-Number(b))) {
  const with_ = mapWith[dc] || 0;
  const without_ = mapWithout[dc] || 0;
  const diff = without_ - with_;
  totalWith += with_;
  totalWithout += without_;
  if (Math.abs(diff) > 1 || with_ > 0) {
    const name = SELLER_NAMES[dc] || dc;
    console.log(`${name.padEnd(18)}| R$${with_.toFixed(2).padStart(9)} | R$${without_.toFixed(2).padStart(9)} | R$${diff.toFixed(2).padStart(8)}`);
  }
}
console.log('------------------+------------+------------+-----------');
console.log(`${'TOTAL'.padEnd(18)}| R$${totalWith.toFixed(2).padStart(9)} | R$${totalWithout.toFixed(2).padStart(9)} | R$${(totalWithout - totalWith).toFixed(2).padStart(8)}`);
console.log(`\nExcel B2R (01-22/04): R$140,627.xx`);
console.log(`Supabase SEM B2L:     R$${totalWithout.toFixed(2)}`);
console.log(`Gap restante:         R$${(totalWithout - 140627).toFixed(2)}`);
