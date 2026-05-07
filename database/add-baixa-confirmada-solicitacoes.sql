-- =====================================================
-- Adicionar campos de Baixa Confirmada na tabela solicitacoes_baixa
-- =====================================================

ALTER TABLE solicitacoes_baixa
  ADD COLUMN IF NOT EXISTS baixa_confirmada BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS baixa_confirmada_em TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS baixa_confirmada_por TEXT;
