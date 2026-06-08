-- Faz o status começar SEM status (null) por padrão pra novos sync TOTVS.
-- O usuário classifica manualmente conforme processa.
-- Também reseta NFs que ainda não foram tocadas (sem transportadora E sem rastreio).
ALTER TABLE expedicao_showroom
  ALTER COLUMN status DROP NOT NULL,
  ALTER COLUMN status DROP DEFAULT;

-- Reseta status das NFs que parecem não ter sido processadas
-- (sem transportadora E sem rastreio E ainda com default 'enviado_blue')
UPDATE expedicao_showroom
   SET status = NULL
 WHERE status = 'enviado_blue'
   AND (transportadora IS NULL OR transportadora = '')
   AND (codigo_rastreio IS NULL OR codigo_rastreio = '');
