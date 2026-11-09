-- ============================================================================
-- CONTAS A PAGAR × CONCILIAÇÃO (Yago, 09/11/2026)
-- Quando uma saída do extrato é conciliada com uma duplicata (contas a pagar
-- do TOTVS, Liberação ou Solicitação), a duplicata passa a aparecer como
-- "PAGO VIA CONCILIAÇÃO" na tela Contas a Pagar - Consulta, com data de
-- liquidação (data da saída) e valor pago. Esta tabela é DERIVADA de
-- fluxo_caixa_conciliacoes: o backend reescreve as linhas de uma conciliação
-- quando ela é gravada e as apaga quando a conciliação é desfeita.
-- Rodar: node scripts/migrar-cp-pagos-conciliacao.mjs
-- ============================================================================
CREATE TABLE IF NOT EXISTS contas_pagar_pagos_conciliacao (
  id              BIGSERIAL PRIMARY KEY,
  conciliacao_id  BIGINT        NOT NULL,
  cd_empresa      INT           NOT NULL,
  nr_duplicata    BIGINT        NOT NULL,
  nr_parcela      INT,
  cd_fornecedor   INT,
  dt_pagamento    DATE          NOT NULL,
  vl_pago         NUMERIC(14,2) NOT NULL,
  banco           TEXT,
  origem          TEXT,
  criado_em       TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cp_pagos_conc_dup ON contas_pagar_pagos_conciliacao (nr_duplicata);
CREATE INDEX IF NOT EXISTS idx_cp_pagos_conc_conc ON contas_pagar_pagos_conciliacao (conciliacao_id);
ALTER TABLE contas_pagar_pagos_conciliacao ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'contas_pagar_pagos_conciliacao' AND policyname = 'leitura_autenticado') THEN
    CREATE POLICY leitura_autenticado ON contas_pagar_pagos_conciliacao FOR SELECT TO authenticated USING (true);
  END IF;
END $$;
