-- Adicionar coluna categoria na tabela de documentos
ALTER TABLE clientes_confianca_documentos ADD COLUMN IF NOT EXISTS categoria TEXT;

-- Criar índice para busca por categoria
CREATE INDEX IF NOT EXISTS idx_clientes_confianca_docs_categoria ON clientes_confianca_documentos(person_code, categoria);
