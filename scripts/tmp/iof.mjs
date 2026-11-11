import 'dotenv/config';
import supabase from '../../config/supabase.js';
import { buscarContasPagar } from '../../services/fluxoCaixaConciliacao.js';
const { data: l } = await supabase.from('fluxo_caixa_lancamentos').select('id,data,valor,descricao').eq('data', '2026-10-01').eq('valor', -0.01).limit(5);
console.log(l);
const r = await buscarContasPagar({ valorMin: '0,01', valorMax: '0,01', lancamentoId: l?.[0]?.id });
for (const c of r.candidatos.slice(0, 6)) console.log(c.origem, c.nome, c.duplicata, c.vencimento, c.valor, 'restante', c.restante, 'esgotada', c.esgotada);
process.exit(0);
