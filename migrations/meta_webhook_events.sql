-- Log RAW de eventos recebidos no webhook Meta.
-- Ajuda a diagnosticar quando o Meta App esta configurado corretamente
-- (delivery/read/failed events chegam) e captura o payload cru pra debug
-- de erros silenciosos tipo 131049 (marketing limit).

CREATE TABLE IF NOT EXISTS meta_webhook_events (
  id BIGSERIAL PRIMARY KEY,
  received_at TIMESTAMPTZ DEFAULT NOW(),
  object_type TEXT,
  entry_id TEXT,
  change_field TEXT,
  meta_message_id TEXT,
  status TEXT,
  recipient_id TEXT,
  error_code INT,
  error_message TEXT,
  raw JSONB
);

CREATE INDEX IF NOT EXISTS idx_meta_wh_meta_id ON meta_webhook_events (meta_message_id);
CREATE INDEX IF NOT EXISTS idx_meta_wh_received ON meta_webhook_events (received_at DESC);
CREATE INDEX IF NOT EXISTS idx_meta_wh_status ON meta_webhook_events (status);
CREATE INDEX IF NOT EXISTS idx_meta_wh_error_code ON meta_webhook_events (error_code);

-- Coluna error_code em message_queue (last_error ja existe pra texto)
ALTER TABLE message_queue ADD COLUMN IF NOT EXISTS error_code INT;
CREATE INDEX IF NOT EXISTS idx_mq_error_code ON message_queue (error_code)
  WHERE error_code IS NOT NULL;

COMMENT ON TABLE meta_webhook_events IS
  'Log raw de eventos webhook Meta (statuses, respostas). Ajuda diagnostico de entregas silenciosas.';
COMMENT ON COLUMN message_queue.error_code IS
  'Codigo de erro Meta (ex: 131049 marketing limit exceeded, 131047 fora janela 24h)';
