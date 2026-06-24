-- ============================================================
-- TABELA: template_disparos
-- Registra cada envio de template do CrosbyBot pra um contato
-- específico, pra depois cruzar com NFs e medir conversão.
-- ============================================================

CREATE TABLE IF NOT EXISTS template_disparos (
  id BIGSERIAL PRIMARY KEY,

  -- Identificação do disparo
  campaign_id UUID NOT NULL,
  campaign_name TEXT,

  -- Template
  template_name TEXT NOT NULL,
  template_language TEXT DEFAULT 'pt_BR',
  template_category TEXT,

  -- Conta WhatsApp
  account_id UUID,
  waba_id TEXT,

  -- Destinatário
  person_code BIGINT,           -- código TOTVS do cliente (pra cruzar com NFs)
  phone_number TEXT NOT NULL,   -- telefone destino (com DDI 55)
  contact_name TEXT,
  cpf_cnpj TEXT,

  -- Metadados do envio
  origem TEXT,                  -- 'totvs' | 'csv' | 'manual' | etc.
  template_variables JSONB DEFAULT '{}'::jsonb,
  status TEXT DEFAULT 'queued', -- queued | sent | delivered | read | failed
  meta_message_id TEXT,         -- ID retornado pela Meta após envio
  error_message TEXT,

  -- Timestamps
  scheduled_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Conversão (preenchido posteriormente por job/relatório)
  comprou BOOLEAN DEFAULT FALSE,         -- houve venda após o disparo?
  data_compra DATE,                      -- data da 1ª compra após disparo
  valor_compra NUMERIC(15, 2) DEFAULT 0, -- soma de NFs após disparo
  nfs_apos_disparo INT DEFAULT 0,        -- nº de NFs após disparo

  UNIQUE (campaign_id, phone_number)
);

CREATE INDEX IF NOT EXISTS idx_disparos_person_code ON template_disparos (person_code);
CREATE INDEX IF NOT EXISTS idx_disparos_template ON template_disparos (template_name);
CREATE INDEX IF NOT EXISTS idx_disparos_campaign ON template_disparos (campaign_id);
CREATE INDEX IF NOT EXISTS idx_disparos_phone ON template_disparos (phone_number);
CREATE INDEX IF NOT EXISTS idx_disparos_sent_at ON template_disparos (sent_at);
