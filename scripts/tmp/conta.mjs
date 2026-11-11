import 'dotenv/config';
import supabase from '../../config/supabase.js';
const { data: contas } = await supabase.from('fluxo_caixa_contas').select('*').eq('conta', '71938990');
console.log(contas);
for (const c of contas || []) {
  const { data: imps } = await supabase.from('fluxo_caixa_importacoes').select('id,nome_arquivo,periodo_inicio,periodo_fim,qtd_lancamentos,origem,created_at').eq('conta_id', c.id).order('periodo_inicio');
  console.log(imps);
  const { count } = await supabase.from('fluxo_caixa_lancamentos').select('id', { count: 'exact', head: true }).eq('conta_id', c.id).gte('data', '2026-10-01').lte('data', '2026-10-31');
  console.log('lanc out', count);
}
process.exit(0);
