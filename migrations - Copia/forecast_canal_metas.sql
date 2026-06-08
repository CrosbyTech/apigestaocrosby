-- ─────────────────────────────────────────────────────────────────────
-- forecast_canal_metas
-- Metas mensais e semanais por canal (varejo, multimarcas, revenda,
-- franquia, business, etc) usadas na aba Métricas do Forecast.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS forecast_canal_metas (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  canal           TEXT NOT NULL,  -- varejo, multimarcas, revenda, franquia,
                                  -- business, bazar, showroom, novidadesfranquia,
                                  -- inbound_david, inbound_rafael, ricardoeletro

  period_type     TEXT NOT NULL CHECK (period_type IN ('mensal','semanal')),
  -- mensal:  'YYYY-MM'    ex: '2026-05'
  -- semanal: 'YYYY-Www'   ex: '2026-W19' (ISO week, segunda a domingo)
  period_key      TEXT NOT NULL,

  valor_meta      NUMERIC(14,2) NOT NULL,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by      TEXT,                     -- email/login do admin

  -- Uma meta única por (canal × período)
  CONSTRAINT forecast_canal_metas_unique
    UNIQUE (canal, period_type, period_key)
);

CREATE INDEX IF NOT EXISTS forecast_canal_metas_lookup_idx
  ON forecast_canal_metas (canal, period_type, period_key);

CREATE INDEX IF NOT EXISTS forecast_canal_metas_period_idx
  ON forecast_canal_metas (period_type, period_key DESC);

COMMENT ON TABLE forecast_canal_metas IS
  'Metas mensais/semanais por canal usadas na aba Métricas do Forecast — admin edita';
