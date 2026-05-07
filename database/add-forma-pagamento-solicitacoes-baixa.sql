-- Adicionar colunas de forma de pagamento e dados do cartão na tabela solicitacoes_baixa
ALTER TABLE solicitacoes_baixa ADD COLUMN IF NOT EXISTS forma_pagamento TEXT;
ALTER TABLE solicitacoes_baixa ADD COLUMN IF NOT EXISTS dados_cartao JSONB;

-- Comentários
COMMENT ON COLUMN solicitacoes_baixa.forma_pagamento IS 'Forma de pagamento: conta_corrente, adiantamento, cartao_credito, cartao_debito, credev';
COMMENT ON COLUMN solicitacoes_baixa.dados_cartao IS 'Dados do cartão (bandeira, autorizacao, nsu) para pagamentos com cartão de crédito/débito';
