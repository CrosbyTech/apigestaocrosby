-- Integração HeadCoach ↔ BlueCard (crediário Crosby)
-- Duas tabelas:
--   bluecard_eventos  — log idempotente dos webhooks recebidos do BlueCard
--                       (compra.aprovada/recusada, parcelamento.aceito, compra.cancelada)
--   bluecard_titulos  — espelho dos títulos (boletos) enviados ao BlueCard.
--                       É a fonte do endpoint de reconciliação GET /pagamentos
--                       e do job que avisa o BlueCard quando o cliente paga.

CREATE TABLE IF NOT EXISTS bluecard_eventos (
  id BIGSERIAL PRIMARY KEY,
  recebido_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  evento TEXT NOT NULL,                -- compra.aprovada | compra.recusada | parcelamento.aceito | compra.cancelada
  -- Chave de dedupe: hash do corpo cru. Reenvio do BlueCard (retry de 24h)
  -- cai em conflito e não processa duas vezes.
  dedupe_hash TEXT NOT NULL UNIQUE,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'recebido',  -- recebido | processado | erro
  processado_em TIMESTAMPTZ,
  erro TEXT
);

CREATE INDEX IF NOT EXISTS idx_bce_evento ON bluecard_eventos (evento);
CREATE INDEX IF NOT EXISTS idx_bce_status ON bluecard_eventos (status);
CREATE INDEX IF NOT EXISTS idx_bce_recebido ON bluecard_eventos (recebido_em DESC);

CREATE TABLE IF NOT EXISTS bluecard_titulos (
  -- externo_id é a chave combinada com o BlueCard (título no TOTVS).
  externo_id TEXT PRIMARY KEY,
  compra_id TEXT,                      -- uuid da compra no BlueCard
  documento TEXT,                      -- nº NF/pedido no TOTVS
  cpf TEXT,
  parcela INT,
  de INT,
  valor_cents BIGINT,
  vencimento DATE,
  -- Identificadores TOTVS para o job de sync casar o título com o
  -- accounts-receivable (receivableCode + installmentCode + branchCode).
  totvs_branch_code INT,
  totvs_receivable_code BIGINT,
  totvs_installment_code INT,
  status TEXT NOT NULL DEFAULT 'aberto',  -- aberto | pago | cancelado | substituido
  pago_em TIMESTAMPTZ,
  valor_pago_cents BIGINT,
  meio TEXT,                           -- boleto | pix | ...
  -- Controle do aviso POST /api/v1/pagamentos ao BlueCard
  notificado_bluecard_em TIMESTAMPTZ,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bct_status ON bluecard_titulos (status);
CREATE INDEX IF NOT EXISTS idx_bct_pago_em ON bluecard_titulos (pago_em DESC) WHERE pago_em IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bct_compra ON bluecard_titulos (compra_id);
CREATE INDEX IF NOT EXISTS idx_bct_totvs ON bluecard_titulos (totvs_receivable_code, totvs_installment_code);

COMMENT ON TABLE bluecard_eventos IS
  'Webhooks recebidos do BlueCard (crediário). Dedupe por hash do corpo — retry deles não processa 2x.';
COMMENT ON TABLE bluecard_titulos IS
  'Títulos TOTVS enviados ao BlueCard. Fonte da reconciliação GET /pagamentos e do aviso de pagamento.';
