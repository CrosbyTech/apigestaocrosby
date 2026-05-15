-- Adiciona entity_type pra diferenciar metas por SELLER (vendedor) ou BRANCH (loja).
-- Pra varejo, meta é por loja (entity_type='branch', code = branch_code).
ALTER TABLE crm_seller_metas
  ADD COLUMN IF NOT EXISTS entity_type TEXT NOT NULL DEFAULT 'seller'
    CHECK (entity_type IN ('seller','branch'));

-- Recria o constraint único pra incluir entity_type
ALTER TABLE crm_seller_metas
  DROP CONSTRAINT IF EXISTS crm_seller_metas_unique;

ALTER TABLE crm_seller_metas
  ADD CONSTRAINT crm_seller_metas_unique
    UNIQUE (entity_type, seller_code, modulo, meta_kind, period_type, period_key);

-- Índice de lookup
DROP INDEX IF EXISTS crm_seller_metas_lookup_idx;
CREATE INDEX IF NOT EXISTS crm_seller_metas_lookup_idx
  ON crm_seller_metas (entity_type, modulo, meta_kind, period_type, period_key);

COMMENT ON COLUMN crm_seller_metas.entity_type IS 'seller (vendedor) | branch (loja varejo)';
