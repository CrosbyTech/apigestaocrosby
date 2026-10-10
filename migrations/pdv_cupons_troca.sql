-- ============================================================================
-- PDV CROSBY — cupons de troca
-- Toda venda gerada no PDV Crosby emite um cupom de troca (pensado para
-- presente: quem troca não tem os dados de quem comprou). O cupom guarda a
-- transação de origem; na troca, o vendedor digita o código e o HeadCoach
-- acha a transação/nota original para referenciar. Idempotente.
-- ============================================================================

CREATE TABLE IF NOT EXISTS pdv_cupons_troca (
  id BIGSERIAL PRIMARY KEY,
  codigo TEXT NOT NULL UNIQUE,              -- código impresso no cupom (8 caracteres)

  -- venda de origem (transação TOTVS)
  empresa INT NOT NULL,
  transacao_code BIGINT NOT NULL,
  transacao_date DATE NOT NULL,
  total NUMERIC(14, 2) NOT NULL DEFAULT 0,

  cliente_code INT,
  cliente_nome TEXT,
  vendedor_code INT,
  vendedor_nome TEXT,

  -- peças da venda: [{ productCode, name, quantity }] (sem valores: é presente)
  itens JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- trocas já feitas com este cupom: [{ productCode, quantity, transacao_code, empresa, em, por }]
  usos JSONB NOT NULL DEFAULT '[]'::jsonb,

  criado_por TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pdv_cupom_transacao ON pdv_cupons_troca (empresa, transacao_code);
CREATE INDEX IF NOT EXISTS idx_pdv_cupom_data ON pdv_cupons_troca (criado_em DESC);
