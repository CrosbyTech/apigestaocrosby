-- Espelho das Solicitações de Baixa do link do Dryland no HeadCoach.
-- Uma linha por pedido do Dryland (id de lá). Controla o que já virou
-- solicitação aqui e o que já foi devolvido pra lá (baixada/recusada).
-- Ver services/drylandBaixas.js.
CREATE TABLE IF NOT EXISTS dryland_baixas_espelho (
  dryland_id         BIGINT PRIMARY KEY,
  ref_externa        TEXT NOT NULL,          -- dryland:baixa:<id>
  status_dryland     TEXT,                   -- status de lá quando espelhado
  solicitante        TEXT,
  cliente_nome       TEXT,
  valor              NUMERIC(12,2),
  data_pagamento     DATE,
  comprovante_url    TEXT,
  titulos            JSONB DEFAULT '[]'::jsonb,   -- ["248784-2", ...]
  solicitacoes_ids   JSONB DEFAULT '[]'::jsonb,   -- ids em solicitacoes_baixa
  status_enviado     TEXT,                   -- baixada | recusada (já devolvido ao Dryland)
  status_enviado_em  TIMESTAMPTZ,
  criado_em          TIMESTAMPTZ DEFAULT now(),
  atualizado_em      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dryland_baixas_espelho_pend
  ON dryland_baixas_espelho (status_enviado) WHERE status_enviado IS NULL;
NOTIFY pgrst, 'reload schema';
