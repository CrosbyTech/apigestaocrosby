-- ============================================================================
-- DEVOLUÇÕES DE MERCADORIA
-- Solicitações abertas pelo CLIENTE no link público /devolucao (Solicitações
-- Crosby) e acompanhadas na página /devolucoes-mercadoria.
--
-- Fluxo:
--   tradicional → aguardando_devolucao ──► (Devolução RFID) em_devolucao ► concluida
--   defeito     → aguardando_avaliacao (chamado no Dryland p/ Produção)
--                 └─ chamado concluído → aguardando_devolucao ► ... ► concluida
-- Fotos ficam no bucket público `devolucoes-mercadoria` (1 por peça).
-- Idempotente.
-- ============================================================================

CREATE TABLE IF NOT EXISTS devolucoes_mercadoria (
  id BIGSERIAL PRIMARY KEY,
  origem TEXT NOT NULL DEFAULT 'publico' CHECK (origem IN ('publico', 'interno')),

  -- Cliente (validado no cadastro pes_pessoa / TOTVS)
  cliente_code INT NOT NULL,
  cliente_nome TEXT,
  cliente_cpf_cnpj TEXT NOT NULL,
  cliente_tipo TEXT,            -- PF | PJ
  cliente_empresa INT,          -- cd_empresacad do cliente
  cliente_empresa_nome TEXT,
  cliente_telefone TEXT,
  cliente_email TEXT,

  -- Vendedor escolhido no formulário
  vendedor_code INT,
  vendedor_nome TEXT,

  -- tradicional | defeito
  tipo TEXT NOT NULL CHECK (tipo IN ('tradicional', 'defeito')),
  qtd_pecas INT NOT NULL DEFAULT 1,
  observacao TEXT,
  -- [{ peca: 1, path, url, nome, tamanho }]
  fotos JSONB NOT NULL DEFAULT '[]'::jsonb,

  status TEXT NOT NULL DEFAULT 'aguardando_devolucao'
    CHECK (status IN ('aguardando_avaliacao', 'aguardando_devolucao', 'em_devolucao', 'concluida', 'cancelada')),
  observacao_interna TEXT,
  motivo_cancelamento TEXT,

  -- Chamado no Dryland (só quando tipo = defeito)
  chamado_dryland_id BIGINT,
  chamado_dryland_numero INT,
  chamado_aberto_em TIMESTAMPTZ,
  chamado_status TEXT,
  chamado_concluido_em TIMESTAMPTZ,
  avaliacao_producao TEXT,      -- último comentário/resultado do chamado

  -- Transação de devolução gerada no TOTVS (Devolução RFID → TRAFP005)
  transacao_branch INT,
  transacao_code BIGINT,
  transacao_date DATE,
  transacao_total NUMERIC(14, 2),
  transacao_status INT,         -- 1 em andamento · 4 atendida · 6 cancelada
  transacao_operacao INT,
  transacao_qtd_epcs INT,
  transacao_em TIMESTAMPTZ,
  transacao_atendida_em TIMESTAMPTZ,
  transacao_por TEXT,

  criado_por TEXT,
  ip_origem TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_devolucoes_status ON devolucoes_mercadoria (status, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_devolucoes_cliente ON devolucoes_mercadoria (cliente_code);
CREATE INDEX IF NOT EXISTS idx_devolucoes_chamado ON devolucoes_mercadoria (chamado_dryland_id)
  WHERE chamado_dryland_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_devolucoes_transacao ON devolucoes_mercadoria (transacao_branch, transacao_code)
  WHERE transacao_code IS NOT NULL;

CREATE OR REPLACE FUNCTION devolucoes_touch_atualizado_em()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.atualizado_em = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_devolucoes_touch ON devolucoes_mercadoria;
CREATE TRIGGER trg_devolucoes_touch BEFORE UPDATE ON devolucoes_mercadoria
  FOR EACH ROW EXECUTE FUNCTION devolucoes_touch_atualizado_em();
