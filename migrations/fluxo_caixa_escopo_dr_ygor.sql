-- ============================================================================
-- 27/10/2026 — Extratos bancários do Dr Ygor (Financeiro → Dr Ygor).
-- Mesmas tabelas do Fluxo de Caixa Ext, separadas por ESCOPO na conta:
--   'crosby'  = extratos do grupo (página Extrato Bancário, padrão)
--   'dr_ygor' = extratos do Dr Ygor Dantas (contestação das retiradas 2025)
-- Importações, lançamentos e transferências herdam o escopo pela conta_id.
-- ============================================================================
ALTER TABLE fluxo_caixa_contas ADD COLUMN IF NOT EXISTS escopo TEXT NOT NULL DEFAULT 'crosby';
ALTER TABLE fluxo_caixa_contas DROP CONSTRAINT IF EXISTS fluxo_caixa_contas_banco_agencia_conta_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_fc_contas_banco_agencia_conta_escopo ON fluxo_caixa_contas (banco, agencia, conta, escopo);
CREATE INDEX IF NOT EXISTS idx_fc_contas_escopo ON fluxo_caixa_contas (escopo);
COMMENT ON COLUMN fluxo_caixa_contas.escopo IS 'crosby (Extrato Bancário do grupo) | dr_ygor (Financeiro → Dr Ygor → Extratos Bancários)';
