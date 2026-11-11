import 'dotenv/config';
import supabase from '../../config/supabase.js';
const { data, error } = await supabase.from('accounts_receivable_commands').select('*').order('id', { ascending: false }).limit(4);
console.log(error?.message);
for (const r of data || []) console.log(JSON.stringify(r).slice(0, 1500), '\n');
process.exit(0);
