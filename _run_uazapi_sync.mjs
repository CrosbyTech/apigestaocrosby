import { runUazapiSync } from './services/uazapiSync.js';
console.log('▶️  Sync manual UAzapi iniciado — recuperando ~5 dias de msgs perdidas...');
const t0 = Date.now();
try {
  const r = await runUazapiSync({ triggeredBy: 'manual-recovery' });
  console.log(`\n✅ Sync concluído em ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  console.log(JSON.stringify(r, null, 2));
} catch (e) {
  console.error(`\n❌ Sync falhou:`, e.message);
  console.error(e.stack);
}
process.exit(0);
