-- =============================================================================
-- HEADCOACH › FINANCEIRO › LIBERAÇÃO DE PAGAMENTO (Yago, 23/11/2026)
-- A duplicata do contas a pagar do HeadCoach é "liberada para pagamento" e segue
-- o fluxo  PENDENTE → PREVISÃO → APROVADO → INCLUÍDO → PAGO.
-- Uma linha por liberação. Uma duplicata só tem UMA liberação em andamento; depois
-- de paga em parte, o que falta pode ser liberado de novo (outra linha).
-- PAGO grava a baixa em hc_cp_baixas (sem estorno) e guarda o id dela aqui.
-- Rodar:  node scripts/migrar-hc-cp-liberacoes.mjs   (só acréscimos; pode repetir)
-- =============================================================================
CREATE TABLE IF NOT EXISTS hc_cp_liberacoes (
  id BIGSERIAL PRIMARY KEY,
  titulo_id BIGINT NOT NULL REFERENCES hc_cp_titulos (id),
  status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'previsao', 'aprovado', 'incluido', 'pago', 'cancelado')),
  valor NUMERIC(14, 2) NOT NULL CHECK (valor > 0), -- quanto vai ser pago nesta liberação (o que falta da duplicata, ou menos)
  data_prevista DATE,                      -- dia programado para pagar
  banco TEXT,                              -- conta de onde sai (ex.: STONE 0116)
  forma_pagamento TEXT,                    -- pix | boleto | transferencia | debito_automatico | cartao | dinheiro | outro
  observacao TEXT,
  liberado_por TEXT,
  liberado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  aprovado_por TEXT,
  aprovado_em TIMESTAMPTZ,
  incluido_por TEXT,                       -- quem incluiu o pagamento no banco
  incluido_em TIMESTAMPTZ,
  pago_por TEXT,
  pago_em TIMESTAMPTZ,
  data_pagamento DATE,
  baixa_id BIGINT REFERENCES hc_cp_baixas (id),
  cancelado_por TEXT,                      -- devolvida ao contas a pagar (sai da liberação)
  cancelado_em TIMESTAMPTZ,
  cancelado_motivo TEXT,
  atualizado_por TEXT,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hc_cp_lib_titulo ON hc_cp_liberacoes (titulo_id);
CREATE INDEX IF NOT EXISTS hc_cp_lib_status ON hc_cp_liberacoes (status);
CREATE INDEX IF NOT EXISTS hc_cp_lib_pagamento ON hc_cp_liberacoes (data_pagamento) WHERE status = 'pago';
CREATE UNIQUE INDEX IF NOT EXISTS hc_cp_lib_uma_em_andamento ON hc_cp_liberacoes (titulo_id) WHERE status NOT IN ('pago', 'cancelado');

ALTER TABLE hc_cp_liberacoes ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS hc_cp_lib_sem_delete ON hc_cp_liberacoes;
CREATE TRIGGER hc_cp_lib_sem_delete BEFORE DELETE ON hc_cp_liberacoes FOR EACH ROW EXECUTE FUNCTION hc_cp_proibir_delete();
