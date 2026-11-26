-- ============================================================================
-- PRONTO PRA FATURAR (26/11/2026)
-- O pedido do site só entra no Faturamento do HeadCoach depois que o vendedor
-- confirma a separação no Dryland (botão "Pronto pra faturar").
--  • pedidos_venda_dryland.aguardando_pronto — o Dryland ainda lista o pedido em
--    "aguardando confirmar a separação" (lv_sep_aguardando); _desde = quando o
--    HeadCoach viu entrar; pronto_liberado_em = quando viu sair da lista.
--  • pedidos_venda_fila.pronto_faturar_em / _por — quem confirmou e quando,
--    lido do card da fila.
-- Só acréscimos: pode rodar de novo. Rodar: node scripts/migrar-pedidos-venda-pronto.mjs
-- ============================================================================
ALTER TABLE pedidos_venda_dryland ADD COLUMN IF NOT EXISTS aguardando_pronto BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE pedidos_venda_dryland ADD COLUMN IF NOT EXISTS aguardando_pronto_desde TIMESTAMPTZ;
ALTER TABLE pedidos_venda_dryland ADD COLUMN IF NOT EXISTS aguardando_pronto_info JSONB;
ALTER TABLE pedidos_venda_dryland ADD COLUMN IF NOT EXISTS pronto_liberado_em TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS pedidos_venda_dryland_aguardando_pronto ON pedidos_venda_dryland (ref) WHERE aguardando_pronto;

ALTER TABLE pedidos_venda_fila ADD COLUMN IF NOT EXISTS pronto_faturar_em TIMESTAMPTZ;
ALTER TABLE pedidos_venda_fila ADD COLUMN IF NOT EXISTS pronto_faturar_por TEXT;
