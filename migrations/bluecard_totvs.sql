-- Integração TOTVS: cadastro automático do lead quando status muda pra
-- "Informações Completas". Guarda o personCode retornado pelo TOTVS.
alter table bluecard_leads
  add column if not exists totvs_person_code bigint,
  add column if not exists totvs_synced_at timestamptz,
  add column if not exists totvs_sync_error text;

create index if not exists idx_bluecard_leads_totvs on bluecard_leads (totvs_person_code) where totvs_person_code is not null;
