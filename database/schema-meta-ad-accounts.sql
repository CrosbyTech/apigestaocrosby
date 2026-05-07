-- Contas do Meta Ads (Facebook Ads) para buscar gasto com tráfego pago
CREATE TABLE IF NOT EXISTS meta_ad_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  ad_account_id TEXT NOT NULL UNIQUE, -- ex: "act_123456789"
  access_token TEXT NOT NULL,
  canal_venda TEXT DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE meta_ad_accounts IS 'Contas do Meta Ads para buscar gastos com tráfego pago (lago)';
COMMENT ON COLUMN meta_ad_accounts.ad_account_id IS 'ID da conta de anúncios no formato act_XXXXXXXXX';
COMMENT ON COLUMN meta_ad_accounts.canal_venda IS 'Canal de venda associado (varejo, franquia, etc.). NULL = todos.';
