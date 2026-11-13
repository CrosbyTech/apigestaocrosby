// Cria as tabelas do RECEBIMENTO DE MERCADORIA + ESTOQUE DAS LOJAS (migrations/hc_estoque_recebimento.sql).
// Só acréscimos (CREATE … IF NOT EXISTS): pode rodar de novo.
// Rodar uma vez, na raiz do repositório:  node scripts/migrar-hc-estoque-recebimento.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import supabase from '../config/supabase.js';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const sql = fs.readFileSync(path.join(aqui, '..', 'migrations', 'hc_estoque_recebimento.sql'), 'utf8');

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
await new Promise((r) => setTimeout(r, 3000));
const confere = await Promise.all(
  ['hc_recebimentos_transferencia', 'hc_estoque_movimentos', 'hc_estoque_epcs'].map(async (t) => {
    const { error } = await supabase.from(t).select('*').limit(1);
    return `${t}: ${error ? error.message : 'ok'}`;
  }),
);
console.log(`
${confere.join(' · ')}`);
console.log(!falhas && confere.every((c) => c.endsWith('ok')) ? 'PRONTO: tabelas do recebimento e do estoque criadas.' : 'TERMINOU COM ERRO: rode de novo (a conexão pode ter caído).');
process.exit(0);
