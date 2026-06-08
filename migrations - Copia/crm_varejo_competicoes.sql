-- ─────────────────────────────────────────────────────────────────────
-- crm_varejo_competicoes
-- Competições de faturamento entre lojas varejo, com histórico.
-- Cada competição tem um período definido e N filiais participantes.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS crm_varejo_competicoes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  nome            TEXT NOT NULL,
  descricao       TEXT,
  premiacao       TEXT,                      -- "iPhone 15", "R$ 1.000 PIX", etc.

  -- Período da competição
  data_inicio     DATE NOT NULL,
  data_fim        DATE NOT NULL,
  duracao_preset  TEXT CHECK (duracao_preset IN ('1w','15d','1m','custom')),

  -- Lojas participantes (branch_code do TOTVS)
  branch_codes    INTEGER[] NOT NULL CHECK (array_length(branch_codes, 1) >= 2),

  -- Tipo de meta (default: faturamento)
  meta_tipo       TEXT NOT NULL DEFAULT 'faturamento'
                  CHECK (meta_tipo IN ('faturamento','aberturas','reativacoes')),
  meta_valor      NUMERIC(14,2),              -- alvo opcional (R$)

  -- Status
  status          TEXT NOT NULL DEFAULT 'ativa'
                  CHECK (status IN ('ativa','encerrada','cancelada')),

  -- Snapshot final (preenchido ao encerrar)
  vencedor_branch INTEGER,
  vencedor_valor  NUMERIC(14,2),
  ranking_final   JSONB,                     -- [{branch_code, branch_name, valor, posicao}]
  encerrada_em    TIMESTAMPTZ,
  encerrada_por   TEXT,

  -- Metadata
  criado_por      TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT crm_varejo_competicoes_periodo_valido
    CHECK (data_fim >= data_inicio)
);

CREATE INDEX IF NOT EXISTS crm_varejo_competicoes_status_idx
  ON crm_varejo_competicoes (status, data_inicio DESC);

CREATE INDEX IF NOT EXISTS crm_varejo_competicoes_periodo_idx
  ON crm_varejo_competicoes (data_inicio, data_fim);

CREATE INDEX IF NOT EXISTS crm_varejo_competicoes_branches_idx
  ON crm_varejo_competicoes USING GIN (branch_codes);

COMMENT ON TABLE crm_varejo_competicoes IS
  'Competições internas entre lojas varejo (gestor define períodos e participantes)';
COMMENT ON COLUMN crm_varejo_competicoes.branch_codes IS
  'Array de branch_code do TOTVS — lojas participantes da competição';
COMMENT ON COLUMN crm_varejo_competicoes.ranking_final IS
  'Snapshot do ranking ao encerrar — pra histórico imutável';
