-- Adiciona chave única (nf_uid) pra dedup do sync diário, e campos extras
-- pra rastrear origem (branch_code, operation_code, invoice_code).
ALTER TABLE faturamento_transacao_historico
  ADD COLUMN IF NOT EXISTS nf_uid TEXT,
  ADD COLUMN IF NOT EXISTS branch_code INTEGER,
  ADD COLUMN IF NOT EXISTS invoice_code TEXT,
  ADD COLUMN IF NOT EXISTS operation_code INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS uq_fth_nf_uid
  ON faturamento_transacao_historico (nf_uid)
  WHERE nf_uid IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_fth_branch
  ON faturamento_transacao_historico (branch_code);
