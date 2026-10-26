-- ============================================================================
-- BOT STONE EXTRATOS — saldos da Pagar.me (adquirente/subconta da Stone)
-- junto com os saldos Stone: uma linha por conta e dia, com o banco.
-- Pagar.me separa "disponível" (saldo) e "a receber" (saldo_a_receber).
-- ============================================================================
ALTER TABLE stone_bot_saldos ADD COLUMN IF NOT EXISTS banco TEXT NOT NULL DEFAULT 'STONE';
ALTER TABLE stone_bot_saldos ADD COLUMN IF NOT EXISTS saldo_a_receber NUMERIC(14,2);
ALTER TABLE stone_bot_saldos ADD COLUMN IF NOT EXISTS saldo_transferido NUMERIC(14,2);
CREATE INDEX IF NOT EXISTS idx_stone_bot_saldos_banco ON stone_bot_saldos (banco, data DESC);
COMMENT ON COLUMN stone_bot_saldos.banco IS 'STONE | PAGARME';
COMMENT ON COLUMN stone_bot_saldos.saldo_a_receber IS 'Pagar.me: waiting_funds_amount (boletos/vendas ainda não liquidados)';
