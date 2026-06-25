-- Tabela para salvar listas de clientes consultadas por filial na página
-- /tecnologia/clientes-por-empresa.
-- A coluna `clientes` guarda o snapshot completo (jsonb) pra que a lista
-- continue acessível mesmo se a NF for cancelada/deletada no TOTVS depois.

CREATE TABLE IF NOT EXISTS clientes_filial_salvos (
  id BIGSERIAL PRIMARY KEY,
  branch_code INT NOT NULL,
  branch_name TEXT,
  lista_nome TEXT,
  total_clientes INT NOT NULL DEFAULT 0,
  faturamento_total NUMERIC(15, 2) NOT NULL DEFAULT 0,
  filtros JSONB,
  clientes JSONB NOT NULL,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cfs_branch_code ON clientes_filial_salvos (branch_code);
CREATE INDEX IF NOT EXISTS idx_cfs_created_at ON clientes_filial_salvos (created_at DESC);
