import 'dotenv/config';
import supabase from '../../config/supabase.js';
const { data, error } = await supabase.from('erp_portadores').select('code,descricao,tipo').in('code', [1020, 1610, 6000, 6001, 6002, 6003]);
console.log(error?.message || data);
process.exit(0);
