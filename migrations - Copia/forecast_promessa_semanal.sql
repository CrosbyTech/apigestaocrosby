-- ====================================================================
-- PROMESSA SEMANAL POR CANAL DE VENDAS — Forecast
-- Tabela de canais configuráveis + metas/faturamento semanais
-- ====================================================================

-- 1. Canais da Promessa Semanal (B2M, B2R, B2C, B2L, Rafael MG, etc)
CREATE TABLE IF NOT EXISTS forecast_promessa_canais (
  id              SERIAL PRIMARY KEY,
  nome            TEXT NOT NULL,                       -- "B2M", "B2L", "RAFAEL MG"
  ordem           INTEGER NOT NULL DEFAULT 0,
  -- tipo: 'modulo' | 'vendedor' | 'franquia' | 'manual'
  --   modulo:   fonte_config = { modulo: 'multimarcas'|'revenda'|'varejo'|'franquia'|'inbound' }
  --   vendedor: fonte_config = { vendedor_codes: ['123','456'], vendedor_nomes: ['Rafael MG'] }
  --   franquia: fonte_config = { branch_codes: [6041, 6048], nome: 'Brejinho' }
  --   manual:   fonte_config = {} (faturamento entrado direto na tabela _metas)
  tipo            VARCHAR(20) NOT NULL,
  fonte_config    JSONB NOT NULL DEFAULT '{}'::jsonb,
  ativo           BOOLEAN NOT NULL DEFAULT true,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  criado_por      TEXT
);

CREATE INDEX IF NOT EXISTS idx_forecast_promessa_canais_ativo
  ON forecast_promessa_canais(ativo, ordem);

-- 2. Metas (e faturamento manual) por canal x semana ISO
CREATE TABLE IF NOT EXISTS forecast_promessa_metas (
  id                  SERIAL PRIMARY KEY,
  canal_id            INTEGER NOT NULL REFERENCES forecast_promessa_canais(id) ON DELETE CASCADE,
  ano                 INTEGER NOT NULL,
  semana_iso          INTEGER NOT NULL,                 -- 1..53
  data_inicio         DATE NOT NULL,                    -- segunda-feira da semana ISO
  data_fim            DATE NOT NULL,                    -- domingo da semana ISO
  meta_realista       NUMERIC(14,2) NOT NULL DEFAULT 0,
  faturamento_manual  NUMERIC(14,2),                    -- só preenchido se canal.tipo='manual'
  observacao          TEXT,
  criado_em           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  criado_por          TEXT,
  UNIQUE (canal_id, ano, semana_iso)
);

CREATE INDEX IF NOT EXISTS idx_forecast_promessa_metas_periodo
  ON forecast_promessa_metas(ano DESC, semana_iso DESC);

-- ====================================================================
-- Seed sugerido (canais comuns) — pode ser ajustado pelo admin depois
-- ====================================================================
INSERT INTO forecast_promessa_canais (nome, ordem, tipo, fonte_config) VALUES
  ('B2M',            10, 'modulo',   '{"modulo":"multimarcas"}'::jsonb),
  ('B2R',            20, 'modulo',   '{"modulo":"revenda"}'::jsonb),
  ('B2C',            30, 'modulo',   '{"modulo":"varejo"}'::jsonb),
  ('B2L',            40, 'manual',   '{}'::jsonb)
ON CONFLICT DO NOTHING;
-- B2M INBOUND e canais por vendedor (RAFAEL MG, BREJINHO KLEITON) ficam para
-- o admin cadastrar no painel (ele precisa escolher entre inbound_david/inbound_rafael
-- e informar os códigos/nomes de vendedor para os canais por vendedor).

COMMENT ON TABLE forecast_promessa_canais IS
  'Canais configuráveis da Promessa Semanal por Canal de Vendas (Forecast)';
COMMENT ON TABLE forecast_promessa_metas IS
  'Meta e faturamento manual por canal x semana ISO';
