-- Espelha pedidos do Wix eCommerce (sync via cron / webhook)
create table if not exists wix_pedidos (
  id text primary key,                   -- UUID do pedido no Wix
  numero text,                           -- número humano (#10106)
  status text,                           -- INITIALIZED, APPROVED, CANCELED, ...
  payment_status text,                   -- PAID, PENDING, REFUNDED
  fulfillment_status text,               -- NOT_FULFILLED, FULFILLED, PARTIALLY_FULFILLED
  -- Cliente
  buyer_email text,
  buyer_nome text,
  buyer_sobrenome text,
  buyer_telefone text,
  buyer_cpf text,                        -- extraído de customFields se houver
  -- Valores
  total numeric(14,2) default 0,
  subtotal numeric(14,2) default 0,
  desconto numeric(14,2) default 0,
  frete numeric(14,2) default 0,
  imposto numeric(14,2) default 0,
  moeda text default 'BRL',
  -- Endereço entrega (resumido)
  ship_cidade text,
  ship_uf text,
  ship_cep text,
  ship_logradouro text,
  ship_numero text,
  ship_complemento text,
  -- Datas
  criado_em timestamptz,                 -- createdDate do Wix
  comprado_em timestamptz,               -- purchasedDate do Wix
  atualizado_em timestamptz,             -- updatedDate do Wix
  -- Metadados
  canal text,                            -- channelInfo (web, pos, etc)
  origem text,                           -- attributionSource (utm)
  raw jsonb,                             -- payload completo pra consulta avançada
  -- Audit
  sincronizado_em timestamptz not null default now()
);

create index if not exists idx_wix_pedidos_criado on wix_pedidos (criado_em desc);
create index if not exists idx_wix_pedidos_status on wix_pedidos (status);
create index if not exists idx_wix_pedidos_email on wix_pedidos (buyer_email);
create index if not exists idx_wix_pedidos_cpf on wix_pedidos (buyer_cpf) where buyer_cpf is not null;
create index if not exists idx_wix_pedidos_numero on wix_pedidos (numero);

-- Itens do pedido (line items) — N por pedido
create table if not exists wix_pedido_items (
  id bigserial primary key,
  pedido_id text not null references wix_pedidos(id) on delete cascade,
  line_item_id text,                     -- id do item no pedido Wix
  produto_id text,                       -- catalogReference.catalogItemId
  variant_id text,                       -- catalogReference.options.variantId
  nome text,                             -- productName.original
  sku text,                              -- physicalProperties.sku
  quantidade integer not null default 1,
  preco_unit numeric(14,2) default 0,    -- price.amount
  preco_total numeric(14,2) default 0,   -- totalPrice.amount
  imagem text,                           -- image (url)
  -- Audit
  criado_em timestamptz not null default now()
);

create index if not exists idx_wix_pedido_items_pedido on wix_pedido_items (pedido_id);
create index if not exists idx_wix_pedido_items_sku on wix_pedido_items (sku) where sku is not null;
create index if not exists idx_wix_pedido_items_produto on wix_pedido_items (produto_id) where produto_id is not null;
