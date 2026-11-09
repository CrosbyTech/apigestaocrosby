-- ============================================================================
-- FATURAMENTO DOS PEDIDOS DE VENDA (tela /expedicao/faturamento)
-- Pedido separado no Dryland → FATURAR no HeadCoach: empresa 99, cliente do
-- pedido, operação escolhida, conferência das peças pelo portal RFID (SKU do
-- pedido × SKU das etiquetas) e transação de venda "em andamento" no TOTVS só
-- com as peças conferidas. Uma linha por transação gerada. Idempotente.
-- ============================================================================
CREATE TABLE IF NOT EXISTS pedidos_venda_faturamentos (
  id BIGSERIAL PRIMARY KEY,
  chave TEXT NOT NULL,                 -- id do card da fila ou SEP:<ref>
  numero_site TEXT,                    -- ref do pedido do Dryland
  empresa INT NOT NULL,
  transacao_code BIGINT NOT NULL,
  transacao_date DATE,
  transacao_status INT NOT NULL DEFAULT 1,   -- 1 andamento · 4 atendida · 6 cancelada
  operacao INT,
  cfop INT,
  total NUMERIC(14, 2) NOT NULL DEFAULT 0,
  cliente_code INT,
  cliente_nome TEXT,
  vendedor_code INT,
  qtd_pedido INT NOT NULL DEFAULT 0,
  qtd_conferida INT NOT NULL DEFAULT 0,
  qtd_faltando INT NOT NULL DEFAULT 0,
  qtd_sobrando INT NOT NULL DEFAULT 0,
  conferidos JSONB NOT NULL DEFAULT '[]'::jsonb,  -- { productCode, name, quantidade, unit, total, epcs[] }
  faltando JSONB NOT NULL DEFAULT '[]'::jsonb,
  sobrando JSONB NOT NULL DEFAULT '[]'::jsonb,
  atendida_em TIMESTAMPTZ,
  criado_por TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pvfat_trx ON pedidos_venda_faturamentos (empresa, transacao_code);
CREATE INDEX IF NOT EXISTS idx_pvfat_chave ON pedidos_venda_faturamentos (chave);
CREATE INDEX IF NOT EXISTS idx_pvfat_ref ON pedidos_venda_faturamentos (numero_site);
