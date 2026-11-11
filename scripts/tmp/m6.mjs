import 'dotenv/config';
import supabase from '../../config/supabase.js';
const { data, error } = await supabase.from('fluxo_caixa_conciliacoes').select('*').in('lancamento_id', [296245, 294622]);
console.log(error?.message, JSON.stringify(data, null, 1));
process.exit(0);
