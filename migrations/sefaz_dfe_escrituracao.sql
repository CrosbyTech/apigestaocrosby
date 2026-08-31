-- Escrituracao no TOTVS: a nota escriturada e a que tem fatura vinculada
alter table sefaz_dfe_notas add column if not exists escriturada boolean default false;
alter table sefaz_dfe_notas add column if not exists nr_fatura text;
alter table sefaz_dfe_notas add column if not exists dt_fatura date;
create index if not exists idx_sefaz_dfe_notas_escr on sefaz_dfe_notas (escriturada);
