-- Adiciona campo cidade ao bluecard_leads (usado em importações em lote).
alter table bluecard_leads add column if not exists cidade text;
create index if not exists idx_bluecard_leads_cidade on bluecard_leads (cidade) where cidade is not null;
