-- Duas contas Pagar.me: 'crosby' (FERREIRA COMERCIO E CONFECCOES, conta atual)
-- e 'fabio' (FA MODA). Cada boleto guarda a conta em que foi emitido.
-- Aditiva: só adiciona a coluna; os boletos existentes são todos da Crosby.
ALTER TABLE pagarme_boletos ADD COLUMN IF NOT EXISTS conta TEXT NOT NULL DEFAULT 'crosby';
CREATE INDEX IF NOT EXISTS idx_pagarme_boletos_conta ON pagarme_boletos (conta);
