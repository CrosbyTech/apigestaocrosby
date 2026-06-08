-- Snapshot histórico do realizado por canal × período.
-- Diferente de forecast_canal_snapshot (override manual de oficial):
-- aqui é foto IMUTÁVEL do fechado, populada por cron e/ou comando manual.
-- Quando o frontend pesquisa período fechado, lê daqui — instantâneo, e
-- não muda mesmo se TOTVS reabrir uma NF retroativa.
CREATE TABLE IF NOT EXISTS forecast_realizado_snapshot (
  id BIGSERIAL PRIMARY KEY,
  canal TEXT NOT NULL,                  -- 'varejo' | 'franquia' | 'multimarcas' | ...
  period_type TEXT NOT NULL,            -- 'mensal' | 'semanal'
  period_key TEXT NOT NULL,             -- '2025-06' | '2025-W22'
  period_start DATE NOT NULL,
  period_end   DATE NOT NULL,
  valor NUMERIC(14,2) NOT NULL DEFAULT 0,   -- realizado líquido
  meta  NUMERIC(14,2),                       -- snapshot da meta vigente
  origem TEXT NOT NULL DEFAULT 'auto-cron',  -- 'auto-cron' | 'manual'
  fechado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_frs UNIQUE (canal, period_type, period_key)
);
CREATE INDEX IF NOT EXISTS idx_frs_period
  ON forecast_realizado_snapshot (period_type, period_key);
CREATE INDEX IF NOT EXISTS idx_frs_canal
  ON forecast_realizado_snapshot (canal, period_type);
