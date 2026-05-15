-- Tabela de auditoria do sync UAzapi (não toca nas tabelas existentes).
CREATE TABLE IF NOT EXISTS uazapi_sync_log (
  id              BIGSERIAL PRIMARY KEY,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at     TIMESTAMPTZ,
  status          TEXT NOT NULL DEFAULT 'running',
  triggered_by    TEXT,
  instances_processed INTEGER DEFAULT 0,
  messages_inserted   INTEGER DEFAULT 0,
  messages_updated    INTEGER DEFAULT 0,
  chats_upserted      INTEGER DEFAULT 0,
  errors          TEXT,
  details         JSONB
);

CREATE INDEX IF NOT EXISTS uazapi_sync_log_started_idx
  ON uazapi_sync_log (started_at DESC);

COMMENT ON TABLE uazapi_sync_log IS 'Histórico de execuções do sync UAzapi (cron + manual)';
