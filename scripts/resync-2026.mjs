// Re-sincroniza 2026 incluindo NFs de devolução (Input) como credev.
// Apaga as linhas atuais de origem='totvs-sync' e recria.
import supabase from '../config/supabase.js';
import { executarSyncTransacao } from '../jobs/transacao-historico-sync.job.js';

console.log('🗑️  Apagando linhas atuais de origem=totvs-sync…');
const { count: antes } = await supabase
  .from('faturamento_transacao_historico')
  .select('*', { count: 'exact', head: true })
  .eq('origem', 'totvs-sync');
console.log(`   ${antes} linhas pra apagar`);

const { error: delErr } = await supabase
  .from('faturamento_transacao_historico')
  .delete()
  .eq('origem', 'totvs-sync');
if (delErr) { console.error(delErr); process.exit(1); }
console.log('   ✓ Apagadas');

// Re-sync mês a mês de 2026
const meses = [
  ['2026-01-01', '2026-01-31'],
  ['2026-02-01', '2026-02-28'],
  ['2026-03-01', '2026-03-31'],
  ['2026-04-01', '2026-04-30'],
  ['2026-05-01', '2026-05-31'],
  ['2026-06-01', new Date().toISOString().slice(0, 10)],
];
const t0 = Date.now();
let totalLidos = 0, totalIns = 0, totalIgn = 0;
for (const [dmin, dmax] of meses) {
  process.stdout.write(`${dmin} → ${dmax} … `);
  const r = await executarSyncTransacao({ datemin: dmin, datemax: dmax });
  if (!r.ok) { console.log(`❌ ${r.erro}`); continue; }
  console.log(`✓ lidos=${r.lidos_notas_fiscais} inseridos=${r.inseridos_ou_atualizados} ignorados=${r.ignorados}`);
  totalLidos += r.lidos_notas_fiscais;
  totalIns += r.inseridos_ou_atualizados;
  totalIgn += r.ignorados;
}
const sec = ((Date.now() - t0) / 1000).toFixed(0);
console.log(`\n✅ Re-sync concluído em ${sec}s`);
console.log(`   Lidos: ${totalLidos.toLocaleString('pt-BR')}`);
console.log(`   Inseridos: ${totalIns.toLocaleString('pt-BR')}`);
console.log(`   Ignorados: ${totalIgn.toLocaleString('pt-BR')}`);
process.exit(0);
