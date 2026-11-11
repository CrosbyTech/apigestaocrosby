import 'dotenv/config';
import supabase from '../../config/supabase.js';
const { data } = await supabase.from('accounts_payable_duplicates_v').select('branch_code,supplier_code,supplier_name,duplicate_code,installment_code,issue_date,due_date,settlement_date,duplicate_value').in('supplier_code', [31124, 130997, 19940]).gte('due_date', '2026-09-01').lte('due_date', '2026-10-31').order('due_date');
let s = 0;
for (const x of data || []) { console.log(x.branch_code, x.supplier_code, (x.supplier_name||'').slice(0,26), x.duplicate_code+'/'+x.installment_code, 'em', x.issue_date?.slice(0,10), 'venc', x.due_date?.slice(0,10), 'liq', x.settlement_date?.slice(0,10)||'-', x.duplicate_value); }
const { data: c } = await supabase.from('fluxo_caixa_conciliacoes').select('lancamento_id,origem,justificativa').in('lancamento_id', [294641, 294653, 294669]);
console.log('conc set/out:', JSON.stringify(c));
process.exit(0);
