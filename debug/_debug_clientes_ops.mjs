import { createClient } from '@supabase/supabase-js';
import { loadDebugEnv } from './_debugEnv.mjs';
loadDebugEnv();

const sb = createClient(
  'https://wnjapaczjcvhumfikwwe.supabase.co',
  process.env.SUPABASE_FISCAL_KEY
);

const SELLERS = { 161: 'Cleiton', 15: 'Heyridan', 251: 'Felipe', 25: 'Anderson', 288: 'Jucelino', 241: 'Yago' };
const OPS_ALVO = new Set([5912, 510, 7279]);

const { data, error } = await sb.from('notas_fiscais')
  .select('operation_code,operation_name,total_value,items,person_code,person_name,invoice_code,issue_date')
  .eq('operation_type', 'Output')
  .not('invoice_status', 'eq', 'Canceled')
  .not('invoice_status', 'eq', 'Deleted')
  .gte('issue_date', '2026-04-01')
  .lte('issue_date', '2026-04-22')
  .in('operation_code', [5912, 510, 7279]);

if (error) { console.error(error); process.exit(1); }

console.log(`NFs encontradas para ops 5912/510/7279: ${data.length}\n`);

for (const nf of data) {
  if (!nf.items) continue;

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

  if (!Object.keys(sellerNet).length) continue;

  const nfTotal = parseFloat(nf.total_value) || 0;
  console.log(`─────────────────────────────────────`);
  console.log(`OP:       [${nf.operation_code}] ${nf.operation_name}`);
  console.log(`NF:       ${nf.invoice_code}  |  Data: ${nf.issue_date}`);
  console.log(`Cliente:  ${nf.person_name || 'N/A'} (Cód: ${nf.person_code || 'N/A'})`);
  console.log(`Valor NF: R$${nfTotal.toFixed(2)}`);
  console.log(`Vendedores nessa NF:`);
  for (const [dc, nv] of Object.entries(sellerNet)) {
    const share = netTotal > 0 ? nv / netTotal : 0;
    const val = nfTotal * share;
    console.log(`  → ${SELLERS[dc].padEnd(12)} R$${val.toFixed(2)}`);
  }
}
