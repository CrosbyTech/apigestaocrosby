-- Cópia local das promoções do TOTVS (PRDFM002) para a tela Preço Promocional
-- (/promocoes/valores): ler a promoção no TOTVS é lento (GET /promotion devolve
-- 100 itens por página). Toda leitura do TOTVS e toda gravação feita pela tela
-- (promotion-values/update / promotion-items) atualizam estas tabelas; a tela
-- consulta daqui e só volta ao TOTVS quando pedem para atualizar.
CREATE TABLE IF NOT EXISTS totvs_promocoes (
  empresa INT NOT NULL,
  promocao_code INT NOT NULL,
  descricao TEXT,
  inicio TIMESTAMPTZ,
  fim TIMESTAMPTZ,
  status TEXT,                 -- A aberta · B bloqueada · E encerrada
  qtd_itens INT NOT NULL DEFAULT 0,
  lido_totvs_em TIMESTAMPTZ,   -- última leitura completa dos itens no TOTVS
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa, promocao_code)
);

CREATE TABLE IF NOT EXISTS totvs_promocao_itens (
  empresa INT NOT NULL,
  promocao_code INT NOT NULL,
  produto_code INT NOT NULL,
  valor_promocional NUMERIC(14, 2),
  valor_anterior NUMERIC(14, 2),
  origem TEXT NOT NULL DEFAULT 'totvs',  -- totvs (lido) · headcoach (gravado pela tela)
  gravado_por TEXT,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa, promocao_code, produto_code)
);
CREATE INDEX IF NOT EXISTS totvs_promocao_itens_produto_idx ON totvs_promocao_itens (produto_code);
