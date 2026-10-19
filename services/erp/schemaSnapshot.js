// Lê o schema public do Supabase pela função erp_schema_snapshot()
// (migrations/erp/0003) e monta um snapshot versionável: JSON + markdown.
export async function gerarSnapshotSchema(supabase) {
  const { data, error } = await supabase.rpc('erp_schema_snapshot');
  if (error) throw new Error(`erp_schema_snapshot(): ${error.message} — rode as migrations (node scripts/erp-migrate.mjs)`);
  const snap = typeof data === 'string' ? JSON.parse(data) : data;
  const lista = snap?.tabelas || [];
  const funcoes = snap?.funcoes || [];

  const md = [];
  md.push('# Schema do Supabase principal (public)');
  md.push('');
  md.push(`Gerado por \`node scripts/erp-schema-snapshot.mjs\` em ${new Date().toISOString()}. ${lista.length} tabelas/views, ${funcoes.length} funções.`);
  md.push('');
  md.push('| Tabela | Tipo | RLS | Policies | Colunas | Linhas (est.) |');
  md.push('|---|---|---|---|---|---|');
  for (const t of lista) {
    md.push(`| ${t.tabela} | ${t.kind === 'r' ? 'tabela' : t.kind === 'v' ? 'view' : 'mat.view'} | ${t.rls ? 'sim' : 'não'} | ${t.policies.length} | ${t.colunas.length} | ${t.linhas_estimadas ?? ''} |`);
  }
  md.push('');
  for (const t of lista) {
    md.push(`## ${t.tabela}`);
    md.push('');
    md.push('| Coluna | Tipo | Nulo | Padrão |');
    md.push('|---|---|---|---|');
    for (const c of t.colunas) md.push(`| ${c.coluna} | ${c.tipo} | ${c.nulo ? 'sim' : 'não'} | ${c.padrao ? '`' + String(c.padrao).replace(/\|/g, '\\|') + '`' : ''} |`);
    if (t.constraints.length) {
      md.push('');
      md.push('Constraints: ' + t.constraints.map((c) => `\`${c.nome}\` ${c.definicao}`).join('; '));
    }
    if (t.indices.length) {
      md.push('');
      md.push('Índices: ' + t.indices.map((i) => `\`${i.nome}\``).join(', '));
    }
    if (t.policies.length) {
      md.push('');
      md.push('Policies: ' + t.policies.map((p) => `\`${p.nome}\` (${p.cmd} → ${p.roles})`).join('; '));
    }
    md.push('');
  }
  md.push('## Funções');
  md.push('');
  for (const f of funcoes) md.push(`- \`${f.nome}(${f.argumentos})\` → ${f.retorno} (${f.linguagem})`);
  md.push('');

  return { geradoEm: snap?.gerado_em || new Date().toISOString(), tabelas: lista, funcoes, markdown: md.join('\n') };
}
