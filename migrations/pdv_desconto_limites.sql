-- =============================================================
-- HEADCOACH › FINANCEIRO › LIBERAÇÃO DE DESCONTO (Yago, 19/11/2026)
--
-- Limite de desconto que cada vendedor pode dar no PDV Crosby sem pedir a
-- senha de um owner/admin. Até aqui era 15% fixo na tela, igual para todos.
-- Agora cada usuário do setor VAREJO com loja configurada tem o seu, mudado
-- pela tela Liberação de Desconto (um a um, por loja ou todos de uma vez).
--
-- Quem não tem linha aqui continua com o padrão de 15%
-- (DESCONTO_PADRAO_PCT em services/pdvDescontoLimites.js).
--
-- Só acréscimo (CREATE … IF NOT EXISTS): pode rodar de novo.
-- Rodar: node scripts/migrar-pdv-desconto-limites.mjs
-- =============================================================

CREATE TABLE IF NOT EXISTS pdv_desconto_limites (
  user_id UUID PRIMARY KEY,

  -- cópia de quem é, de quando o limite foi gravado (para consulta e relatório)
  usuario_nome TEXT,
  usuario_email TEXT,
  empresas INTEGER[] NOT NULL DEFAULT '{}',

  pct NUMERIC(5,2) NOT NULL CHECK (pct >= 0 AND pct <= 100),

  atualizado_por TEXT,
  atualizado_por_id UUID,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- histórico: uma linha por usuário a cada mudança
CREATE TABLE IF NOT EXISTS pdv_desconto_limites_hist (
  id BIGSERIAL PRIMARY KEY,

  user_id UUID NOT NULL,
  usuario_nome TEXT,
  usuario_email TEXT,
  empresas INTEGER[] NOT NULL DEFAULT '{}',

  de_pct NUMERIC(5,2) NOT NULL,
  para_pct NUMERIC(5,2) NOT NULL,

  -- como foi mudado: só este usuário, todos de uma loja ou todos
  escopo TEXT NOT NULL CHECK (escopo IN ('usuario', 'loja', 'todos')),
  escopo_empresa INTEGER,

  alterado_por TEXT,
  alterado_por_id UUID,
  alterado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pdv_desc_lim_hist_user
  ON pdv_desconto_limites_hist(user_id);
CREATE INDEX IF NOT EXISTS idx_pdv_desc_lim_hist_em
  ON pdv_desconto_limites_hist(alterado_em);

-- só o servidor (service role) lê e grava
ALTER TABLE pdv_desconto_limites ENABLE ROW LEVEL SECURITY;
ALTER TABLE pdv_desconto_limites_hist ENABLE ROW LEVEL SECURITY;
