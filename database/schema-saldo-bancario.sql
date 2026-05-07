-- Tabela para armazenar saldo manual de cada banco
-- Execute este script no Supabase SQL Editor

CREATE TABLE IF NOT EXISTS saldo_bancario (
  banco       TEXT PRIMARY KEY,
  valor       NUMERIC(15, 2) NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_by  TEXT
);

ALTER TABLE saldo_bancario ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'saldo_bancario' AND policyname = 'saldo_bancario_select'
  ) THEN
    CREATE POLICY "saldo_bancario_select" ON saldo_bancario
      FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'saldo_bancario' AND policyname = 'saldo_bancario_all'
  ) THEN
    CREATE POLICY "saldo_bancario_all" ON saldo_bancario
      FOR ALL USING (auth.role() = 'authenticated');
  END IF;
END $$;

-- Popula as linhas iniciais (valor 0) para cada banco
INSERT INTO saldo_bancario (banco, valor)
VALUES
  ('SICREDI CROSBY', 0),
  ('SICREDI FÁBIO',  0),
  ('STONE',          0),
  ('ITAU FLAVIO',    0),
  ('CAIXA IRMAOS',   0)
ON CONFLICT (banco) DO NOTHING;
