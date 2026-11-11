import 'dotenv/config';
import supabase from '../../config/supabase.js';
const { data, error } = await supabase.from('fluxo_caixa_lancamentos').select('id,data,valor,fornecedor,observacao').eq('conta_id', 14).gte('data', '2026-10-01').lte('data', '2026-10-28').or('fornecedor.not.is.null,observacao.not.is.null');
console.log(error?.message, data?.length, data?.slice(0,5));
process.exit(0);
