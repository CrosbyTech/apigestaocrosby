// Popula APENAS a instância "drygor" no banco UAzapi.
// Uso: node backend/_run_uazapi_sync_drygor.mjs
import { runUazapiSync } from './services/uazapiSync.js';

const t0 = Date.now();
console.log('▶️  Sync UAzapi — apenas instância "drygor"...');
try {
  const r = await runUazapiSync({
    triggeredBy: 'manual-drygor',
    onlyInstance: 'drygor',
  });
  console.log(`\n✅ Sync concluído em ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  console.log(JSON.stringify(r, null, 2));
} catch (e) {
  console.error(`\n❌ Sync falhou:`, e.message);
  console.error(e.stack);
  process.exit(1);
}
process.exit(0);
