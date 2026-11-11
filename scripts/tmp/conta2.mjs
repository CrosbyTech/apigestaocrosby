import 'dotenv/config';
import supabase from '../../config/supabase.js';
const { data: imps, error } = await supabase.from('fluxo_caixa_importacoes').select('*').eq('conta_id', 14).limit(20);
console.log(error?.message, (imps||[]).map(i => ({ id: i.id, arq: i.nome_arquivo, ini: i.periodo_inicio, fim: i.periodo_fim, qtd: i.qtd_lancamentos ?? i.qtd, origem: i.origem, em: i.criado_em })));
const { data: l } = await supabase.from('fluxo_caixa_lancamentos').select('data,valor,descricao,forma,editado_manual,fornecedor,observacao').eq('conta_id', 14).gte('data', '2026-10-01').lte('data', '2026-10-31').order('data').limit(1000);
console.log('total', l.length, 'soma', l.reduce((s,x)=>s+Number(x.valor),0).toFixed(2), 'ultimo', l.at(-1)?.data, 'primeiro', l[0]?.data);
console.log('manuais', l.filter(x => x.editado_manual || x.fornecedor || x.observacao).length);
process.exit(0);
