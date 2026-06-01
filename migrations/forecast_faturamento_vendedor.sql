-- Snapshot de faturamento por vendedor (B2R/B2M) sincronizado do TOTVS.
-- Objetivo: ler daqui (instantâneo) em vez de bater no TOTVS a cada visualização.
-- O sync (cron 06h/12h/18h) sobrescreve o período corrente; períodos fechados
-- ficam congelados como histórico.
CREATE TABLE IF NOT EXISTS forecast_faturamento_vendedor (
  id            BIGSERIAL PRIMARY KEY,
  grupo         TEXT NOT NULL,            -- 'B2R' | 'B2M'
  periodo_tipo  TEXT NOT NULL,            -- 'mensal' | 'semanal'
  periodo_key   TEXT NOT NULL,            -- '2026-05' | '2026-W22'
  seller_code   TEXT NOT NULL,
  seller_name   TEXT,
  bruto         NUMERIC(14,2) NOT NULL DEFAULT 0,
  credev        NUMERIC(14,2) NOT NULL DEFAULT 0,
  liquido       NUMERIC(14,2) NOT NULL DEFAULT 0,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_fat_vend UNIQUE (grupo, periodo_tipo, periodo_key, seller_code)
);

CREATE INDEX IF NOT EXISTS idx_fat_vend_periodo
  ON forecast_faturamento_vendedor (periodo_tipo, periodo_key);

-- Log de sync (auditoria: quando rodou, quantas linhas, fonte)
CREATE TABLE IF NOT EXISTS forecast_faturamento_vendedor_sync (
  id            BIGSERIAL PRIMARY KEY,
  periodo_tipo  TEXT,
  periodo_key   TEXT,
  linhas        INTEGER,
  origem        TEXT,                     -- 'cron' | 'manual'
  ok            BOOLEAN,
  erro          TEXT,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now()
);
