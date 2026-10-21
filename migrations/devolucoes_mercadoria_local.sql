-- ============================================================================
-- DEVOLUÇÕES DE MERCADORIA — localização da mercadoria (coluna "local")
-- Toggle na aba Solicitações: EM TRÂNSITO → MATRIZ → LOCAL (ciclo).
-- Só owner/admin/DP/financeiro alteram (gating no front). Idempotente.
-- ============================================================================

ALTER TABLE devolucoes_mercadoria
  ADD COLUMN IF NOT EXISTS local TEXT NOT NULL DEFAULT 'em_transito'
    CHECK (local IN ('em_transito', 'matriz', 'local'));
ALTER TABLE devolucoes_mercadoria ADD COLUMN IF NOT EXISTS local_por TEXT;
ALTER TABLE devolucoes_mercadoria ADD COLUMN IF NOT EXISTS local_em TIMESTAMPTZ;
