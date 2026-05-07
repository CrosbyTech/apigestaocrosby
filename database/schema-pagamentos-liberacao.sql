-- =============================================
-- Tabela: pagamentos_liberacao
-- Armazena títulos enviados de Contas a Pagar
-- para o fluxo de Liberação de Pagamento
-- Execute no Supabase SQL Editor
-- =============================================

CREATE TABLE IF NOT EXISTS pagamentos_liberacao (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Identificação do título original (vindos da API TOTVS)
  cd_empresa        INTEGER,
  nm_empresa        VARCHAR(255),
  nr_duplicata      VARCHAR(50),
  nr_parcela        VARCHAR(10),
  nr_portador       VARCHAR(50),
  cd_fornecedor     VARCHAR(50),
  nm_fornecedor     VARCHAR(255),
  cd_despesaitem    VARCHAR(50),
  ds_despesaitem    VARCHAR(255),
  cd_ccusto         VARCHAR(50),
  dt_emissao        DATE,
  dt_vencimento     DATE,
  vl_duplicata      NUMERIC(15, 2) NOT NULL DEFAULT 0,
  vl_real           NUMERIC(15, 2),          -- valor efetivamente pago (quando diferente do duplicata)

  -- Workflow
  status            VARCHAR(20) NOT NULL DEFAULT 'PENDENTE'
                    CHECK (status IN ('PENDENTE', 'APROVADO', 'PAGO', 'CANCELADO', 'TRANSFERENCIA')),

  -- Dados de pagamento (preenchidos pelo financeiro)
  banco_pagamento   VARCHAR(50),    -- banco em que o pagamento será efetuado
  forma_pagamento   VARCHAR(20)
                    CHECK (forma_pagamento IN ('PIX', 'BOLETO', 'DEBITO', 'CREDITO') OR forma_pagamento IS NULL),
  codigo_barras     VARCHAR(255),   -- usado quando BOLETO
  chave_pix         VARCHAR(255),   -- usado quando PIX
  link_pagamento    VARCHAR(500),   -- usado quando DEBITO ou CREDITO
  observacao        TEXT,

  -- Auditoria
  enviado_por       VARCHAR(255),
  enviado_em        TIMESTAMPTZ DEFAULT NOW(),
  aprovado_por      VARCHAR(255),
  aprovado_em       TIMESTAMPTZ,
  pago_por          VARCHAR(255),
  pago_em           TIMESTAMPTZ,
  dt_pagamento      DATE,           -- data efetiva de pagamento (informada pelo usuário)
  cancelado_por     VARCHAR(255),
  cancelado_em      TIMESTAMPTZ,

  -- Snapshot do objeto original
  dados_completos   JSONB,

  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_pagamentos_liberacao_status ON pagamentos_liberacao(status);
CREATE INDEX IF NOT EXISTS idx_pagamentos_liberacao_dt_venc ON pagamentos_liberacao(dt_vencimento);
CREATE INDEX IF NOT EXISTS idx_pagamentos_liberacao_forn ON pagamentos_liberacao(cd_fornecedor);

-- Trigger updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_pagamentos_liberacao_updated_at ON pagamentos_liberacao;
CREATE TRIGGER update_pagamentos_liberacao_updated_at
  BEFORE UPDATE ON pagamentos_liberacao
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS
ALTER TABLE pagamentos_liberacao ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'pagamentos_liberacao' AND policyname = 'Leitura autenticada') THEN
    CREATE POLICY "Leitura autenticada"   ON pagamentos_liberacao FOR SELECT USING (auth.role() = 'authenticated');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'pagamentos_liberacao' AND policyname = 'Insercao autenticada') THEN
    CREATE POLICY "Insercao autenticada"  ON pagamentos_liberacao FOR INSERT WITH CHECK (auth.role() = 'authenticated');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'pagamentos_liberacao' AND policyname = 'Atualizacao autenticada') THEN
    CREATE POLICY "Atualizacao autenticada" ON pagamentos_liberacao FOR UPDATE USING (auth.role() = 'authenticated');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'pagamentos_liberacao' AND policyname = 'Exclusao autenticada') THEN
    CREATE POLICY "Exclusao autenticada"  ON pagamentos_liberacao FOR DELETE USING (auth.role() = 'authenticated');
  END IF;
END $$;

-- =============================================
-- MIGRAÇÃO (execute se a tabela já existir)
-- =============================================
ALTER TABLE pagamentos_liberacao
  ADD COLUMN IF NOT EXISTS banco_pagamento  VARCHAR(50),
  ADD COLUMN IF NOT EXISTS aprovado_por     VARCHAR(255),
  ADD COLUMN IF NOT EXISTS aprovado_em      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelado_por    VARCHAR(255),
  ADD COLUMN IF NOT EXISTS cancelado_em     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS vl_real          NUMERIC(15, 2),
  ADD COLUMN IF NOT EXISTS dt_pagamento     DATE;
