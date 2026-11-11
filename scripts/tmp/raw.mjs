import 'dotenv/config';
import { getLojaByStonecode } from '../../config/stoneConciliacao.js';
import { _internals, parseArquivoStone } from '../../services/stoneConciliacao.js';
const cfg = getLojaByStonecode('579299624');
const xml = await _internals.baixarXml(cfg, '20261015');
console.log('len', xml.length); console.log(xml.slice(0, 900));
const d = parseArquivoStone(xml, '20261015');
console.log('tx', d.transacoes.length, 'pag', d.pagamentos.length, JSON.stringify(d.trailer));
process.exit(0);
