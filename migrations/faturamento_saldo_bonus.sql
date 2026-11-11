-- ============================================================================
-- SALDO BÔNUS DO CLIENTE (faturamento da expedição) — 11/11/2026
-- Pedido com PEÇA EM FALTA em que o cliente preferiu ficar com o crédito: a
-- peça sai da nota e o valor dela vira saldo bônus do cliente aqui no
-- HeadCoach (a API do TOTVS não tem como incluir adiantamento). O saldo é
-- usado depois como forma de pagamento "Saldo bônus" em outro faturamento.
-- Livro-razão: o saldo de um crédito = valor − usos + estornos − cancelamentos.
-- Idempotente.
-- ============================================================================
CREATE TABLE IF NOT EXISTS faturamento_saldo_bonus (
  id BIGSERIAL PRIMARY KEY,
  cliente_code BIGINT NOT NULL,
  cliente_nome TEXT,
  cliente_cpf_cnpj TEXT,
  tipo TEXT NOT NULL CHECK (tipo IN ('credito', 'uso', 'estorno', 'cancelamento')),
  valor NUMERIC(14, 2) NOT NULL CHECK (valor > 0),
  credito_id BIGINT,          -- uso / estorno / cancelamento: o crédito de onde saiu
  venda_id BIGINT,            -- crédito: venda que gerou · uso e estorno: venda que usou
  numero_site TEXT,
  motivo TEXT,
  origem JSONB,               -- crédito: pagamento que o cliente fez { forma, parcelas, cartao_totvs, autorizacao }
  criado_por TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fsb_cliente ON faturamento_saldo_bonus (cliente_code, criado_em);
CREATE INDEX IF NOT EXISTS idx_fsb_venda ON faturamento_saldo_bonus (venda_id);
CREATE INDEX IF NOT EXISTS idx_fsb_credito ON faturamento_saldo_bonus (credito_id);
-- uma venda gera no máximo um crédito
CREATE UNIQUE INDEX IF NOT EXISTS idx_fsb_credito_por_venda ON faturamento_saldo_bonus (venda_id) WHERE tipo = 'credito';

-- forma de pagamento "saldo_bonus" nas vendas
ALTER TABLE pdv_venda_pagamentos DROP CONSTRAINT IF EXISTS pdv_venda_pagamentos_forma_check;
ALTER TABLE pdv_venda_pagamentos ADD CONSTRAINT pdv_venda_pagamentos_forma_check
  CHECK (forma IN ('dinheiro', 'pix', 'credito', 'debito', 'credito_loja', 'vale_troca', 'boleto', 'adiantamento', 'saldo_bonus'));
