-- Adicionar colunas de inadimplência por canal (multimarcas e franquias) na timeline
ALTER TABLE inadimplencia_timeline
  ADD COLUMN IF NOT EXISTS valor_multimarcas NUMERIC(18, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS valor_franquias NUMERIC(18, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS qtd_titulos_multimarcas INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS qtd_titulos_franquias INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS qtd_clientes_multimarcas INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS qtd_clientes_franquias INTEGER NOT NULL DEFAULT 0;

-- Preencher valor inicial (25/02) com os dados base de cada canal
UPDATE inadimplencia_timeline
SET valor_multimarcas = 688245.00,
    valor_franquias = 515207.00
WHERE data = '2025-02-25';
