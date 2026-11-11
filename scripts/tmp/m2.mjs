import 'dotenv/config';
import supabase from '../../config/supabase.js';
for (const id of [296245, 294622]) {
  const { data } = await supabase.from('fluxo_caixa_conciliacoes').select('id,origem,justificativa,referencia,usuario,automatico,criado_em').eq('lancamento_id', id);
  console.log(id, JSON.stringify(data));
}
const { data: l } = await supabase.from('fluxo_caixa_lancamentos').select('*').in('id',[296245,294622]);
console.log(JSON.stringify(l));
process.exit(0);
