import 'dotenv/config';
import supabase from '../../config/supabase.js';
const vals = [23.62, 674.73, 29.86, 23.97, 1742.78, 49.99, 54.38, 1553.75, 55, 65.49];
const { data } = await supabase.from('accounts_payable_duplicates_v').select('branch_code,supplier_code,supplier_name,duplicate_code,installment_code,issue_date,due_date,settlement_date,duplicate_value').in('duplicate_value', vals).gte('issue_date', '2026-09-15').lte('issue_date', '2026-10-15').order('duplicate_value');
for (const x of data || []) console.log(x.branch_code, x.supplier_code, (x.supplier_name||'').slice(0,30), x.duplicate_code+'/'+x.installment_code, 'em', x.issue_date?.slice(0,10), 'venc', x.due_date?.slice(0,10), 'liq', x.settlement_date?.slice(0,10)||'-', x.duplicate_value);
const { data: c } = await supabase.from('contas_pagar_pagos_conciliacao').select('nr_duplicata,conciliacao_id').in('nr_duplicata', (data||[]).map(x=>x.duplicate_code));
console.log('já conciliadas:', JSON.stringify(c));
process.exit(0);
