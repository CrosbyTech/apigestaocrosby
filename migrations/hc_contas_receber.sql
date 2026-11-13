-- ============================================================================
-- HEADCOACH › CONTAS A RECEBER (Yago, 12/11/2026) — títulos próprios do
-- HeadCoach, sem o TOTVS e sem nada em paralelo com ele.
--
-- Toda venda do HeadCoach com nota AUTORIZADA (PDV Crosby e Faturamento) vira
-- títulos aqui, um por forma de pagamento (o boleto, um por parcela):
--   • fatura = 9.000.000.000 + nº da transação (pdv_vendas.id); parcela 1, 2…
--   • dinheiro, Pix, cartão de crédito e débito nascem PAGOS, com a data de
--     liquidação (cartão e Pix: D+1, configurável) e a taxa da maquininha;
--   • credev, adiantamento e saldo bônus nascem pagos (compensação de crédito);
--   • boleto/fatura fica EM ABERTO até a baixa (com juros, multa e desconto).
--   • vale-troca não vira título (é o crédito da própria troca). Devoluções e
--     transferências não geram contas a receber.
-- Conciliação D+1: vendeu hoje, concilia amanhã — o que caiu da maquininha/Pix
-- confere com os títulos do dia e a diferença vira a taxa real.
-- Sem estorno (pedido do Yago). Nota cancelada cancela os títulos da venda.
--
-- Segurança: RLS LIGADO e SEM política — só o servidor lê e grava. Nada se
-- apaga (trigger).
-- Rodar: node scripts/migrar-hc-contas-receber.mjs
-- ============================================================================

-- configuração única (taxas, juros, multa, dias de liquidação)
CREATE TABLE IF NOT EXISTS hc_cr_config (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  juros_mes_pct NUMERIC(7, 4) NOT NULL DEFAULT 1,        -- juros de mora ao mês (pro rata dia)
  multa_pct NUMERIC(7, 4) NOT NULL DEFAULT 2,            -- multa por atraso
  taxa_credito_pct NUMERIC(7, 4) NOT NULL DEFAULT 0,     -- crédito à vista
  taxa_credito_parc_pct NUMERIC(7, 4) NOT NULL DEFAULT 0, -- crédito parcelado
  taxa_debito_pct NUMERIC(7, 4) NOT NULL DEFAULT 0,
  taxa_pix_pct NUMERIC(7, 4) NOT NULL DEFAULT 0,
  dias_liq_credito INT NOT NULL DEFAULT 1,
  dias_liq_debito INT NOT NULL DEFAULT 1,
  dias_liq_pix INT NOT NULL DEFAULT 1,
  atualizado_por TEXT,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO hc_cr_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- conciliação D+1 (um lançamento por empresa + data de liquidação + forma + portador)
CREATE TABLE IF NOT EXISTS hc_cr_conciliacoes (
  id BIGSERIAL PRIMARY KEY,
  empresa INT NOT NULL,
  data_liquidacao DATE NOT NULL,
  forma TEXT NOT NULL,
  portador TEXT,
  qtd_titulos INT NOT NULL DEFAULT 0,
  valor_bruto NUMERIC(14, 2) NOT NULL DEFAULT 0,
  valor_recebido NUMERIC(14, 2) NOT NULL DEFAULT 0,
  taxa NUMERIC(14, 2) NOT NULL DEFAULT 0,               -- bruto − recebido
  observacao TEXT,
  por_id UUID,
  por TEXT,
  em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hc_cr_conc_empresa_data ON hc_cr_conciliacoes (empresa, data_liquidacao DESC);

-- títulos (mesmas informações do contas a receber do TOTVS)
CREATE TABLE IF NOT EXISTS hc_cr_titulos (
  id BIGSERIAL PRIMARY KEY,
  empresa INT NOT NULL,
  fatura BIGINT NOT NULL,                  -- 9.000.000.000 + nº da transação
  parcela INT NOT NULL,
  venda_id BIGINT NOT NULL,                -- nº da transação do HeadCoach
  pagamento_id BIGINT,                     -- pdv_venda_pagamentos.id
  origem TEXT,                             -- pdv | expedicao
  canal TEXT,
  operacao INT,
  cliente_code BIGINT,
  cliente_nome TEXT,
  cliente_cpf_cnpj TEXT,
  vendedor_code INT,
  vendedor_nome TEXT,
  forma TEXT NOT NULL,                     -- dinheiro | pix | credito | debito | boleto | credito_loja | adiantamento | saldo_bonus
  tipo_documento INT,                      -- código do TOTVS: 3 dinheiro · 4 crédito · 5 débito · 26 Pix · 1 fatura · 20 credev · 10 adiantamento
  portador TEXT,                           -- adquirente / banco
  bandeira TEXT,
  nsu TEXT,
  autorizacao TEXT,
  parcelas_cartao INT,
  nf_modelo INT,
  nf_serie INT,
  nf_numero INT,
  nf_chave TEXT,
  caixa_id BIGINT,
  data_caixa DATE,
  emissao DATE NOT NULL,
  vencimento DATE NOT NULL,
  valor NUMERIC(14, 2) NOT NULL CHECK (valor >= 0),
  taxa_pct NUMERIC(7, 4) NOT NULL DEFAULT 0,
  taxa_valor NUMERIC(14, 2) NOT NULL DEFAULT 0,
  valor_liquido NUMERIC(14, 2),
  situacao TEXT NOT NULL DEFAULT 'aberto' CHECK (situacao IN ('aberto', 'pago', 'cancelado')),
  data_pagamento DATE,
  data_liquidacao DATE,
  valor_pago NUMERIC(14, 2) NOT NULL DEFAULT 0,
  juros NUMERIC(14, 2) NOT NULL DEFAULT 0,
  multa NUMERIC(14, 2) NOT NULL DEFAULT 0,
  desconto NUMERIC(14, 2) NOT NULL DEFAULT 0,
  precisa_conciliar BOOLEAN NOT NULL DEFAULT false,   -- cartão e Pix
  conciliado_em TIMESTAMPTZ,
  conciliado_por TEXT,
  conciliacao_id BIGINT REFERENCES hc_cr_conciliacoes (id),
  baixado_por TEXT,
  baixado_em TIMESTAMPTZ,
  cancelado_em TIMESTAMPTZ,
  cancelado_motivo TEXT,
  observacao TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (fatura, parcela)
);
CREATE INDEX IF NOT EXISTS hc_cr_tit_venda ON hc_cr_titulos (venda_id);
CREATE INDEX IF NOT EXISTS hc_cr_tit_empresa_venc ON hc_cr_titulos (empresa, vencimento);
CREATE INDEX IF NOT EXISTS hc_cr_tit_empresa_emissao ON hc_cr_titulos (empresa, emissao DESC);
CREATE INDEX IF NOT EXISTS hc_cr_tit_cliente ON hc_cr_titulos (cliente_code);
CREATE INDEX IF NOT EXISTS hc_cr_tit_conciliar ON hc_cr_titulos (empresa, data_liquidacao) WHERE precisa_conciliar AND conciliado_em IS NULL AND situacao = 'pago';

-- baixas (recebimento do título em aberto: boleto/fatura). Sem estorno.
CREATE TABLE IF NOT EXISTS hc_cr_baixas (
  id BIGSERIAL PRIMARY KEY,
  titulo_id BIGINT NOT NULL REFERENCES hc_cr_titulos (id),
  data_pagamento DATE NOT NULL,
  valor_titulo NUMERIC(14, 2) NOT NULL,
  juros NUMERIC(14, 2) NOT NULL DEFAULT 0,
  multa NUMERIC(14, 2) NOT NULL DEFAULT 0,
  desconto NUMERIC(14, 2) NOT NULL DEFAULT 0,
  valor_recebido NUMERIC(14, 2) NOT NULL,
  forma_recebimento TEXT,                  -- pix | boleto | transferencia | dinheiro | cartao …
  conta TEXT,                              -- banco/conta onde entrou
  observacao TEXT,
  por_id UUID,
  por TEXT,
  em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hc_cr_baixas_titulo ON hc_cr_baixas (titulo_id);

-- nada de apagar
CREATE OR REPLACE FUNCTION hc_cr_proibir_delete() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Registro do contas a receber não pode ser apagado';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS hc_cr_tit_sem_delete ON hc_cr_titulos;
CREATE TRIGGER hc_cr_tit_sem_delete BEFORE DELETE ON hc_cr_titulos FOR EACH ROW EXECUTE FUNCTION hc_cr_proibir_delete();
DROP TRIGGER IF EXISTS hc_cr_baixas_sem_delete ON hc_cr_baixas;
CREATE TRIGGER hc_cr_baixas_sem_delete BEFORE DELETE ON hc_cr_baixas FOR EACH ROW EXECUTE FUNCTION hc_cr_proibir_delete();
DROP TRIGGER IF EXISTS hc_cr_conc_sem_delete ON hc_cr_conciliacoes;
CREATE TRIGGER hc_cr_conc_sem_delete BEFORE DELETE ON hc_cr_conciliacoes FOR EACH ROW EXECUTE FUNCTION hc_cr_proibir_delete();

CREATE OR REPLACE FUNCTION hc_cr_touch() RETURNS TRIGGER AS $$
BEGIN
  NEW.atualizado_em = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS hc_cr_tit_touch ON hc_cr_titulos;
CREATE TRIGGER hc_cr_tit_touch BEFORE UPDATE ON hc_cr_titulos FOR EACH ROW EXECUTE FUNCTION hc_cr_touch();

-- só o servidor acessa
ALTER TABLE hc_cr_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE hc_cr_conciliacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE hc_cr_titulos ENABLE ROW LEVEL SECURITY;
ALTER TABLE hc_cr_baixas ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
