-- Tecnologia → Cotação de Compras
-- 1 item por cotação, N fornecedores. Status fluxo: rascunho → cotando → escolhido → comprado.
-- Anexos por fornecedor via Supabase Storage (bucket tech-cotacoes-anexos).

CREATE TABLE IF NOT EXISTS tech_cotacoes (
  id BIGSERIAL PRIMARY KEY,
  titulo TEXT NOT NULL,
  descricao TEXT,
  quantidade NUMERIC NOT NULL DEFAULT 1,
  unidade TEXT DEFAULT 'un',
  status TEXT NOT NULL DEFAULT 'rascunho'
    CHECK (status IN ('rascunho','cotando','escolhido','comprado','cancelado')),
  fornecedor_escolhido_id BIGINT, -- FK setada abaixo (referência circular)
  solicitante TEXT,
  urgencia TEXT DEFAULT 'normal' CHECK (urgencia IN ('baixa','normal','alta')),
  data_necessidade DATE,
  observacao TEXT,
  criado_por TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tech_cotacoes_status ON tech_cotacoes(status);
CREATE INDEX IF NOT EXISTS idx_tech_cotacoes_criado_em ON tech_cotacoes(criado_em DESC);

CREATE TABLE IF NOT EXISTS tech_cotacoes_fornecedores (
  id BIGSERIAL PRIMARY KEY,
  cotacao_id BIGINT NOT NULL REFERENCES tech_cotacoes(id) ON DELETE CASCADE,
  fornecedor_nome TEXT NOT NULL,
  fornecedor_contato TEXT,
  tipo_compra TEXT NOT NULL DEFAULT 'online'
    CHECK (tipo_compra IN ('online','presencial')),
  link TEXT,
  endereco TEXT,
  valor_unitario NUMERIC NOT NULL DEFAULT 0,
  frete NUMERIC DEFAULT 0,
  taxas NUMERIC DEFAULT 0,
  prazo_entrega TEXT,
  condicao_pagamento TEXT,
  garantia TEXT,
  anexo_path TEXT,
  anexo_nome TEXT,
  observacao TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tech_cot_forn_cotacao_id
  ON tech_cotacoes_fornecedores(cotacao_id);

-- FK circular: cotacao.fornecedor_escolhido_id → fornecedores.id
ALTER TABLE tech_cotacoes
  DROP CONSTRAINT IF EXISTS fk_tech_cot_escolhido;
ALTER TABLE tech_cotacoes
  ADD CONSTRAINT fk_tech_cot_escolhido
  FOREIGN KEY (fornecedor_escolhido_id)
  REFERENCES tech_cotacoes_fornecedores(id)
  ON DELETE SET NULL;

-- Trigger pra manter atualizado_em em sync
CREATE OR REPLACE FUNCTION trg_tech_cotacoes_touch() RETURNS TRIGGER AS $$
BEGIN NEW.atualizado_em = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tg_tech_cot_touch ON tech_cotacoes;
CREATE TRIGGER tg_tech_cot_touch BEFORE UPDATE ON tech_cotacoes
  FOR EACH ROW EXECUTE FUNCTION trg_tech_cotacoes_touch();

DROP TRIGGER IF EXISTS tg_tech_cot_forn_touch ON tech_cotacoes_fornecedores;
CREATE TRIGGER tg_tech_cot_forn_touch BEFORE UPDATE ON tech_cotacoes_fornecedores
  FOR EACH ROW EXECUTE FUNCTION trg_tech_cotacoes_touch();

-- ─── Bucket Storage (rode no Supabase Console se ainda não existir) ───
-- A SQL abaixo cria o bucket via API interna do Supabase. Se der erro de
-- permissão, crie manualmente no painel: Storage → New bucket
--   nome: tech-cotacoes-anexos · público: false (signed URLs)
INSERT INTO storage.buckets (id, name, public)
VALUES ('tech-cotacoes-anexos', 'tech-cotacoes-anexos', false)
ON CONFLICT (id) DO NOTHING;
