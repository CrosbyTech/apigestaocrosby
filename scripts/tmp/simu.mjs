import 'dotenv/config';
import { getLojaByStonecode, stonecodesDaLoja } from '../../config/stoneConciliacao.js';
import { obterDiaStone } from '../../services/stoneConciliacao.js';
import { escolherCartao, numeroFatura, buscarClientePorCodigo } from '../../services/stoneLancarTotvs.js';
const cfg = getLojaByStonecode('579299624');
for (const sc of stonecodesDaLoja(cfg)) for (const d of ['2026-10-15','2026-10-16']) {
  try {
    const dia = await obterDiaStone({ ...cfg, stonecode: sc }, d);
    for (const t of dia.transacoes.filter(t => t.valorBruto <= 0.05)) {
      console.log(sc, d, t.nsu, t.codAutorizacao, t.bandeira, t.tipoConta, t.parcelas, t.valorBruto, t.dataVenda, t.dataArquivo, t.cancelada, 'fatura', numeroFatura(t.nsu));
      console.log('  cartao', JSON.stringify(await escolherCartao(t)));
    }
  } catch (e) { console.log(sc, d, 'erro', e.message); }
}
console.log(await buscarClientePorCodigo(Number(process.argv[2] || 0)));
process.exit(0);
