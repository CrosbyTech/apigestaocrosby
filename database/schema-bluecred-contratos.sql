-- ============================================================
-- Tabela: bluecred_contratos
-- Armazena os contratos de crédito enviados para assinatura
-- via Autentique, com status de assinatura de cada parte.
-- ============================================================

CREATE TABLE IF NOT EXISTS bluecred_contratos (
  id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  autentique_doc_id  TEXT         NOT NULL UNIQUE,
  cliente_nome       TEXT         NOT NULL,
  cliente_cpf        TEXT         NOT NULL,
  cliente_whatsapp   TEXT,
  -- pendente | parcialmente_assinado | concluido | recusado
  status             TEXT         NOT NULL DEFAULT 'pendente',
  total_assinantes   INTEGER      NOT NULL DEFAULT 2,
  total_assinados    INTEGER      NOT NULL DEFAULT 0,
  -- Array: [{ public_id, name, signed_at, action }]
  assinaturas        JSONB        NOT NULL DEFAULT '[]'::jsonb,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Índices úteis
CREATE INDEX IF NOT EXISTS idx_bluecred_contratos_cliente_cpf
  ON bluecred_contratos (cliente_cpf);

CREATE INDEX IF NOT EXISTS idx_bluecred_contratos_status
  ON bluecred_contratos (status);

CREATE INDEX IF NOT EXISTS idx_bluecred_contratos_created_at
  ON bluecred_contratos (created_at DESC);

-- Trigger para updated_at automático
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_bluecred_contratos_updated_at ON bluecred_contratos;
CREATE TRIGGER trg_bluecred_contratos_updated_at
  BEFORE UPDATE ON bluecred_contratos
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- RLS: desabilitar para acesso via service key (backend)
ALTER TABLE bluecred_contratos DISABLE ROW LEVEL SECURITY;
