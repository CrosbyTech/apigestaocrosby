-- ====================================================================
-- COMPARATIVO ANUAL — Valores de referência por canal × ano × mês
-- Usados quando os valores de anos passados não podem ser puxados
-- diretamente do TOTVS (ex: reclassificação de canais, dados manuais).
-- ====================================================================

CREATE TABLE IF NOT EXISTS forecast_comparativo_ref (
  id              SERIAL PRIMARY KEY,
  canal           TEXT NOT NULL,
  ano             INTEGER NOT NULL,
  mes             INTEGER NOT NULL CHECK (mes BETWEEN 1 AND 12),
  valor_full      NUMERIC(14,2) NOT NULL DEFAULT 0,   -- mês cheio (referência total)
  valor_acumulado NUMERIC(14,2) NOT NULL DEFAULT 0,   -- acumulado até dia X (configurável)
  dia_acumulado   INTEGER,                              -- até que dia esse acumulado representa
  observacao      TEXT,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_por  TEXT,
  UNIQUE (canal, ano, mes)
);

CREATE INDEX IF NOT EXISTS idx_forecast_comparativo_ref_ano_mes
  ON forecast_comparativo_ref(ano, mes);

COMMENT ON TABLE forecast_comparativo_ref IS
  'Valores fixos de referência para comparativo ano × ano (canal × ano × mês)';
