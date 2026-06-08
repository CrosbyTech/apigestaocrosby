-- Histórico de mudanças de status de cada instância UAzapi.
-- Usado pelo monitor (polling 15 min) pra detectar desconexões e
-- por relatórios de causa de desconexão.

CREATE TABLE IF NOT EXISTS uazapi_instance_status_history (
  id              BIGSERIAL PRIMARY KEY,
  instance_id     UUID NOT NULL,
  instance_name   TEXT,
  prev_status     TEXT,
  new_status      TEXT NOT NULL,
  reason          TEXT,
  changed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  alerted         BOOLEAN DEFAULT FALSE,
  alerted_at      TIMESTAMPTZ,
  alert_channel   TEXT,
  alert_error     TEXT,
  report          JSONB
);

CREATE INDEX IF NOT EXISTS uazapi_status_hist_instance_idx
  ON uazapi_instance_status_history (instance_id, changed_at DESC);

CREATE INDEX IF NOT EXISTS uazapi_status_hist_changed_idx
  ON uazapi_instance_status_history (changed_at DESC);

CREATE INDEX IF NOT EXISTS uazapi_status_hist_disconnect_idx
  ON uazapi_instance_status_history (changed_at DESC)
  WHERE new_status = 'disconnected';

COMMENT ON TABLE uazapi_instance_status_history IS
  'Histórico de transições de status de instâncias UAzapi (polling 15 min).';
