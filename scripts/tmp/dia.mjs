import 'dotenv/config';
import { getLojaByStonecode, stonecodesDaLoja } from '../../config/stoneConciliacao.js';
import { obterDiaStone } from '../../services/stoneConciliacao.js';
const cfg = getLojaByStonecode('579299624');
for (const sc of stonecodesDaLoja(cfg)) for (const d of ['2026-10-14','2026-10-15','2026-10-16']) {
  const dia = await obterDiaStone({ ...cfg, stonecode: sc }, d);
  console.log(sc, d, dia._cache, 'tx', dia.transacoes.length, 'pag', dia.pagamentos.length, dia.transacoes.filter(t=>t.valorBruto<=0.05).map(t=>t.nsu+' venda '+t.dataVenda).join(', '));
}
process.exit(0);
