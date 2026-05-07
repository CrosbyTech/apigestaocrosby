-- =====================================================
-- SCHEMA: Solicitações de Remessa (Licitação de Títulos)
-- Tabela para armazenar remessas e os títulos selecionados.
-- =====================================================

-- Tabela de remessas
CREATE TABLE IF NOT EXISTS solicitacoes_remessa (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  
  -- Número sequencial da remessa
  nr_remessa SERIAL,
  
  -- Quem solicitou
  user_id UUID REFERENCES auth.users(id),
  user_nome TEXT NOT NULL,
  user_email TEXT,
  
  -- Valor total da remessa
  vl_total NUMERIC(15,2) NOT NULL DEFAULT 0,
  
  -- Quantidade de títulos
  qt_titulos INTEGER NOT NULL DEFAULT 0,
  
  -- Status da remessa
  status TEXT NOT NULL DEFAULT 'EM ANALISE' CHECK (status IN ('EM ANALISE', 'APROVADA', 'REPROVADA')),
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tabela de títulos da remessa
CREATE TABLE IF NOT EXISTS solicitacoes_remessa_titulos (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  
  -- Referência à remessa
  remessa_id UUID NOT NULL REFERENCES solicitacoes_remessa(id) ON DELETE CASCADE,
  
  -- Dados do título (TOTVS)
  cd_empresa INTEGER,
  cd_cliente INTEGER,
  nm_cliente TEXT,
  nr_cpfcnpj TEXT,
  nr_fat INTEGER,
  nr_parcela INTEGER,
  cd_portador INTEGER,
  nm_portador TEXT,
  vl_fatura NUMERIC(15,2) NOT NULL DEFAULT 0,
  dt_emissao DATE,
  dt_vencimento DATE,
  
  -- Chave única para evitar selecionar o mesmo título mais de uma vez
  titulo_key TEXT NOT NULL,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índice único para impedir seleção duplicada de títulos
CREATE UNIQUE INDEX IF NOT EXISTS idx_remessa_titulo_unique 
  ON solicitacoes_remessa_titulos(titulo_key);

-- Índice para buscar títulos por remessa
CREATE INDEX IF NOT EXISTS idx_remessa_titulos_remessa_id 
  ON solicitacoes_remessa_titulos(remessa_id);

-- Trigger para atualizar updated_at
CREATE OR REPLACE FUNCTION update_solicitacoes_remessa_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_solicitacoes_remessa_updated_at ON solicitacoes_remessa;
CREATE TRIGGER update_solicitacoes_remessa_updated_at
  BEFORE UPDATE ON solicitacoes_remessa
  FOR EACH ROW
  EXECUTE FUNCTION update_solicitacoes_remessa_updated_at();

-- RLS (Row Level Security)
ALTER TABLE solicitacoes_remessa ENABLE ROW LEVEL SECURITY;
ALTER TABLE solicitacoes_remessa_titulos ENABLE ROW LEVEL SECURITY;

-- Políticas para solicitacoes_remessa
CREATE POLICY "Permitir leitura para todos autenticados" ON solicitacoes_remessa
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Permitir inserção para todos autenticados" ON solicitacoes_remessa
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Permitir atualização para todos autenticados" ON solicitacoes_remessa
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- Políticas para solicitacoes_remessa_titulos
CREATE POLICY "Permitir leitura para todos autenticados" ON solicitacoes_remessa_titulos
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Permitir inserção para todos autenticados" ON solicitacoes_remessa_titulos
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Permitir exclusão para todos autenticados" ON solicitacoes_remessa_titulos
  FOR DELETE TO authenticated USING (true);

-- Política para service_role (admin)
CREATE POLICY "Service role full access remessa" ON solicitacoes_remessa
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access remessa_titulos" ON solicitacoes_remessa_titulos
  FOR ALL TO service_role USING (true) WITH CHECK (true);
