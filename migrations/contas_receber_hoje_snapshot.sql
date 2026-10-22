-- Snapshot da tela Hoje do Contas a Receber: a carga pesada (TOTVS + devedores
-- + Pagar.me) roda uma vez por dia (job) e fica guardada; a tela abre na hora
-- com o último snapshot e "Atualizar" gera outro em segundo plano
-- (pedido do João, 22/10/2026).
CREATE TABLE IF NOT EXISTS contas_receber_hoje_snapshot (
  id         BIGSERIAL PRIMARY KEY,
  dia        DATE NOT NULL,
  gerado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
  tempo_ms   INTEGER,
  payload    JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cr_hoje_snapshot_gerado ON contas_receber_hoje_snapshot (gerado_em DESC);
