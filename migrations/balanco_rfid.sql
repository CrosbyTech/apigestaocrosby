-- ============================================================================
-- BALANÇO RFID — arquivos de contagem feitos no app Android (coletor Urovo
-- DT50 + pistola RFDT50). Cada contagem finalizada vira um "ARQUIVO BALANÇO
-- LOJA X DATA HORA" com os EPCs únicos lidos; o resumo por produto (EPC
-- SGTIN-96 → EAN → produto TOTVS) é calculado sob demanda e guardado em cache.
-- Idempotente.
-- ============================================================================

CREATE TABLE IF NOT EXISTS balanco_rfid_arquivos (
  id BIGSERIAL PRIMARY KEY,
  client_id TEXT UNIQUE,                 -- gerado no app: reenvio não duplica
  nome TEXT NOT NULL,                    -- ARQUIVO BALANÇO LOJA X DATA HORA

  empresa INT NOT NULL,
  empresa_nome TEXT,

  usuario_id UUID,
  usuario_nome TEXT,
  usuario_email TEXT,

  iniciado_em TIMESTAMPTZ,
  finalizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  duracao_seg INT,

  qtd_epcs INT NOT NULL DEFAULT 0,       -- peças (EPCs únicos)
  qtd_leituras INT NOT NULL DEFAULT 0,   -- leituras brutas do leitor
  epcs JSONB NOT NULL DEFAULT '[]'::jsonb,

  dispositivo JSONB,                     -- { modelo, app, sdk, potencia }
  resumo_produtos JSONB,                 -- cache: [{ ean, productCode, nome, qtd }]
  resumo_em TIMESTAMPTZ,
  observacao TEXT,

  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_balanco_rfid_empresa ON balanco_rfid_arquivos (empresa, finalizado_em DESC);
CREATE INDEX IF NOT EXISTS idx_balanco_rfid_data ON balanco_rfid_arquivos (finalizado_em DESC);
