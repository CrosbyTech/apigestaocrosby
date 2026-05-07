-- =============================================
-- WHATSAPP OFICIAL - FILA DE DISPARO / CAMPANHAS
-- =============================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS message_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id BIGINT NOT NULL REFERENCES whatsapp_accounts(id) ON DELETE CASCADE,
  campaign_id UUID DEFAULT gen_random_uuid(),
  campaign_name TEXT,
  contact_external_id TEXT,
  contact_name TEXT,
  phone_number TEXT NOT NULL,
  template_name TEXT NOT NULL,
  template_language TEXT NOT NULL DEFAULT 'pt_BR',
  template_category TEXT,
  template_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  template_variables JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending',
  priority SMALLINT NOT NULL DEFAULT 100,
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  next_retry_at TIMESTAMPTZ,
  processing_started_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  replied_at TIMESTAMPTZ,
  canceled_at TIMESTAMPTZ,
  provider_message_id TEXT,
  conversation_category TEXT,
  estimated_cost NUMERIC(12, 4) DEFAULT 0,
  real_cost NUMERIC(12, 4) DEFAULT 0,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 6,
  daily_tier_limit INTEGER NOT NULL DEFAULT 1000,
  last_error TEXT,
  error_log JSONB NOT NULL DEFAULT '[]'::jsonb,
  dedupe_key TEXT,
  locked_by TEXT,
  locked_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT message_queue_status_check CHECK (
    status IN (
      'pending',
      'retrying',
      'processing',
      'sent',
      'delivered',
      'read',
      'replied',
      'paused',
      'failed',
      'canceled'
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_message_queue_dedupe_key
  ON message_queue(dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_message_queue_dispatch_window
  ON message_queue(status, scheduled_at, next_retry_at, priority DESC);

CREATE INDEX IF NOT EXISTS idx_message_queue_account_status
  ON message_queue(account_id, status, scheduled_at);

CREATE INDEX IF NOT EXISTS idx_message_queue_campaign_status
  ON message_queue(campaign_id, status);

CREATE INDEX IF NOT EXISTS idx_message_queue_provider_message_id
  ON message_queue(provider_message_id);

CREATE INDEX IF NOT EXISTS idx_message_queue_sent_at
  ON message_queue(account_id, sent_at DESC);

CREATE OR REPLACE FUNCTION set_message_queue_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_message_queue_updated_at ON message_queue;
CREATE TRIGGER trg_message_queue_updated_at
BEFORE UPDATE ON message_queue
FOR EACH ROW EXECUTE FUNCTION set_message_queue_updated_at();

ALTER TABLE message_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS message_queue_select_authenticated ON message_queue;
CREATE POLICY message_queue_select_authenticated
ON message_queue
FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS message_queue_insert_authenticated ON message_queue;
CREATE POLICY message_queue_insert_authenticated
ON message_queue
FOR INSERT
TO authenticated
WITH CHECK (true);

DROP POLICY IF EXISTS message_queue_update_authenticated ON message_queue;
CREATE POLICY message_queue_update_authenticated
ON message_queue
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS message_queue_delete_authenticated ON message_queue;
CREATE POLICY message_queue_delete_authenticated
ON message_queue
FOR DELETE
TO authenticated
USING (true);

COMMENT ON TABLE message_queue IS 'Fila transacional/campanhas do WhatsApp Oficial com retry, backoff e controle de tier diário.';
COMMENT ON COLUMN message_queue.daily_tier_limit IS 'Tier diário aplicado ao número no momento da campanha: 1000, 10000, 100000 etc.';
COMMENT ON COLUMN message_queue.template_payload IS 'Payload final do template no formato aceito pela Meta Graph API.';
COMMENT ON COLUMN message_queue.metadata IS 'Metadados livres: origem, utms, operador, tags da campanha, pricing snapshot.';
