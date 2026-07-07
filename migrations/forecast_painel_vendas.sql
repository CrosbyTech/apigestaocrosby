-- Painel de Vendas do TOTVS (sale-panel/sellers, campo seller_sale_value)
-- sincronizado por dia/vendedor. Fonte oficial do Forecast por vendedor —
-- espelha exatamente o que o TOTVS mostra no Painel de Vendas.
-- Populada pelo cron painel-vendas-sync (backend/jobs).

create table if not exists forecast_painel_vendas (
  id bigserial primary key,
  data date not null,
  seller_code integer not null,
  seller_name text,
  branch_code integer,
  valor numeric(15,2) not null default 0,
  atualizado_em timestamptz default now(),
  unique (data, seller_code, branch_code)
);

create index if not exists idx_painel_vendas_data on forecast_painel_vendas (data);
create index if not exists idx_painel_vendas_seller on forecast_painel_vendas (seller_code);
create index if not exists idx_painel_vendas_data_seller on forecast_painel_vendas (data, seller_code);

comment on table forecast_painel_vendas is
  'Painel de Vendas TOTVS por dia/vendedor (seller_sale_value). Fonte oficial do Forecast por vendedor.';
