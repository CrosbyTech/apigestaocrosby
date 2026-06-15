-- Adiciona campo categoria às cotações (compras/patrimonio/uso_consumo/tecnologia).
-- Default 'compras' pra cotações existentes.
ALTER TABLE tech_cotacoes
  ADD COLUMN IF NOT EXISTS categoria TEXT NOT NULL DEFAULT 'compras'
  CHECK (categoria IN ('compras', 'patrimonio', 'uso_consumo', 'tecnologia'));

CREATE INDEX IF NOT EXISTS idx_tech_cotacoes_categoria ON tech_cotacoes(categoria);
