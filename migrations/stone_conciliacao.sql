-- ============================================================================
-- CONCILIAÇÃO STONE — cache dos arquivos diários + vínculos manuais
--
-- A Stone limita a 7 downloads por HORA por combinação StoneCode + dia.
-- Por isso cada arquivo baixado é guardado aqui (já parseado em JSON) e
-- nunca mais é pedido à Stone, salvo atualização forçada pelo usuário.
--
-- Tabelas:
--   stone_conciliacao_arquivos — 1 linha por StoneCode + dia + layout
--   stone_conciliacao_vinculos — casamentos manuais NSU Stone ↔ título TOTVS
-- ============================================================================

CREATE TABLE IF NOT EXISTS stone_conciliacao_arquivos (
  stonecode        TEXT        NOT NULL,
  data_ref         DATE        NOT NULL,
  layout           TEXT        NOT NULL DEFAULT 'XML2_2',
  conteudo         JSONB       NOT NULL,
  qtd_transacoes   INT         NOT NULL DEFAULT 0,
  qtd_pagamentos   INT         NOT NULL DEFAULT 0,
  valor_bruto      NUMERIC(14,2) NOT NULL DEFAULT 0,
  gerado_em        TIMESTAMPTZ,
  baixado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (stonecode, data_ref, layout)
);

CREATE INDEX IF NOT EXISTS idx_stone_conc_arq_data
  ON stone_conciliacao_arquivos (data_ref);

COMMENT ON TABLE stone_conciliacao_arquivos IS
  'Cache do arquivo diário da API de Conciliação Stone (parseado). Não rebaixar: limite 7/h por loja+dia.';

CREATE TABLE IF NOT EXISTS stone_conciliacao_vinculos (
  id          BIGSERIAL PRIMARY KEY,
  stonecode   TEXT        NOT NULL,
  nsu         TEXT        NOT NULL,   -- AcquirerTransactionKey da Stone
  filial      INT         NOT NULL,   -- branchCode TOTVS
  titulo      BIGINT      NOT NULL,   -- receivableCode TOTVS
  observacao  TEXT,
  usuario     TEXT,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (stonecode, nsu),
  UNIQUE (filial, titulo)
);

COMMENT ON TABLE stone_conciliacao_vinculos IS
  'Vínculo manual entre transação Stone (NSU) e título de cartão no TOTVS, feito na página Conciliação Stone.';
