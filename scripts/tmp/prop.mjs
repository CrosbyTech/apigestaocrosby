import 'dotenv/config';
import supabase from '../../config/supabase.js';
import { propagarConciliacao } from '../../services/conciliacaoPropagacao.js';
const { data } = await supabase.from('fluxo_caixa_conciliacoes').select('id,conta_id,data,valor,origem,referencia,usuario').in('origem', ['TOTVS_CP', 'MULTIPLO', 'SOLICITACAO']).lt('valor', 0).order('data', { ascending: false }).limit(3);
for (const c of data) console.log(c.origem, c.data, c.valor, JSON.stringify(await propagarConciliacao(c)));
process.exit(0);
