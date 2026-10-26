-- Snapshot diário da inadimplência mensal (>60 dias) — João, 26/10/2026.
-- Uma linha por geração; a tela lê a mais recente. Ver services/inadimplenciaMensal.js.
CREATE TABLE IF NOT EXISTS inadimplencia_mensal_snapshot (
  id          BIGSERIAL PRIMARY KEY,
  gerado_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
  hoje        DATE,
  dias        INT NOT NULL DEFAULT 60,
  dados       JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_inad_mensal_gerado ON inadimplencia_mensal_snapshot (gerado_em DESC);
NOTIFY pgrst, 'reload schema';
