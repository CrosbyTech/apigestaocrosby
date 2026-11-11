import 'dotenv/config';
import supabase from '../../config/supabase.js';
import { getLojaByStonecode } from '../../config/stoneConciliacao.js';
import { obterDiaStone, mapLimit } from '../../services/stoneConciliacao.js';
const { data } = await supabase.from('stone_conciliacao_arquivos').select('stonecode,data_ref,qtd_transacoes,gerado_em').gte('baixado_em', '2026-11-03T00:00:00Z').eq('qtd_transacoes', 0).is('gerado_em', null);
console.log('para rebaixar', data.length);
const res = await mapLimit(data, 3, async (r) => {
  const cfg = getLojaByStonecode(r.stonecode);
  if (!cfg) return `${r.stonecode} ${r.data_ref} sem config`;
  try { const d = await obterDiaStone({ ...cfg, stonecode: r.stonecode }, r.data_ref, { force: true }); return `${r.stonecode} ${r.data_ref} tx ${d.transacoes.length} pag ${d.pagamentos.length}`; }
  catch (e) { return `${r.stonecode} ${r.data_ref} ERRO ${e.message}`; }
});
console.log(res.join('\n'));
process.exit(0);
