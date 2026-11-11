import 'dotenv/config';
import fs from 'fs';
import { parseArquivoStone, obterDiaStone } from '../../services/stoneConciliacao.js';
import { getLojaByStonecode } from '../../config/stoneConciliacao.js';
const d = parseArquivoStone(fs.readFileSync(process.argv[2], 'utf8'), '20261016');
const cfg = getLojaByStonecode('579299624');
const cache = await obterDiaStone(cfg, '2026-10-16'); // versão antiga (XML) no cache
const resumo = (x) => ({ tx: x.transacoes.length, pag: x.pagamentos.length, liq: x.liquidacoes.length, bruto: x.transacoes.reduce((s,t)=>s+t.valorBruto,0).toFixed(2), pagTot: x.pagamentos.reduce((s,p)=>s+p.valorTotal,0).toFixed(2), trailer: x.trailer, h: x.header });
console.log('JSON ', JSON.stringify(resumo(d)));
console.log('CACHE', JSON.stringify(resumo(cache)));
const a = d.transacoes[0], b = cache.transacoes.find(t => t.nsu === a.nsu);
for (const k of Object.keys(b)) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) console.log('dif', k, JSON.stringify(a[k]).slice(0,120), '|', JSON.stringify(b[k]).slice(0,120));
const pa = d.pagamentos[0], pb = cache.pagamentos.find(p => p.id === pa.id);
for (const k of Object.keys(pb)) if (JSON.stringify(pa[k]) !== JSON.stringify(pb[k])) console.log('difPag', k, pa[k], pb[k]);
process.exit(0);
