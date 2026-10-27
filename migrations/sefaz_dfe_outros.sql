-- Status manual "Outros" na Manifestação do Destinatário › Pendentes
-- (pedido da Niziany, 27/10/2026): tira a nota da fila de pendentes sem
-- contar como escriturada, sempre com justificativa. Idempotente.
alter table sefaz_dfe_notas add column if not exists status_manual text;        -- 'outros' | null
alter table sefaz_dfe_notas add column if not exists outros_justificativa text;
alter table sefaz_dfe_notas add column if not exists outros_em timestamptz;
alter table sefaz_dfe_notas add column if not exists outros_por text;
create index if not exists sefaz_dfe_notas_status_manual_idx on sefaz_dfe_notas (status_manual);
