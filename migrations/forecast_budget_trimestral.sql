-- Orçamento de marketing por canal × trimestre.
-- Fonte: planilha "FORECAST - Planejamento de buget trimestral.xlsx"
-- - budget_trafego  = 2,5% do faturamento (Meta Ads / tráfego pago)
-- - budget_marketing = 0,5% do faturamento (API/WhatsApp)
-- - meta_faturamento = meta de receita do trimestre (pra calcular % atingido)
--
-- Usado pelo card "Orçamento Marketing" no Forecast + aba "Orçamento"
-- de planejamento futuro. Comparado vs gasto real (custos-marketing).

CREATE TABLE IF NOT EXISTS forecast_budget_trimestral (
  id BIGSERIAL PRIMARY KEY,
  ano INT NOT NULL,
  trimestre INT NOT NULL CHECK (trimestre BETWEEN 1 AND 4),
  -- Chave do canal usada no resto do sistema (varejo, revenda, multimarcas,
  -- inbound_david, inbound_rafael, franquia, business, bazar, fardamento, etc.)
  canal TEXT NOT NULL,
  -- Label amigável (ex.: "B2C — Varejo", "B2L — Franquia")
  canal_label TEXT,
  budget_trafego NUMERIC(12, 2) NOT NULL DEFAULT 0,
  budget_marketing NUMERIC(12, 2) NOT NULL DEFAULT 0,
  meta_faturamento NUMERIC(14, 2) NOT NULL DEFAULT 0,
  observacao TEXT,
  created_by TEXT,
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (ano, trimestre, canal)
);

CREATE INDEX IF NOT EXISTS idx_forecast_budget_ano_trim
  ON forecast_budget_trimestral (ano, trimestre);

-- Helper pra reaproveitar trigger de updated_at (caso ainda não exista).
CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_updated_at_forecast_budget_trimestral ON forecast_budget_trimestral;
CREATE TRIGGER set_updated_at_forecast_budget_trimestral
  BEFORE UPDATE ON forecast_budget_trimestral
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
