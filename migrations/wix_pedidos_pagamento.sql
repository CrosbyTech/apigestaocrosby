-- Adiciona campos de pagamento manual aos pedidos Wix.
-- (Wix retorna sempre paymentStatus=NOT_PAID porque os pagamentos da Crosby
-- acontecem fora do site — PIX, boleto, depósito, etc.)
alter table wix_pedidos
  add column if not exists forma_pagamento text,
  add column if not exists data_pagamento timestamptz,
  add column if not exists observacao_pagamento text;

create index if not exists idx_wix_pedidos_forma_pag
  on wix_pedidos (forma_pagamento)
  where forma_pagamento is not null;

create index if not exists idx_wix_pedidos_data_pag
  on wix_pedidos (data_pagamento desc)
  where data_pagamento is not null;
