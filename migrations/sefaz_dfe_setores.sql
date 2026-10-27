-- Setor responsável pela nota na Manifestação do Destinatário › Pendentes
-- (pedido da Niziany, 27/10/2026, no modelo do Dryland). Idempotente.
alter table sefaz_dfe_notas add column if not exists setor text;
create index if not exists sefaz_dfe_notas_setor_idx on sefaz_dfe_notas (setor);

create table if not exists sefaz_dfe_setores (
  id bigserial primary key,
  nome text not null unique,
  ordem integer not null default 100,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

insert into sefaz_dfe_setores (nome, ordem) values
  ('Fiscal', 1),
  ('Devolução', 2),
  ('Transferência', 3),
  ('Patrimônio', 4),
  ('Produção', 5)
on conflict (nome) do nothing;
