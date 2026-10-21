-- Baixa (cancelamento) de boletos na Pagar.me pela página Retorno Boleto.
-- Guarda quem/quando/por que cancelou. Aditivo: só adiciona colunas.
ALTER TABLE pagarme_boletos ADD COLUMN IF NOT EXISTS cancelado_em  TIMESTAMPTZ;
ALTER TABLE pagarme_boletos ADD COLUMN IF NOT EXISTS cancelado_por TEXT;
ALTER TABLE pagarme_boletos ADD COLUMN IF NOT EXISTS cancel_motivo TEXT;
