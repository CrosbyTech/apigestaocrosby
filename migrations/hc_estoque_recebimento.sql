-- ============================================================================
-- RECEBIMENTO DE MERCADORIA TRANSFERIDA + ESTOQUE DAS LOJAS (Yago, 13/11/2026)
--
-- A loja vê as transferências feitas para ela (tela Transferências), clica em
-- RECEBER MERCADORIA, confere as peças (leitor RFID de mesa; o que não tem
-- etiqueta, por quantidade) e finaliza: as peças recebidas entram no estoque
-- da loja. Por enquanto o estoque é só isso — as peças recebidas por
-- transferência; depois ele fica mais completo (vendas, devoluções…).
--
--   hc_recebimentos_transferencia  um recebimento por transferência (o que
--                                  veio, o que faltou, o que chegou de fora)
--   hc_estoque_movimentos          entrada no estoque (uma linha por etiqueta;
--                                  sem etiqueta, uma linha com a quantidade)
--   hc_estoque_epcs                onde está cada etiqueta
-- Saldo da loja = soma de hc_estoque_movimentos por empresa + produto.
--
-- Segurança: RLS LIGADO e SEM política — só o servidor lê e grava. Nada se
-- apaga (trigger).
-- Rodar: node scripts/migrar-hc-estoque-recebimento.mjs
-- ============================================================================

CREATE TABLE IF NOT EXISTS hc_recebimentos_transferencia (
  id BIGSERIAL PRIMARY KEY,
  transferencia_transacao_id BIGINT NOT NULL UNIQUE,   -- transferencias_transacoes.id (recebe uma vez só)
  transferencia_id BIGINT,                             -- transferencias_mercadoria.id (solicitação), se houver
  empresa INT NOT NULL,                                -- loja que recebeu (destino)
  empresa_origem INT,
  venda_id BIGINT,
  nf_numero INT,
  qtd_esperada INT NOT NULL DEFAULT 0,
  qtd_recebida INT NOT NULL DEFAULT 0,
  qtd_faltando INT NOT NULL DEFAULT 0,
  qtd_fora INT NOT NULL DEFAULT 0,                     -- etiquetas lidas que não eram da transferência
  itens JSONB NOT NULL DEFAULT '[]'::jsonb,            -- [{ productCode, name, esperado, recebido, epcsRecebidos[], epcsFaltando[], manual }]
  fora JSONB NOT NULL DEFAULT '[]'::jsonb,             -- [epc]
  observacao TEXT,
  recebido_por_id UUID,
  recebido_por TEXT,
  recebido_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hc_receb_trf_empresa ON hc_recebimentos_transferencia (empresa, recebido_em DESC);

CREATE TABLE IF NOT EXISTS hc_estoque_movimentos (
  id BIGSERIAL PRIMARY KEY,
  empresa INT NOT NULL,
  product_code BIGINT NOT NULL,
  nome TEXT,
  quantidade NUMERIC(12, 3) NOT NULL,
  epc TEXT,
  tipo TEXT NOT NULL CHECK (tipo IN ('recebimento_transferencia')),
  recebimento_id BIGINT REFERENCES hc_recebimentos_transferencia (id),
  por TEXT,
  em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hc_estoque_mov_empresa_prod ON hc_estoque_movimentos (empresa, product_code);
CREATE INDEX IF NOT EXISTS hc_estoque_mov_receb ON hc_estoque_movimentos (recebimento_id);

CREATE TABLE IF NOT EXISTS hc_estoque_epcs (
  epc TEXT PRIMARY KEY,
  empresa INT NOT NULL,
  product_code BIGINT,
  nome TEXT,
  recebimento_id BIGINT REFERENCES hc_recebimentos_transferencia (id),
  entrou_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hc_estoque_epcs_empresa ON hc_estoque_epcs (empresa, product_code);

-- nada de apagar
CREATE OR REPLACE FUNCTION hc_estoque_proibir_delete() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Registro do estoque não pode ser apagado';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS hc_receb_trf_sem_delete ON hc_recebimentos_transferencia;
CREATE TRIGGER hc_receb_trf_sem_delete BEFORE DELETE ON hc_recebimentos_transferencia FOR EACH ROW EXECUTE FUNCTION hc_estoque_proibir_delete();
DROP TRIGGER IF EXISTS hc_estoque_mov_sem_delete ON hc_estoque_movimentos;
CREATE TRIGGER hc_estoque_mov_sem_delete BEFORE DELETE ON hc_estoque_movimentos FOR EACH ROW EXECUTE FUNCTION hc_estoque_proibir_delete();

-- só o servidor acessa
ALTER TABLE hc_recebimentos_transferencia ENABLE ROW LEVEL SECURITY;
ALTER TABLE hc_estoque_movimentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE hc_estoque_epcs ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
