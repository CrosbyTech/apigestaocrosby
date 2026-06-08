-- ====================================================================
-- CRM VAREJO — AVISOS DE REUNIÃO
-- Cadastrados pelo gerente, exibidos na reunião semanal.
-- ====================================================================

CREATE TABLE IF NOT EXISTS crm_varejo_avisos (
  id              SERIAL PRIMARY KEY,
  titulo          TEXT NOT NULL,
  conteudo        TEXT NOT NULL,
  -- prioridade: 'normal' | 'alta' | 'urgente'
  prioridade      VARCHAR(10) NOT NULL DEFAULT 'normal',
  -- escopo opcional: ano + semana ISO (semana de referência) — null = avisos gerais
  ano             INTEGER,
  semana_iso      INTEGER,
  -- vigência (opcional): expira após esta data
  expira_em       DATE,
  ativo           BOOLEAN NOT NULL DEFAULT true,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  criado_por      TEXT
);

CREATE INDEX IF NOT EXISTS idx_crm_varejo_avisos_periodo
  ON crm_varejo_avisos(ano DESC, semana_iso DESC) WHERE ativo;
CREATE INDEX IF NOT EXISTS idx_crm_varejo_avisos_recentes
  ON crm_varejo_avisos(criado_em DESC) WHERE ativo;

COMMENT ON TABLE crm_varejo_avisos IS
  'Avisos semanais publicados pelo gerente (reunião de varejo)';
