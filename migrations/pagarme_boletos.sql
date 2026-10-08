-- Remessa / Retorno de boletos Pagar.me (Contas a Receber › Remessa Boletos).
-- Uma linha por boleto emitido na Pagar.me para uma fatura/parcela do TOTVS.
-- É esta tabela que "flagra" a fatura como portador PAGARME no HeadCoach — no
-- TOTVS o portador não muda (a API não permite), só a carteira vira Simples.
-- Rodar no SQL Editor do Supabase do HeadCoach (dorztqiunewggydvkjnf).

CREATE TABLE IF NOT EXISTS pagarme_boletos (
  id                 BIGSERIAL PRIMARY KEY,
  remessa_id         TEXT NOT NULL,           -- lote do clique em "Gerar remessa"
  cd_empresa         INTEGER NOT NULL,
  cd_cliente         INTEGER NOT NULL,
  nm_cliente         TEXT,
  nr_documento       TEXT,                    -- CPF/CNPJ do pagador
  nr_fatura          BIGINT NOT NULL,
  nr_parcela         INTEGER NOT NULL DEFAULT 1,
  dt_emissao         DATE,
  dt_vencimento      DATE,
  vl_fatura          NUMERIC(14,2) NOT NULL,
  cd_portador_totvs  INTEGER,                 -- portador no TOTVS na hora da remessa (1020/1098)
  nm_portador_totvs  TEXT,

  -- Pagar.me
  order_id           TEXT,
  charge_id          TEXT,
  order_code         TEXT,
  status             TEXT NOT NULL DEFAULT 'pending', -- pending | paid | canceled | failed | (status cru da Pagar.me)
  boleto_url         TEXT,
  boleto_pdf         TEXT,
  linha_digitavel    TEXT,
  nosso_numero       TEXT,
  vl_pago            NUMERIC(14,2),
  dt_pagamento       TIMESTAMPTZ,
  erro               TEXT,                    -- motivo quando status = failed

  -- TOTVS: carteira → Simples
  carteira_ok        BOOLEAN NOT NULL DEFAULT FALSE,
  carteira_erro      TEXT,

  -- TOTVS: baixa automática quando pago
  baixa_status       TEXT NOT NULL DEFAULT 'pendente', -- pendente | processando | processada | erro
  baixa_erro         TEXT,
  baixa_em           TIMESTAMPTZ,

  criado_por         TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Um único boleto "vivo" por fatura/parcela (falhou/cancelado libera nova remessa).
CREATE UNIQUE INDEX IF NOT EXISTS ux_pagarme_boletos_titulo_ativo
  ON pagarme_boletos (cd_empresa, nr_fatura, nr_parcela)
  WHERE status NOT IN ('failed', 'canceled');

CREATE UNIQUE INDEX IF NOT EXISTS ux_pagarme_boletos_order
  ON pagarme_boletos (order_id)
  WHERE order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pagarme_boletos_status ON pagarme_boletos (status);
CREATE INDEX IF NOT EXISTS idx_pagarme_boletos_vencimento ON pagarme_boletos (dt_vencimento);
