-- ====================================================================
-- PROMOÇÕES — GRUPOS DE VOUCHER
-- Campanhas reutilizáveis (regras de desconto) e os vouchers emitidos
-- sob cada campanha, com controle de participação única por cliente.
-- ====================================================================

CREATE TABLE IF NOT EXISTS promocao_grupos (
  id                        BIGSERIAL PRIMARY KEY,
  nome                      TEXT NOT NULL,                         -- nome da promoção
  data_inicio               TIMESTAMPTZ NOT NULL,                  -- início da vigência
  data_fim                  TIMESTAMPTZ NOT NULL,                  -- fim da vigência
  desconto_tipo             VARCHAR(12) NOT NULL DEFAULT 'valor',  -- 'valor' | 'percentual'
  desconto_valor            NUMERIC(12,2) NOT NULL,                -- R$ ou % conforme desconto_tipo
  compra_minima             NUMERIC(12,2) NOT NULL DEFAULT 0,      -- gatilho: compra mínima para ganhar
  prefix_code               TEXT NOT NULL DEFAULT 'PROMO',
  print_template_code       INT NOT NULL DEFAULT 1,                -- modelo de impressão exigido pela TOTVS
  branch_code_registration  INT NOT NULL DEFAULT 90,               -- empresa de cadastro
  participant_branches      JSONB NOT NULL
                              DEFAULT '[2,5,55,65,87,88,89,90,91,92,93,94,95,96,97,98]',
  cancelado                 BOOLEAN NOT NULL DEFAULT false,
  criado_em                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  criado_por                TEXT,
  CONSTRAINT promocao_grupos_desconto_tipo_chk
    CHECK (desconto_tipo IN ('valor', 'percentual'))
);

CREATE INDEX IF NOT EXISTS idx_promocao_grupos_periodo
  ON promocao_grupos(data_inicio, data_fim);

-- Vouchers emitidos sob cada grupo (participação + unicidade por cliente)
CREATE TABLE IF NOT EXISTS promocao_vouchers (
  id                  BIGSERIAL PRIMARY KEY,
  grupo_id            BIGINT NOT NULL REFERENCES promocao_grupos(id) ON DELETE CASCADE,
  customer_code       BIGINT NOT NULL,
  customer_cpf_cnpj   TEXT,
  customer_name       TEXT,
  voucher_number      BIGINT,                                      -- nº do voucher base na TOTVS
  voucher_code        TEXT,                                        -- código do voucher gerado
  desconto_tipo       VARCHAR(12),                                 -- snapshot da regra
  valor               NUMERIC(12,2),                               -- snapshot do desconto (R$ ou %)
  start_date          TIMESTAMPTZ,
  end_date            TIMESTAMPTZ,
  criado_em           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  criado_por          TEXT,
  -- Um cliente só pode participar uma vez de cada grupo de promoção
  UNIQUE (grupo_id, customer_code)
);

CREATE INDEX IF NOT EXISTS idx_promocao_vouchers_grupo
  ON promocao_vouchers(grupo_id, criado_em DESC);

COMMENT ON TABLE promocao_grupos IS 'Campanhas/grupos de promoção de voucher (regras de desconto)';
COMMENT ON TABLE promocao_vouchers IS 'Vouchers emitidos sob cada grupo; UNIQUE(grupo_id, customer_code) impede participação repetida';
