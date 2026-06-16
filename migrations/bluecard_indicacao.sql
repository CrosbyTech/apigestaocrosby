-- Adiciona coluna indicado_por pra rastrear referrer do lead BlueCard
alter table bluecard_leads
  add column if not exists indicado_por text;

create index if not exists idx_bluecard_leads_indicado_por
  on bluecard_leads (indicado_por)
  where indicado_por is not null;
