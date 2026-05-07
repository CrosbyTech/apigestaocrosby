-- Tabela para armazenar observações dos clientes inadimplentes
-- Execute este SQL no painel do Supabase para criar a tabela

-- Criar tabela de observações
CREATE TABLE IF NOT EXISTS observacoes_inadimplentes (
  id SERIAL PRIMARY KEY,
  cd_cliente VARCHAR(50) NOT NULL,
  nm_cliente VARCHAR(255),
  observacao TEXT NOT NULL,
  usuario VARCHAR(255) NOT NULL,
  data_criacao TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Índices para melhorar performance das buscas
  CONSTRAINT observacoes_inadimplentes_cd_cliente_idx UNIQUE (id)
);

-- Criar índice para buscar observações por cliente
CREATE INDEX IF NOT EXISTS idx_observacoes_cd_cliente ON observacoes_inadimplentes(cd_cliente);

-- Criar índice para ordenar por data
CREATE INDEX IF NOT EXISTS idx_observacoes_data_criacao ON observacoes_inadimplentes(data_criacao DESC);

-- Adicionar coluna 'representante' na tabela de classificações (se ainda não existir)
-- ALTER TABLE classificacoes_inadimplentes ADD COLUMN IF NOT EXISTS representante VARCHAR(255);

-- Comentários para documentação
COMMENT ON TABLE observacoes_inadimplentes IS 'Tabela para armazenar observações/comentários sobre clientes inadimplentes';
COMMENT ON COLUMN observacoes_inadimplentes.cd_cliente IS 'Código do cliente inadimplente';
COMMENT ON COLUMN observacoes_inadimplentes.nm_cliente IS 'Nome do cliente para referência';
COMMENT ON COLUMN observacoes_inadimplentes.observacao IS 'Texto da observação';
COMMENT ON COLUMN observacoes_inadimplentes.usuario IS 'Email ou ID do usuário que criou a observação';
COMMENT ON COLUMN observacoes_inadimplentes.data_criacao IS 'Data e hora da criação da observação';

-- Habilitar RLS (Row Level Security) se necessário
-- ALTER TABLE observacoes_inadimplentes ENABLE ROW LEVEL SECURITY;

-- Política para permitir inserção
-- CREATE POLICY "Permitir inserção de observações" ON observacoes_inadimplentes
--   FOR INSERT WITH CHECK (true);

-- Política para permitir leitura
-- CREATE POLICY "Permitir leitura de observações" ON observacoes_inadimplentes
--   FOR SELECT USING (true);
