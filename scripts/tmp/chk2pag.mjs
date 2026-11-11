import 'dotenv/config';
import supabase from '../../config/supabase.js';
const { data } = await supabase.from('fluxo_caixa_conciliacoes').select('id,data,valor,origem,referencia').eq('origem', 'TOTVS_CP').lt('valor', 0).order('data', { ascending: false }).limit(3);
for (const c of data) console.log(c.id, c.data, c.valor, JSON.stringify(c.referencia).slice(0, 300));
const r = await supabase.from('fluxo_caixa_conciliacoes').select('id', { count: 'exact', head: true }).gte('data', '2026-01-01').lt('valor', 0).in('origem', ['TOTVS_CP', 'LIBERACAO', 'SOLICITACAO', 'MULTIPLO']);
console.log('total', r.count, r.error?.message);
process.exit(0);
