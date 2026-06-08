-- ====================================================================
-- Overrides administrativos de credev
-- Permite que admins desconsiderem o credev de NFs específicas, fazendo
-- com que o valor bruto da NF seja contabilizado integralmente como
-- faturamento líquido (não subtrai o credev daquela NF do total do canal).
--
-- Uso típico: NFs onde o credev foi lançado por engano ou cuja política
-- de negócio diz que aquela troca não deve reduzir o faturamento.
-- ====================================================================

CREATE TABLE IF NOT EXISTS forecast_credev_overrides (
  id                SERIAL PRIMARY KEY,
  branch_code       INT NOT NULL,
  transaction_code  BIGINT NOT NULL,
  invoice_code      BIGINT,
  issue_date        DATE,     -- data da NF (necessário para filtro por período no fat-seg)
  canal             TEXT NOT NULL,
  -- valor do credev que está sendo desconsiderado (informativo + usado no cálculo)
  credev_amount     NUMERIC(14,2),
  motivo            TEXT NOT NULL,
  ativo             BOOLEAN NOT NULL DEFAULT TRUE,
  created_by        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deactivated_by    TEXT,
  deactivated_at    TIMESTAMPTZ,
  -- só permite 1 override por NF/canal (UNIQUE inclui ativo? não — só permite
  -- 1 linha ativa pelo índice parcial abaixo, mantendo histórico inativo)
  CONSTRAINT credev_override_motivo_nao_vazio CHECK (length(trim(motivo)) > 0)
);

-- Garante apenas 1 override ATIVO por (branch_code, transaction_code, canal).
-- Permite múltiplas linhas inativas (histórico).
CREATE UNIQUE INDEX IF NOT EXISTS idx_credev_override_unico_ativo
  ON forecast_credev_overrides (branch_code, transaction_code, canal)
  WHERE ativo = TRUE;

CREATE INDEX IF NOT EXISTS idx_credev_override_canal
  ON forecast_credev_overrides (canal, ativo);
CREATE INDEX IF NOT EXISTS idx_credev_override_created_at
  ON forecast_credev_overrides (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credev_override_invoice
  ON forecast_credev_overrides (invoice_code);
CREATE INDEX IF NOT EXISTS idx_credev_override_issue_date
  ON forecast_credev_overrides (issue_date) WHERE ativo = TRUE;

COMMENT ON TABLE forecast_credev_overrides IS
  'Overrides admin: NFs cujo credev deve ser ignorado (contabilizado como faturamento). Apenas 1 linha ativa por NF/canal.';

-- ====================================================================
-- Log de auditoria — cada criação/desativação/reativação gera 1 linha
-- ====================================================================
CREATE TABLE IF NOT EXISTS forecast_credev_overrides_log (
  id                 SERIAL PRIMARY KEY,
  override_id        INT,                       -- ref soft (não FK para sobreviver delete físico)
  branch_code        INT NOT NULL,
  transaction_code   BIGINT NOT NULL,
  invoice_code       BIGINT,
  issue_date         DATE,
  canal              TEXT NOT NULL,
  acao               VARCHAR(20) NOT NULL,      -- 'create' | 'deactivate' | 'reactivate'
  motivo             TEXT,
  credev_amount      NUMERIC(14,2),
  alterado_por       TEXT,
  alterado_em        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_origem          TEXT
);

CREATE INDEX IF NOT EXISTS idx_credev_override_log_data
  ON forecast_credev_overrides_log (alterado_em DESC);
CREATE INDEX IF NOT EXISTS idx_credev_override_log_invoice
  ON forecast_credev_overrides_log (invoice_code);

COMMENT ON TABLE forecast_credev_overrides_log IS
  'Auditoria de alterações em forecast_credev_overrides';
