import 'dotenv/config';
import supabase from '../../config/supabase.js';
const { data, error } = await supabase.from('accounts_payable_duplicates_v').select('*').eq('duplicate_value', 29.99).limit(3);
console.log(error?.message, data?.length, data?.[0] && Object.keys(data[0]).join(','));
console.log(JSON.stringify(data?.[0]).slice(0, 900));
const { data: mx } = await supabase.from('accounts_payable_duplicates').select('sincronizado_em').order('sincronizado_em', { ascending: false }).limit(1);
console.log('ultimo sync', mx);
process.exit(0);
