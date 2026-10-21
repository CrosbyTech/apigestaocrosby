-- Acréscimo fixo somado ao valor da fatura na emissão do boleto Pagar.me
-- (R$ 0,98 por boleto — regra do João, Contas a Receber, 21/10/2026).
-- Aditiva: boletos antigos ficam com 0 (foram emitidos pelo valor da fatura).
ALTER TABLE pagarme_boletos ADD COLUMN IF NOT EXISTS vl_acrescimo NUMERIC(14,2) NOT NULL DEFAULT 0;
