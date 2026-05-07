-- Tabela para armazenar notas fiscais sincronizadas da TOTVS
CREATE TABLE IF NOT EXISTS notas_fiscais (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Identificação única da NF na TOTVS
  branch_code          INTEGER NOT NULL,           -- Código da filial emissora
  transaction_code     INTEGER NOT NULL,           -- Nº da transação TOTVS

  -- Dados da nota fiscal
  invoice_code         TEXT,                       -- Nº da NF
  serial_code          TEXT,                       -- Série
  issue_date           DATE,                       -- Data de emissão
  transaction_date     DATE,                       -- Data da transação
  transaction_branch_code INTEGER,                 -- Filial da transação (pode diferir)
  invoice_status       TEXT,                       -- Authorized | Canceled | etc.

  -- Dados da filial emissora
  branch_cnpj          TEXT,

  -- Dados da pessoa (cliente / fornecedor)
  person_code          INTEGER,
  person_name          TEXT,

  -- Operação fiscal
  operation_name       TEXT,
  operation_code       INTEGER,
  operation_type       TEXT,                       -- Output | Input

  -- Valores financeiros
  total_value          DECIMAL(15, 2),
  product_value        DECIMAL(15, 2),
  discount_value       DECIMAL(15, 2),
  discount_percentage  DECIMAL(10, 4),
  freight_value        DECIMAL(15, 2),
  insurance_value      DECIMAL(15, 2),
  other_expenses       DECIMAL(15, 2),
  ipi_value            DECIMAL(15, 2),
  icms_st_value        DECIMAL(15, 2),
  pis_value            DECIMAL(15, 2),
  cofins_value         DECIMAL(15, 2),

  -- Contagem
  quantity             DECIMAL(15, 4),

  -- Itens da nota (expand=items)
  items                JSONB DEFAULT '[]'::jsonb,

  -- Dado bruto completo da API (para referência futura)
  raw_data             JSONB,

  -- Controle de sincronização
  synced_at            TIMESTAMPTZ DEFAULT NOW(),  -- Última vez que foi sincronizado
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

-- Chave de unicidade: filial + transação (identifica a NF unicamente na TOTVS)
ALTER TABLE notas_fiscais
  ADD CONSTRAINT uq_notas_fiscais_branch_transaction
  UNIQUE (branch_code, transaction_code);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_nf_branch_code      ON notas_fiscais(branch_code);
CREATE INDEX IF NOT EXISTS idx_nf_issue_date       ON notas_fiscais(issue_date DESC);
CREATE INDEX IF NOT EXISTS idx_nf_invoice_status   ON notas_fiscais(invoice_status);
CREATE INDEX IF NOT EXISTS idx_nf_person_code      ON notas_fiscais(person_code);
CREATE INDEX IF NOT EXISTS idx_nf_invoice_code     ON notas_fiscais(invoice_code);
CREATE INDEX IF NOT EXISTS idx_nf_synced_at        ON notas_fiscais(synced_at DESC);

-- Trigger para atualizar updated_at automaticamente
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_notas_fiscais_updated_at
  BEFORE UPDATE ON notas_fiscais
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Habilitar Row Level Security
ALTER TABLE notas_fiscais ENABLE ROW LEVEL SECURITY;

-- Política: usuários autenticados podem visualizar
CREATE POLICY "Usuarios autenticados podem visualizar NFs"
  ON notas_fiscais
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Política: apenas service_role pode inserir/atualizar (via backend)
CREATE POLICY "Service role pode inserir NFs"
  ON notas_fiscais
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Service role pode atualizar NFs"
  ON notas_fiscais
  FOR UPDATE
  USING (true);
