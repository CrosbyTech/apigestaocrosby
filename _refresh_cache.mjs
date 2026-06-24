import { executarCacheCanalTotals } from './jobs/canal-totals-cache.job.js';
console.log('🔄 Refresh canal_totals_cache...');
const r = await executarCacheCanalTotals();
console.log('Done:', r);
process.exit(0);
