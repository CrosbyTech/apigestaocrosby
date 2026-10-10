-- ============================================================================
-- DEVOLUÇÕES — registro das transações geradas pela Devolução RFID
-- Uma linha por transação de devolução enviada ao TOTVS, com o resultado da
-- conferência: o que foi RECEBIDO (entrou na transação), o que FALTOU (estava
-- na nota do cliente e não foi lido) e o que SOBROU (lido a mais ou fora da
-- nota). Faltas e sobras NÃO entram na transação — ficam só registradas aqui.
-- Alimenta a aba "Transações" de /devolucoes-mercadoria. Idempotente.
-- ============================================================================

CREATE TABLE IF NOT EXISTS devolucoes_transacoes (
  id BIGSERIAL PRIMARY KEY,
  -- solicitação de origem (quando a devolução veio do link público)
  devolucao_id BIGINT,

  -- transação no TOTVS
  empresa INT NOT NULL,
  transacao_code BIGINT NOT NULL,
  transacao_date DATE,
  transacao_status INT NOT NULL DEFAULT 1,   -- 1 andamento · 4 atendida · 6 cancelada
  operacao INT,
  cfop INT,
  total NUMERIC(14, 2) NOT NULL DEFAULT 0,
  atendida_em TIMESTAMPTZ,

  cliente_code INT,
  cliente_nome TEXT,
  vendedor_code INT,
  vendedor_nome TEXT,

  -- nota fiscal emitida pelo cliente (modo conferência); nulo na devolução sem nota
  nf_numero INT,
  nf_serie TEXT,
  nf_data DATE,
  nf_empresa INT,
  nf_chave TEXT,
  nf_total NUMERIC(14, 2),
  nf_qtd_pecas INT,

  -- resumo da conferência
  qtd_recebida INT NOT NULL DEFAULT 0,
  qtd_faltando INT NOT NULL DEFAULT 0,
  qtd_sobrando INT NOT NULL DEFAULT 0,
  valor_faltando NUMERIC(14, 2) NOT NULL DEFAULT 0,

  -- detalhe: listas de { productCode, name, quantidade, unit, total, epcs[], ... }
  recebidos JSONB NOT NULL DEFAULT '[]'::jsonb,
  faltando JSONB NOT NULL DEFAULT '[]'::jsonb,
  sobrando JSONB NOT NULL DEFAULT '[]'::jsonb,

  criado_por TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_dev_trx ON devolucoes_transacoes (empresa, transacao_code);
CREATE INDEX IF NOT EXISTS idx_dev_trx_data ON devolucoes_transacoes (criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_dev_trx_cliente ON devolucoes_transacoes (cliente_code);
CREATE INDEX IF NOT EXISTS idx_dev_trx_nf ON devolucoes_transacoes (nf_chave) WHERE nf_chave IS NOT NULL;

CREATE OR REPLACE FUNCTION devolucoes_trx_touch()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.atualizado_em = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_dev_trx_touch ON devolucoes_transacoes;
CREATE TRIGGER trg_dev_trx_touch BEFORE UPDATE ON devolucoes_transacoes
  FOR EACH ROW EXECUTE FUNCTION devolucoes_trx_touch();
