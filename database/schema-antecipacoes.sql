-- =====================================================
-- SCHEMA: Antecipações de Faturas
-- Descrição: Tabela para registrar antecipações de faturas
-- Data: 14/12/2024
-- =====================================================

-- Criar tabela de antecipações de faturas
CREATE TABLE IF NOT EXISTS antecipacoes_faturas (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  
  -- Informações da Fatura
  cd_cliente VARCHAR(50) NOT NULL,
  nm_cliente VARCHAR(255),
  nr_fatura VARCHAR(100) NOT NULL,
  nr_parcela VARCHAR(50),
  vl_fatura DECIMAL(15, 2),
  dt_vencimento DATE,
  cd_empresa VARCHAR(50),
  
  -- Informações da Antecipação
  banco_antecipado VARCHAR(100) NOT NULL,
  
  -- Informações de Auditoria
  usuario_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  usuario_email VARCHAR(255),
  usuario_nome VARCHAR(255),
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  
  -- Informações Adicionais
  observacoes TEXT,
  
  -- Índices compostos para busca única
  UNIQUE(cd_cliente, nr_fatura, nr_parcela)
);

-- Criar índices para melhor performance
CREATE INDEX IF NOT EXISTS idx_antecipacoes_cd_cliente ON antecipacoes_faturas(cd_cliente);
CREATE INDEX IF NOT EXISTS idx_antecipacoes_nr_fatura ON antecipacoes_faturas(nr_fatura);
CREATE INDEX IF NOT EXISTS idx_antecipacoes_banco ON antecipacoes_faturas(banco_antecipado);
CREATE INDEX IF NOT EXISTS idx_antecipacoes_usuario ON antecipacoes_faturas(usuario_id);
CREATE INDEX IF NOT EXISTS idx_antecipacoes_created_at ON antecipacoes_faturas(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_antecipacoes_dt_vencimento ON antecipacoes_faturas(dt_vencimento);

-- Trigger para atualizar updated_at automaticamente
CREATE OR REPLACE FUNCTION update_antecipacoes_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = TIMEZONE('utc'::text, NOW());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_antecipacoes_updated_at ON antecipacoes_faturas;
CREATE TRIGGER trigger_update_antecipacoes_updated_at
  BEFORE UPDATE ON antecipacoes_faturas
  FOR EACH ROW
  EXECUTE FUNCTION update_antecipacoes_updated_at();

-- =====================================================
-- RLS (Row Level Security) Policies
-- =====================================================

-- Habilitar RLS
ALTER TABLE antecipacoes_faturas ENABLE ROW LEVEL SECURITY;

-- Policy: Usuários autenticados podem visualizar suas próprias antecipações
CREATE POLICY "Usuários podem ver suas próprias antecipações"
  ON antecipacoes_faturas
  FOR SELECT
  TO authenticated
  USING (true); -- Todos podem ver todas as antecipações

-- Policy: Usuários autenticados podem inserir antecipações
CREATE POLICY "Usuários podem criar antecipações"
  ON antecipacoes_faturas
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = usuario_id);

-- Policy: Usuários podem atualizar suas próprias antecipações
CREATE POLICY "Usuários podem atualizar suas próprias antecipações"
  ON antecipacoes_faturas
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = usuario_id)
  WITH CHECK (auth.uid() = usuario_id);

-- Policy: Usuários podem deletar suas próprias antecipações
CREATE POLICY "Usuários podem deletar suas próprias antecipações"
  ON antecipacoes_faturas
  FOR DELETE
  TO authenticated
  USING (auth.uid() = usuario_id);

-- =====================================================
-- COMENTÁRIOS
-- =====================================================

COMMENT ON TABLE antecipacoes_faturas IS 'Registros de antecipações de faturas com informações de auditoria';
COMMENT ON COLUMN antecipacoes_faturas.cd_cliente IS 'Código do cliente';
COMMENT ON COLUMN antecipacoes_faturas.nm_cliente IS 'Nome do cliente';
COMMENT ON COLUMN antecipacoes_faturas.nr_fatura IS 'Número da fatura';
COMMENT ON COLUMN antecipacoes_faturas.nr_parcela IS 'Número da parcela';
COMMENT ON COLUMN antecipacoes_faturas.vl_fatura IS 'Valor da fatura';
COMMENT ON COLUMN antecipacoes_faturas.dt_vencimento IS 'Data de vencimento da fatura';
COMMENT ON COLUMN antecipacoes_faturas.banco_antecipado IS 'Nome do banco onde a fatura foi antecipada';
COMMENT ON COLUMN antecipacoes_faturas.usuario_id IS 'ID do usuário que registrou a antecipação';
COMMENT ON COLUMN antecipacoes_faturas.usuario_email IS 'Email do usuário que registrou a antecipação';
COMMENT ON COLUMN antecipacoes_faturas.usuario_nome IS 'Nome do usuário que registrou a antecipação';
COMMENT ON COLUMN antecipacoes_faturas.created_at IS 'Data e hora de criação do registro';
COMMENT ON COLUMN antecipacoes_faturas.updated_at IS 'Data e hora da última atualização';
COMMENT ON COLUMN antecipacoes_faturas.observacoes IS 'Observações adicionais sobre a antecipação';

-- =====================================================
-- SEED DATA (Opcional - Remover em produção)
-- =====================================================
-- Exemplos de dados para testes podem ser adicionados aqui
