-- Faturamento diário por canal — histórico manual + auto.
-- Granularidade: data × canal.
-- Uso:
--  - 2025 (e anteriores): preenchimento MANUAL via UI/CSV
--  - 2026+: preenchimento AUTOMÁTICO via cron diário
-- Origem registra qual: 'manual' | 'auto-cron' | 'csv-import'
CREATE TABLE IF NOT EXISTS faturamento_diario_canal (
  id BIGSERIAL PRIMARY KEY,
  data DATE NOT NULL,
  canal TEXT NOT NULL,                       -- 'varejo' | 'franquia' | 'multimarcas' | ...
  valor NUMERIC(14,2) NOT NULL DEFAULT 0,    -- monetário
  quantidade INTEGER,                        -- pra canais quantitativos (bluecard etc.)
  observacao TEXT,
  origem TEXT NOT NULL DEFAULT 'manual',     -- 'manual' | 'auto-cron' | 'csv-import'
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_por TEXT,
  CONSTRAINT uq_fdc UNIQUE (data, canal)
);
CREATE INDEX IF NOT EXISTS idx_fdc_data ON faturamento_diario_canal (data);
CREATE INDEX IF NOT EXISTS idx_fdc_canal_data ON faturamento_diario_canal (canal, data);
CREATE INDEX IF NOT EXISTS idx_fdc_ano_mes
  ON faturamento_diario_canal ((EXTRACT(YEAR FROM data)), (EXTRACT(MONTH FROM data)));
