-- ============================================================================
-- PDV CROSBY v3 — espelho da venda HEADCOACH no TOTVS como DOCUMENTO INTERNO
-- Modo HEADCOACH: a venda e a nota fiscal são do HeadCoach; a mesma venda é
-- duplicada no TOTVS numa operação de documento interno (sem NF), já recebida
-- pela API (transaction-receiving) → ATENDIDA, com o financeiro lançado para a
-- conciliação. Idempotente.
-- ============================================================================

-- Configuração por empresa (Administração → Fiscal PDV)
ALTER TABLE pdv_fiscal_config ADD COLUMN IF NOT EXISTS espelhar_totvs BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE pdv_fiscal_config ADD COLUMN IF NOT EXISTS operacao_doc_interno INT NOT NULL DEFAULT 511;  -- 511-VENDA VAREJO * (modelo 35)
ALTER TABLE pdv_fiscal_config ADD COLUMN IF NOT EXISTS terminal_totvs INT NOT NULL DEFAULT 1;           -- terminal com caixa aberto
ALTER TABLE pdv_fiscal_config ADD COLUMN IF NOT EXISTS cliente_balcao_totvs INT;                        -- cliente p/ NFC-e sem CPF

-- Resultado do espelho em cada venda
ALTER TABLE pdv_vendas ADD COLUMN IF NOT EXISTS totvs_transacao_code BIGINT;
ALTER TABLE pdv_vendas ADD COLUMN IF NOT EXISTS totvs_transacao_date DATE;
ALTER TABLE pdv_vendas ADD COLUMN IF NOT EXISTS totvs_status INT;              -- 1 em andamento · 4 atendida (recebida)
ALTER TABLE pdv_vendas ADD COLUMN IF NOT EXISTS totvs_doc_interno_seq BIGINT;  -- fatura/sequência do documento modelo 35
ALTER TABLE pdv_vendas ADD COLUMN IF NOT EXISTS totvs_erro TEXT;
ALTER TABLE pdv_vendas ADD COLUMN IF NOT EXISTS totvs_espelhado_em TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_pdv_vendas_totvs_trx ON pdv_vendas (empresa, totvs_transacao_code) WHERE totvs_transacao_code IS NOT NULL;
