-- Tabela para armazenar solicitações de crédito das franquias
CREATE TABLE IF NOT EXISTS solicitacoes_credito (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  
  -- Informações da Franquia
  cd_empresa INTEGER NOT NULL,
  nm_empresa TEXT,
  cd_pessoa INTEGER,
  
  -- Dados da Solicitação
  vl_credito DECIMAL(15, 2) NOT NULL,
  forma_pagamento TEXT NOT NULL, -- boleto, credito, debito, dinheiro, pix
  nr_parcelas INTEGER DEFAULT 1,
  motivo TEXT NOT NULL,
  
  -- Títulos Financeiros (JSON Arrays)
  titulos_vencidos JSONB DEFAULT '[]'::jsonb, -- Array de títulos vencidos
  titulos_a_vencer JSONB DEFAULT '[]'::jsonb, -- Array de títulos a vencer
  
  -- Dados do Solicitante
  user_id UUID REFERENCES auth.users(id),
  user_email TEXT,
  user_nome TEXT,
  
  -- Controle
  status TEXT NOT NULL DEFAULT 'ANALISE' CHECK (status IN ('ANALISE', 'APROVADO', 'REPROVADO')),
  dt_solicitacao TIMESTAMPTZ DEFAULT NOW(),
  dt_aprovacao TIMESTAMPTZ,
  aprovado_por UUID REFERENCES auth.users(id),
  motivo_reprovacao TEXT,
  
  -- Auditoria
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para melhorar performance
CREATE INDEX IF NOT EXISTS idx_solicitacoes_credito_cd_empresa ON solicitacoes_credito(cd_empresa);
CREATE INDEX IF NOT EXISTS idx_solicitacoes_credito_user_id ON solicitacoes_credito(user_id);
CREATE INDEX IF NOT EXISTS idx_solicitacoes_credito_status ON solicitacoes_credito(status);
CREATE INDEX IF NOT EXISTS idx_solicitacoes_credito_dt_solicitacao ON solicitacoes_credito(dt_solicitacao DESC);

-- Trigger para atualizar updated_at automaticamente
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_solicitacoes_credito_updated_at
  BEFORE UPDATE ON solicitacoes_credito
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Habilitar Row Level Security (RLS)
ALTER TABLE solicitacoes_credito ENABLE ROW LEVEL SECURITY;

-- Políticas de acesso
-- Usuários autenticados podem ver todas as solicitações (serão filtradas por empresa no frontend)
CREATE POLICY "Usuários podem ver solicitações"
  ON solicitacoes_credito
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Usuários podem criar suas próprias solicitações
CREATE POLICY "Usuários podem criar solicitações"
  ON solicitacoes_credito
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Apenas admins podem atualizar (aprovar/reprovar)
CREATE POLICY "Admins podem atualizar solicitações"
  ON solicitacoes_credito
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = auth.uid()
      AND auth.users.raw_user_meta_data->>'role' = 'admin'
    )
  );

-- Comentários na tabela para documentação
COMMENT ON TABLE solicitacoes_credito IS 'Armazena todas as solicitações de crédito feitas pelas franquias';
COMMENT ON COLUMN solicitacoes_credito.titulos_vencidos IS 'Array JSON com os títulos vencidos no momento da solicitação';
COMMENT ON COLUMN solicitacoes_credito.titulos_a_vencer IS 'Array JSON com os títulos a vencer no momento da solicitação';
COMMENT ON COLUMN solicitacoes_credito.status IS 'Status da solicitação: ANALISE (padrão), APROVADO ou REPROVADO';
