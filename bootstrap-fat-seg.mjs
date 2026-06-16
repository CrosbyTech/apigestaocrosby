import { executarCacheCanalTotals } from './jobs/canal-totals-cache.job.js';
console.log('▶ bootstrap via fat-seg —', new Date().toISOString());
await executarCacheCanalTotals();
console.log('✅ ok');
process.exit(0);
