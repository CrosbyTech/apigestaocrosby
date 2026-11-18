-- ============================================================================
-- HEADCOACH › CONTAS A PAGAR (Yago, 18/11/2026) — duplicatas próprias do
-- HeadCoach, sem o TOTVS, no mesmo molde do HEADCOACH › CONTAS A RECEBER.
--
-- Numeração (Yago, 18/11/2026): a DUPLICATA é um número por empresa + fornecedor
-- (1, 2, 3…) e cada lançamento é uma PARCELA dela: "1/11" e "1/12" são a duplicata
-- 1, parcelas 11 e 12. Conta que vem todo mês fica na mesma duplicata, com o mês
-- do vencimento como parcela. O DOCUMENTO FISCAL é o número da nota/fatura do
-- fornecedor e muda a cada parcela.
-- Cada duplicata tem o que o contas a pagar do TOTVS tem: empresa, fornecedor,
-- documento fiscal, parcela, portador, forma de pagamento, despesa, centro de custo,
-- emissão, entrada, vencimento, valor e observação. A baixa registra juros,
-- multa, desconto e o valor pago. Sem estorno; duplicata em aberto pode ser
-- cancelada (com motivo). Nada se apaga (trigger).
--
-- Segurança: RLS LIGADO e SEM política — só o servidor lê e grava.
-- Rodar: node scripts/migrar-hc-contas-pagar.mjs
-- ============================================================================

-- despesas (plano de contas do contas a pagar) — carregadas de config/despesas.json
CREATE TABLE IF NOT EXISTS hc_cp_despesas (
  code INT PRIMARY KEY,
  nome TEXT NOT NULL,
  ativo BOOLEAN NOT NULL DEFAULT true,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS hc_cp_titulos (
  id BIGSERIAL PRIMARY KEY,
  empresa INT NOT NULL,
  fornecedor_code BIGINT NOT NULL,         -- erp_pessoas.code
  fornecedor_nome TEXT NOT NULL,
  fornecedor_cpf_cnpj TEXT,
  duplicata INT NOT NULL CHECK (duplicata >= 1), -- número por empresa + fornecedor
  documento_fiscal TEXT,                   -- nº da nota / fatura do fornecedor
  lote UUID NOT NULL,                      -- parcelas incluídas na mesma vez
  parcela INT NOT NULL DEFAULT 1 CHECK (parcela >= 1), -- parcela dentro da duplicata (conta mensal: o mês do vencimento)
  tipo_documento TEXT NOT NULL DEFAULT 'duplicata', -- duplicata | nota_fiscal | boleto | recibo | outro
  portador_code INT,                       -- erp_portadores.code
  portador_nome TEXT,
  forma_pagamento TEXT,                    -- pix | boleto | transferencia | debito_automatico | cartao | dinheiro | outro
  chave_pix TEXT,                          -- chave ou Pix copia e cola
  codigo_barras TEXT,                      -- linha digitável
  despesa_code INT REFERENCES hc_cp_despesas (code),
  despesa_nome TEXT,
  centro_custo_code INT,
  previsao TEXT NOT NULL DEFAULT 'real' CHECK (previsao IN ('real', 'previsao')),
  emissao DATE NOT NULL,
  entrada DATE NOT NULL,
  vencimento DATE NOT NULL,
  referencia TEXT,                         -- competência (ex.: 10/2026)
  valor NUMERIC(14, 2) NOT NULL CHECK (valor > 0),
  situacao TEXT NOT NULL DEFAULT 'aberto' CHECK (situacao IN ('aberto', 'pago', 'cancelado')),
  data_pagamento DATE,
  juros NUMERIC(14, 2) NOT NULL DEFAULT 0,
  multa NUMERIC(14, 2) NOT NULL DEFAULT 0,
  desconto NUMERIC(14, 2) NOT NULL DEFAULT 0,
  valor_pago NUMERIC(14, 2) NOT NULL DEFAULT 0,
  conta_pagamento TEXT,                    -- banco/conta de onde saiu
  observacao TEXT,
  anexo_path TEXT,                         -- PDF da fatura no Storage
  origem TEXT NOT NULL DEFAULT 'manual',   -- manual | bot-cosern-whatsapp …
  origem_ref TEXT,                         -- id na origem (ex.: contas_fixas_faturas.id)
  criado_por TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_por TEXT,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  baixado_por TEXT,
  baixado_em TIMESTAMPTZ,
  cancelado_por TEXT,
  cancelado_em TIMESTAMPTZ,
  cancelado_motivo TEXT,
  UNIQUE (empresa, fornecedor_code, documento_fiscal, parcela)
);
CREATE INDEX IF NOT EXISTS hc_cp_tit_empresa_venc ON hc_cp_titulos (empresa, vencimento);
CREATE INDEX IF NOT EXISTS hc_cp_tit_empresa_emissao ON hc_cp_titulos (empresa, emissao DESC);
CREATE INDEX IF NOT EXISTS hc_cp_tit_fornecedor ON hc_cp_titulos (fornecedor_code);
CREATE INDEX IF NOT EXISTS hc_cp_tit_despesa ON hc_cp_titulos (despesa_code);
CREATE INDEX IF NOT EXISTS hc_cp_tit_aberto ON hc_cp_titulos (vencimento) WHERE situacao = 'aberto';

-- baixas (pagamento da duplicata). Sem estorno.
CREATE TABLE IF NOT EXISTS hc_cp_baixas (
  id BIGSERIAL PRIMARY KEY,
  titulo_id BIGINT NOT NULL REFERENCES hc_cp_titulos (id),
  data_pagamento DATE NOT NULL,
  valor_titulo NUMERIC(14, 2) NOT NULL,
  juros NUMERIC(14, 2) NOT NULL DEFAULT 0,
  multa NUMERIC(14, 2) NOT NULL DEFAULT 0,
  desconto NUMERIC(14, 2) NOT NULL DEFAULT 0,
  valor_pago NUMERIC(14, 2) NOT NULL,
  forma_pagamento TEXT,
  conta TEXT,
  observacao TEXT,
  por_id UUID,
  por TEXT,
  em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hc_cp_baixas_titulo ON hc_cp_baixas (titulo_id);

ALTER TABLE hc_cp_despesas ENABLE ROW LEVEL SECURITY;
ALTER TABLE hc_cp_titulos ENABLE ROW LEVEL SECURITY;
ALTER TABLE hc_cp_baixas ENABLE ROW LEVEL SECURITY;

-- nada de apagar
CREATE OR REPLACE FUNCTION hc_cp_proibir_delete() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Registro do contas a pagar não pode ser apagado';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS hc_cp_tit_sem_delete ON hc_cp_titulos;
CREATE TRIGGER hc_cp_tit_sem_delete BEFORE DELETE ON hc_cp_titulos FOR EACH ROW EXECUTE FUNCTION hc_cp_proibir_delete();
DROP TRIGGER IF EXISTS hc_cp_baixas_sem_delete ON hc_cp_baixas;
CREATE TRIGGER hc_cp_baixas_sem_delete BEFORE DELETE ON hc_cp_baixas FOR EACH ROW EXECUTE FUNCTION hc_cp_proibir_delete();

-- ─── rateio por centro de custo (Yago, 18/11/2026) ──────────────────────────
-- Centros de custo com nome, separados em empresa (filiais) e setor — carregados
-- de config/centrosCustoContasPagar.json (a cópia erp_centros_custo não tem nome).
CREATE TABLE IF NOT EXISTS hc_cp_centros_custo (
  code INT PRIMARY KEY,
  nome TEXT NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'empresa' CHECK (tipo IN ('empresa', 'setor', 'outro')),
  ativo BOOLEAN NOT NULL DEFAULT true,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE hc_cp_centros_custo ENABLE ROW LEVEL SECURITY;

-- rateio da duplicata, no modelo das Solicitações de RH: uma linha por despesa +
-- centro de custo, com o percentual e o valor (a soma fecha 100% e o valor da parcela).
--   [{ despesa_code, despesa_nome, centro_custo_code, centro_custo_nome, percentual, valor }]
-- despesa_code / centro_custo_code da duplicata guardam a linha principal (maior %).
ALTER TABLE hc_cp_titulos ADD COLUMN IF NOT EXISTS rateio JSONB;
ALTER TABLE hc_cp_titulos ADD COLUMN IF NOT EXISTS centro_custo_nome TEXT;
CREATE INDEX IF NOT EXISTS hc_cp_tit_rateio ON hc_cp_titulos USING GIN (rateio jsonb_path_ops);

-- ─── duplicata sequencial + documento fiscal (Yago, 18/11/2026) ─────────────
-- Para o banco criado antes desta numeração: "fatura" vira documento_fiscal e as
-- duplicatas existentes são numeradas por empresa + fornecedor, em ordem de vencimento.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'hc_cp_titulos' AND column_name = 'fatura') THEN
    ALTER TABLE hc_cp_titulos RENAME COLUMN fatura TO documento_fiscal;
  END IF;
END;
$$;
ALTER TABLE hc_cp_titulos ALTER COLUMN documento_fiscal DROP NOT NULL;
ALTER TABLE hc_cp_titulos ADD COLUMN IF NOT EXISTS duplicata INT;
ALTER TABLE hc_cp_titulos ADD COLUMN IF NOT EXISTS lote UUID;
UPDATE hc_cp_titulos t
   SET duplicata = s.n
  FROM (SELECT id, row_number() OVER (PARTITION BY empresa, fornecedor_code ORDER BY vencimento, id) AS n FROM hc_cp_titulos) s
 WHERE s.id = t.id AND t.duplicata IS NULL;
UPDATE hc_cp_titulos SET lote = gen_random_uuid() WHERE lote IS NULL;
ALTER TABLE hc_cp_titulos ALTER COLUMN duplicata SET NOT NULL;
ALTER TABLE hc_cp_titulos ALTER COLUMN lote SET NOT NULL;
-- uma parcela por número dentro da duplicata (a cancelada libera o número).
-- O índice é recriado porque já existiu só com (empresa, fornecedor, duplicata).
DROP INDEX IF EXISTS hc_cp_titulos_duplicata_key;
CREATE UNIQUE INDEX hc_cp_titulos_duplicata_key ON hc_cp_titulos (empresa, fornecedor_code, duplicata, parcela) WHERE situacao <> 'cancelado';
CREATE INDEX IF NOT EXISTS hc_cp_tit_lote ON hc_cp_titulos (lote);
