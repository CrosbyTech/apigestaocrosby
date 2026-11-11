import 'dotenv/config';
import supabase from '../../config/supabase.js';
const pg = [294641, 294653, 294669, 294676, 294679];
const { data: c } = await supabase.from('fluxo_caixa_conciliacoes').select('lancamento_id,origem,justificativa').in('lancamento_id', pg);
console.log('conc', JSON.stringify(c));
const { data: d1 } = await supabase.from('accounts_payable_duplicates_v').select('branch_code,supplier_code,supplier_name,supplier_cpf_cnpj,duplicate_code,installment_code,issue_date,due_date,settlement_date,duplicate_value,paid_value,observation,expense').like('supplier_cpf_cnpj', '08561701%').gte('due_date', '2026-08-01').order('due_date');
console.log('PAGSEGURO dups', d1?.length);
for (const x of d1 || []) console.log(x.branch_code, x.supplier_code, x.supplier_name, x.duplicate_code, x.installment_code, x.issue_date?.slice(0,10), x.due_date?.slice(0,10), x.settlement_date?.slice(0,10)||'-', x.duplicate_value, (x.observation||'').toString().slice(0,60), (x.expense||[]).map(e=>e.expenseCode+' '+e.expenseName).join('/').slice(0,60));
process.exit(0);
