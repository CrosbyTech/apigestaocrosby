// Import 78k+ transações da planilha "Crescimento 24x25.xlsx" → faturamento_transacao_historico
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import supabase from '../config/supabase.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const jsonPath = path.join(__dirname, '.faturamento-transacoes-import.json');

if (!fs.existsSync(jsonPath)) {
  console.error('❌ JSON não encontrado:', jsonPath);
  process.exit(1);
}
const rows = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
console.log(`📥 ${rows.length} transações pra importar`);

// Limpa tabela antes (re-import full)
console.log('🗑️ Limpando tabela…');
const { error: delErr } = await supabase
  .from('faturamento_transacao_historico')
  .delete()
  .gte('id', 0);
if (delErr) {
  console.error('Erro ao limpar:', delErr.message);
  process.exit(1);
}

const now = new Date().toISOString();
const enriched = rows.map((r) => ({ ...r, origem: 'planilha-import', atualizado_em: now }));

const CHUNK = 500;
let salvos = 0;
const t0 = Date.now();
for (let i = 0; i < enriched.length; i += CHUNK) {
  const chunk = enriched.slice(i, i + CHUNK);
  const { error } = await supabase
    .from('faturamento_transacao_historico')
    .insert(chunk);
  if (error) {
    console.error(`\n❌ Erro chunk ${i}-${i + chunk.length}:`, error.message);
    process.exit(1);
  }
  salvos += chunk.length;
  const pct = Math.round((salvos / enriched.length) * 100);
  process.stdout.write(`\r   [${pct}%] ${salvos}/${enriched.length}      `);
}
const sec = ((Date.now() - t0) / 1000).toFixed(0);
console.log(`\n\n✅ ${salvos} transações importadas em ${sec}s`);
process.exit(0);
