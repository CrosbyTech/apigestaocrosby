-- New Forecast — cache dos valores por bloco de datas (botão SALVAR DB).
-- Cada linha guarda o faturamento de UM bloco fechado (ex.: 2026-09-01 a
-- 2026-09-07) por canal, como o /sale-panel/faturamento-vendedor-semanal
-- calcula. Na busca seguinte esses blocos vêm daqui em vez do TOTVS, que é
-- a parte lenta. Só bloco JÁ FECHADO entra (datemax com 2 dias de folga),
-- porque o dia corrente ainda recebe venda e cancelamento.
-- Não guarda o drill (detalhamento por cliente/loja) — só os totais.
-- Rodar no SQL Editor do projeto Supabase PRINCIPAL.

create table if not exists new_forecast_semana_cache (
  periodo_key text primary key, -- 'YYYY-MM-DD|YYYY-MM-DD' (datemin|datemax do bloco)
  datemin date not null,
  datemax date not null,
  canais jsonb not null default '{}'::jsonb, -- { CANAL: valor } do bloco
  salvo_em timestamptz default now()
);

create index if not exists new_forecast_semana_cache_datas_idx
  on new_forecast_semana_cache (datemin, datemax);

comment on table new_forecast_semana_cache is
  'Cache do New Forecast: faturamento por canal de cada bloco de datas fechado (botao SALVAR DB).';
