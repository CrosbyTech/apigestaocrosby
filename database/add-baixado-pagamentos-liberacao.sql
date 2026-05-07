-- =============================================
-- Migration: adiciona campo "baixado" em pagamentos_liberacao
-- Indica se o título foi baixado no ERP TOTVS pela conciliadora
-- Execute no Supabase SQL Editor
-- =============================================

ALTER TABLE pagamentos_liberacao
  ADD COLUMN IF NOT EXISTS baixado        BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS baixado_por    VARCHAR(255),
  ADD COLUMN IF NOT EXISTS baixado_em     TIMESTAMPTZ;

-- Índice para facilitar consultas de não-baixados
CREATE INDEX IF NOT EXISTS idx_pagamentos_liberacao_baixado
  ON pagamentos_liberacao(baixado)
  WHERE status = 'PAGO';

COMMENT ON COLUMN pagamentos_liberacao.baixado     IS 'Indica se o título foi baixado no ERP TOTVS';
COMMENT ON COLUMN pagamentos_liberacao.baixado_por IS 'E-mail do usuário que realizou a baixa';
COMMENT ON COLUMN pagamentos_liberacao.baixado_em  IS 'Data/hora em que a baixa foi registrada';
