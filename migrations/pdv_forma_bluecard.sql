-- Forma de pagamento BLUECARD no PDV Crosby (Yago, 18/11/2026): crediário da
-- loja. Na venda fica com o nome "bluecard"; no contas a receber vira título de
-- BOLETO / FATURA em aberto (portador BLUECARD), uma parcela por mês.
-- Só acrescenta 'bluecard' à lista de formas aceitas (as outras continuam).
ALTER TABLE pdv_venda_pagamentos
  DROP CONSTRAINT IF EXISTS pdv_venda_pagamentos_forma_check,
  ADD CONSTRAINT pdv_venda_pagamentos_forma_check
    CHECK (forma IN ('dinheiro', 'pix', 'credito', 'debito', 'credito_loja', 'vale_troca', 'boleto', 'adiantamento', 'saldo_bonus', 'bluecard'));
