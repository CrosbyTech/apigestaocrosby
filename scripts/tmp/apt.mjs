import 'dotenv/config';
import supabase from '../../config/supabase.js';
for (const t of ['accounts_payable_duplicates', 'accounts_payable_installments', 'accounts_payable_documents', 'erp_contas_pagar']) {
  const { count, error } = await supabase.from(t).select('*', { count: 'exact', head: true });
  console.log(t, error?.message || count);
}
process.exit(0);
