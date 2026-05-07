-- Migration: Criar tabela de observações para despesas do TOTVS
-- Data: 2025-11-06
-- Descrição: Tabela para armazenar observações/comentários sobre despesas 
--            importadas do TOTVS, permitindo anotações personalizadas

-- 1. Criar tabela de observações
CREATE TABLE IF NOT EXISTS observacoes_despesas_totvs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Identificação da despesa TOTVS
  cd_empresa INTEGER NOT NULL,
  cd_despesaitem INTEGER NOT NULL,
  cd_fornecedor INTEGER NOT NULL,
  nr_duplicata TEXT NOT NULL,
  nr_parcela INTEGER NOT NULL DEFAULT 0,
  
  -- Observação
  observacao TEXT NOT NULL,
  
  -- Período da DRE (para filtros)
  dt_inicio DATE NOT NULL,
  dt_fim DATE NOT NULL,
  
  -- Auditoria
  cd_usuario UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Índices para performance
CREATE INDEX IF NOT EXISTS idx_obs_totvs_periodo 
  ON observacoes_despesas_totvs(dt_inicio, dt_fim);

CREATE INDEX IF NOT EXISTS idx_obs_totvs_empresa_despesa 
  ON observacoes_despesas_totvs(cd_empresa, cd_despesaitem);

CREATE INDEX IF NOT EXISTS idx_obs_totvs_fornecedor 
  ON observacoes_despesas_totvs(cd_fornecedor);

CREATE INDEX IF NOT EXISTS idx_obs_totvs_duplicata 
  ON observacoes_despesas_totvs(nr_duplicata, nr_parcela);

-- Índice composto único para evitar duplicatas (uma obs por despesa por período)
CREATE UNIQUE INDEX IF NOT EXISTS idx_obs_totvs_unique 
  ON observacoes_despesas_totvs(
    cd_empresa, 
    cd_despesaitem, 
    cd_fornecedor, 
    nr_duplicata, 
    nr_parcela, 
    dt_inicio, 
    dt_fim
  );

-- 3. RLS (Row Level Security)
ALTER TABLE observacoes_despesas_totvs ENABLE ROW LEVEL SECURITY;

-- Política: Usuários autenticados podem ver suas próprias observações
CREATE POLICY "Usuários podem ver próprias observações"
  ON observacoes_despesas_totvs
  FOR SELECT
  USING (auth.uid() = cd_usuario);

-- Política: Usuários autenticados podem criar observações
CREATE POLICY "Usuários podem criar observações"
  ON observacoes_despesas_totvs
  FOR INSERT
  WITH CHECK (auth.uid() = cd_usuario);

-- Política: Usuários podem atualizar próprias observações
CREATE POLICY "Usuários podem atualizar próprias observações"
  ON observacoes_despesas_totvs
  FOR UPDATE
  USING (auth.uid() = cd_usuario)
  WITH CHECK (auth.uid() = cd_usuario);

-- Política: Usuários podem deletar próprias observações
CREATE POLICY "Usuários podem deletar próprias observações"
  ON observacoes_despesas_totvs
  FOR DELETE
  USING (auth.uid() = cd_usuario);

-- 4. Trigger para atualizar updated_at automaticamente
CREATE OR REPLACE FUNCTION update_observacoes_totvs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_observacoes_totvs_updated_at
  BEFORE UPDATE ON observacoes_despesas_totvs
  FOR EACH ROW
  EXECUTE FUNCTION update_observacoes_totvs_updated_at();

-- 5. Comentários na tabela
COMMENT ON TABLE observacoes_despesas_totvs IS 
  'Armazena observações/comentários personalizados para despesas importadas do TOTVS no módulo DRE';

COMMENT ON COLUMN observacoes_despesas_totvs.cd_empresa IS 
  'Código da empresa no TOTVS';

COMMENT ON COLUMN observacoes_despesas_totvs.cd_despesaitem IS 
  'Código do item de despesa no TOTVS';

COMMENT ON COLUMN observacoes_despesas_totvs.cd_fornecedor IS 
  'Código do fornecedor no TOTVS';

COMMENT ON COLUMN observacoes_despesas_totvs.nr_duplicata IS 
  'Número da duplicata/título';

COMMENT ON COLUMN observacoes_despesas_totvs.nr_parcela IS 
  'Número da parcela';

COMMENT ON COLUMN observacoes_despesas_totvs.observacao IS 
  'Texto da observação/comentário do usuário';

COMMENT ON COLUMN observacoes_despesas_totvs.dt_inicio IS 
  'Data inicial do período da DRE';

COMMENT ON COLUMN observacoes_despesas_totvs.dt_fim IS 
  'Data final do período da DRE';

COMMENT ON COLUMN observacoes_despesas_totvs.cd_usuario IS 
  'UUID do usuário que criou a observação';

-- ✅ Migration concluída
