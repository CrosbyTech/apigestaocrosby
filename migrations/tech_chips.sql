-- ====================================================================
-- TECNOLOGIA — CONTROLE DE CHIPS
-- Cadastro dos chips/linhas telefônicas da empresa
-- ====================================================================

CREATE TABLE IF NOT EXISTS tech_chips (
  id              SERIAL PRIMARY KEY,
  numero          TEXT NOT NULL,                          -- (XX) 9XXXX-XXXX
  numero_clean    TEXT NOT NULL,                          -- só dígitos, único
  responsavel     TEXT,                                    -- nome da pessoa
  setor           TEXT,                                    -- ex: TI, RH, Vendas, etc
  local_uso       TEXT,                                    -- onde o chip é usado (loja, frota, escritório)
  operadora       VARCHAR(20),                             -- claro|vivo|tim|oi|outros
  plano           TEXT,                                    -- descrição do plano
  iccid           TEXT,                                    -- ID do chip físico (opcional)
  status          VARCHAR(15) NOT NULL DEFAULT 'ativo',    -- ativo|inativo|bloqueado|cancelado
  data_aquisicao  DATE,
  data_cancelamento DATE,
  observacao      TEXT,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  criado_por      TEXT,
  atualizado_por  TEXT,
  UNIQUE (numero_clean)
);

CREATE INDEX IF NOT EXISTS idx_tech_chips_status ON tech_chips(status) WHERE status = 'ativo';
CREATE INDEX IF NOT EXISTS idx_tech_chips_setor ON tech_chips(setor);
CREATE INDEX IF NOT EXISTS idx_tech_chips_operadora ON tech_chips(operadora);
CREATE INDEX IF NOT EXISTS idx_tech_chips_responsavel ON tech_chips(responsavel);

-- Log de alterações
CREATE TABLE IF NOT EXISTS tech_chips_log (
  id              SERIAL PRIMARY KEY,
  chip_id         INTEGER REFERENCES tech_chips(id) ON DELETE CASCADE,
  acao            VARCHAR(20) NOT NULL,                    -- create|update|delete
  campo_alterado  TEXT,
  valor_anterior  TEXT,
  valor_novo      TEXT,
  alterado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  alterado_por    TEXT
);

CREATE INDEX IF NOT EXISTS idx_tech_chips_log_chip ON tech_chips_log(chip_id, alterado_em DESC);

COMMENT ON TABLE tech_chips IS 'Controle de chips telefônicos da empresa';
COMMENT ON TABLE tech_chips_log IS 'Histórico de alterações dos chips';
