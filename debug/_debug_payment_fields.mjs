import { createClient } from '@supabase/supabase-js';
import { loadDebugEnv } from './_debugEnv.mjs';
loadDebugEnv();

const supabase = createClient(
  'https://wnjapaczjcvhumfikwwe.supabase.co',
  process.env.SUPABASE_FISCAL_KEY
);

const nfCodes = [27554, 27656]; // NFs da Ana Anegelia (op 5912 - Credev)

const { data, error } = await supabase
  .from('notas_fiscais')
  .select('invoice_code, operation_code, total_value, raw_data->payments, raw_data->paymentConditionCode, raw_data->paymentConditionName')
  .in('invoice_code', nfCodes);

if (error) { console.error(error); process.exit(1); }

for (const nf of data) {
  console.log(`\n=== NF ${nf.invoice_code} | Op ${nf.operation_code} | R$${nf.total_value} ===`);
  console.log('  paymentConditionCode:', nf.paymentConditionCode);
  console.log('  paymentConditionName:', nf.paymentConditionName);
  console.log('  payments:', JSON.stringify(nf.payments, null, 2));
}
