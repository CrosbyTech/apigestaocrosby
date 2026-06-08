// Backfill de faturamento_diario_canal usando o MESMO endpoint que o Forecast
// alimenta (/api/crm/faturamento-por-segmento).
//
// REQUER backend rodando em INTERNAL_API_BASE (default http://localhost:4100).
//
// Uso:
//   node scripts/backfill-faturamento-historico.mjs 2026-01-01 2026-06-04
//   node scripts/backfill-faturamento-historico.mjs 2026-05-01 2026-05-31
//
// Default (sem args): backfill do 2026-01-01 até ONTEM.
import { popularRangeFaturamento } from '../jobs/faturamento-historico.job.js';

const args = process.argv.slice(2);
let datemin = args[0];
let datemax = args[1];

if (!datemin || !datemax) {
  const hoje = new Date();
  const ontem = new Date(hoje);
  ontem.setUTCDate(ontem.getUTCDate() - 1);
  datemin = datemin || '2026-01-01';
  datemax = datemax || ontem.toISOString().slice(0, 10);
}

console.log(`\n📥 Backfill: ${datemin} → ${datemax}`);
console.log(`   Origem: /api/crm/faturamento-por-segmento (mesma fonte do Forecast)`);
console.log(`   Pode levar 5-30 minutos dependendo do range.\n`);

const t0 = Date.now();
const r = await popularRangeFaturamento({
  datemin,
  datemax,
  origem: 'manual-backfill',
  gapMs: 500, // 0.5s entre chamadas
  onProgress: ({ idx, total, day, result }) => {
    const pct = Math.round((idx / total) * 100);
    process.stdout.write(
      `\r   [${pct}%] ${idx}/${total}  ${day}  ` +
      `${result.canais_salvos} canais  R$ ${result.total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}      `,
    );
  },
});
const sec = ((Date.now() - t0) / 1000).toFixed(0);

console.log(`\n\n✅ Backfill concluído em ${sec}s`);
console.log(`   Dias processados: ${r.processados}`);
console.log(`   Linhas (data×canal) salvas: ${r.salvos}`);
if (r.erros.length) {
  console.log(`\n⚠️ ${r.erros.length} dia(s) com erro:`);
  for (const e of r.erros.slice(0, 10)) {
    console.log(`   ${e.day}: ${e.motivo}`);
  }
}
process.exit(0);
