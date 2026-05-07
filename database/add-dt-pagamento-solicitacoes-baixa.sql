-- Adicionar coluna dt_pagamento na tabela solicitacoes_baixa
ALTER TABLE solicitacoes_baixa ADD COLUMN IF NOT EXISTS dt_pagamento DATE;
