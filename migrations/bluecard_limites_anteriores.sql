-- Snapshot do limite FINANCEIRO por filial no momento da liberacao BlueCard.
-- O watchdog (jobs/bluecard-limite.job.js) restaura estes valores ao fechar a
-- janela — antes ele zerava tudo, destruindo limites definidos manualmente
-- (Analise de Credito, tela de Creditos Clientes) a cada ciclo de compra.
-- Formato: { "99": 5000, "2": 1500 } — filial -> valor em reais.
ALTER TABLE bluecard_liberacoes
  ADD COLUMN IF NOT EXISTS limites_anteriores jsonb;
