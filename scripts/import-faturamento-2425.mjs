// Import histórico de 2024+2025 da planilha "Crescimento 24x25.xlsx"
// para faturamento_diario_canal.
//
//   node scripts/import-faturamento-2425.mjs
//
// Lê o JSON pré-agregado em scripts/.faturamento-2425-import.json
// (gerado por: Python lê xlsx → agrega por data×canal → escreve JSON)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import supabase from '../config/supabase.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const jsonPath = path.join(__dirname, '.faturamento-2425-import.json');

if (!fs.existsSync(jsonPath)) {
  console.error('❌ JSON não encontrado:', jsonPath);
  console.error('   Rode primeiro o agregador Python que gera esse arquivo.');
  process.exit(1);
}

const rows = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
console.log(`📥 ${rows.length} linhas a importar (planilha xlsx → faturamento_diario_canal)`);

// Enriquecer com metadados
const now = new Date().toISOString();
const enriched = rows.map((r) => ({
  data: r.data,
  canal: r.canal,
  valor_bruto: Number(r.valor_bruto || 0),
  credev: Number(r.credev || 0),
  valor: Number(r.valor),
  origem: 'manual',
  observacao: 'Importado de Crescimento 24x25.xlsx',
  atualizado_em: now,
  atualizado_por: 'import-script',
}));

// Resumo antes
const porAno = {};
for (const r of enriched) {
  const ano = r.data.slice(0, 4);
  if (!porAno[ano]) porAno[ano] = { linhas: 0, total: 0 };
  porAno[ano].linhas += 1;
  porAno[ano].total += r.valor;
}
console.log('\n📊 Distribuição:');
for (const [ano, v] of Object.entries(porAno)) {
  console.log(`   ${ano}: ${v.linhas} linhas · R$ ${v.total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`);
}

// Upsert em chunks de 500
const CHUNK = 500;
let salvos = 0;
console.log('\n⏳ Upsertando…');
for (let i = 0; i < enriched.length; i += CHUNK) {
  const chunk = enriched.slice(i, i + CHUNK);
  const { error } = await supabase
    .from('faturamento_diario_canal')
    .upsert(chunk, { onConflict: 'data,canal' });
  if (error) {
    console.error(`❌ Erro no chunk ${i}-${i + chunk.length}:`, error.message);
    process.exit(1);
  }
  salvos += chunk.length;
  process.stdout.write(`\r   ${salvos}/${enriched.length}`);
}

console.log(`\n\n✅ ${salvos} linhas importadas com sucesso.`);
process.exit(0);
