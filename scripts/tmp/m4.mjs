import 'dotenv/config';
import supabase from '../../config/supabase.js';
const { data } = await supabase.from('fluxo_caixa_contas').select('id,banco,apelido,escopo,ativo,titular_nome').in('id', [10, 140]);
console.log(JSON.stringify(data));
const { data: t } = await supabase.from('fluxo_caixa_transferencias').select('*').gte('data', '2026-09-28').lte('data', '2026-11-10').order('data');
console.log('total', t.length, 'metodos', JSON.stringify(t.reduce((m,x)=>(m[x.metodo]=(m[x.metodo]||0)+1,m),{})));
const { data: soltas } = await supabase.from('fluxo_caixa_lancamentos').select('id,conta_id,data,valor,descricao,observacao').eq('tipo','TRANSFERENCIA').is('transferencia_id', null).gte('data','2026-09-28').lte('data','2026-11-10');
console.log('transf de um lado', soltas.length);
process.exit(0);
