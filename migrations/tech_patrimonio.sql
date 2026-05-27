-- ====================================================================
-- TECNOLOGIA — INVENTÁRIO DE PATRIMÔNIO
-- Cadastro de bens da empresa: ar condicionado, celular, computador,
-- impressora, móveis, etc. Cada item tem um código de patrimônio único.
-- ====================================================================

CREATE TABLE IF NOT EXISTS tech_patrimonio (
  id                  SERIAL PRIMARY KEY,
  codigo_patrimonio   TEXT NOT NULL UNIQUE,                  -- ex: PAT-001234 (identificador único)
  tipo                VARCHAR(30) NOT NULL,                  -- ar_condicionado, celular, computador, impressora, monitor, mobiliario, outro
  descricao           TEXT,                                  -- descrição livre
  marca               TEXT,                                  -- ex: Samsung, Dell, Carrier
  modelo              TEXT,                                  -- ex: Galaxy S24, Latitude 5420
  numero_serie        TEXT,                                  -- serial number do equipamento
  -- Localização e responsabilidade
  local               TEXT,                                  -- ex: Sala da Diretoria, Filial Recife
  setor               TEXT,                                  -- ex: TI, Financeiro, Vendas
  responsavel         TEXT,                                  -- nome da pessoa responsável
  responsavel_cpf     TEXT,                                  -- CPF (opcional)
  responsavel_email   TEXT,                                  -- e-mail (opcional)
  -- Aquisição
  data_aquisicao      DATE,
  valor_aquisicao     NUMERIC(12, 2),                        -- valor pago
  fornecedor          TEXT,                                  -- onde foi comprado
  nota_fiscal         TEXT,                                  -- número da NF
  -- Estado atual
  status              VARCHAR(20) NOT NULL DEFAULT 'ativo',  -- ativo|em_manutencao|emprestado|descartado|extraviado
  observacao          TEXT,
  -- Auditoria
  criado_em           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  criado_por          TEXT,                                  -- email/login do usuário
  atualizado_por      TEXT
);

CREATE INDEX IF NOT EXISTS idx_tech_patrimonio_tipo ON tech_patrimonio(tipo);
CREATE INDEX IF NOT EXISTS idx_tech_patrimonio_status ON tech_patrimonio(status);
CREATE INDEX IF NOT EXISTS idx_tech_patrimonio_setor ON tech_patrimonio(setor);
CREATE INDEX IF NOT EXISTS idx_tech_patrimonio_local ON tech_patrimonio(local);
CREATE INDEX IF NOT EXISTS idx_tech_patrimonio_responsavel ON tech_patrimonio(responsavel);
CREATE INDEX IF NOT EXISTS idx_tech_patrimonio_codigo ON tech_patrimonio(codigo_patrimonio);

-- Log de alterações
CREATE TABLE IF NOT EXISTS tech_patrimonio_log (
  id                  SERIAL PRIMARY KEY,
  patrimonio_id       INTEGER REFERENCES tech_patrimonio(id) ON DELETE CASCADE,
  acao                VARCHAR(20) NOT NULL,                  -- create|update|delete|transferencia
  campo_alterado      TEXT,
  valor_anterior      TEXT,
  valor_novo          TEXT,
  alterado_em         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  alterado_por        TEXT
);

CREATE INDEX IF NOT EXISTS idx_tech_patrimonio_log_pat ON tech_patrimonio_log(patrimonio_id);

-- Trigger pra atualizar atualizado_em automaticamente
CREATE OR REPLACE FUNCTION update_tech_patrimonio_atualizado_em()
RETURNS TRIGGER AS $$
BEGIN
  NEW.atualizado_em = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tech_patrimonio_atualizado_em ON tech_patrimonio;
CREATE TRIGGER trg_tech_patrimonio_atualizado_em
  BEFORE UPDATE ON tech_patrimonio
  FOR EACH ROW
  EXECUTE FUNCTION update_tech_patrimonio_atualizado_em();

-- Comentários nas colunas (documentação)
COMMENT ON TABLE tech_patrimonio IS 'Inventário de patrimônio da empresa (Tecnologia)';
COMMENT ON COLUMN tech_patrimonio.codigo_patrimonio IS 'Identificador único do bem (ex: PAT-001234)';
COMMENT ON COLUMN tech_patrimonio.tipo IS 'Categoria: ar_condicionado, celular, computador, impressora, monitor, mobiliario, outro';
COMMENT ON COLUMN tech_patrimonio.status IS 'ativo|em_manutencao|emprestado|descartado|extraviado';
