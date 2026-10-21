-- Clientes travados para boleto Pagar.me: não entram na lista do Envio de
-- Remessa nem recebem emissão (pedido do João, Contas a Receber, 21/10/2026).
-- Complementa a lista fixa de nomes em totvsrouter/remessaBoletos.js.
CREATE TABLE IF NOT EXISTS pagarme_clientes_bloqueados (
  id            BIGSERIAL PRIMARY KEY,
  cd_cliente    INTEGER NOT NULL UNIQUE,
  nm_cliente    TEXT,
  nr_documento  TEXT,
  motivo        TEXT,
  criado_por    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
