// Runner de migrations versionadas do ERP HeadCoach.
//
//   node scripts/erp-migrate.mjs            aplica as pendentes de migrations/erp/*.sql
//   node scripts/erp-migrate.mjs --status   só lista o que está aplicado/pendente
//   node scripts/erp-migrate.mjs --force 0001_fase0_base   reaplica uma migration
//
// Cada arquivo roda inteiro numa chamada da RPC exec_sql (Supabase principal) e
// fica registrado em schema_migrations com o checksum. Os SQLs devem ser
// idempotentes (CREATE IF NOT EXISTS / DO $$ ... $$), porque uma falha no meio
// não faz rollback automático.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const { default: supabase } = await import('../config/supabase.js');
const { aplicarMigrations, statusMigrations } = await import('../services/erp/migrations.js');

const args = process.argv.slice(2);
const onlyStatus = args.includes('--status');
const forceIdx = args.indexOf('--force');
const force = forceIdx >= 0 ? args[forceIdx + 1] : null;

const dir = path.resolve(__dirname, '..', 'migrations', 'erp');

if (onlyStatus) {
  const st = await statusMigrations(supabase, dir);
  for (const m of st) {
    console.log(`${m.aplicada ? '✅' : '⏳'} ${m.name}${m.aplicada ? `  (${m.applied_at})` : ''}${m.checksumDiferente ? '  ⚠ checksum mudou' : ''}`);
  }
  process.exit(0);
}

const res = await aplicarMigrations(supabase, dir, { force, log: console.log });
if (res.erros.length) {
  console.error('❌ Falhas:', res.erros);
  process.exit(1);
}
console.log(`OK — ${res.aplicadas.length} aplicada(s), ${res.puladas.length} já estavam.`);
process.exit(0);
