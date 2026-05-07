-- Tabela para registrar o valor diário de inadimplência (timeline)
CREATE TABLE IF NOT EXISTS inadimplencia_timeline (
  id BIGSERIAL PRIMARY KEY,
  data DATE NOT NULL UNIQUE,
  valor_total NUMERIC(18, 2) NOT NULL DEFAULT 0,
  qtd_titulos INTEGER NOT NULL DEFAULT 0,
  qtd_clientes INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índice para busca por data
CREATE INDEX IF NOT EXISTS idx_inadimplencia_timeline_data ON inadimplencia_timeline (data);

-- Inserir valor fixo de 25/02
INSERT INTO inadimplencia_timeline (data, valor_total, qtd_titulos, qtd_clientes)
VALUES ('2025-02-25', 1393240.84, 0, 0)
ON CONFLICT (data) DO NOTHING;

-- Habilitar RLS
ALTER TABLE inadimplencia_timeline ENABLE ROW LEVEL SECURITY;

-- Política de leitura para todos os usuários autenticados
CREATE POLICY "Leitura inadimplencia_timeline" ON inadimplencia_timeline
  FOR SELECT USING (true);

-- Política de escrita para todos os usuários autenticados
CREATE POLICY "Escrita inadimplencia_timeline" ON inadimplencia_timeline
  FOR ALL USING (true) WITH CHECK (true);
