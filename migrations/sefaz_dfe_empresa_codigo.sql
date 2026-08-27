-- Código da empresa/filial TOTVS (Cod. Empresa do FISFP153) para filtro por filial
alter table sefaz_dfe_notas add column if not exists empresa_codigo int;
create index if not exists idx_sefaz_dfe_notas_emp on sefaz_dfe_notas (empresa_codigo);
