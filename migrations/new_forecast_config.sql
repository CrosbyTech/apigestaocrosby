-- New Forecast — configuração persistida por período (compartilhada entre
-- usuários/navegadores): régua de semanas ajustada, metas, valores manuais
-- e overrides digitados sobre os valores do Painel de Vendas.
-- Rodar no SQL Editor do projeto Supabase PRINCIPAL.

create table if not exists new_forecast_config (
  period_key text primary key, -- 'YYYY-MM-DD|YYYY-MM-DD' (datemin|datemax)
  datemin date not null,
  datemax date not null,
  semanas jsonb, -- [{s, datemin, datemax}] ou null = régua padrão
  metas jsonb not null default '{}'::jsonb, -- { canal: numero }
  manual jsonb not null default '{}'::jsonb, -- { canal: { s1..sN } }
  overrides jsonb not null default '{}'::jsonb, -- { canal: { s1..sN } }
  atualizado_em timestamptz default now()
);

comment on table new_forecast_config is
  'Configuração do New Forecast por período: semanas ajustadas, metas, valores manuais e overrides.';
