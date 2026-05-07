-- Tabela para solicitações de renegociação de dívidas
CREATE TABLE IF NOT EXISTS solicitacoes_renegociacoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Informações da empresa/franquia
  cd_empresa TEXT NOT NULL,
  nm_empresa TEXT NOT NULL,
  cd_pessoa INTEGER,
  
  -- Informações das faturas selecionadas (JSONB array)
  faturas_selecionadas JSONB NOT NULL,
  
  -- Valores
  vl_total DECIMAL(15, 2) NOT NULL,
  
  -- Forma de pagamento e parcelamento
  forma_pagamento TEXT NOT NULL,
  nr_parcelas INTEGER,
  vl_parcela DECIMAL(15, 2),
  
  -- Motivo da renegociação
  motivo TEXT NOT NULL,
  
  -- Informações do solicitante
  user_id UUID NOT NULL,
  user_email TEXT NOT NULL,
  user_nome TEXT,
  
  -- Status da solicitação
  status TEXT NOT NULL DEFAULT 'ANALISE' CHECK (status IN ('ANALISE', 'APROVADO', 'REPROVADO')),
  
  -- Datas
  dt_solicitacao TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  dt_aprovacao TIMESTAMP WITH TIME ZONE,
  
  -- Informações de aprovação/reprovação
  aprovado_por UUID,
  user_aprovador TEXT,
  motivo_reprovacao TEXT,
  
  -- Índices para melhor performance
  CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES auth.users(id)
);

-- Criar índices
CREATE INDEX IF NOT EXISTS idx_renegociacoes_cd_empresa ON solicitacoes_renegociacoes(cd_empresa);
CREATE INDEX IF NOT EXISTS idx_renegociacoes_user_id ON solicitacoes_renegociacoes(user_id);
CREATE INDEX IF NOT EXISTS idx_renegociacoes_status ON solicitacoes_renegociacoes(status);
CREATE INDEX IF NOT EXISTS idx_renegociacoes_dt_solicitacao ON solicitacoes_renegociacoes(dt_solicitacao DESC);

-- Habilitar RLS (Row Level Security)
ALTER TABLE solicitacoes_renegociacoes ENABLE ROW LEVEL SECURITY;

-- Política para permitir que todos usuários autenticados visualizem todas as solicitações
CREATE POLICY "Permitir leitura para usuários autenticados"
ON solicitacoes_renegociacoes
FOR SELECT
TO authenticated
USING (auth.uid() IS NOT NULL);

-- Política para permitir que usuários criem suas próprias solicitações
CREATE POLICY "Permitir inserção para usuários autenticados"
ON solicitacoes_renegociacoes
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

-- Política para permitir que admins atualizem solicitações (aprovar/reprovar)
CREATE POLICY "Permitir atualização para admins"
ON solicitacoes_renegociacoes
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

-- Comentários nas colunas
COMMENT ON TABLE solicitacoes_renegociacoes IS 'Tabela de solicitações de renegociação de dívidas das franquias';
COMMENT ON COLUMN solicitacoes_renegociacoes.faturas_selecionadas IS 'Array JSONB com todas as faturas selecionadas para renegociação';
COMMENT ON COLUMN solicitacoes_renegociacoes.vl_total IS 'Valor total de todas as faturas selecionadas';
COMMENT ON COLUMN solicitacoes_renegociacoes.vl_parcela IS 'Valor de cada parcela (se parcelado)';
COMMENT ON COLUMN solicitacoes_renegociacoes.status IS 'Status da solicitação: ANALISE, APROVADO ou REPROVADO';
