-- New Forecast — canais extras criados pelo usuário na própria tela
-- ("Adicionar canal"). Valem para todos os períodos; o que for digitado nas
-- células continua no new_forecast_config de cada período (bucket `manual`),
-- igual aos demais canais manuais. qtd = true → contado em UNIDADES (und),
-- fora dos totais em R$; false → valor em R$.
-- Rodar no SQL Editor do projeto Supabase PRINCIPAL.

create table if not exists new_forecast_canais_extra (
  nome text primary key, -- rótulo do canal, em MAIÚSCULAS
  qtd boolean not null default false, -- true = unidades, false = R$
  criado_em timestamptz default now()
);

comment on table new_forecast_canais_extra is
  'Canais extras do New Forecast criados na tela (nome + se e contado em unidades).';
