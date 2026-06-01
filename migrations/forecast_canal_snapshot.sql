-- Snapshot oficial por canal+período (override do valor calculado).
-- Quando ativo, fat-seg e canal-totals usam esse valor em vez de calcular.
-- Pra casos onde o cálculo automático diverge do report oficial TOTVS.
CREATE TABLE IF NOT EXISTS forecast_canal_snapshot (
  id BIGSERIAL PRIMARY KEY,
  canal TEXT NOT NULL,
  period_type TEXT NOT NULL,        -- 'mensal' | 'semanal'
  period_key TEXT NOT NULL,         -- '2026-05' | '2026-W22'
  valor_oficial NUMERIC(14,2) NOT NULL,
  observacao TEXT,
  ativo BOOLEAN NOT NULL DEFAULT true,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_fcs UNIQUE (canal, period_type, period_key)
);
CREATE INDEX IF NOT EXISTS idx_fcs_canal ON forecast_canal_snapshot (canal, period_type, period_key)
  WHERE ativo = true;
