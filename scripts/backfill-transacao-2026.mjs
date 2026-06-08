// Backfill da `faturamento_transacao_historico` a partir da última data
// da planilha (2025-12-31) até HOJE. Roda em chunks mensais pra log claro
// e pra evitar timeout. Reusa o helper do job de sync (NÃO chama TOTVS).
import { executarSyncTransacao } from '../jobs/transacao-historico-sync.job.js';
import supabase from '../config/supabase.js';

// Detecta última data carregada (qualquer origem)
const { data, error } = await supabase
  .from('faturamento_transacao_historico')
  .select('data_transacao')
  .order('data_transacao', { ascending: false })
  .limit(1);
if (error) { console.error(error); process.exit(1); }
const ultimaIso = data?.[0]?.data_transacao || '2025-12-31';

// Começa no dia seguinte à última data
const startDate = new Date(ultimaIso + 'T00:00:00Z');
startDate.setUTCDate(startDate.getUTCDate() + 1);
const endDate = new Date();
const hojeIso = endDate.toISOString().slice(0, 10);

if (startDate > endDate) {
  console.log(`✓ Já está atualizado (última: ${ultimaIso}, hoje: ${hojeIso})`);
  process.exit(0);
}

console.log(`\n📥 Backfill: ${startDate.toISOString().slice(0, 10)} → ${hojeIso}`);
console.log(`   Última data atual no banco: ${ultimaIso}\n`);

// Chunks mensais
const chunks = [];
let cur = new Date(startDate);
while (cur <= endDate) {
  const ano = cur.getUTCFullYear();
  const mes = cur.getUTCMonth();
  const inicioMes = new Date(Date.UTC(ano, mes, 1));
  const fimMes = new Date(Date.UTC(ano, mes + 1, 0));
  const dmin = cur > inicioMes ? cur : inicioMes;
  const dmax = endDate < fimMes ? endDate : fimMes;
  chunks.push({
    datemin: dmin.toISOString().slice(0, 10),
    datemax: dmax.toISOString().slice(0, 10),
  });
  cur = new Date(fimMes);
  cur.setUTCDate(cur.getUTCDate() + 1);
}

const t0 = Date.now();
let totalInseridos = 0, totalLidos = 0, totalIgnorados = 0;
for (let i = 0; i < chunks.length; i++) {
  const { datemin, datemax } = chunks[i];
  process.stdout.write(`[${i + 1}/${chunks.length}] ${datemin} → ${datemax} … `);
  const r = await executarSyncTransacao({ datemin, datemax });
  if (!r.ok) {
    console.log(`❌ ${r.erro}`);
    continue;
  }
  console.log(
    `✓ lidos=${r.lidos_notas_fiscais} inseridos=${r.inseridos_ou_atualizados} ignorados=${r.ignorados}`,
  );
  totalInseridos += r.inseridos_ou_atualizados;
  totalLidos += r.lidos_notas_fiscais;
  totalIgnorados += r.ignorados;
}

const sec = ((Date.now() - t0) / 1000).toFixed(0);
console.log(`\n✅ Backfill concluído em ${sec}s`);
console.log(`   Total lidos da notas_fiscais: ${totalLidos.toLocaleString('pt-BR')}`);
console.log(`   Inseridos/atualizados:        ${totalInseridos.toLocaleString('pt-BR')}`);
console.log(`   Ignorados (cancelados/etc):   ${totalIgnorados.toLocaleString('pt-BR')}`);
process.exit(0);
