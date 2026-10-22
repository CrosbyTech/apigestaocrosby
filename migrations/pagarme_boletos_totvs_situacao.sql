-- Situação do título no TOTVS conferida a cada sincronização do retorno:
-- boleto Pagar.me pendente cujo título já foi pago / renegociado / cancelado
-- no TOTVS precisa ser cancelado na Pagar.me (João, 21/10/2026).
ALTER TABLE pagarme_boletos ADD COLUMN IF NOT EXISTS totvs_situacao     TEXT;        -- aberto | pago | renegociado | cancelado | devolvido | quebrado | nao_encontrado
ALTER TABLE pagarme_boletos ADD COLUMN IF NOT EXISTS totvs_baixa_em     DATE;
ALTER TABLE pagarme_boletos ADD COLUMN IF NOT EXISTS totvs_conferido_em TIMESTAMPTZ;
