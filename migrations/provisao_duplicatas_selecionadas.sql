-- ============================================================================
-- PROVISÃO AUTOMÁTICA — duplicatas específicas selecionadas pela tela
-- (Liberação de Pagamento → Provisão → "Selecionar duplicatas").
--
-- Substitui a lista fixa RENEGOCIACOES que ficava em
-- jobs/provisao-liberacao.job.js. O job lê esta tabela a cada execução:
-- cada linha é um par (fornecedor, nº da duplicata) que entra em PROVISÃO
-- enquanto estiver em aberto no Contas a Pagar, com vencimento dentro do
-- mês corrente — independentemente do código de despesa e da janela de 3 dias.
-- ============================================================================

CREATE TABLE IF NOT EXISTS provisao_duplicatas_selecionadas (
  id             BIGSERIAL PRIMARY KEY,
  cd_fornecedor  INT         NOT NULL,
  nm_fornecedor  TEXT,
  nr_duplicata   TEXT        NOT NULL,
  -- Dados informativos do título no momento da seleção (só para exibir na tela)
  cd_empresa     INT,
  nm_empresa     TEXT,
  nr_parcela     TEXT,
  dt_vencimento  DATE,
  vl_duplicata   NUMERIC(14,2),
  ds_despesaitem TEXT,
  observacao     TEXT,
  adicionado_por TEXT,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (cd_fornecedor, nr_duplicata)
);

CREATE INDEX IF NOT EXISTS idx_provisao_dup_sel_fornecedor
  ON provisao_duplicatas_selecionadas (cd_fornecedor);
