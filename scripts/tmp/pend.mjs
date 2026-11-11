import 'dotenv/config';
import { saidasPendentes } from '../../services/tarifasConciliacao.js';
const t0 = Date.now();
const it = await saidasPendentes({ de: '2026-10-01', ate: '2026-10-31' });
console.log('pendentes', it.length, 'elegiveis', it.filter((i) => i.elegivel).length, 'ms', Date.now() - t0);
const porBanco = {}; for (const i of it.filter(x => x.elegivel)) porBanco[i.banco] = (porBanco[i.banco] || 0) + 1; console.log(porBanco);
const bloq = {}; for (const i of it.filter(x => !x.elegivel)) bloq[i.motivoBloqueio] = (bloq[i.motivoBloqueio] || 0) + 1; console.log(bloq);
const formas = {}; for (const i of it.filter(x => x.elegivel)) formas[i.forma] = (formas[i.forma] || 0) + 1; console.log(formas);
for (const y of it.filter((x) => x.elegivel && !/TARIFA/.test(x.forma)).slice(0, 15)) { const i = y; console.log(' ', i.empresa, i.banco, i.data, i.valor, i.forma, '|', i.descricao, '|', i.contraparte); }
process.exit(0);
