import supabase from '../config/supabase.js';
import { executarSyncTransacao } from '../jobs/transacao-historico-sync.job.js';

console.log('🗑️  Apagando linhas canal=outros…');
const { count: antes } = await supabase
  .from('faturamento_transacao_historico')
  .select('*', { count: 'exact', head: true })
  .eq('canal', 'outros');
console.log(`   ${antes?.toLocaleString('pt-BR')} linhas a apagar`);

const { error } = await supabase
  .from('faturamento_transacao_historico')
  .delete()
  .eq('canal', 'outros');
if (error) { console.error(error); process.exit(1); }
console.log('   ✓ Apagadas');

// Re-sync 2026 (vai ignorar transferências automaticamente agora)
console.log('\n📥 Re-sync 2026 (ignorando transferências)…');
const meses = [
  ['2026-01-01', '2026-01-31'],
  ['2026-02-01', '2026-02-28'],
  ['2026-03-01', '2026-03-31'],
  ['2026-04-01', '2026-04-30'],
  ['2026-05-01', '2026-05-31'],
  ['2026-06-01', new Date().toISOString().slice(0, 10)],
];
let totalLidos = 0, totalIns = 0, totalIgn = 0;
const t0 = Date.now();
for (const [dmin, dmax] of meses) {
  process.stdout.write(`${dmin} → ${dmax} … `);
  const r = await executarSyncTransacao({ datemin: dmin, datemax: dmax });
  console.log(`✓ lidos=${r.lidos_notas_fiscais} inseridos=${r.inseridos_ou_atualizados} ignorados=${r.ignorados}`);
  totalLidos += r.lidos_notas_fiscais;
  totalIns += r.inseridos_ou_atualizados;
  totalIgn += r.ignorados;
}
const sec = ((Date.now() - t0) / 1000).toFixed(0);
console.log(`\n✅ Concluído em ${sec}s`);
console.log(`   Lidos: ${totalLidos.toLocaleString('pt-BR')}`);
console.log(`   Inseridos/atualizados: ${totalIns.toLocaleString('pt-BR')}`);
console.log(`   Ignorados: ${totalIgn.toLocaleString('pt-BR')}`);
process.exit(0);
