-- Painel de Impostos (aba Fiscal) — apuração por empresa/mês.
-- v1: ICMS. Provisão (estimativa pelas notas do TOTVS) vira realizado quando
-- o SPED EFD ICMS/IPI é importado (registro E110).
create table if not exists fiscal_imposto_apuracao (
  id              bigint generated always as identity primary key,
  imposto         text    not null default 'ICMS',
  cd_empresa      integer not null,
  nm_empresa      text,
  cnpj            text,
  ano             integer not null,
  mes             integer not null check (mes between 1 and 12),
  valor           numeric(15,2) not null default 0,   -- saldo a recolher
  origem          text    not null check (origem in ('provisao','realizado')),
  detalhe         jsonb,                                -- {debito, credito, notas, sped:{...}}
  atualizado_por  text,
  atualizado_em   timestamptz not null default now(),
  unique (imposto, cd_empresa, ano, mes)
);

create index if not exists idx_fiscal_imposto_apuracao_ano on fiscal_imposto_apuracao (imposto, ano);
