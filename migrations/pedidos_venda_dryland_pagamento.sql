-- Pedidos de venda do Dryland: pagamento (do Dryland/Pagar.me e manual) e comprovante.
-- O Dryland só expõe o pagamento do pedido enquanto ele está "pago e sem TOTVS"
-- (RPC loja_revenda_pagos_sem_totvs); o job guarda nessa janela e não apaga depois.
ALTER TABLE pedidos_venda_dryland ADD COLUMN IF NOT EXISTS pagamento_info JSONB;      -- pago_info do Dryland (nsu, autorizacao, tid, bandeira, parcelas, cartao_final, end_to_end_id, charge_id, code…)
ALTER TABLE pedidos_venda_dryland ADD COLUMN IF NOT EXISTS pagamento_capturado_em TIMESTAMPTZ;
ALTER TABLE pedidos_venda_dryland ADD COLUMN IF NOT EXISTS total_pago NUMERIC(14, 2);
ALTER TABLE pedidos_venda_dryland ADD COLUMN IF NOT EXISTS frete NUMERIC(14, 2);
ALTER TABLE pedidos_venda_dryland ADD COLUMN IF NOT EXISTS credev_usado NUMERIC(14, 2);
ALTER TABLE pedidos_venda_dryland ADD COLUMN IF NOT EXISTS cliente_doc TEXT;
ALTER TABLE pedidos_venda_dryland ADD COLUMN IF NOT EXISTS cliente_telefone TEXT;
ALTER TABLE pedidos_venda_dryland ADD COLUMN IF NOT EXISTS pagamento_manual JSONB;    -- { forma, nsu, autorizacao, obs, por, em }
ALTER TABLE pedidos_venda_dryland ADD COLUMN IF NOT EXISTS comprovante_url TEXT;
ALTER TABLE pedidos_venda_dryland ADD COLUMN IF NOT EXISTS comprovante_nome TEXT;
ALTER TABLE pedidos_venda_dryland ADD COLUMN IF NOT EXISTS comprovante_em TIMESTAMPTZ;
