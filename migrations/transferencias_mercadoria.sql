-- ============================================================================
-- TRANSFERÊNCIAS DE MERCADORIA ENTRE EMPRESAS — página /transferencias-mercadoria
-- (mesmo desenho das Devoluções de Mercadoria: Solicitações / Transferência
-- RFID / Transações). Operação pela regra do POP "Transferências entre
-- empresas - Varejo" (raiz do CNPJ de origem × destino → 7272 / 7273 / 7280).
-- O "cliente" da transação é a pessoa da filial de destino (ex.: empresa 1 →
-- pessoa 110000001). Idempotente.
-- ============================================================================

-- Solicitações (o formulário de abertura ainda não existe; a aba já lista)
CREATE TABLE IF NOT EXISTS transferencias_mercadoria (
  id BIGSERIAL PRIMARY KEY,
  empresa_origem INT NOT NULL,
  empresa_origem_nome TEXT,
  empresa_destino INT NOT NULL,
  empresa_destino_nome TEXT,
  cliente_code INT,                 -- pessoa da filial de destino
  operacao INT,                     -- 7272 / 7273 / 7280 (POP)
  solicitante_nome TEXT,
  solicitante_email TEXT,
  qtd_pecas INT NOT NULL DEFAULT 0,
  observacao TEXT,
  observacao_interna TEXT,
  status TEXT NOT NULL DEFAULT 'aguardando_transferencia'
    CHECK (status IN ('aguardando_transferencia', 'em_transferencia', 'concluida', 'cancelada')),
  motivo_cancelamento TEXT,
  -- onde está a mercadoria (toggle ORIGEM → EM TRÂNSITO → DESTINO)
  local TEXT NOT NULL DEFAULT 'origem' CHECK (local IN ('origem', 'em_transito', 'destino')),
  local_por TEXT,
  local_em TIMESTAMPTZ,
  -- transação gerada na Transferência RFID
  transacao_code BIGINT,
  transacao_branch INT,
  transacao_date DATE,
  transacao_status INT,
  transacao_total NUMERIC(14, 2),
  transacao_operacao INT,
  transacao_qtd_epcs INT,
  transacao_por TEXT,
  transacao_atendida_em TIMESTAMPTZ,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_transf_status ON transferencias_mercadoria (status, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_transf_origem ON transferencias_mercadoria (empresa_origem);
CREATE INDEX IF NOT EXISTS idx_transf_destino ON transferencias_mercadoria (empresa_destino);

-- Transações geradas pela Transferência RFID (aba Transações)
CREATE TABLE IF NOT EXISTS transferencias_transacoes (
  id BIGSERIAL PRIMARY KEY,
  transferencia_id BIGINT,
  empresa INT NOT NULL,             -- origem (quem emite)
  empresa_destino INT NOT NULL,
  transacao_code BIGINT NOT NULL,
  transacao_date DATE,
  transacao_status INT NOT NULL DEFAULT 1,   -- 1 andamento · 4 atendida · 6 cancelada
  operacao INT,
  cfop INT,
  total NUMERIC(14, 2) NOT NULL DEFAULT 0,
  qtd_pecas INT NOT NULL DEFAULT 0,
  qtd_epcs INT NOT NULL DEFAULT 0,
  cliente_code INT,
  cliente_nome TEXT,
  vendedor_code INT,
  vendedor_nome TEXT,
  itens JSONB NOT NULL DEFAULT '[]'::jsonb,  -- { productCode, name, quantidade, unit, total, epcs[] }
  atendida_em TIMESTAMPTZ,
  criado_por TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_transf_trx ON transferencias_transacoes (empresa, transacao_code);
CREATE INDEX IF NOT EXISTS idx_transf_trx_data ON transferencias_transacoes (criado_em DESC);

-- 10/11/2026: solicitações vindas dos pedidos de transferência entre lojas do Dryland
-- (cards TR### / TRU-<LOJA>-<BJ|MAX> do canal varejo da fila de faturamento)
ALTER TABLE transferencias_mercadoria ADD COLUMN IF NOT EXISTS origem TEXT;            -- dryland | null (aberta no HeadCoach)
ALTER TABLE transferencias_mercadoria ADD COLUMN IF NOT EXISTS origem_chave TEXT;      -- id do card na fila do Dryland
ALTER TABLE transferencias_mercadoria ADD COLUMN IF NOT EXISTS origem_ref TEXT;        -- TR247, TRU-RECIFE-BJ…
ALTER TABLE transferencias_mercadoria ADD COLUMN IF NOT EXISTS valor NUMERIC(14, 2);
ALTER TABLE transferencias_mercadoria ADD COLUMN IF NOT EXISTS itens JSONB;            -- [{ cod, descricao, cor, tam, qtd, preco, tr, estoque }]
CREATE UNIQUE INDEX IF NOT EXISTS idx_transf_origem_chave ON transferencias_mercadoria (origem_chave) WHERE origem_chave IS NOT NULL;
