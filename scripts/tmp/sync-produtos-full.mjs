import 'dotenv/config';
import { executarSync } from '../../services/erp/sync/runner.js';
const t0 = Date.now();
const r = await executarSync('produtos', 'full', { disparadoPor: 'claude:promocoes-busca' });
console.log('FIM', JSON.stringify(r).slice(0, 500), Math.round((Date.now() - t0) / 1000) + 's');
process.exit(0);
