-- ─────────────────────────────────────────────────────────────────────────
-- crm_lead_generation_calls
-- Histórico de ligações feitas pelos vendedores no módulo Lead Generation
-- ─────────────────────────────────────────────────────────────────────────
-- Aplicar no Supabase (NÃO no supabaseFiscal):
--   psql ... -f crm_lead_generation_calls.sql
-- OU pelo dashboard SQL Editor

CREATE TABLE IF NOT EXISTS crm_lead_generation_calls (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Quem ligou
  vendedor_code   INTEGER NOT NULL,
  vendedor_nome   TEXT,
  modulo          TEXT NOT NULL,           -- multimarcas | revenda | varejo | business

  -- Cliente
  person_code     INTEGER NOT NULL,
  person_nome     TEXT,
  person_telefone TEXT,
  person_cidade   TEXT,
  person_uf       TEXT,

  -- Categoria do contato (porque o lead apareceu na lista)
  categoria       TEXT NOT NULL,           -- ativo | a_inativar | inativo | aniversariante | cashback | top

  -- Detalhes da ligação
  data_contato    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atendida        BOOLEAN NOT NULL,
  observacao      TEXT,

  -- Auditoria
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_login      TEXT
);

-- Índices pra acelerar filtros comuns
CREATE INDEX IF NOT EXISTS crm_lgc_person_idx
  ON crm_lead_generation_calls (person_code, data_contato DESC);

CREATE INDEX IF NOT EXISTS crm_lgc_vendedor_idx
  ON crm_lead_generation_calls (vendedor_code, data_contato DESC);

CREATE INDEX IF NOT EXISTS crm_lgc_modulo_data_idx
  ON crm_lead_generation_calls (modulo, data_contato DESC);

CREATE INDEX IF NOT EXISTS crm_lgc_categoria_idx
  ON crm_lead_generation_calls (categoria, data_contato DESC);

COMMENT ON TABLE  crm_lead_generation_calls IS 'Registro de ligações de prospecção por vendedor (módulo Lead Generation do CRM)';
COMMENT ON COLUMN crm_lead_generation_calls.categoria IS 'ativo | a_inativar | inativo | aniversariante | cashback | top';
COMMENT ON COLUMN crm_lead_generation_calls.atendida IS 'TRUE = cliente atendeu; FALSE = não atendeu / caixa postal / desligou';
