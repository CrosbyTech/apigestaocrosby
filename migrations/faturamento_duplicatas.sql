-- ============================================================================
-- DUPLICATAS DO FATURAMENTO DA EXPEDIÇÃO (services/faturamentoDuplicata.js)
-- Uma linha por venda com boleto: documento no Autentique, mensagem no WhatsApp
-- e assinatura. O mesmo estado é espelhado no card do Dryland (duplicata_*).
-- Idempotente.
-- ============================================================================
CREATE TABLE IF NOT EXISTS faturamento_duplicatas (
  venda_id BIGINT PRIMARY KEY,
  faturamento_id BIGINT,
  chave TEXT,                       -- id do card da fila do Dryland (ou SEP:/BRJ:)
  nf_numero INT,
  cliente_nome TEXT,
  telefone TEXT,                    -- número conferido no WhatsApp (JID)
  doc_id TEXT,                      -- documento no Autentique
  link TEXT,                        -- link de assinatura (assina.ae/…)
  status TEXT NOT NULL DEFAULT 'enviando',  -- enviando | enviada | assinada | erro | cancelada
  erro TEXT,
  enviada_em TIMESTAMPTZ,
  assinada_em TIMESTAMPTZ,
  assinada_url TEXT,
  chip TEXT,                        -- instância da UAZAPI que mandou
  mensagem_id TEXT,
  mensagem TEXT,
  criado_por TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fat_dup_status ON faturamento_duplicatas (status, enviada_em DESC);
