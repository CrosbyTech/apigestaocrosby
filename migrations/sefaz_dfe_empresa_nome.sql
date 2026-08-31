-- Nome da filial no TOTVS, gravado junto com o codigo na captura da SEFAZ
alter table sefaz_dfe_notas add column if not exists empresa_nome text;
