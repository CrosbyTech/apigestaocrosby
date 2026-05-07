-- Tabela para armazenar observações dos clientes inadimplentes de franquias
-- Execute este SQL no painel do Supabase para criar a tabela

-- Criar tabela de observações
CREATE TABLE IF NOT EXISTS observacoes_inadimplentes_franquias (
  id SERIAL PRIMARY KEY,
  cd_cliente VARCHAR(50) NOT NULL,
  nm_cliente VARCHAR(255),
  observacao TEXT NOT NULL,
  usuario VARCHAR(255) NOT NULL,
  data_criacao TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Índices para melhorar performance das buscas
  CONSTRAINT observacoes_inadimplentes_franquias_cd_cliente_idx UNIQUE (id)
);

-- Criar índice para buscar observações por cliente
CREATE INDEX IF NOT EXISTS idx_observacoes_franquias_cd_cliente ON observacoes_inadimplentes_franquias(cd_cliente);

-- Criar índice para ordenar por data
CREATE INDEX IF NOT EXISTS idx_observacoes_franquias_data_criacao ON observacoes_inadimplentes_franquias(data_criacao DESC);

-- Comentários para documentação
COMMENT ON TABLE observacoes_inadimplentes_franquias IS 'Tabela para armazenar observações/comentários sobre clientes inadimplentes de franquias';
COMMENT ON COLUMN observacoes_inadimplentes_franquias.cd_cliente IS 'Código do cliente inadimplente';
COMMENT ON COLUMN observacoes_inadimplentes_franquias.nm_cliente IS 'Nome do cliente para referência';
COMMENT ON COLUMN observacoes_inadimplentes_franquias.observacao IS 'Texto da observação';
COMMENT ON COLUMN observacoes_inadimplentes_franquias.usuario IS 'Email ou ID do usuário que criou a observação';
COMMENT ON COLUMN observacoes_inadimplentes_franquias.data_criacao IS 'Data e hora da criação da observação';

-- Habilitar RLS (Row Level Security) se necessário
-- ALTER TABLE observacoes_inadimplentes_franquias ENABLE ROW LEVEL SECURITY;

-- Política para permitir inserção
-- CREATE POLICY "Permitir inserção de observações franquias" ON observacoes_inadimplentes_franquias
--   FOR INSERT WITH CHECK (true);

-- Política para permitir leitura
-- CREATE POLICY "Permitir leitura de observações franquias" ON observacoes_inadimplentes_franquias
--   FOR SELECT USING (true);
