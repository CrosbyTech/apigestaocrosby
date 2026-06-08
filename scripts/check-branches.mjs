import supabase from '../config/supabase.js';

// Branches que estão na planilha (origem = planilha-import)
const PAGE = 1000;
const branchesPlanilha = new Map();
for (let from = 0; ; from += PAGE) {
  const { data, error } = await supabase
    .from('faturamento_transacao_historico')
    .select('loja')
    .eq('origem', 'planilha-import')
    .range(from, from + PAGE - 1);
  if (error || !data || data.length === 0) break;
  for (const r of data) {
    if (r.loja) branchesPlanilha.set(r.loja, (branchesPlanilha.get(r.loja) || 0) + 1);
  }
  if (data.length < PAGE) break;
}
console.log(`Planilha: ${branchesPlanilha.size} lojas distintas`);
for (const [k, v] of [...branchesPlanilha.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)) {
  console.log(`  ${k.padEnd(35)} ${v.toLocaleString('pt-BR')} NFs`);
}

// Branches que estão no sync (origem = totvs-sync)
const branchCount = new Map();
for (let from = 0; ; from += PAGE) {
  const { data, error } = await supabase
    .from('faturamento_transacao_historico')
    .select('branch_code')
    .eq('origem', 'totvs-sync')
    .range(from, from + PAGE - 1);
  if (error || !data || data.length === 0) break;
  for (const r of data) {
    const k = r.branch_code != null ? Number(r.branch_code) : 'null';
    branchCount.set(k, (branchCount.get(k) || 0) + 1);
  }
  if (data.length < PAGE) break;
}
console.log(`\nSync TOTVS: ${branchCount.size} branch_codes distintos`);
for (const [k, v] of [...branchCount.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  branch_code ${String(k).padEnd(5)} → ${v.toLocaleString('pt-BR')} NFs`);
}
