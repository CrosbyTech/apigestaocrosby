-- Adicionar coluna para armazenar o nome do usuário que aprovou/reprovou
-- Execute este SQL no Supabase SQL Editor

-- Verificar se a coluna já existe
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'solicitacoes_credito' 
        AND column_name = 'user_aprovador'
    ) THEN
        ALTER TABLE solicitacoes_credito 
        ADD COLUMN user_aprovador TEXT;
        
        RAISE NOTICE 'Coluna user_aprovador criada com sucesso!';
    ELSE
        RAISE NOTICE 'Coluna user_aprovador já existe!';
    END IF;
END $$;

-- Comentário na coluna
COMMENT ON COLUMN solicitacoes_credito.user_aprovador IS 'Nome do usuário que aprovou ou reprovou a solicitação';

-- Verificar a estrutura da tabela
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'solicitacoes_credito'
ORDER BY ordinal_position;
