import 'dotenv/config';
import supabase from '../../config/supabase.js';
import { getLojaByStonecode } from '../../config/stoneConciliacao.js';
import { obterDiaStone, mapLimit } from '../../services/stoneConciliacao.js';
const { data } = await supabase.from('stone_conciliacao_arquivos').select('stonecode,data_ref,qtd_transacoes,gerado_em,baixado_em').eq('qtd_transacoes', 0).is('gerado_em', null).gte('data_ref', '2026-09-01').range(0, 999);
console.log('vazios sem geração', data.length);
const res = await mapLimit(data, 3, async (r) => {
  const cfg = getLojaByStonecode(r.stonecode);
  if (!cfg) return null;
  try { const d = await obterDiaStone({ ...cfg, stonecode: r.stonecode }, r.data_ref, { force: true }); return d.transacoes.length || d.pagamentos.length ? `${cfg.nome} ${r.stonecode} ${r.data_ref} → tx ${d.transacoes.length} pag ${d.pagamentos.length}` : null; }
  catch (e) { return `${r.stonecode} ${r.data_ref} ERRO ${e.message}`; }
});
console.log(res.filter(Boolean).join('\n') || 'nenhum voltou com dados');
process.exit(0);
