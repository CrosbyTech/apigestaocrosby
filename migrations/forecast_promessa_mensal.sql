-- ====================================================================
-- PROMESSA MENSAL DE CANAIS — Forecast
-- Reutiliza forecast_promessa_canais (mesma estrutura de canais do semanal)
-- Adiciona meta+forecast por canal × mês
-- ====================================================================

CREATE TABLE IF NOT EXISTS forecast_promessa_mensal_metas (
  id                  SERIAL PRIMARY KEY,
  canal_id            INTEGER NOT NULL REFERENCES forecast_promessa_canais(id) ON DELETE CASCADE,
  ano                 INTEGER NOT NULL,
  mes                 INTEGER NOT NULL CHECK (mes BETWEEN 1 AND 12),
  meta_mensal         NUMERIC(14,2) NOT NULL DEFAULT 0,
  forecast_mensal     NUMERIC(14,2) NOT NULL DEFAULT 0,   -- pode ser != meta (caso B2L)
  faturamento_manual  NUMERIC(14,2),                       -- só preenchido se canal.tipo='manual'
  observacao          TEXT,
  criado_em           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  criado_por          TEXT,
  UNIQUE (canal_id, ano, mes)
);

CREATE INDEX IF NOT EXISTS idx_forecast_promessa_mensal_periodo
  ON forecast_promessa_mensal_metas(ano DESC, mes DESC);

COMMENT ON TABLE forecast_promessa_mensal_metas IS
  'Meta mensal + forecast mensal por canal. Dias úteis: seg-sáb (varejo).';
