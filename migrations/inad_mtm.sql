-- ============================================================================
-- INADIMPLÊNCIA MTM › VENDA x INADIMPLÊNCIA POR VENDEDOR (João/BRUCE, 25/11/2026)
-- O cálculo é feito pela API (services/inadimplenciaMtm.js) e GRAVADO aqui;
-- o painel só lê. Só acréscimos (CREATE … IF NOT EXISTS): pode rodar de novo.
--   node scripts/migrar-inad-mtm.mjs
-- ============================================================================

-- Ajustes manuais por vendedor e semana (nunca sobrescrevem o valor do sistema)
CREATE TABLE IF NOT EXISTS inad_ajustes (
  id            bigserial PRIMARY KEY,
  vendedor_cod  integer       NOT NULL,
  semana_ref    date          NOT NULL,              -- segunda-feira da semana
  tipo          text          NOT NULL CHECK (tipo IN ('FATURADO', 'INADIMPLENCIA')),
  valor         numeric(14,2) NOT NULL,              -- positivo ou negativo
  motivo        text          NOT NULL,
  usuario       text,
  criado_em     timestamptz   NOT NULL DEFAULT now(),
  excluido_em   timestamptz,                         -- exclusão lógica (o histórico fica)
  excluido_por  text
);
CREATE INDEX IF NOT EXISTS inad_ajustes_semana_idx ON inad_ajustes (semana_ref, vendedor_cod);

-- Foto semanal por vendedor (uma linha por vendedor e semana; a apuração da
-- semana em curso pode ser refeita e substitui a linha da própria semana)
CREATE TABLE IF NOT EXISTS inad_snapshot (
  id                    bigserial PRIMARY KEY,
  vendedor_cod          integer       NOT NULL,
  vendedor_nome         text,
  semana_ref            date          NOT NULL,      -- segunda-feira da semana
  data_apuracao         timestamptz   NOT NULL DEFAULT now(),
  desde                 date,                         -- data de entrada do vendedor
  faturado              numeric(14,2) NOT NULL,       -- sistema: TOTVS + HeadCoach
  inadimplencia_60d     numeric(14,2) NOT NULL,
  ajuste_faturado       numeric(14,2) NOT NULL DEFAULT 0,
  ajuste_inadimplencia  numeric(14,2) NOT NULL DEFAULT 0,
  faturado_final        numeric(14,2) NOT NULL,
  inadimplencia_final   numeric(14,2) NOT NULL,
  pct_inadimplencia     numeric(9,4),                 -- NULL = sem faturamento
  carteira_vencida      numeric(14,2) NOT NULL DEFAULT 0,
  clientes              integer       NOT NULL DEFAULT 0,
  clientes_inadimplentes jsonb,                       -- lista do modal (cliente, valor, dias)
  origem                text,                         -- 'job' | 'manual:<usuário>'
  UNIQUE (vendedor_cod, semana_ref)
);
CREATE INDEX IF NOT EXISTS inad_snapshot_semana_idx ON inad_snapshot (semana_ref DESC);

ALTER TABLE inad_ajustes ENABLE ROW LEVEL SECURITY;
ALTER TABLE inad_snapshot ENABLE ROW LEVEL SECURITY;
