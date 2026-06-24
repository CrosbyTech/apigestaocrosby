import './config/supabase.js';
import { createClient } from '@supabase/supabase-js';
const fiscal = createClient(process.env.SUPABASE_FISCAL_URL, process.env.SUPABASE_FISCAL_KEY);

const CANAL_CONFIG = {
  varejo: { devolucaoOps: [8888, 8889, 1, 1102, 1152, 7052, 9402], devolucaoBranchs: [2, 5, 55, 65, 87, 88, 90, 93, 94, 95, 97] },
  revenda: { devolucaoOps: [7245, 20, 1214, 7790], devolucaoBranchs: [2, 5, 75, 99, 200] },
  multimarcas: { devolucaoOps: [7244, 7245, 1214], devolucaoBranchs: [99, 2, 95, 87, 88, 90, 94, 97], excludeSellers: [21, 26, 69] },
  inbound_david: { devolucaoOps: [7244, 7245, 1214], devolucaoBranchs: [99, 2, 95, 87, 88, 90, 94, 97], allowedSellers: [26, 69] },
  inbound_rafael: { devolucaoOps: [7244, 7245, 1214], devolucaoBranchs: [99], allowedSellers: [21] },
  franquia: { devolucaoOps: [7244, 7245], devolucaoBranchs: null },
  ricardoeletro: { devolucaoOps: [5153, 5152], devolucaoBranchs: [11, 111] },
};

const { data } = await fiscal.from('notas_fiscais')
  .select('operation_code, branch_code, dealer_code, total_value, invoice_status')
  .eq('operation_type', 'Input')
  .gte('issue_date', '2026-06-01').lte('issue_date', '2026-06-22');
const valid = (data||[]).filter(n => n.invoice_status !== 'Canceled' && n.invoice_status !== 'Deleted');

let totGlobal = 0;
for (const [canal, cfg] of Object.entries(CANAL_CONFIG)) {
  const opsSet = new Set(cfg.devolucaoOps.map(Number));
  const branchSet = cfg.devolucaoBranchs?.length ? new Set(cfg.devolucaoBranchs.map(Number)) : null;
  const sellerSet = cfg.allowedSellers?.length ? new Set(cfg.allowedSellers.map(Number)) : null;
  let cv = 0;
  for (const n of valid) {
    if (!opsSet.has(Number(n.operation_code))) continue;
    if (branchSet && !branchSet.has(Number(n.branch_code))) continue;
    if (sellerSet && !sellerSet.has(Number(n.dealer_code))) continue;
    cv += Number(n.total_value || 0);
  }
  console.log(canal.padEnd(20), 'credev R$', cv.toFixed(2));
  totGlobal += cv;
}
console.log('---');
console.log('TOTAL credev calculado:', totGlobal.toFixed(2));
