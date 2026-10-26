-- ============================================================================
-- BOT STONE EXTRATOS — fila de execuções do bot local (puppeteer) que baixa os
-- extratos das contas Stone, importa no Extrato Bancário (fluxo_caixa_*) e
-- sobe o saldo do dia em saldo_bancario (Liberação de Pagamento).
--
-- O bot roda no PC do financeiro (bots/stone-extratos) e conversa com o
-- backend por /api/stone-bot/agente/* (token STONE_BOT_TOKEN). A tela
-- (Extrato Bancário → aba "Bot Stone") enfileira execuções e lê o log.
-- ============================================================================

CREATE TABLE IF NOT EXISTS stone_bot_execucoes (
  id              BIGSERIAL PRIMARY KEY,
  status          TEXT        NOT NULL DEFAULT 'pendente',  -- pendente | rodando | concluido | erro | cancelado
  origem          TEXT        NOT NULL DEFAULT 'manual',    -- manual (botão) | agendado (horário do bot)
  solicitado_por  TEXT,
  parametros      JSONB,                                    -- { de, ate, contas? }
  log             JSONB       NOT NULL DEFAULT '[]'::jsonb, -- [{ t, nivel, msg }]
  resumo          JSONB,                                    -- { contas, pdfs, importados, falhas, saldoTotal, ... }
  erro            TEXT,
  agente          TEXT,                                     -- hostname do PC que rodou
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
  iniciado_em     TIMESTAMPTZ,
  concluido_em    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_stone_bot_exec_status ON stone_bot_execucoes (status, criado_em);
CREATE INDEX IF NOT EXISTS idx_stone_bot_exec_criado ON stone_bot_execucoes (criado_em DESC);

-- Saldo de cada conta Stone a cada execução (histórico diário)
CREATE TABLE IF NOT EXISTS stone_bot_saldos (
  id              BIGSERIAL PRIMARY KEY,
  execucao_id     BIGINT REFERENCES stone_bot_execucoes(id) ON DELETE SET NULL,
  data            DATE        NOT NULL,
  stone_account_id TEXT,
  agencia         TEXT,
  conta           TEXT        NOT NULL,
  titular_nome    TEXT,
  titular_cnpj    TEXT,
  saldo           NUMERIC(14,2) NOT NULL,
  saldo_bloqueado NUMERIC(14,2),
  saldo_agendado  NUMERIC(14,2),
  capturado_em    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (data, conta)
);
CREATE INDEX IF NOT EXISTS idx_stone_bot_saldos_data ON stone_bot_saldos (data DESC);

-- Último sinal de vida do agente local (uma linha por PC)
CREATE TABLE IF NOT EXISTS stone_bot_agentes (
  host            TEXT PRIMARY KEY,
  versao          TEXT,
  sessao_ok       BOOLEAN,
  ultimo_ping     TIMESTAMPTZ NOT NULL DEFAULT now(),
  proxima_agendada TEXT,
  detalhes        JSONB
);

-- PDF do extrato guardado no Storage (bucket extratos-bancarios)
ALTER TABLE fluxo_caixa_importacoes ADD COLUMN IF NOT EXISTS arquivo_path TEXT;
ALTER TABLE fluxo_caixa_importacoes ADD COLUMN IF NOT EXISTS origem TEXT; -- upload | bot-stone-pdf | bot-stone-api

COMMENT ON TABLE stone_bot_execucoes IS 'Bot Stone Extratos — fila/log das execuções do bot local (puppeteer).';
COMMENT ON TABLE stone_bot_saldos IS 'Bot Stone Extratos — saldo de cada conta Stone capturado pelo bot (histórico diário).';
COMMENT ON TABLE stone_bot_agentes IS 'Bot Stone Extratos — último ping de cada PC rodando o agente.';
