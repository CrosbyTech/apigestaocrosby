// Soma vendas de Jucelino (288) em maio/2026 — Supabase only, sem TOTVS
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const s = createClient(process.env.SUPABASE_FISCAL_URL, process.env.SUPABASE_FISCAL_KEY);

const REVENDA_OPS = [7236, 9122, 5102, 7242, 9061, 9001, 9121, 512];
const DMIN = '2026-05-01', DMAX = '2026-05-31';
const SELLER = 288;

let off = 0, total = 0, nfs = 0, porFilial = {};
while (true) {
  const { data } = await s.from('notas_fiscais')
    .select('branch_code, total_value, invoice_status, dealer_code')
    .eq('operation_type', 'Output')
    .gte('issue_date', DMIN).lte('issue_date', DMAX)
    .in('operation_code', REVENDA_OPS)
    .eq('dealer_code', SELLER)
    .range(off, off + 999);
  if (!data?.length) break;
  for (const n of data) {
    if (n.invoice_status === 'Canceled' || n.invoice_status === 'Deleted') continue;
    const v = Number(n.total_value || 0);
    total += v;
    nfs++;
    porFilial[n.branch_code] = (porFilial[n.branch_code] || 0) + v;
  }
  if (data.length < 1000) break;
  off += 1000;
}
console.log(`Jucelino (288) — maio/2026 — ops revenda:`);
console.log(`  NFs: ${nfs}`);
for (const [b, v] of Object.entries(porFilial)) console.log(`  Filial ${b}: R$ ${Number(v).toFixed(2)}`);
console.log(`  TOTAL: R$ ${total.toFixed(2)}`);

// Também testa SEM filtro de op (qualquer venda de Jucelino)
let off2 = 0, total2 = 0, nfs2 = 0, porOp = {};
while (true) {
  const { data } = await s.from('notas_fiscais')
    .select('branch_code, total_value, invoice_status, operation_code')
    .eq('operation_type', 'Output')
    .gte('issue_date', DMIN).lte('issue_date', DMAX)
    .eq('dealer_code', SELLER)
    .range(off2, off2 + 999);
  if (!data?.length) break;
  for (const n of data) {
    if (n.invoice_status === 'Canceled' || n.invoice_status === 'Deleted') continue;
    total2 += Number(n.total_value || 0);
    nfs2++;
    porOp[n.operation_code] = (porOp[n.operation_code] || 0) + Number(n.total_value || 0);
  }
  if (data.length < 1000) break;
  off2 += 1000;
}
console.log(`\nTodas as vendas de Jucelino (qualquer op):`);
console.log(`  NFs: ${nfs2}, Total: R$ ${total2.toFixed(2)}`);
for (const [op, v] of Object.entries(porOp).sort((a, b) => b[1] - a[1]).slice(0, 10)) {
  console.log(`  op ${op}: R$ ${Number(v).toFixed(2)}`);
}
