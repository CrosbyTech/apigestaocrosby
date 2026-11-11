import 'dotenv/config';
import { getLojaByStonecode } from '../../config/stoneConciliacao.js';
import { obterDiaStone } from '../../services/stoneConciliacao.js';
import { lancarVendaStone } from '../../services/stoneLancarTotvs.js';
import { buscarClientePorCnpj } from '../../services/bluecardLimite.js';
const cli = await buscarClientePorCnpj('17177680001007');
console.log('cliente filial', cli);
const cfg = getLojaByStonecode('579299624');
const dia = await obterDiaStone(cfg, '2026-10-15');
for (const v of dia.transacoes.filter(t => t.valorBruto <= 0.05)) {
  const r = await lancarVendaStone({ venda: v, loja: { ...cfg, filiais: [99] }, cliente: cli.code, simular: true });
  console.log(JSON.stringify(r, null, 1).slice(0, 1500));
}
process.exit(0);
