-- ─────────────────────────────────────────────────────────────────────────
-- crm_seller_metas
-- Metas mensais/semanais por vendedor com histórico (uma linha por
-- vendedor × tipo × período).
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS crm_seller_metas (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  seller_code     INTEGER NOT NULL,         -- totvs_id do vendedor
  seller_name     TEXT,                     -- snapshot do nome (info)
  modulo          TEXT NOT NULL,            -- multimarcas | revenda | varejo | inbound_david | inbound_rafael

  period_type     TEXT NOT NULL CHECK (period_type IN ('mensal','semanal')),
  -- mensal: 'YYYY-MM'      ex: '2026-04'
  -- semanal: 'YYYY-Www'    ex: '2026-W18'  (ISO week)
  period_key      TEXT NOT NULL,

  valor_meta      NUMERIC(14,2) NOT NULL,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by      TEXT,                     -- email/login do admin

  -- Uma única meta por (seller, modulo, tipo, período)
  CONSTRAINT crm_seller_metas_unique
    UNIQUE (seller_code, modulo, period_type, period_key)
);

CREATE INDEX IF NOT EXISTS crm_seller_metas_lookup_idx
  ON crm_seller_metas (modulo, period_type, period_key);

CREATE INDEX IF NOT EXISTS crm_seller_metas_seller_idx
  ON crm_seller_metas (seller_code, modulo, period_type, period_key DESC);

COMMENT ON TABLE crm_seller_metas IS 'Metas mensais e semanais por vendedor (CRM Performance) — só admin edita';
