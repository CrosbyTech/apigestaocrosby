-- =============================================================
-- Tabela: inadimplencia_mtm_timeline
-- Armazena snapshots diários da inadimplência Multimarcas
-- para gráficos de evolução
-- =============================================================

CREATE TABLE IF NOT EXISTS inadimplencia_mtm_timeline (
  id BIGSERIAL PRIMARY KEY,
  data DATE NOT NULL UNIQUE,
  valor_total NUMERIC(18,2) NOT NULL DEFAULT 0,
  qtd_clientes INTEGER NOT NULL DEFAULT 0,
  qtd_titulos INTEGER NOT NULL DEFAULT 0,
  valor_atrasados NUMERIC(18,2) NOT NULL DEFAULT 0,
  valor_inadimplentes NUMERIC(18,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índice para busca por data
CREATE INDEX IF NOT EXISTS idx_inadimplencia_mtm_timeline_data ON inadimplencia_mtm_timeline(data);

-- =============================================================
-- Tabela: inadimplencia_mtm_representantes_timeline
-- Armazena snapshots diários por representante
-- =============================================================

CREATE TABLE IF NOT EXISTS inadimplencia_mtm_representantes_timeline (
  id BIGSERIAL PRIMARY KEY,
  data DATE NOT NULL,
  representante TEXT NOT NULL,
  valor_total NUMERIC(18,2) NOT NULL DEFAULT 0,
  qtd_clientes INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(data, representante)
);

-- Índice para busca por data
CREATE INDEX IF NOT EXISTS idx_inadimplencia_mtm_rep_timeline_data ON inadimplencia_mtm_representantes_timeline(data);

-- RLS
ALTER TABLE inadimplencia_mtm_timeline ENABLE ROW LEVEL SECURITY;
ALTER TABLE inadimplencia_mtm_representantes_timeline ENABLE ROW LEVEL SECURITY;

-- Políticas de leitura/escrita para todos os usuários autenticados
CREATE POLICY "Permitir leitura inadimplencia_mtm_timeline" ON inadimplencia_mtm_timeline
  FOR SELECT USING (true);
CREATE POLICY "Permitir inserção inadimplencia_mtm_timeline" ON inadimplencia_mtm_timeline
  FOR INSERT WITH CHECK (true);
CREATE POLICY "Permitir atualização inadimplencia_mtm_timeline" ON inadimplencia_mtm_timeline
  FOR UPDATE USING (true);

CREATE POLICY "Permitir leitura inadimplencia_mtm_rep_timeline" ON inadimplencia_mtm_representantes_timeline
  FOR SELECT USING (true);
CREATE POLICY "Permitir inserção inadimplencia_mtm_rep_timeline" ON inadimplencia_mtm_representantes_timeline
  FOR INSERT WITH CHECK (true);
CREATE POLICY "Permitir atualização inadimplencia_mtm_rep_timeline" ON inadimplencia_mtm_representantes_timeline
  FOR UPDATE USING (true);

-- =============================================================
-- Seed: dados iniciais de 18/03/2026 (print fornecido pelo usuário)
-- =============================================================
INSERT INTO inadimplencia_mtm_timeline (data, valor_total, qtd_clientes, qtd_titulos, valor_atrasados, valor_inadimplentes)
VALUES ('2026-03-18', 677649.68, 124, 0, 0, 0)
ON CONFLICT (data) DO NOTHING;

INSERT INTO inadimplencia_mtm_representantes_timeline (data, representante, valor_total, qtd_clientes)
VALUES
  ('2026-03-18', 'REPRESENTANTE', 226783.04, 34),
  ('2026-03-18', 'WALTER DANILO', 191469.06, 36),
  ('2026-03-18', 'PEU', 76002.82, 10),
  ('2026-03-18', 'RENATO ANDERSON', 61469.47, 20),
  ('2026-03-18', 'SEM REPRESENTANTE', 61127.67, 17),
  ('2026-03-18', 'RAFAEL/WALTER', 52122.62, 2),
  ('2026-03-18', 'NAO FOI VENDA', 3287.40, 1),
  ('2026-03-18', 'DAVID', 2227.80, 1),
  ('2026-03-18', 'RAFAEL', 1576.00, 1),
  ('2026-03-18', 'BIRA', 1546.80, 1),
  ('2026-03-18', 'VENDA ERRADA', 37.00, 1)
ON CONFLICT (data, representante) DO NOTHING;
