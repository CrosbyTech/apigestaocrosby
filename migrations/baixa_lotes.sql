-- Histórico de lotes de baixa (Solicitações de Baixa → TOTVS), pedido do João 26/10/2026:
-- cada clique em "Processar" vira 1 lote com quantidade, sucesso/falhas e os itens
-- (título, cliente, valor, data, resultado, motivo do erro). Gravado pelo backend
-- em POST /api/totvs/invoices-settle; consultado em GET /api/baixa-lotes.
CREATE TABLE IF NOT EXISTS baixa_lotes (
  id            BIGSERIAL PRIMARY KEY,
  em            TIMESTAMPTZ NOT NULL DEFAULT now(),
  usuario       TEXT,                 -- e-mail/nome de quem processou (vem do front)
  origem        TEXT,                 -- 'solicitacoes-baixa' | 'baixa-automatica' | outro
  forma         TEXT,                 -- rótulo da forma de pagamento (ex.: Cartão de Débito (PAGARME DEBITO))
  paid_type     INT,
  qtd           INT NOT NULL DEFAULT 0,
  sucesso       INT NOT NULL DEFAULT 0,
  falhas        INT NOT NULL DEFAULT 0,
  valor_ok      NUMERIC(14,2) NOT NULL DEFAULT 0,
  valor_falha   NUMERIC(14,2) NOT NULL DEFAULT 0,
  itens         JSONB NOT NULL DEFAULT '[]'::jsonb
  -- itens[]: { titulo:"emp-fat/parc", cd_empresa, cd_cliente, nm_cliente, nr_fat, nr_parcela, valor, juros, data, ok, motivo, seq }
);
CREATE INDEX IF NOT EXISTS idx_baixa_lotes_em ON baixa_lotes (em DESC);
NOTIFY pgrst, 'reload schema';
