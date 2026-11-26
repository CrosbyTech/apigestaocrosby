-- Solicitações Crosby: comprovante de PAGAMENTO separado do anexo do pedido.
-- comprovante_url serve aos dois (o arquivo que a pessoa anexa no formulário e o
-- recibo da Stone); quando o pedido já vinha com anexo, o recibo do pagamento não
-- aparecia em "Minhas Solicitações". O recibo passa a ficar aqui (Yago, 26/11/2026).
-- Só acréscimos: pode rodar de novo.
alter table solicitacoes_crosby add column if not exists comprovante_pagamento_url text;
