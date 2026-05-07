-- =====================================================
-- SCHEMA: Solicitações de Baixa de Faturas
-- Tabela para armazenar solicitações de baixa originadas
-- da tela de Inadimplentes Multimarcas.
-- =====================================================

-- Criar tabela
CREATE TABLE IF NOT EXISTS solicitacoes_baixa (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  
  -- Dados da fatura (TOTVS)
  cd_empresa INTEGER NOT NULL,
  cd_cliente INTEGER NOT NULL,
  nm_cliente TEXT,
  nr_fat INTEGER NOT NULL,
  nr_parcela INTEGER NOT NULL DEFAULT 1,
  vl_fatura NUMERIC(15,2) NOT NULL,
  vl_juros NUMERIC(15,2) DEFAULT 0,
  dt_vencimento DATE,
  dt_emissao DATE,
  cd_portador INTEGER,
  nm_portador TEXT,
  
  -- Comprovante de pagamento
  comprovante_url TEXT NOT NULL,
  comprovante_path TEXT, -- caminho no storage do Supabase
  
  -- Status da solicitação
  status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'aprovada', 'rejeitada', 'processada')),
  
  -- Quem solicitou
  user_id UUID REFERENCES auth.users(id),
  user_nome TEXT,
  user_email TEXT,
  
  -- Observações
  observacao TEXT,
  motivo_rejeicao TEXT,
  
  -- Quem processou a baixa
  processado_por UUID REFERENCES auth.users(id),
  processado_em TIMESTAMPTZ,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Trigger para atualizar updated_at automaticamente
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_solicitacoes_baixa_updated_at ON solicitacoes_baixa;
CREATE TRIGGER update_solicitacoes_baixa_updated_at
  BEFORE UPDATE ON solicitacoes_baixa
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_solicitacoes_baixa_status ON solicitacoes_baixa(status);
CREATE INDEX IF NOT EXISTS idx_solicitacoes_baixa_cd_cliente ON solicitacoes_baixa(cd_cliente);
CREATE INDEX IF NOT EXISTS idx_solicitacoes_baixa_cd_portador ON solicitacoes_baixa(cd_portador);
CREATE INDEX IF NOT EXISTS idx_solicitacoes_baixa_created_at ON solicitacoes_baixa(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_solicitacoes_baixa_user_id ON solicitacoes_baixa(user_id);

-- RLS (Row Level Security)
ALTER TABLE solicitacoes_baixa ENABLE ROW LEVEL SECURITY;

-- Qualquer usuário autenticado pode ver todas as solicitações
CREATE POLICY "Authenticated users can view all solicitacoes_baixa"
  ON solicitacoes_baixa FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Qualquer usuário autenticado pode criar solicitações
CREATE POLICY "Authenticated users can insert solicitacoes_baixa"
  ON solicitacoes_baixa FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- Qualquer usuário autenticado pode atualizar solicitações (status, processamento)
CREATE POLICY "Authenticated users can update solicitacoes_baixa"
  ON solicitacoes_baixa FOR UPDATE
  USING (auth.uid() IS NOT NULL);

-- Qualquer usuário autenticado pode excluir solicitações
CREATE POLICY "Authenticated users can delete solicitacoes_baixa"
  ON solicitacoes_baixa FOR DELETE
  USING (auth.uid() IS NOT NULL);

-- =====================================================
-- STORAGE: Bucket para comprovantes de pagamento
-- Execute no SQL Editor do Supabase ou crie manualmente:
-- 1. Vá em Storage > New Bucket > Nome: comprovantes_baixa > Public: ON
-- 2. Depois execute as policies abaixo:
-- =====================================================

-- Policy para permitir upload (INSERT) por qualquer usuário autenticado
-- INSERT INTO storage.policies (bucket_id, name, definition, check_expression)
-- Ou via SQL:
CREATE POLICY "Allow authenticated uploads comprovantes_baixa"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'comprovantes_baixa'
    AND auth.role() = 'authenticated'
  );

-- Policy para permitir leitura pública (SELECT)
CREATE POLICY "Allow public read comprovantes_baixa"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'comprovantes_baixa');

-- Policy para permitir exclusão por usuários autenticados
CREATE POLICY "Allow authenticated delete comprovantes_baixa"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'comprovantes_baixa'
    AND auth.role() = 'authenticated'
  );

-- Comentários
COMMENT ON TABLE solicitacoes_baixa IS 'Solicitações de baixa de faturas originadas da tela de inadimplentes';
COMMENT ON COLUMN solicitacoes_baixa.cd_portador IS 'Código do portador/banco da fatura no TOTVS';
COMMENT ON COLUMN solicitacoes_baixa.nm_portador IS 'Nome do portador/banco da fatura no TOTVS';
COMMENT ON COLUMN solicitacoes_baixa.comprovante_url IS 'URL pública do comprovante no Supabase Storage';
COMMENT ON COLUMN solicitacoes_baixa.comprovante_path IS 'Caminho do arquivo no bucket comprovantes_baixa';
COMMENT ON COLUMN solicitacoes_baixa.status IS 'pendente=aguardando, aprovada=aprovada para baixa, rejeitada=negada, processada=baixa efetuada no TOTVS';
