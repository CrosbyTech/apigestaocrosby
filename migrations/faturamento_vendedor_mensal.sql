-- =============================================================
-- Tabela: faturamento_vendedor_mensal
--
-- Cache PERMANENTE do faturamento por vendedor, um registro por
-- (mês, vendedor). Existe porque a rota
-- POST /api/totvs/sale-panel/faturamento-vendedor leva de 50 a 110
-- segundos por mês e ESTOURA em janelas longas (janeiro→setembro não
-- respondeu em 542 s). Mês fechado não muda mais, então é gravado aqui
-- uma vez e lido em milissegundos.
--
-- REGRA DE FECHAMENTO: um mês só é gravado 10 dias depois de terminar
-- (devoluções e acertos ainda entram na virada). Meses ainda abertos
-- continuam sendo consultados ao vivo no TOTVS.
-- =============================================================

CREATE TABLE IF NOT EXISTS faturamento_vendedor_mensal (
  id BIGSERIAL PRIMARY KEY,

  -- Primeiro dia do mês de referência (2026-01-01 = janeiro/2026)
  mes DATE NOT NULL,

  seller_code INTEGER NOT NULL,
  seller_name TEXT,

  qtd INTEGER NOT NULL DEFAULT 0,
  valor NUMERIC(18,2) NOT NULL DEFAULT 0,

  -- Quando a linha foi congelada e qual janela gerou o número
  fechado_em TIMESTAMPTZ DEFAULT NOW(),
  periodo_ini DATE,
  periodo_fim DATE,

  UNIQUE (mes, seller_code)
);

CREATE INDEX IF NOT EXISTS idx_fat_vend_mensal_mes
  ON faturamento_vendedor_mensal(mes);
CREATE INDEX IF NOT EXISTS idx_fat_vend_mensal_seller
  ON faturamento_vendedor_mensal(seller_code);

ALTER TABLE faturamento_vendedor_mensal ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "leitura faturamento_vendedor_mensal" ON faturamento_vendedor_mensal;
CREATE POLICY "leitura faturamento_vendedor_mensal" ON faturamento_vendedor_mensal
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "insercao faturamento_vendedor_mensal" ON faturamento_vendedor_mensal;
CREATE POLICY "insercao faturamento_vendedor_mensal" ON faturamento_vendedor_mensal
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "atualizacao faturamento_vendedor_mensal" ON faturamento_vendedor_mensal;
CREATE POLICY "atualizacao faturamento_vendedor_mensal" ON faturamento_vendedor_mensal
  FOR UPDATE USING (true);
