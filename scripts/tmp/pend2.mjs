import 'dotenv/config';
import supabase from '../../config/supabase.js';
import { saidasPendentes } from '../../services/tarifasConciliacao.js';
const it = await saidasPendentes({ de: '2026-10-01', ate: '2026-10-31' });
const ids = it.map((i) => i.id);
const { data: extra } = await supabase.from('fluxo_caixa_lancamentos').select('id,contraparte_doc,contraparte_banco,documento').in('id', ids);
const ex = new Map(extra.map((e) => [e.id, e]));
for (const i of it.filter((x) => !x.elegivel)) { const e = ex.get(i.id) || {}; console.log(i.empresa.slice(0, 22), '|', i.banco, '|', i.data, '|', i.valor, '|', i.forma, '|', (i.descricao || '').slice(0, 40), '|', (i.contraparte || '').slice(0, 35), '|', e.contraparte_doc || '-', '|', i.motivoBloqueio); }
process.exit(0);
