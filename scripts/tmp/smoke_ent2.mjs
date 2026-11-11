import 'dotenv/config';
import { entradasPendentes } from '../../services/tarifasConciliacao.js';
const it = await entradasPendentes({ de: '2026-10-01', ate: '2026-10-31' });
const m = new Map();
for (const i of it) { const k = `${i.contaId} ${i.banco} ${i.conta} | ${i.empresa}`; const x = m.get(k) || [0,0]; x[0]++; x[1]+=i.valor; m.set(k,x); }
for (const [k,[q,v]] of [...m].sort((a,b)=>b[1][0]-a[1][0])) console.log(q, v.toFixed(2), k);
process.exit(0);
