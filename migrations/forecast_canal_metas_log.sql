-- ====================================================================
-- Auditoria de alterações em forecast_canal_metas
-- Grava valor anterior + novo + quem alterou + quando
-- ====================================================================

CREATE TABLE IF NOT EXISTS forecast_canal_metas_log (
  id                    SERIAL PRIMARY KEY,
  canal                 TEXT NOT NULL,
  period_type           VARCHAR(10) NOT NULL,
  period_key            TEXT NOT NULL,
  acao                  VARCHAR(20) NOT NULL,   -- 'create' | 'update' | 'delete'
  valor_meta_anterior   NUMERIC(14,2),
  valor_meta_novo       NUMERIC(14,2),
  justificativa_anterior TEXT,
  justificativa_nova    TEXT,
  alterado_em           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  alterado_por          TEXT,
  user_role             TEXT,
  ip_origem             TEXT
);

CREATE INDEX IF NOT EXISTS idx_forecast_canal_metas_log_periodo
  ON forecast_canal_metas_log(canal, period_type, period_key, alterado_em DESC);
CREATE INDEX IF NOT EXISTS idx_forecast_canal_metas_log_data
  ON forecast_canal_metas_log(alterado_em DESC);

COMMENT ON TABLE forecast_canal_metas_log IS
  'Auditoria de alterações em forecast_canal_metas (Faturamento × Meta)';
