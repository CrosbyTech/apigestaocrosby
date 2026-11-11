import 'dotenv/config';
import { entradasPendentes } from '../../services/tarifasConciliacao.js';
const it = await entradasPendentes({ de: '2026-10-01', ate: '2026-10-31' });
console.log(it.length, it.reduce((s,i)=>s+i.valor,0).toFixed(2));
console.log(JSON.stringify(it.slice(0,3)));
process.exit(0);
