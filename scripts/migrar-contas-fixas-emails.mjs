// Cria a tabela dos e-mails das despesas fixas (migrations/contas_fixas_emails.sql).
// Rodar na raiz da API: node scripts/migrar-contas-fixas-emails.mjs
import 'dotenv/config';
import fs from 'node:fs';
import supabase from '../config/supabase.js';

const sql = fs.readFileSync(new URL('../migrations/contas_fixas_emails.sql', import.meta.url), 'utf8');
const comandos = sql
  .split('\n')
  .filter((l) => !l.trim().startsWith('--'))
  .join('\n')
  .split(';')
  .map((c) => c.trim())
  .filter(Boolean);
for (const c of comandos) {
  const { error } = await supabase.rpc('exec_sql', { query: c });
  console.log(error ? `ERRO ${error.message}` : 'ok  ', c.replace(/\s+/g, ' ').slice(0, 90));
  if (error) process.exit(1);
}
await supabase.rpc('exec_sql', { query: "notify pgrst, 'reload schema'" });
await new Promise((ok) => setTimeout(ok, 2500));
const { error } = await supabase.from('contas_fixas_emails').select('id').limit(1);
console.log(error ? `tabela ainda não visível: ${error.message}` : 'PRONTO: contas_fixas_emails criada.');
process.exit(0);
