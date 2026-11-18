-- Configurações do Faturamento da expedição que o admin/owner muda pela tela
-- (Yago, 18/11/2026). Uma linha por chave; o valor é um JSON.
--   troca_produtos → { "liberada": true|false, "ate": "AAAA-MM-DD" }
--     troca de peça na conferência do faturamento (a que falta sai, a que sobra
--     entra pelo mesmo valor): vale enquanto liberada = true e hoje <= ate.
CREATE TABLE IF NOT EXISTS faturamento_config (
  chave TEXT PRIMARY KEY,
  valor JSONB NOT NULL DEFAULT '{}'::jsonb,
  atualizado_por TEXT,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- histórico de quem mudou o quê (para saber quem liberou e até quando)
CREATE TABLE IF NOT EXISTS faturamento_config_historico (
  id BIGSERIAL PRIMARY KEY,
  chave TEXT NOT NULL,
  valor JSONB NOT NULL,
  por TEXT,
  em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS faturamento_config_hist_chave ON faturamento_config_historico (chave, em DESC);
