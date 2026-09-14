-- Cache PERSISTIDO de listas caras do TOTVS (ex.: clientes de REVENDA, que a
-- frio levam mais de 3 minutos para montar — 4 varreduras paginadas PJ+PF).
--
-- Antes o cache vivia só na memória do processo: cada deploy/restart zerava,
-- e a primeira tela a pedir a lista pagava os 3 minutos (ou desistia). Agora
-- a rota responde na hora com o que está salvo aqui, renova em segundo plano
-- e o job reseller-cache-warm mantém a lista fresca.

CREATE TABLE IF NOT EXISTS totvs_listas_cache (
  chave TEXT PRIMARY KEY,              -- ex.: 'reseller-clients'
  payload JSONB NOT NULL,              -- a lista inteira, como a rota devolve
  total INT NOT NULL DEFAULT 0,
  duracao_ms INT,                      -- quanto demorou para montar no TOTVS
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE totvs_listas_cache IS
  'Listas caras do TOTVS persistidas (revenda etc.). Rota lê daqui e renova em background.';
