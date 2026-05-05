import { createClient } from '@supabase/supabase-js';
import { loadDebugEnv } from './_debugEnv.mjs';
loadDebugEnv();
const sb = createClient('https://wnjapaczjcvhumfikwwe.supabase.co',process.env.SUPABASE_FISCAL_KEY);

const datemin = '2026-04-01';
const datemax = '2026-04-23';
const OPS_FALTANDO = [5202, 1407, 9120, 9121, 9113, 9111, 9001, 9009, 9061, 9067, 9400, 9401, 9420, 9404, 7806, 7809, 7242, 512];
const REVENDA_DEALERS = new Set([15, 25, 161, 165, 241, 251, 288, 779]);
const NAMES = { 288: 'Jucelino', 161: 'Cleiton', 241: 'Yago', 15: 'Heyridan', 25: 'Anderson', 165: 'Michel', 251: 'Felipe', 779: 'Aldo' };

const PAGE = 1000;
let all = [], offset = 0;
while (true) {
  const { data } = await sb.from('notas_fiscais')
    .select('invoice_code,total_value,operation_code,operation_name,issue_date,person_name,items')
    .eq('operation_type', 'Output')
    .not('invoice_status', 'eq', 'Canceled')
    .not('invoice_status', 'eq', 'Deleted')
    .gte('issue_date', datemin)
    .lte('issue_date', datemax)
    .lt('person_code', 100000000)
    .in('operation_code', OPS_FALTANDO)
    .range(offset, offset + PAGE - 1);
  if (!data?.length) break;
  all.push(...data);
  if (data.length < PAGE) break;
  offset += PAGE;
}

console.log('NFs com dealers revenda nas "ops faltando":');
for (const nf of all) {
  for (const item of nf.items || []) {
    for (const p of item.products || []) {
      const dc = parseInt(p.dealerCode);
      if (REVENDA_DEALERS.has(dc)) {
        console.log(`  ${NAMES[dc].padEnd(10)} | NF ${nf.invoice_code} | op ${nf.operation_code} "${nf.operation_name||''}" | R$${nf.total_value} | ${nf.issue_date} | ${nf.person_name}`);
        break;
      }
    }
  }
}
