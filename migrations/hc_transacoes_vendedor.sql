-- =============================================================
-- HEADCOACH › TRANSAÇÕES — troca de vendedor (Yago, 19/11/2026)
--
-- O owner pode trocar o vendedor de uma transação pela tela de
-- Transações. A troca vale para tudo o que lê o vendedor da transação
-- (ranking do PDV, New Forecast, contas a receber…). Esta tabela guarda
-- o histórico: quem era, quem passou a ser, quem trocou, quando e por quê.
--
-- Só acréscimo (CREATE … IF NOT EXISTS): pode rodar de novo.
-- Rodar: node scripts/migrar-hc-transacoes-vendedor.mjs
-- =============================================================

CREATE TABLE IF NOT EXISTS hc_transacoes_vendedor_alteracoes (
  id BIGSERIAL PRIMARY KEY,

  -- "V45" (venda/faturamento/transferência: pdv_vendas) ou "D28" (devolução: devolucoes_transacoes)
  transacao TEXT NOT NULL,
  fonte TEXT NOT NULL CHECK (fonte IN ('venda', 'devolucao')),
  transacao_id BIGINT NOT NULL,
  empresa INTEGER,

  de_code INTEGER,
  de_nome TEXT,
  para_code INTEGER NOT NULL,
  para_nome TEXT,

  motivo TEXT,
  alterado_por TEXT,
  alterado_por_id UUID,
  alterado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hc_trx_vend_alt_transacao
  ON hc_transacoes_vendedor_alteracoes(fonte, transacao_id);
CREATE INDEX IF NOT EXISTS idx_hc_trx_vend_alt_em
  ON hc_transacoes_vendedor_alteracoes(alterado_em);

-- só o servidor (service role) lê e grava
ALTER TABLE hc_transacoes_vendedor_alteracoes ENABLE ROW LEVEL SECURITY;
