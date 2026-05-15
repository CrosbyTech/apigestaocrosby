-- Adiciona suporte a metas de diferentes tipos: faturamento (default), aberturas, reativacoes.
ALTER TABLE crm_seller_metas
  ADD COLUMN IF NOT EXISTS meta_kind TEXT NOT NULL DEFAULT 'faturamento'
    CHECK (meta_kind IN ('faturamento','aberturas','reativacoes'));

-- Recria o constraint único pra incluir meta_kind
ALTER TABLE crm_seller_metas
  DROP CONSTRAINT IF EXISTS crm_seller_metas_unique;

ALTER TABLE crm_seller_metas
  ADD CONSTRAINT crm_seller_metas_unique
    UNIQUE (seller_code, modulo, meta_kind, period_type, period_key);

-- Índice para lookups por (modulo, kind, period)
DROP INDEX IF EXISTS crm_seller_metas_lookup_idx;
CREATE INDEX IF NOT EXISTS crm_seller_metas_lookup_idx
  ON crm_seller_metas (modulo, meta_kind, period_type, period_key);

COMMENT ON COLUMN crm_seller_metas.meta_kind IS 'Tipo da meta: faturamento (R$) | aberturas (qtd) | reativacoes (qtd)';
