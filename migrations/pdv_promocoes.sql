-- PDV Crosby — promoções próprias do HeadCoach (criadas na tela Preço
-- Promocional com "GERAR NO PDV CROSBY"). Não mexem no TOTVS: o PDV Crosby
-- aplica o valor promocional como desconto ao bipar o produto.
create table if not exists pdv_promocoes (
  id bigserial primary key,
  nome text not null,
  empresas int[],                 -- null = todas as lojas
  inicio date not null,
  fim date not null,
  ativa boolean not null default true,
  desconto_pct numeric,           -- % usado na criação (informativo)
  criado_por text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table if not exists pdv_promocao_itens (
  promocao_id bigint not null references pdv_promocoes(id) on delete cascade,
  product_code bigint not null,
  sku text,
  nome text,
  preco_base numeric,             -- preço de venda quando a promoção foi criada
  preco_promocional numeric not null,
  criado_em timestamptz not null default now(),
  primary key (promocao_id, product_code)
);

create index if not exists pdv_promocao_itens_produto_idx on pdv_promocao_itens (product_code);
create index if not exists pdv_promocoes_vigencia_idx on pdv_promocoes (ativa, inicio, fim);
