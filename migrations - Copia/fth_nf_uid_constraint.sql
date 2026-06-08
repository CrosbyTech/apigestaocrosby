-- Substitui o partial index por uma constraint UNIQUE real (ON CONFLICT precisa)
DROP INDEX IF EXISTS uq_fth_nf_uid;
ALTER TABLE faturamento_transacao_historico
  DROP CONSTRAINT IF EXISTS uq_fth_nf_uid;
ALTER TABLE faturamento_transacao_historico
  ADD CONSTRAINT uq_fth_nf_uid UNIQUE (nf_uid);
