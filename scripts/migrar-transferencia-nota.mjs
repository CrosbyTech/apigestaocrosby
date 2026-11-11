// Colunas novas (só acréscimos) para a TRANSFERÊNCIA COM NOTA PELO HEADCOACH.
// São as mesmas do fim de migrations/transferencias_mercadoria.sql.
// Rodar uma vez, na raiz do repositório:  node scripts/migrar-transferencia-nota.mjs
import supabase from '../config/supabase.js';

const comandos = [
  // a transação do TOTVS (990) só existe depois da nota: o número pode ficar vazio
  'ALTER TABLE transferencias_transacoes ALTER COLUMN transacao_code DROP NOT NULL',
  'ALTER TABLE transferencias_transacoes ADD COLUMN IF NOT EXISTS venda_id BIGINT',
  'ALTER TABLE transferencias_transacoes ADD COLUMN IF NOT EXISTS empresa_totvs INT',
  'ALTER TABLE transferencias_transacoes ADD COLUMN IF NOT EXISTS natureza TEXT',
  'ALTER TABLE transferencias_transacoes ADD COLUMN IF NOT EXISTS nota_id BIGINT',
  'ALTER TABLE transferencias_transacoes ADD COLUMN IF NOT EXISTS nf_numero INT',
  'ALTER TABLE transferencias_transacoes ADD COLUMN IF NOT EXISTS nf_serie TEXT',
  'ALTER TABLE transferencias_transacoes ADD COLUMN IF NOT EXISTS nf_chave TEXT',
  'ALTER TABLE transferencias_transacoes ADD COLUMN IF NOT EXISTS nf_status TEXT',
  'ALTER TABLE transferencias_transacoes ADD COLUMN IF NOT EXISTS totvs_erro TEXT',
  'ALTER TABLE transferencias_transacoes ADD COLUMN IF NOT EXISTS qtd_faltando INT NOT NULL DEFAULT 0',
  'ALTER TABLE transferencias_transacoes ADD COLUMN IF NOT EXISTS qtd_sobrando INT NOT NULL DEFAULT 0',
  'CREATE UNIQUE INDEX IF NOT EXISTS uq_transf_trx_venda ON transferencias_transacoes (venda_id) WHERE venda_id IS NOT NULL',
  'ALTER TABLE transferencias_mercadoria ADD COLUMN IF NOT EXISTS venda_id BIGINT',
  'ALTER TABLE transferencias_mercadoria ADD COLUMN IF NOT EXISTS nf_numero INT',
  'ALTER TABLE transferencias_mercadoria ADD COLUMN IF NOT EXISTS nf_chave TEXT',
  "NOTIFY pgrst, 'reload schema'",
];

let falhas = 0;
for (const q of comandos) {
  const { error } = await supabase.rpc('exec_sql', { query: q });
  if (error) falhas += 1;
  console.log(error ? `ERRO ${error.message}` : 'ok  ', q.slice(0, 100));
}
await new Promise((r) => setTimeout(r, 3000));
const a = await supabase.from('transferencias_transacoes').select('id, venda_id, empresa_totvs, natureza, nf_numero, nf_status, totvs_erro, qtd_faltando').limit(1);
const b = await supabase.from('transferencias_mercadoria').select('id, venda_id, nf_numero, nf_chave').limit(1);
console.log(`\ntransferencias_transacoes: ${a.error?.message || 'ok'} · transferencias_mercadoria: ${b.error?.message || 'ok'}`);
console.log(falhas || a.error || b.error ? 'TERMINOU COM ERRO: rode de novo (a conexão pode ter caído).' : 'PRONTO: colunas criadas.');
process.exit(0);
