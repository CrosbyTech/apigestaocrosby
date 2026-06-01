import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
const s = createClient(process.env.SUPABASE_FISCAL_URL, process.env.SUPABASE_FISCAL_KEY);

const { data, error } = await s.from('notas_fiscais')
  .select('person_code, person_name, raw_data')
  .eq('dealer_code', 21)
  .eq('operation_type', 'Output')
  .limit(2);

console.log('err:', error?.message);
console.log('count:', data?.length);
for (const nf of data || []) {
  console.log('\npc=', nf.person_code, '|', nf.person_name);
  const raw = nf.raw_data || {};
  console.log('  raw_data keys:', Object.keys(raw).join(', '));
  console.log('  person obj:', JSON.stringify(raw.person)?.slice(0, 600));
}
