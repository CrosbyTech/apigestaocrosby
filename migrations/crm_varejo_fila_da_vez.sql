-- ====================================================================
-- FILA DA VEZ — Varejo
-- Sistema de fila por loja com vendedoras, atendimentos e métricas
-- ====================================================================

-- 1. Config por loja (PIN de acesso + flags)
CREATE TABLE IF NOT EXISTS fila_lojas_config (
  id            SERIAL PRIMARY KEY,
  branch_code   INTEGER UNIQUE NOT NULL,           -- código da loja (VAREJO_STORE_MAP)
  nome          TEXT,                                -- nome amigável (cache)
  pin           VARCHAR(10) NOT NULL,                -- PIN de acesso (4-6 dígitos)
  ativo         BOOLEAN NOT NULL DEFAULT true,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  criado_por    TEXT
);

-- 2. Vendedoras cadastradas por loja
CREATE TABLE IF NOT EXISTS fila_vendedoras (
  id            SERIAL PRIMARY KEY,
  branch_code   INTEGER NOT NULL,
  nome          TEXT NOT NULL,
  totvs_id      TEXT,                                -- código TOTVS opcional (pra cruzar venda)
  apelido       TEXT,                                -- mostrado na tela curta
  ativo         BOOLEAN NOT NULL DEFAULT true,
  criado_em    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (branch_code, nome)
);

CREATE INDEX IF NOT EXISTS idx_fila_vendedoras_branch ON fila_vendedoras(branch_code) WHERE ativo;

-- 3. Motivos de não-venda (cadastráveis por admin, globais)
CREATE TABLE IF NOT EXISTS fila_motivos_nao_venda (
  id           SERIAL PRIMARY KEY,
  motivo       TEXT NOT NULL UNIQUE,
  ordem        INTEGER NOT NULL DEFAULT 0,
  ativo        BOOLEAN NOT NULL DEFAULT true,
  criado_em    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed inicial de motivos comuns
INSERT INTO fila_motivos_nao_venda (motivo, ordem) VALUES
  ('Sem tamanho/numeração', 10),
  ('Preço alto', 20),
  ('Apenas olhando', 30),
  ('Não gostou da peça', 40),
  ('Sem disponibilidade da cor', 50),
  ('Voltará depois', 60),
  ('Buscava outra peça', 70),
  ('Forma de pagamento', 80)
ON CONFLICT (motivo) DO NOTHING;

-- 4. Estado atual de cada vendedora (uma linha por vendedora ativa)
-- status: 'disponivel' | 'em_atendimento' | 'pausa' | 'folga' | 'atestado'
CREATE TABLE IF NOT EXISTS fila_vendedora_status (
  vendedora_id      INTEGER PRIMARY KEY REFERENCES fila_vendedoras(id) ON DELETE CASCADE,
  branch_code       INTEGER NOT NULL,
  status            VARCHAR(20) NOT NULL DEFAULT 'disponivel',
  posicao_fila      INTEGER,                        -- ordem FIFO (menor = próximo)
  atendimento_id    INTEGER,                        -- se em_atendimento, FK pro atendimento aberto
  inicio_status     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fila_vendedora_status_branch ON fila_vendedora_status(branch_code, status, posicao_fila);

-- 5. Histórico de atendimentos
CREATE TABLE IF NOT EXISTS fila_atendimentos (
  id                  SERIAL PRIMARY KEY,
  branch_code         INTEGER NOT NULL,
  vendedora_id        INTEGER NOT NULL REFERENCES fila_vendedoras(id),
  vendedora_nome      TEXT NOT NULL,                -- snapshot do nome
  inicio              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fim                 TIMESTAMPTZ,
  duracao_segundos    INTEGER,                       -- calculado ao fechar
  houve_venda         BOOLEAN,
  cliente_cpf_cnpj    TEXT,                          -- digitado pela vendedora
  cliente_nome        TEXT,                          -- preenchido via TOTVS lookup
  cliente_validado    BOOLEAN DEFAULT false,         -- true se encontrou no TOTVS
  valor_venda         NUMERIC(12,2),                 -- preenchido via cruzamento TOTVS
  nota_fiscal_id      TEXT,                          -- número da NF se encontrada
  motivo_nao_venda_id INTEGER REFERENCES fila_motivos_nao_venda(id),
  motivo_nao_venda_txt TEXT,                         -- snapshot do motivo
  observacao          TEXT,
  criado_em           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fila_atendimentos_branch_data ON fila_atendimentos(branch_code, inicio DESC);
CREATE INDEX IF NOT EXISTS idx_fila_atendimentos_vendedora ON fila_atendimentos(vendedora_id, inicio DESC);
CREATE INDEX IF NOT EXISTS idx_fila_atendimentos_data ON fila_atendimentos(inicio DESC);

-- 6. Histórico de mudanças de status (auditoria / cálculo de tempo em pausa)
CREATE TABLE IF NOT EXISTS fila_status_log (
  id              SERIAL PRIMARY KEY,
  vendedora_id    INTEGER NOT NULL REFERENCES fila_vendedoras(id) ON DELETE CASCADE,
  branch_code     INTEGER NOT NULL,
  status_anterior VARCHAR(20),
  status_novo     VARCHAR(20) NOT NULL,
  duracao_segundos INTEGER,                          -- tempo no status anterior
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fila_status_log_vend ON fila_status_log(vendedora_id, criado_em DESC);

-- ====================================================================
COMMENT ON TABLE fila_lojas_config IS 'Configuração da Fila da Vez por loja (PIN, ativo)';
COMMENT ON TABLE fila_vendedoras IS 'Cadastro de vendedoras participantes da fila por loja';
COMMENT ON TABLE fila_motivos_nao_venda IS 'Motivos cadastráveis para não-venda (admin gerencia)';
COMMENT ON TABLE fila_vendedora_status IS 'Estado atual de cada vendedora (posição FIFO, status)';
COMMENT ON TABLE fila_atendimentos IS 'Histórico completo de atendimentos com cruzamento TOTVS';
COMMENT ON TABLE fila_status_log IS 'Log de mudanças de status para auditoria e métricas de tempo';
