-- ============================================================================
-- CONCILIAÇÃO BANCÁRIA — resolução das pendências do extrato (Extrato Bancário)
--
-- Cada lançamento importado é uma pendência até ser justificado. A
-- justificativa fica aqui, ligada ao lançamento por uma CHAVE estável
-- (conta + data + valor + hash do histórico + nº de repetição), porque
-- reimportar o extrato apaga e recria os lançamentos (ids mudam).
--
-- origem: TRANSFERENCIA (par casado entre contas do grupo — derivado, não
--         gravado), LIBERACAO (pagamentos_liberacao), SOLICITACAO
--         (solicitacoes_crosby), TOTVS_CP (contas a pagar do TOTVS), MANUAL
-- ============================================================================
CREATE TABLE IF NOT EXISTS fluxo_caixa_conciliacoes (
  id             BIGSERIAL PRIMARY KEY,
  conta_id       BIGINT      NOT NULL REFERENCES fluxo_caixa_contas(id) ON DELETE CASCADE,
  lancamento_id  BIGINT,                          -- id atual (pode mudar na reimportação)
  chave          TEXT        NOT NULL UNIQUE,     -- conta|data|valor|hash(memo)|n
  data           DATE        NOT NULL,
  valor          NUMERIC(14,2) NOT NULL,
  origem         TEXT        NOT NULL,            -- LIBERACAO | SOLICITACAO | TOTVS_CP | MANUAL
  referencia     JSONB,                           -- ids/nomes/valores da origem
  justificativa  TEXT,
  automatico     BOOLEAN     NOT NULL DEFAULT false,
  pontuacao      INT,
  usuario        TEXT,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fc_conc_conta_data ON fluxo_caixa_conciliacoes (conta_id, data);
CREATE INDEX IF NOT EXISTS idx_fc_conc_lanc ON fluxo_caixa_conciliacoes (lancamento_id);

-- 23/10/2026: anexos da conciliação (comprovante / nota fiscal) — bucket solicitacoes-crosby
ALTER TABLE fluxo_caixa_conciliacoes ADD COLUMN IF NOT EXISTS anexos JSONB NOT NULL DEFAULT '[]'::jsonb;
