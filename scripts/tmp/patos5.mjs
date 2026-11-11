import 'dotenv/config';
import { buscarTitulosCartaoStone } from '../../services/totvsCartoesStone.js';
const r = await buscarTitulosCartaoStone({ branchCodes: [94], inicioIso: '2026-10-01', fimIso: '2026-10-31' });
const arr = Array.isArray(r) ? r : r.titulos || r.items || [];
console.log('qtd', arr.length);
for (const t of arr.filter(t => [195372, 195121, 195367].includes(Number(t.titulo)))) console.log(JSON.stringify(t).slice(0, 400));
process.exit(0);
