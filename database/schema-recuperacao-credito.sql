-- ================================================
-- TABELAS PARA RECUPERAÇÃO DE CRÉDITO
-- Status e Anexos por cliente
-- ================================================

-- Tabela de status por cliente
CREATE TABLE IF NOT EXISTS recuperacao_credito_status (
  id BIGSERIAL PRIMARY KEY,
  cd_cliente VARCHAR(50) NOT NULL UNIQUE,
  nm_cliente VARCHAR(255),
  status VARCHAR(50) NOT NULL DEFAULT 'PROTESTO',
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by TEXT
);

-- Tabela de anexos por cliente
CREATE TABLE IF NOT EXISTS recuperacao_credito_anexos (
  id BIGSERIAL PRIMARY KEY,
  cd_cliente VARCHAR(50) NOT NULL,
  nome_arquivo TEXT NOT NULL,
  file_path TEXT NOT NULL,
  tipo TEXT,
  uploaded_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_rec_credito_status_cliente ON recuperacao_credito_status(cd_cliente);
CREATE INDEX IF NOT EXISTS idx_rec_credito_anexos_cliente ON recuperacao_credito_anexos(cd_cliente);

-- RLS
ALTER TABLE recuperacao_credito_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE recuperacao_credito_anexos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for recuperacao_credito_status"
  ON recuperacao_credito_status FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all for recuperacao_credito_anexos"
  ON recuperacao_credito_anexos FOR ALL USING (true) WITH CHECK (true);
