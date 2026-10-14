-- ============================================================================
-- DEVOLUÇÕES — recebimento via FISFP082 (nota do cliente)
-- Devoluções em que o cliente já emitiu a nota NÃO geram transação no TOTVS:
-- a entrada é feita manualmente no FISFP082. O HeadCoach só confere as peças e
-- registra o recebimento aqui. Por isso:
--   • transacao_code passa a aceitar NULL (sem transação no TOTVS)
--   • origem distingue 'totvs' (gerou transação) de 'fisfp082' (só recebido)
-- Idempotente.
-- ============================================================================

ALTER TABLE devolucoes_transacoes ADD COLUMN IF NOT EXISTS origem TEXT NOT NULL DEFAULT 'totvs';
ALTER TABLE devolucoes_transacoes ALTER COLUMN transacao_code DROP NOT NULL;
