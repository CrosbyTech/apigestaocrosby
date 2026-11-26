// Cria as colunas do "PRONTO PRA FATURAR" (migrations/pedidos_venda_pronto_faturar.sql)
// em pedidos_venda_dryland e pedidos_venda_fila. Só acréscimos (ADD COLUMN IF NOT
// EXISTS): pode rodar de novo. Rodar na raiz do repositório:
//   node scripts/migrar-pedidos-venda-pronto.mjs
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import supabase from '../config/supabase.js';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const sql = fs.readFileSync(path.join(aqui, '..', 'migrations', 'pedidos_venda_pronto_faturar.sql'), 'utf8');
const comandos = sql
  .split('\n')
  .filter((l) => !l.trim().startsWith('--'))
  .join('\n')
  .split(';')
  .map((c) => c.trim())
  .filter(Boolean);

let falhas = 0;
for (const q of comandos) {
  const { data, error } = await supabase.rpc('exec_sql', { query: q });
  // o exec_sql devolve o erro do banco dentro de data
  const erro = error?.message || (data && typeof data === 'object' && (data.error || data.erro)) || (typeof data === 'string' && /error|erro/i.test(data) ? data : null);
  if (erro) falhas += 1;
  console.log(erro ? `ERRO ${erro}` : 'ok  ', q.replace(/\s+/g, ' ').slice(0, 110));
}
await new Promise((r) => setTimeout(r, 3000));
const confere = await Promise.all([
  supabase.from('pedidos_venda_dryland').select('ref, aguardando_pronto, aguardando_pronto_desde, aguardando_pronto_info, pronto_liberado_em').limit(1),
  supabase.from('pedidos_venda_fila').select('id, pronto_faturar_em, pronto_faturar_por').limit(1),
]);
const erros = confere.map((c) => c.error?.message).filter(Boolean);
console.log(erros.length ? `colunas ainda não visíveis: ${erros.join(' · ')}` : 'colunas conferidas nas duas tabelas');
const ok = !falhas && !erros.length;
console.log(ok ? 'PRONTO: colunas do "pronto pra faturar" criadas.' : 'TERMINOU COM ERRO: rode de novo (o cache do banco pode demorar alguns segundos).');
setTimeout(() => process.exit(ok ? 0 : 1), 300);
