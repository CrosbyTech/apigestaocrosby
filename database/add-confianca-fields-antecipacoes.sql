-- ========================================
-- ADICIONAR CAMPOS DO BANCO CONFIANÇA
-- Tabela: antecipacoes_faturas
-- Data: 2025-12-18
-- ========================================

-- Adicionar colunas para campos específicos do Banco Confiança
ALTER TABLE antecipacoes_faturas
ADD COLUMN IF NOT EXISTS valor_descontado DECIMAL(15, 2) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS titulos_recomprados DECIMAL(15, 2) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS credito_debito_cedente DECIMAL(15, 2) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS saldo_pagar_cedente DECIMAL(15, 2) DEFAULT NULL;

-- Adicionar comentários nas colunas para documentação
COMMENT ON COLUMN antecipacoes_faturas.valor_descontado IS 'Valor descontado pelo Banco Confiança (em reais, >= 0)';
COMMENT ON COLUMN antecipacoes_faturas.titulos_recomprados IS 'Valor de títulos recomprados pelo Banco Confiança (em reais, >= 0)';
COMMENT ON COLUMN antecipacoes_faturas.credito_debito_cedente IS 'Valor de crédito/débito da cedente no Banco Confiança (em reais, >= 0)';
COMMENT ON COLUMN antecipacoes_faturas.saldo_pagar_cedente IS 'Saldo a pagar para cedente pelo Banco Confiança (em reais, >= 0)';

-- Adicionar constraints para garantir valores >= 0
ALTER TABLE antecipacoes_faturas
ADD CONSTRAINT check_valor_descontado_positive 
  CHECK (valor_descontado IS NULL OR valor_descontado >= 0);

ALTER TABLE antecipacoes_faturas
ADD CONSTRAINT check_titulos_recomprados_positive 
  CHECK (titulos_recomprados IS NULL OR titulos_recomprados >= 0);

ALTER TABLE antecipacoes_faturas
ADD CONSTRAINT check_credito_debito_cedente_positive 
  CHECK (credito_debito_cedente IS NULL OR credito_debito_cedente >= 0);

ALTER TABLE antecipacoes_faturas
ADD CONSTRAINT check_saldo_pagar_cedente_positive 
  CHECK (saldo_pagar_cedente IS NULL OR saldo_pagar_cedente >= 0);

-- Criar índice para consultas por banco antecipado
CREATE INDEX IF NOT EXISTS idx_antecipacoes_banco_antecipado 
  ON antecipacoes_faturas(banco_antecipado);

-- Verificar as alterações
SELECT 
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = 'antecipacoes_faturas'
  AND column_name IN (
    'valor_descontado',
    'titulos_recomprados',
    'credito_debito_cedente',
    'saldo_pagar_cedente'
  )
ORDER BY ordinal_position;
