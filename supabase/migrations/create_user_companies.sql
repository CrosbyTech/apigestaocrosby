-- Migration: Criar tabela de empresas vinculadas a usuários
-- Descrição: Sistema para vincular empresas específicas a usuários do tipo "franquias"

-- Remover políticas existentes (se houver)
DROP POLICY IF EXISTS "Users can view their own companies" ON public.user_companies;
DROP POLICY IF EXISTS "Only owners can insert user companies" ON public.user_companies;
DROP POLICY IF EXISTS "Only owners can update user companies" ON public.user_companies;
DROP POLICY IF EXISTS "Only owners can delete user companies" ON public.user_companies;

-- Remover índices existentes (se houver)
DROP INDEX IF EXISTS public.idx_user_companies_user_id;
DROP INDEX IF EXISTS public.idx_user_companies_cd_empresa;

-- Remover tabela existente (se houver) - necessário se foi criada incorretamente antes
DROP TABLE IF EXISTS public.user_companies CASCADE;

-- Criar tabela user_companies
CREATE TABLE public.user_companies (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    cd_empresa TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Garantir que não haja duplicatas (um usuário não pode ter a mesma empresa duas vezes)
    CONSTRAINT unique_user_company UNIQUE (user_id, cd_empresa)
);

-- Criar índices para melhorar performance
CREATE INDEX IF NOT EXISTS idx_user_companies_user_id ON public.user_companies(user_id);
CREATE INDEX IF NOT EXISTS idx_user_companies_cd_empresa ON public.user_companies(cd_empresa);

-- Habilitar Row Level Security (RLS)
ALTER TABLE public.user_companies ENABLE ROW LEVEL SECURITY;

-- Política: Usuários podem ver apenas suas próprias empresas vinculadas
CREATE POLICY "Users can view their own companies"
    ON public.user_companies
    FOR SELECT
    USING (auth.uid() = user_id);

-- Política: Apenas owners podem inserir empresas vinculadas
CREATE POLICY "Only owners can insert user companies"
    ON public.user_companies
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM auth.users
            WHERE id = auth.uid()
            AND (raw_user_meta_data->>'role')::text = 'owner'
        )
    );

-- Política: Apenas owners podem atualizar empresas vinculadas
CREATE POLICY "Only owners can update user companies"
    ON public.user_companies
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM auth.users
            WHERE id = auth.uid()
            AND (raw_user_meta_data->>'role')::text = 'owner'
        )
    );

-- Política: Apenas owners podem deletar empresas vinculadas
CREATE POLICY "Only owners can delete user companies"
    ON public.user_companies
    FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM auth.users
            WHERE id = auth.uid()
            AND (raw_user_meta_data->>'role')::text = 'owner'
        )
    );

-- Comentários
COMMENT ON TABLE public.user_companies IS 'Armazena empresas vinculadas a usuários (especialmente tipo franquias)';
COMMENT ON COLUMN public.user_companies.user_id IS 'ID do usuário (auth.users.id)';
COMMENT ON COLUMN public.user_companies.cd_empresa IS 'Código da empresa (cd_empresa)';

