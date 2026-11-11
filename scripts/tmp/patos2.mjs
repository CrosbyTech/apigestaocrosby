import 'dotenv/config';
import { STONE_LOJAS, stonecodesDaLoja } from '../../config/stoneConciliacao.js';
import { obterDiaStone, rangeDatasIso } from '../../services/stoneConciliacao.js';
const alvo = [178.00, 102.10, 53.40];
// procura em TODAS as lojas com chave (pode ter passado em outra maquininha)
for (const l of STONE_LOJAS.filter(l => l.apiKey && l.stonecode)) for (const sc of stonecodesDaLoja(l)) for (const d of rangeDatasIso('2026-10-22', '2026-10-29')) {
  try {
    const dia = await obterDiaStone({ ...l, stonecode: sc }, d);
    for (const t of dia.transacoes) if (alvo.some(v => Math.abs(t.valorBruto - v) < 0.005)) console.log(l.nome, sc, d, t.nsu, t.dataCaptura, t.bandeira, t.tipoConta, t.parcelas, t.valorBruto, t.codAutorizacao, t.cancelada ? 'CANCELADA' : '');
  } catch (e) { console.log(l.nome, sc, d, 'erro', e.message); }
}
process.exit(0);
