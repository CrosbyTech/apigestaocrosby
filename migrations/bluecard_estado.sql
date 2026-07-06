-- Coluna estado (UF) no bluecard_leads — usada pelo import Excel
alter table bluecard_leads add column if not exists estado text;
