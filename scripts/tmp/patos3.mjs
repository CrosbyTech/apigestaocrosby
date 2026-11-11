import 'dotenv/config';
import { getLojaByStonecode, stonecodesDaLoja } from '../../config/stoneConciliacao.js';
import { obterDiaStone, rangeDatasIso } from '../../services/stoneConciliacao.js';
const cfg = getLojaByStonecode('168851294');
console.log('stonecodes', stonecodesDaLoja(cfg));
for (const d of rangeDatasIso('2026-10-22', '2026-10-28')) {
  const dia = await obterDiaStone(cfg, d);
  const tx = dia.transacoes;
  console.log(d, dia._cache, 'tx', tx.length, 'gerado', dia.header?.geradoEm, '4x+', tx.filter(t => t.parcelas >= 4).map(t => `${t.valorBruto}/${t.parcelas}x ${t.bandeira} ${t.dataCaptura?.slice(11,16)}`).join(', '));
}
process.exit(0);
