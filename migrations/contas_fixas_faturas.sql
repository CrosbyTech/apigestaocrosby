-- Faturas das despesas fixas (energia, água, internet…) capturadas pelos bots.
-- Uma linha por fatura: a mesma fatura pedida de novo só atualiza.
create table if not exists contas_fixas_faturas (
  id bigserial primary key,
  tipo_despesa text not null,
  concessionaria text not null,
  cd_filial varchar(20) not null,
  codigo_cliente text not null,
  valor numeric(14, 2) not null,
  vencimento date not null,
  pix_copia_cola text,
  linha_digitavel text,
  pdf_path text,
  liberacao_id uuid,
  origem text not null,
  capturado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create unique index if not exists contas_fixas_faturas_uniq on contas_fixas_faturas (concessionaria, codigo_cliente, vencimento, valor);
create index if not exists contas_fixas_faturas_filial_idx on contas_fixas_faturas (cd_filial, vencimento desc);

alter table contas_fixas_faturas enable row level security;
