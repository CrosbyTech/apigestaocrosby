import 'dotenv/config';
import { buscarTitulosCartaoStone } from '../../services/totvsCartoesStone.js';
const arr = await buscarTitulosCartaoStone({ branchCodes: [94], inicioIso: '2026-10-01', fimIso: '2026-10-31' });
for (const t of arr.filter(t => ['39662398217779','39962453497407'].includes(String(t.nsu)))) console.log(t.chave, t.valor, t.parcelas+'x', t.dataEmissao, t.nsu, t.autorizacao, t.nf, t.transacao);
process.exit(0);
