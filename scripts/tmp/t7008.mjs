import 'dotenv/config';
import supabase from '../../config/supabase.js';
import { postTotvs } from '../../services/bluecardLimite.js';
const { data, error } = await supabase.from('accounts_payable_duplicates_v').select('branch_code,supplier_code,supplier_name,supplier_cpf_cnpj,duplicate_value,issue_date,expense,bearer_code').filter('expense', 'cs', JSON.stringify([{ expenseCode: 7008 }])).order('issue_date', { ascending: false }).limit(8);
console.log(error?.message);
for (const x of data || []) console.log(x.branch_code, x.supplier_code, x.supplier_name, x.supplier_cpf_cnpj, x.duplicate_value, String(x.issue_date).slice(0, 10), JSON.stringify(x.expense), x.bearer_code);
for (const cnpj of ['16501555000157', '01181521000155', '60701190000104', '00000000000191', '00360305000104', '90400888000142', '07237373000120', '08561701000101']) {
  const r = await postTotvs('/person/v2/legal-entities/search', { filter: { cnpjList: [cnpj] }, page: 1, pageSize: 1 });
  const it = r.data?.items?.[0];
  console.log(cnpj, it ? `${it.code} ${it.name}` : 'NAO CADASTRADO');
}
process.exit(0);
