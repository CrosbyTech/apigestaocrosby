-- ============================================================================
-- FLUXO DE CAIXA EXT — extratos bancários importados (Stone, Sicredi, Caixa,
-- Mêntore) consolidados numa visão gerencial de entradas, saídas e
-- transferências entre contas do grupo.
--
-- Tabelas:
--   fluxo_caixa_contas          — 1 linha por conta bancária (banco+agência+conta)
--   fluxo_caixa_importacoes     — 1 linha por PDF importado (período, saldos)
--   fluxo_caixa_lancamentos     — 1 linha por lançamento do extrato
--   fluxo_caixa_transferencias  — pares saída↔entrada entre contas do grupo
--
-- Reimportar um extrato da mesma conta apaga os lançamentos do período
-- coberto e grava os novos (o PDF é a fonte da verdade).
-- ============================================================================

CREATE TABLE IF NOT EXISTS fluxo_caixa_contas (
  id            BIGSERIAL PRIMARY KEY,
  banco         TEXT        NOT NULL,              -- STONE | SICREDI | CAIXA | MENTORE
  banco_codigo  TEXT,
  banco_nome    TEXT,
  agencia       TEXT        NOT NULL DEFAULT '',
  conta         TEXT        NOT NULL,
  conta_dv      TEXT,
  titular_nome  TEXT,
  titular_cnpj  TEXT,                              -- 14 dígitos (pode ser ajustado na tela)
  apelido       TEXT,                              -- nome curto para a tela (ex.: "Stone 01-03")
  ativo         BOOLEAN     NOT NULL DEFAULT true,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (banco, agencia, conta)
);

CREATE TABLE IF NOT EXISTS fluxo_caixa_importacoes (
  id              BIGSERIAL PRIMARY KEY,
  conta_id        BIGINT      NOT NULL REFERENCES fluxo_caixa_contas(id) ON DELETE CASCADE,
  arquivo_nome    TEXT,
  arquivo_hash    TEXT,
  periodo_inicio  DATE,
  periodo_fim     DATE,
  saldo_inicial   NUMERIC(14,2),
  saldo_final     NUMERIC(14,2),
  qtd_lancamentos INT         NOT NULL DEFAULT 0,
  inconsistencias INT         NOT NULL DEFAULT 0,
  avisos          JSONB,
  usuario         TEXT,
  importado_em    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fc_import_conta ON fluxo_caixa_importacoes (conta_id, importado_em DESC);

CREATE TABLE IF NOT EXISTS fluxo_caixa_lancamentos (
  id                BIGSERIAL PRIMARY KEY,
  conta_id          BIGINT      NOT NULL REFERENCES fluxo_caixa_contas(id) ON DELETE CASCADE,
  importacao_id     BIGINT      REFERENCES fluxo_caixa_importacoes(id) ON DELETE SET NULL,
  data              DATE        NOT NULL,
  hora              TEXT,                           -- "hh:mm" ou "hh:mm:ss" quando o banco informa
  seq               INT         NOT NULL DEFAULT 0, -- ordem dentro do extrato
  valor             NUMERIC(14,2) NOT NULL,         -- assinado: + entrada, − saída
  natureza          CHAR(1)     NOT NULL,           -- C | D
  tipo              TEXT        NOT NULL,           -- ENTRADA | SAIDA | TRANSFERENCIA
  forma             TEXT        NOT NULL DEFAULT 'OUTROS',   -- PIX, TED/DOC, BOLETO, CARTÃO CRÉDITO…
  categoria         TEXT        NOT NULL DEFAULT 'outros',   -- pix, cartao, antecipacao, boleto, tarifa, folha…
  descricao         TEXT,                           -- histórico padronizado
  memo              TEXT,                           -- texto original do extrato
  documento         TEXT,                           -- nº documento / E2E / COB…
  contraparte_nome  TEXT,
  contraparte_doc   TEXT,                           -- CNPJ/CPF só dígitos, quando o extrato traz
  contraparte_banco TEXT,
  bandeira          TEXT,
  loja              TEXT,                           -- sufixo de CNPJ da loja (Sicredi/Rede: "0009-73")
  saldo_apos        NUMERIC(14,2),
  pagina            INT,
  transferencia_id  BIGINT,                         -- preenchido quando casa com outra conta do grupo
  fornecedor        TEXT,                           -- nome ajustado manualmente (opcional)
  observacao        TEXT,
  criado_em         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fc_lanc_conta_data ON fluxo_caixa_lancamentos (conta_id, data, seq);
CREATE INDEX IF NOT EXISTS idx_fc_lanc_data        ON fluxo_caixa_lancamentos (data);
CREATE INDEX IF NOT EXISTS idx_fc_lanc_doc         ON fluxo_caixa_lancamentos (contraparte_doc);
CREATE INDEX IF NOT EXISTS idx_fc_lanc_forma       ON fluxo_caixa_lancamentos (forma);
CREATE INDEX IF NOT EXISTS idx_fc_lanc_tipo        ON fluxo_caixa_lancamentos (tipo);
CREATE INDEX IF NOT EXISTS idx_fc_lanc_transf      ON fluxo_caixa_lancamentos (transferencia_id);

CREATE TABLE IF NOT EXISTS fluxo_caixa_transferencias (
  id                    BIGSERIAL PRIMARY KEY,
  data                  DATE        NOT NULL,       -- data da saída
  data_entrada          DATE,
  valor                 NUMERIC(14,2) NOT NULL,
  origem_conta_id       BIGINT REFERENCES fluxo_caixa_contas(id) ON DELETE CASCADE,
  destino_conta_id      BIGINT REFERENCES fluxo_caixa_contas(id) ON DELETE CASCADE,
  origem_lancamento_id  BIGINT REFERENCES fluxo_caixa_lancamentos(id) ON DELETE CASCADE,
  destino_lancamento_id BIGINT REFERENCES fluxo_caixa_lancamentos(id) ON DELETE CASCADE,
  metodo                TEXT        NOT NULL DEFAULT 'auto',  -- auto | manual
  confianca             TEXT,                                 -- alta | media
  criado_em             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fc_transf_data ON fluxo_caixa_transferencias (data);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_fc_lanc_transferencia'
  ) THEN
    ALTER TABLE fluxo_caixa_lancamentos
      ADD CONSTRAINT fk_fc_lanc_transferencia
      FOREIGN KEY (transferencia_id) REFERENCES fluxo_caixa_transferencias(id) ON DELETE SET NULL;
  END IF;
END $$;

COMMENT ON TABLE fluxo_caixa_contas IS 'Fluxo de Caixa Ext — contas bancárias do grupo (extratos importados em PDF).';
COMMENT ON TABLE fluxo_caixa_lancamentos IS 'Fluxo de Caixa Ext — lançamentos dos extratos (Stone, Sicredi, Caixa, Mêntore), classificados por forma de pagamento.';
COMMENT ON TABLE fluxo_caixa_transferencias IS 'Fluxo de Caixa Ext — transferências entre contas do grupo casadas automaticamente (mesmo valor, data ±1 dia, contraparte = titular).';
