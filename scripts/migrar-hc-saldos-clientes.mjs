// Cria as tabelas do HEADCOACH › SALDOS DE CLIENTES — CREDEV e adiantamento (migrations/hc_saldos_clientes.sql).
// Só acréscimos (CREATE … IF NOT EXISTS): pode rodar de novo.
// Rodar uma vez, na raiz do repositório:  node scripts/migrar-hc-saldos-clientes.mjs
// Carga inicial (só leitura no TOTVS): clientes com CREDEV/adiantamento na empresa 99 em 2026, com o saldo de agora:
//   node scripts/migrar-hc-saldos-clientes.mjs --carregar
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import supabase from '../config/supabase.js';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const sql = fs.readFileSync(path.join(aqui, '..', 'migrations', 'hc_saldos_clientes.sql'), 'utf8');

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
  ['hc_cliente_saldos', 'hc_cliente_saldos_mov'].map(async (t) => {
    const { error } = await supabase.from(t).select('*').limit(1);
    return `${t}: ${error ? error.message : 'ok'}`;
  }),
);
console.log(`
${confere.join(' · ')}`);
const ok = !falhas && confere.every((c) => c.endsWith('ok'));
console.log(ok ? 'PRONTO: tabelas de saldos (CREDEV/adiantamento) criadas.' : 'TERMINOU COM ERRO: rode de novo (a conexão pode ter caído).');
if (ok && process.argv.includes('--carregar')) {
  const { carregarDoTotvs } = await import('../services/hcSaldosClientes.js');
  const r = await carregarDoTotvs({ empresa: 99, ano: 2026 });
  const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  console.log(`
CARGA: ${r.clientes} cliente(s) com CREDEV/adiantamento na 99 em 2026 · ${r.comSaldo} com saldo hoje`);
  console.log(`  carregados agora: ${r.carregados} saldo(s) — CREDEV ${brl(r.credev)} · adiantamento ${brl(r.adiantamento)}`);
  console.log(`  já estavam carregados: ${r.jaCarregados} · zerados (entram com saldo 0): ${r.zerados} · erros: ${r.erros.length}`);
  for (const e of r.erros.slice(0, 20)) console.log(`  cliente ${e.cliente} ${e.tipo}: ${e.erro}`);
}
process.exit(0);
