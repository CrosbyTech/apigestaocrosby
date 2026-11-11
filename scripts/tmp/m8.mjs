import 'dotenv/config';
import supabase from '../../config/supabase.js';
const { data: ls } = await supabase.from('fluxo_caixa_lancamentos').select('id,conta_id,data,valor,tipo,categoria,descricao,memo,contraparte_nome,contraparte_banco,transferencia_id').gte('data','2026-09-25').lte('data','2026-11-05').or('valor.eq.1495,valor.eq.-1495');
for (const l of ls) {
  const { data: c } = await supabase.from('fluxo_caixa_conciliacoes').select('id,origem,justificativa,usuario,criado_em').eq('lancamento_id', l.id);
  console.log(JSON.stringify(l), '| conc:', JSON.stringify(c));
}
setTimeout(()=>process.exit(0),100);
