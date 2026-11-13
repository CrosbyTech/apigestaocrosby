-- ============================================================================
-- HEADCOACH › CAIXA (Yago, 12/11/2026) — abertura, suprimento, retirada,
-- contagem, fechamento e encerramento diário (data de caixa), sem o TOTVS.
-- Base do contas a receber próprio: todo movimento tem caixa e data de caixa.
--
-- Segurança: as tabelas ficam com RLS LIGADO e SEM política — o navegador não
-- lê nem grava; só o servidor (service role) mexe, sempre com usuário logado.
-- Movimentos, contagens e encerramentos não podem ser apagados (trigger): o
-- que foi lançado errado é ESTORNADO, e o rastro fica.
-- Rodar: node scripts/migrar-hc-caixa.mjs
-- ============================================================================

-- data de caixa de cada empresa (avança no encerramento diário)
CREATE TABLE IF NOT EXISTS hc_caixa_datas (
  empresa INT PRIMARY KEY,
  data_caixa DATE NOT NULL,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_por TEXT
);

-- um caixa = uma sessão de um terminal de uma empresa, numa data de caixa
CREATE TABLE IF NOT EXISTS hc_caixas (
  id BIGSERIAL PRIMARY KEY,
  empresa INT NOT NULL,
  terminal INT NOT NULL DEFAULT 1 CHECK (terminal > 0),
  data_caixa DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto', 'fechado')),
  fundo_inicial NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (fundo_inicial >= 0),
  fundo_sugerido NUMERIC(14, 2),           -- o que o caixa anterior deixou
  observacao_abertura TEXT,
  aberto_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  aberto_por_id UUID,
  aberto_por TEXT,
  fechado_em TIMESTAMPTZ,
  fechado_por_id UUID,
  fechado_por TEXT,
  fundo_final NUMERIC(14, 2),              -- o que fica para o próximo caixa
  retirada_fechamento NUMERIC(14, 2),      -- o que saiu no fechamento (cofre/banco)
  diferenca NUMERIC(14, 2),                -- contado − sistema (todas as formas)
  diferenca_dinheiro NUMERIC(14, 2),
  resumo JSONB,                            -- foto dos totais no fechamento
  observacao_fechamento TEXT,
  reaberto_em TIMESTAMPTZ,
  reaberto_por TEXT,
  reabertura_motivo TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- só um caixa aberto por terminal de cada empresa
CREATE UNIQUE INDEX IF NOT EXISTS hc_caixas_um_aberto ON hc_caixas (empresa, terminal) WHERE status = 'aberto';
CREATE INDEX IF NOT EXISTS hc_caixas_empresa_data ON hc_caixas (empresa, data_caixa DESC);

-- suprimento (entra dinheiro), retirada (sai dinheiro) e a retirada do fechamento
CREATE TABLE IF NOT EXISTS hc_caixa_movimentos (
  id BIGSERIAL PRIMARY KEY,
  caixa_id BIGINT NOT NULL REFERENCES hc_caixas (id),
  empresa INT NOT NULL,
  data_caixa DATE NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('suprimento', 'retirada', 'retirada_fechamento')),
  valor NUMERIC(14, 2) NOT NULL CHECK (valor > 0),
  motivo TEXT NOT NULL,
  por_id UUID,
  por TEXT,
  em TIMESTAMPTZ NOT NULL DEFAULT now(),
  estornado_em TIMESTAMPTZ,
  estornado_por TEXT,
  estorno_motivo TEXT
);
CREATE INDEX IF NOT EXISTS hc_caixa_mov_caixa ON hc_caixa_movimentos (caixa_id);

-- cada contagem fica guardada (a que vale é a última antes do fechamento)
CREATE TABLE IF NOT EXISTS hc_caixa_contagens (
  id BIGSERIAL PRIMARY KEY,
  caixa_id BIGINT NOT NULL REFERENCES hc_caixas (id),
  cedulas JSONB NOT NULL DEFAULT '{}'::jsonb,   -- { "100": 3, "0.5": 4, … }
  dinheiro_contado NUMERIC(14, 2) NOT NULL DEFAULT 0,
  dinheiro_esperado NUMERIC(14, 2) NOT NULL DEFAULT 0,
  formas JSONB NOT NULL DEFAULT '{}'::jsonb,    -- { pix: { sistema, informado, diferenca }, … }
  diferenca_dinheiro NUMERIC(14, 2) NOT NULL DEFAULT 0,
  diferenca_total NUMERIC(14, 2) NOT NULL DEFAULT 0,
  observacao TEXT,
  por_id UUID,
  por TEXT,
  em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hc_caixa_cont_caixa ON hc_caixa_contagens (caixa_id);

-- encerramento diário: a data de caixa da empresa passa para a próxima
CREATE TABLE IF NOT EXISTS hc_caixa_encerramentos (
  id BIGSERIAL PRIMARY KEY,
  empresa INT NOT NULL,
  data_caixa DATE NOT NULL,
  proxima_data DATE NOT NULL,
  verificacao JSONB,
  autorizado_por TEXT,
  por_id UUID,
  por TEXT,
  em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hc_caixa_enc_empresa ON hc_caixa_encerramentos (empresa, em DESC);

-- a venda guarda em qual caixa entrou
ALTER TABLE pdv_vendas ADD COLUMN IF NOT EXISTS caixa_id BIGINT;
CREATE INDEX IF NOT EXISTS idx_pdv_vendas_caixa ON pdv_vendas (caixa_id);

-- nada de apagar o que foi lançado
CREATE OR REPLACE FUNCTION hc_caixa_proibir_delete() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Registro do caixa não pode ser apagado (use estorno)';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS hc_caixas_sem_delete ON hc_caixas;
CREATE TRIGGER hc_caixas_sem_delete BEFORE DELETE ON hc_caixas FOR EACH ROW EXECUTE FUNCTION hc_caixa_proibir_delete();
DROP TRIGGER IF EXISTS hc_caixa_mov_sem_delete ON hc_caixa_movimentos;
CREATE TRIGGER hc_caixa_mov_sem_delete BEFORE DELETE ON hc_caixa_movimentos FOR EACH ROW EXECUTE FUNCTION hc_caixa_proibir_delete();
DROP TRIGGER IF EXISTS hc_caixa_cont_sem_delete ON hc_caixa_contagens;
CREATE TRIGGER hc_caixa_cont_sem_delete BEFORE DELETE ON hc_caixa_contagens FOR EACH ROW EXECUTE FUNCTION hc_caixa_proibir_delete();
DROP TRIGGER IF EXISTS hc_caixa_enc_sem_delete ON hc_caixa_encerramentos;
CREATE TRIGGER hc_caixa_enc_sem_delete BEFORE DELETE ON hc_caixa_encerramentos FOR EACH ROW EXECUTE FUNCTION hc_caixa_proibir_delete();

CREATE OR REPLACE FUNCTION hc_caixas_touch() RETURNS TRIGGER AS $$
BEGIN
  NEW.atualizado_em = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS hc_caixas_touch ON hc_caixas;
CREATE TRIGGER hc_caixas_touch BEFORE UPDATE ON hc_caixas FOR EACH ROW EXECUTE FUNCTION hc_caixas_touch();

-- contagem salva fica TRAVADA; só owner, admin ou financeiro reabre (Yago, 12/11/2026)
ALTER TABLE hc_caixa_contagens ADD COLUMN IF NOT EXISTS reaberta_em TIMESTAMPTZ;
ALTER TABLE hc_caixa_contagens ADD COLUMN IF NOT EXISTS reaberta_por TEXT;
ALTER TABLE hc_caixa_contagens ADD COLUMN IF NOT EXISTS reabertura_autorizada_por TEXT;
ALTER TABLE hc_caixa_contagens ADD COLUMN IF NOT EXISTS reabertura_motivo TEXT;

-- só o servidor acessa
ALTER TABLE hc_caixa_datas ENABLE ROW LEVEL SECURITY;
ALTER TABLE hc_caixas ENABLE ROW LEVEL SECURITY;
ALTER TABLE hc_caixa_movimentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE hc_caixa_contagens ENABLE ROW LEVEL SECURITY;
ALTER TABLE hc_caixa_encerramentos ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
