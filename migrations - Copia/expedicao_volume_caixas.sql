-- Volume de caixas enviadas (manual). Diferente de volume_qty (peças vindas do TOTVS).
alter table expedicao_showroom
  add column if not exists volume_caixas integer not null default 0;
