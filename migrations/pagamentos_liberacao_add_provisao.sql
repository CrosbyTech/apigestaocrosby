-- Adiciona PROVISAO como status válido na tabela pagamentos_liberacao
ALTER TABLE pagamentos_liberacao
  DROP CONSTRAINT pagamentos_liberacao_status_check;

ALTER TABLE pagamentos_liberacao
  ADD CONSTRAINT pagamentos_liberacao_status_check
  CHECK (status IN ('PENDENTE', 'PROVISAO', 'APROVADO', 'PAGO', 'CANCELADO', 'TRANSFERENCIA'));
