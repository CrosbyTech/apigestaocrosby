// Roda getExclusoesPorCanal direto pra ver se calcula
import 'dotenv/config';
import { getExclusoesPorCanal } from './services/forecastExclusoes.js';
const r = await getExclusoesPorCanal('2026-06-01', '2026-06-15');
console.log('Exclusões por canal (2026-06-01 → 2026-06-15):');
for (const [k, v] of r.entries()) console.log(`  ${k}: R$ ${v.toFixed(2)}`);
process.exit(0);
