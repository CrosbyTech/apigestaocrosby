-- Adiciona coluna de justificativa do não cumprimento da meta
ALTER TABLE forecast_canal_metas
  ADD COLUMN IF NOT EXISTS justificativa TEXT;

COMMENT ON COLUMN forecast_canal_metas.justificativa IS
  'Justificativa quando a meta não foi atingida (preenchido manualmente pelo admin)';
