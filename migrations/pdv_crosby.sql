-- ============================================================================
-- PDV CROSBY (HeadCoach) — vendas fechadas no próprio HeadCoach + emissão
-- fiscal direta (NFC-e / NF-e) sem passar pelo TOTVS.
--
-- Tabelas:
--   pdv_fiscal_config     — 1 linha por empresa: ambiente, séries, numeração,
--                           CSC (NFC-e), alíquota ICMS, info complementar
--   pdv_vendas            — cabeçalho da venda (cliente, vendedor, totais)
--   pdv_venda_itens       — itens (1 linha por produto, qtd agregada)
--   pdv_venda_pagamentos  — formas de pagamento (cartão guarda NSU/autorização)
--   pdv_notas_fiscais     — documentos fiscais emitidos (XML, chave, protocolo)
--
-- Função pdv_fiscal_proximo_numero(empresa, modelo): incremento atômico da
-- numeração por empresa/modelo (65 = NFC-e, 55 = NF-e).
-- ============================================================================

CREATE TABLE IF NOT EXISTS pdv_fiscal_config (
  empresa INT PRIMARY KEY,
  cnpj TEXT,
  ativo BOOLEAN NOT NULL DEFAULT true,
  -- 1 = produção, 2 = homologação (padrão seguro)
  ambiente SMALLINT NOT NULL DEFAULT 2 CHECK (ambiente IN (1, 2)),
  serie_nfce INT NOT NULL DEFAULT 9,
  serie_nfe INT NOT NULL DEFAULT 9,
  prox_num_nfce INT NOT NULL DEFAULT 1,
  prox_num_nfe INT NOT NULL DEFAULT 1,
  -- CSC (Código de Segurança do Contribuinte) — QR Code da NFC-e.
  -- Cadastrado no portal da SEFAZ da UF; homologação e produção são distintos.
  csc_id_hom TEXT,
  csc_token_hom TEXT,
  csc_id_prod TEXT,
  csc_token_prod TEXT,
  -- Alíquota interna de ICMS (%). Se nula, usa a tabela por UF do serviço.
  aliq_icms NUMERIC(5, 2),
  -- Texto livre de infCpl (ex.: exigência PROCON municipal)
  info_complementar TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pdv_vendas (
  id BIGSERIAL PRIMARY KEY,
  empresa INT NOT NULL,
  empresa_cnpj TEXT,
  empresa_nome TEXT,
  -- nfce | nfe | troca
  tipo_venda TEXT NOT NULL CHECK (tipo_venda IN ('nfce', 'nfe', 'troca')),
  operacao INT,
  cliente_code INT,
  cliente_nome TEXT,
  cliente_cpf_cnpj TEXT,
  vendedor_code INT,
  vendedor_nome TEXT,
  qtd_pecas INT NOT NULL DEFAULT 0,
  subtotal NUMERIC(14, 2) NOT NULL DEFAULT 0,
  desconto NUMERIC(14, 2) NOT NULL DEFAULT 0,
  cashback_usado NUMERIC(14, 2) NOT NULL DEFAULT 0,
  cashback_gerado NUMERIC(14, 2) NOT NULL DEFAULT 0,
  total NUMERIC(14, 2) NOT NULL DEFAULT 0,
  -- registrada → (emitindo) → autorizada | rejeitada | cancelada
  status TEXT NOT NULL DEFAULT 'registrada'
    CHECK (status IN ('registrada', 'emitindo', 'autorizada', 'rejeitada', 'cancelada')),
  -- Chave da NF-e/NFC-e de origem (usada na TROCA como NF referenciada)
  nf_referenciada TEXT,
  observacao TEXT,
  criado_por TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pdv_vendas_empresa_data
  ON pdv_vendas (empresa, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_pdv_vendas_status ON pdv_vendas (status);

CREATE TABLE IF NOT EXISTS pdv_venda_itens (
  id BIGSERIAL PRIMARY KEY,
  venda_id BIGINT NOT NULL REFERENCES pdv_vendas (id) ON DELETE CASCADE,
  seq INT NOT NULL,
  product_code INT NOT NULL,
  sku TEXT,
  nome TEXT NOT NULL,
  referencia TEXT,
  ncm TEXT,
  cest TEXT,
  origem TEXT DEFAULT '0',
  unidade TEXT DEFAULT 'UN',
  quantidade NUMERIC(12, 3) NOT NULL DEFAULT 1,
  valor_unit NUMERIC(14, 2) NOT NULL DEFAULT 0,
  desconto_unit NUMERIC(14, 2) NOT NULL DEFAULT 0,
  total NUMERIC(14, 2) NOT NULL DEFAULT 0,
  -- EPCs das etiquetas RFID bipadas (rastreabilidade da peça)
  epcs JSONB DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_pdv_venda_itens_venda ON pdv_venda_itens (venda_id);

CREATE TABLE IF NOT EXISTS pdv_venda_pagamentos (
  id BIGSERIAL PRIMARY KEY,
  venda_id BIGINT NOT NULL REFERENCES pdv_vendas (id) ON DELETE CASCADE,
  -- dinheiro | pix | credito | debito | credito_loja | vale_troca
  forma TEXT NOT NULL
    CHECK (forma IN ('dinheiro', 'pix', 'credito', 'debito', 'credito_loja', 'vale_troca')),
  valor NUMERIC(14, 2) NOT NULL DEFAULT 0,
  parcelas INT NOT NULL DEFAULT 1,
  bandeira TEXT,
  nsu TEXT,
  autorizacao TEXT,
  adquirente_cnpj TEXT,
  troco NUMERIC(14, 2) NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_pdv_venda_pag_venda ON pdv_venda_pagamentos (venda_id);

CREATE TABLE IF NOT EXISTS pdv_notas_fiscais (
  id BIGSERIAL PRIMARY KEY,
  venda_id BIGINT NOT NULL REFERENCES pdv_vendas (id) ON DELETE CASCADE,
  empresa INT NOT NULL,
  cnpj_emitente TEXT,
  modelo SMALLINT NOT NULL CHECK (modelo IN (55, 65)),
  serie INT NOT NULL,
  numero INT NOT NULL,
  chave TEXT,
  ambiente SMALLINT NOT NULL DEFAULT 2,
  -- gerada → enviada → autorizada | rejeitada | cancelada | erro
  status TEXT NOT NULL DEFAULT 'gerada'
    CHECK (status IN ('gerada', 'enviada', 'autorizada', 'rejeitada', 'cancelada', 'erro')),
  cstat TEXT,
  xmotivo TEXT,
  protocolo TEXT,
  dh_emissao TIMESTAMPTZ,
  dh_autorizacao TIMESTAMPTZ,
  xml_assinado TEXT,
  xml_proc TEXT,
  qr_code TEXT,
  url_chave TEXT,
  cancel_protocolo TEXT,
  cancel_justificativa TEXT,
  cancel_em TIMESTAMPTZ,
  erro TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pdv_nf_venda ON pdv_notas_fiscais (venda_id);
CREATE INDEX IF NOT EXISTS idx_pdv_nf_chave ON pdv_notas_fiscais (chave);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pdv_nf_numeracao
  ON pdv_notas_fiscais (empresa, modelo, serie, numero, ambiente);

-- Numeração atômica por empresa/modelo. Devolve o número a usar e já avança.
CREATE OR REPLACE FUNCTION pdv_fiscal_proximo_numero(p_empresa INT, p_modelo INT)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
  n INT;
BEGIN
  IF p_modelo = 65 THEN
    UPDATE pdv_fiscal_config
      SET prox_num_nfce = prox_num_nfce + 1, atualizado_em = now()
      WHERE empresa = p_empresa
      RETURNING prox_num_nfce - 1 INTO n;
  ELSE
    UPDATE pdv_fiscal_config
      SET prox_num_nfe = prox_num_nfe + 1, atualizado_em = now()
      WHERE empresa = p_empresa
      RETURNING prox_num_nfe - 1 INTO n;
  END IF;
  IF n IS NULL THEN
    RAISE EXCEPTION 'Empresa % sem configuração fiscal (pdv_fiscal_config)', p_empresa;
  END IF;
  RETURN n;
END;
$$;

-- atualizado_em automático
CREATE OR REPLACE FUNCTION pdv_touch_atualizado_em()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.atualizado_em = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pdv_vendas_touch ON pdv_vendas;
CREATE TRIGGER trg_pdv_vendas_touch BEFORE UPDATE ON pdv_vendas
  FOR EACH ROW EXECUTE FUNCTION pdv_touch_atualizado_em();

DROP TRIGGER IF EXISTS trg_pdv_nf_touch ON pdv_notas_fiscais;
CREATE TRIGGER trg_pdv_nf_touch BEFORE UPDATE ON pdv_notas_fiscais
  FOR EACH ROW EXECUTE FUNCTION pdv_touch_atualizado_em();

DROP TRIGGER IF EXISTS trg_pdv_cfg_touch ON pdv_fiscal_config;
CREATE TRIGGER trg_pdv_cfg_touch BEFORE UPDATE ON pdv_fiscal_config
  FOR EACH ROW EXECUTE FUNCTION pdv_touch_atualizado_em();
