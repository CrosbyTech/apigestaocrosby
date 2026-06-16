// Backfill de faturamento_diario_canal — 2026 inteiro.
// Reprocessa cada dia via popularRangeFaturamento. A função AGORA respeita
// flag `partial` do fat-seg: dias com credev incompleto são PULADOS (não
// sobrescrevem). Gap 3s entre dias pra não martelar TOTVS.
import { popularRangeFaturamento } from './jobs/faturamento-historico.job.js';

const datemin = '2026-01-01';
const hoje = new Date();
const datemax = hoje.toISOString().slice(0, 10);

console.log(`▶ backfill ${datemin} → ${datemax} (gap 3s) — começou ${new Date().toISOString()}`);

let lastReport = Date.now();
const out = await popularRangeFaturamento({
  datemin,
  datemax,
  origem: 'manual-backfill-2026',
  gapMs: 3000,
  onProgress: ({ idx, total, day, result }) => {
    const partial = result?.partial ? ' [PARTIAL — skip]' : '';
    const canais = result?.canais_salvos ?? 0;
    // Log a cada 5 dias OU a cada 30s pra acompanhar sem floodar
    if (idx % 5 === 0 || Date.now() - lastReport > 30000) {
      console.log(`[${String(idx).padStart(3)}/${total}] ${day}: ${canais} canais salvos${partial}`);
      lastReport = Date.now();
    }
  },
});

console.log(`\n✅ Backfill concluído ${new Date().toISOString()}`);
console.log(`   Dias processados: ${out.processados}`);
console.log(`   Dias salvos: ${out.salvos}`);
console.log(`   Erros: ${out.erros.length}`);
if (out.erros.length > 0) {
  console.log('   Lista de erros:', out.erros.slice(0, 10));
}
