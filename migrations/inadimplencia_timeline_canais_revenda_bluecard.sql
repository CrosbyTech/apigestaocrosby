-- Dashboard de Inadimplência: a timeline diária passa a guardar também os
-- canais REVENDA e BLUECARD (antes só Multimarcas e Franquias).
-- O frontend faz upsert com estas colunas; se elas não existirem ele cai para
-- o formato antigo (sem os dois canais) e avisa no console.

ALTER TABLE inadimplencia_timeline
  ADD COLUMN IF NOT EXISTS valor_revenda NUMERIC(14,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS qtd_titulos_revenda INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS qtd_clientes_revenda INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS valor_bluecard NUMERIC(14,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS qtd_titulos_bluecard INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS qtd_clientes_bluecard INT DEFAULT 0;

COMMENT ON COLUMN inadimplencia_timeline.valor_bluecard IS
  'Saldo vencido dos clientes BlueCard (crediário do app) no dia — canal novo, 2026-09';
COMMENT ON COLUMN inadimplencia_timeline.valor_revenda IS
  'Saldo vencido dos clientes REVENDA (classificação TOTVS) no dia';
