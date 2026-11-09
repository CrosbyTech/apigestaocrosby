-- ============================================================================
-- PEDIDOS DE VENDA — fila de faturamento do Dryland (Painel do /frete)
-- Fonte: RPC fila_fat_listar(p_canal, p_status, p_limit) do Supabase do Dryland,
-- um card por venda de todos os canais (varejo, revenda, franquias, mtm), com
-- pagamento (forma, NSU, autorização, Pix, Pagar.me), comprovantes, NF, pedido
-- TOTVS e cliente. O card do site liga com a separação (pedidos_venda_dryland)
-- por numero_site = ref. Cópia feita pelo job pedidos-venda-sync (5 min); nada
-- é apagado (sumiu_do_dryland_em). Idempotente.
-- ============================================================================
CREATE TABLE IF NOT EXISTS pedidos_venda_fila (
  id UUID PRIMARY KEY,                -- id do card na fila do Dryland
  canal TEXT,                         -- varejo, revenda, franquias, mtm
  titulo TEXT,
  status TEXT,                        -- a faturar, aguardando minuta, Pronto na matriz, Pedido faturado, Pedido enviado…
  numero_site TEXT,                   -- ref do pedido do site / separação (VJ1311, RV…, TR…)
  pedido_totvs TEXT,
  transacao TEXT,
  eh_venda BOOLEAN NOT NULL DEFAULT true, -- transferência "sem financeiro" = false
  cliente TEXT,
  cliente_codigo TEXT,
  cliente_doc TEXT,
  cliente_telefone TEXT,
  tipo_cliente TEXT,
  vendedor TEXT,
  vendedor_code TEXT,
  loja TEXT,
  forma_pagamento TEXT,
  parcelamento TEXT,
  valor_pedido NUMERIC(14, 2),
  valor_frete NUMERIC(14, 2),
  desconto NUMERIC(14, 2),
  total_pecas INT,
  cartao_nsu TEXT,
  cartao_autorizacao TEXT,
  cartao_bandeira TEXT,
  cartao_final TEXT,
  pix_e2e TEXT,
  pagarme_charge TEXT,
  nf_numero TEXT,
  nf_serie TEXT,
  nf_chave TEXT,
  comprovantes TEXT[] NOT NULL DEFAULT '{}', -- caminhos no bucket missao-nfs do Dryland
  dados JSONB,                        -- card completo (o que mais vier)
  criado_em TIMESTAMPTZ,
  atualizado_em TIMESTAMPTZ,
  criado_por TEXT,
  atualizado_por TEXT,
  sumiu_do_dryland_em TIMESTAMPTZ,
  sincronizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pvf_criado ON pedidos_venda_fila (criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_pvf_numero_site ON pedidos_venda_fila (numero_site);
CREATE INDEX IF NOT EXISTS idx_pvf_canal ON pedidos_venda_fila (canal, status);

-- O que o HeadCoach acrescenta ao pedido (chave = id do card da fila ou ref do
-- pedido da separação que ainda não tem card): pagamento registrado à mão e
-- comprovante anexado aqui.
CREATE TABLE IF NOT EXISTS pedidos_venda_anexos (
  chave TEXT PRIMARY KEY,
  pagamento_manual JSONB,
  comprovante_url TEXT,
  comprovante_nome TEXT,
  comprovante_em TIMESTAMPTZ,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
