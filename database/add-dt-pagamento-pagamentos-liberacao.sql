-- =============================================
-- Migração: adiciona dt_pagamento em pagamentos_liberacao
-- Permite registrar a data efetiva de pagamento (informada pelo usuário)
-- separada de pago_em (timestamp da ação no sistema).
-- =============================================

ALTER TABLE pagamentos_liberacao
  ADD COLUMN IF NOT EXISTS dt_pagamento DATE;

CREATE INDEX IF NOT EXISTS idx_pagamentos_liberacao_dt_pagamento
  ON pagamentos_liberacao(dt_pagamento);
