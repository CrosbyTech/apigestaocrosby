import 'dotenv/config';
import supabase from '../../config/supabase.js';
const vals = [50, 19.36, 2280.12, 553.08, 941.77, 6.82, 2900, 1778.61, 2902.56, 948.59];
const { data } = await supabase.from('accounts_payable_duplicates_v').select('branch_code,supplier_code,supplier_name,duplicate_code,installment_code,issue_date,due_date,settlement_date,duplicate_value,bearer_code,observation,expense').in('duplicate_value', vals).gte('issue_date', '2026-09-15').lte('issue_date', '2026-11-15').order('issue_date');
for (const x of data || []) console.log(x.branch_code, x.supplier_code, (x.supplier_name||'').slice(0,34), x.duplicate_code+'/'+x.installment_code, 'em', x.issue_date?.slice(0,10), 'venc', x.due_date?.slice(0,10), 'liq', x.settlement_date?.slice(0,10)||'-', x.duplicate_value, 'port', x.bearer_code, (x.expense||[]).map(e=>e.expenseCode).join('/'), String(x.observation||'').slice(0,50));
// pagamento de 10/11?
const { data: n } = await supabase.from('fluxo_caixa_lancamentos').select('id,data,valor,descricao').eq('conta_id', 38).gte('data', '2026-10-15').order('data');
console.log('PagBank depois de 15/10:', JSON.stringify(n));
process.exit(0);
