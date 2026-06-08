-- Atualiza pipeline de status do BlueCard pra espelhar o board do ClickUp.
-- Status anteriores → novos:
--   novo → 1_msg_enviada
--   contatado → info_completas
--   qualificado → presskit_montado
--   convertido → credito_utilizado
--   descartado → descartado
update bluecard_leads set status = '1_msg_enviada'    where status = 'novo';
update bluecard_leads set status = 'info_completas'   where status = 'contatado';
update bluecard_leads set status = 'presskit_montado' where status = 'qualificado';
update bluecard_leads set status = 'credito_utilizado' where status = 'convertido';

-- Novo default (pipeline ClickUp começa em "1ª Mensagem Enviada")
alter table bluecard_leads alter column status set default '1_msg_enviada';
