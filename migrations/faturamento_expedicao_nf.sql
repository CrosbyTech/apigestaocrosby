-- ============================================================================
-- FATURAMENTO DA EXPEDIÇÃO COM NF-e PELO HEADCOACH (empresa 99)
-- O FATURAR da tela Pedido de Venda vira uma venda do PDV Crosby (pdv_vendas,
-- origem 'expedicao'): a NF-e sai pelo emissor do HeadCoach e o TOTVS recebe
-- só o DOCUMENTO INTERNO (ops 511/7807/7808/7809, modelo 35) com o contas a
-- receber (transaction-receiving). EPCs no kardex pdv_epc_movimentos.
-- Idempotente.
-- ============================================================================

-- Venda: de onde veio e os dados do pedido do Dryland
ALTER TABLE pdv_vendas ADD COLUMN IF NOT EXISTS origem TEXT NOT NULL DEFAULT 'pdv';     -- pdv | expedicao
ALTER TABLE pdv_vendas ADD COLUMN IF NOT EXISTS canal TEXT;                             -- varejo | revenda | mtm | franquias
ALTER TABLE pdv_vendas ADD COLUMN IF NOT EXISTS pedido_chave TEXT;                      -- id do card da fila ou SEP:<ref>
ALTER TABLE pdv_vendas ADD COLUMN IF NOT EXISTS numero_site TEXT;                       -- RV123 / MT45 …
ALTER TABLE pdv_vendas ADD COLUMN IF NOT EXISTS data_caixa DATE;                        -- data do caixa aberto no TOTVS (transação/recebimento)
ALTER TABLE pdv_vendas ADD COLUMN IF NOT EXISTS operacao_doc_interno INT;               -- operação do documento interno no TOTVS
ALTER TABLE pdv_vendas ADD COLUMN IF NOT EXISTS frete NUMERIC(14, 2) NOT NULL DEFAULT 0;
ALTER TABLE pdv_vendas ADD COLUMN IF NOT EXISTS transporte JSONB;                       -- { transportadoraCode, nome, cnpj, servico, modFrete, volumes, pesoB, pesoL }
ALTER TABLE pdv_vendas ADD COLUMN IF NOT EXISTS cobranca JSONB;                         -- { parcelas: [{ n, vencimento, valor }] } (boleto)
ALTER TABLE pdv_vendas ADD COLUMN IF NOT EXISTS comprovantes JSONB NOT NULL DEFAULT '[]'::jsonb; -- [{ url, path }] do Dryland
ALTER TABLE pdv_vendas ADD COLUMN IF NOT EXISTS pedido_info JSONB;                      -- forma, parcelamento, NSU, autorização… do card
CREATE INDEX IF NOT EXISTS idx_pdv_vendas_origem ON pdv_vendas (origem, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_pdv_vendas_pedido ON pdv_vendas (pedido_chave);

-- Item: produção própria (5101/6101/6107) ou adquirido de terceiros (5102/6102/6108)
ALTER TABLE pdv_venda_itens ADD COLUMN IF NOT EXISTS tipo_fiscal TEXT;
ALTER TABLE pdv_venda_itens ADD COLUMN IF NOT EXISTS cfop INT;

-- Boleto (fatura) como forma de pagamento
ALTER TABLE pdv_venda_pagamentos DROP CONSTRAINT IF EXISTS pdv_venda_pagamentos_forma_check;
ALTER TABLE pdv_venda_pagamentos ADD CONSTRAINT pdv_venda_pagamentos_forma_check
  CHECK (forma IN ('dinheiro', 'pix', 'credito', 'debito', 'credito_loja', 'vale_troca', 'boleto'));

-- Produção × adquirido por produto, aprendido das NF-e autorizadas do TOTVS
CREATE TABLE IF NOT EXISTS fiscal_produto_tipo (
  empresa INT NOT NULL,
  product_code BIGINT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('producao', 'adquirido')),
  nome TEXT,
  notas_producao INT NOT NULL DEFAULT 0,
  notas_adquirido INT NOT NULL DEFAULT 0,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa, product_code)
);
CREATE INDEX IF NOT EXISTS idx_fiscal_produto_tipo_nome ON fiscal_produto_tipo (empresa, nome);

-- Faturamento ligado à venda/nota do HeadCoach (a transação TOTVS vem depois)
ALTER TABLE pedidos_venda_faturamentos ALTER COLUMN transacao_code DROP NOT NULL;
ALTER TABLE pedidos_venda_faturamentos ADD COLUMN IF NOT EXISTS venda_id BIGINT;
ALTER TABLE pedidos_venda_faturamentos ADD COLUMN IF NOT EXISTS nf_numero INT;
ALTER TABLE pedidos_venda_faturamentos ADD COLUMN IF NOT EXISTS nf_serie INT;
ALTER TABLE pedidos_venda_faturamentos ADD COLUMN IF NOT EXISTS nf_chave TEXT;
ALTER TABLE pedidos_venda_faturamentos ADD COLUMN IF NOT EXISTS nf_status TEXT;
ALTER TABLE pedidos_venda_faturamentos ADD COLUMN IF NOT EXISTS totvs_erro TEXT;
ALTER TABLE pedidos_venda_faturamentos ADD COLUMN IF NOT EXISTS frete NUMERIC(14, 2) NOT NULL DEFAULT 0;
ALTER TABLE pedidos_venda_faturamentos ADD COLUMN IF NOT EXISTS forma_pagamento TEXT;
CREATE INDEX IF NOT EXISTS idx_pvfat_venda ON pedidos_venda_faturamentos (venda_id);
