// Cria as tabelas do HEADCOACH › CONTAS A PAGAR (migrations/hc_contas_pagar.sql).
// Só acréscimos (CREATE … IF NOT EXISTS): pode rodar de novo.
// Rodar uma vez, na raiz do repositório:  node scripts/migrar-hc-contas-pagar.mjs
// Também carrega as despesas (config/despesasContasPagar.json) na tabela hc_cp_despesas.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import supabase from '../config/supabase.js';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const sql = fs.readFileSync(path.join(aqui, '..', 'migrations', 'hc_contas_pagar.sql'), 'utf8');

// separa os comandos por ";" respeitando os blocos $$ … $$ das funções
function comandos(texto) {
  const semComentario = texto
    .split('\n')
    .map((l) => (l.trim().startsWith('--') ? '' : l))
    .join('\n');
  const out = [];
  let atual = '';
  let dentro = false;
  for (let i = 0; i < semComentario.length; i += 1) {
    if (semComentario.startsWith('$$', i)) {
      dentro = !dentro;
      atual += '$$';
      i += 1;
      continue;
    }
    const c = semComentario[i];
    if (c === ';' && !dentro) {
      if (atual.trim()) out.push(atual.trim());
      atual = '';
    } else atual += c;
  }
  if (atual.trim()) out.push(atual.trim());
  return out;
}

let falhas = 0;
for (const q of comandos(sql)) {
  const { error } = await supabase.rpc('exec_sql', { query: q });
  if (error) falhas += 1;
  console.log(error ? `ERRO ${error.message}` : 'ok  ', q.replace(/\s+/g, ' ').slice(0, 100));
}
await supabase.rpc('exec_sql', { query: "notify pgrst, 'reload schema'" });
await new Promise((r) => setTimeout(r, 4000));
const confere = await Promise.all(
  ['hc_cp_despesas', 'hc_cp_centros_custo', 'hc_cp_titulos', 'hc_cp_baixas'].map(async (t) => {
    const { error } = await supabase.from(t).select('*').limit(1);
    return `${t}: ${error ? error.message : 'ok'}`;
  }),
);
console.log(`
${confere.join(' · ')}`);
const ok = !falhas && confere.every((c) => c.endsWith('ok'));
console.log(ok ? 'PRONTO: tabelas do contas a pagar criadas.' : 'TERMINOU COM ERRO: rode de novo (a conexão pode ter caído).');
// despesas: carrega (ou atualiza o nome de) todas as de config/despesasContasPagar.json
if (ok) {
  const mapa = JSON.parse(fs.readFileSync(path.join(aqui, '..', 'config', 'despesasContasPagar.json'), 'utf8'));
  const linhas = Object.entries(mapa).map(([code, nome]) => ({ code: Number(code), nome: String(nome).trim() }));
  const { error } = await supabase.from('hc_cp_despesas').upsert(linhas, { onConflict: 'code' });
  console.log(error ? `ERRO nas despesas: ${error.message}` : `Despesas: ${linhas.length} carregada(s).`);
  // centros de custo: FILIAL/MATRIZ/cidade = empresa; SETOR, agência, tráfego e varejo = setor
  const cc = JSON.parse(fs.readFileSync(path.join(aqui, '..', 'config', 'centrosCustoContasPagar.json'), 'utf8'));
  const tipo = (code, nome) => (Number(code) === 999 ? 'outro' : /^SETOR|AGENCIA|TRAFEGO|^VAREJO$/i.test(nome) ? 'setor' : 'empresa');
  const centros = Object.entries(cc).map(([code, nome]) => ({ code: Number(code), nome: String(nome).trim(), tipo: tipo(code, String(nome).trim()) }));
  const r2 = await supabase.from('hc_cp_centros_custo').upsert(centros, { onConflict: 'code' });
  console.log(r2.error ? `ERRO nos centros de custo: ${r2.error.message}` : `Centros de custo: ${centros.length} carregado(s).`);
}
process.exit(0);
