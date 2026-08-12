-- Liberações de limite TOTVS do crediário BlueCard.
-- Fluxo: cliente vive com limite 0 no TOTVS → compra.aprovada sobe o limite
-- para o valor exato (+ títulos em aberto) → watchdog zera quando a venda
-- fecha no TOTVS, quando a compra é cancelada, ou por timeout.

CREATE TABLE IF NOT EXISTS bluecard_liberacoes (
  compra_id TEXT PRIMARY KEY,          -- uuid da compra no BlueCard
  documento TEXT,                      -- nº transação/NF se o BlueCard mandar
  cpf TEXT NOT NULL,
  nome TEXT,
  customer_code BIGINT,                -- código da pessoa no TOTVS
  branch_code INT,
  valor_cents BIGINT NOT NULL,         -- valor aprovado no app
  abertos_cents BIGINT DEFAULT 0,      -- títulos em aberto no momento da liberação
  limite_cents BIGINT NOT NULL,        -- limite efetivamente gravado no TOTVS
  status TEXT NOT NULL DEFAULT 'liberado',
    -- liberado          → limite alto, aguardando a venda fechar no PDV
    -- consumido         → venda detectada no TOTVS, limite zerado
    -- zerado_expirado   → venda nunca fechou, zerado por timeout
    -- zerado_cancelado  → compra.cancelada antes da venda fechar
  liberado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  venda_detectada_em TIMESTAMPTZ,
  zerado_em TIMESTAMPTZ,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bcl_status ON bluecard_liberacoes (status);
CREATE INDEX IF NOT EXISTS idx_bcl_cpf ON bluecard_liberacoes (cpf);
CREATE INDEX IF NOT EXISTS idx_bcl_liberado ON bluecard_liberacoes (liberado_em DESC);

COMMENT ON TABLE bluecard_liberacoes IS
  'Janelas de limite TOTVS abertas pelo webhook compra.aprovada do BlueCard. O watchdog zera de volta.';
