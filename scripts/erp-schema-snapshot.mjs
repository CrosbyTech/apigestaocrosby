// Snapshot do schema do Supabase principal para o git (docs/schema/).
//
//   node scripts/erp-schema-snapshot.mjs
//
// Gera docs/schema/schema.json (tabelas, colunas, chaves, índices, RLS,
// policies, funções) e docs/schema/TABELAS.md (resumo legível). Substitui o
// pg_dump --schema-only, que não dá para rodar sem a connection string direta.
// Só LÊ information_schema/pg_catalog pela RPC exec_sql.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });
const { default: supabase } = await import('../config/supabase.js');
const { gerarSnapshotSchema } = await import('../services/erp/schemaSnapshot.js');

const outDir = path.resolve(__dirname, '..', 'docs', 'schema');
fs.mkdirSync(outDir, { recursive: true });

const snap = await gerarSnapshotSchema(supabase);
fs.writeFileSync(path.join(outDir, 'schema.json'), JSON.stringify(snap, null, 2));
fs.writeFileSync(path.join(outDir, 'TABELAS.md'), snap.markdown);
console.log(`OK — ${snap.tabelas.length} tabelas, ${snap.funcoes.length} funções → docs/schema/`);
process.exit(0);
