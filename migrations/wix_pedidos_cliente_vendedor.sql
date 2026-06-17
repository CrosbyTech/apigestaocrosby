-- Cliente TOTVS substituto + classificação + vendedor responsável
alter table wix_pedidos
  add column if not exists cliente_totvs_code int,
  add column if not exists cliente_totvs_nome text,
  add column if not exists cliente_totvs_doc text,         -- CPF/CNPJ
  add column if not exists cliente_classificacao text,     -- multimarcas | franquia | varejo | outros
  add column if not exists vendedor text;                  -- Renato | Arthur | Rafael | David | Walter | Jhemyson

create index if not exists idx_wix_pedidos_cli_totvs on wix_pedidos (cliente_totvs_code) where cliente_totvs_code is not null;
create index if not exists idx_wix_pedidos_classif on wix_pedidos (cliente_classificacao) where cliente_classificacao is not null;
create index if not exists idx_wix_pedidos_vendedor on wix_pedidos (vendedor) where vendedor is not null;
