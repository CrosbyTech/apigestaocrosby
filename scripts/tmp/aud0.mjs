import 'dotenv/config';
import supabase from '../../config/supabase.js';
for (const t of ['accounts_payable_duplicates','accounts_payable_duplicates_v','contas_pagar_pagos_conciliacao']) {
  const { data, error } = await supabase.from(t).select('*').limit(1);
  console.log(t, error?.message || Object.keys(data[0]||{}).join(','));
  if (data?.[0]) console.log(JSON.stringify(data[0]).slice(0,600));
}
process.exit(0);
