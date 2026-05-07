-- Migration: Criar tabela de permissões customizadas por usuário
-- Descrição: Sistema de controle de acesso granular onde cada usuário tem permissões específicas para páginas

-- Criar tabela user_page_permissions
CREATE TABLE IF NOT EXISTS public.user_page_permissions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    page_path TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Garantir que não haja duplicatas (um usuário não pode ter a mesma página duas vezes)
    CONSTRAINT unique_user_page UNIQUE (user_id, page_path)
);

-- Criar índices para melhorar performance
CREATE INDEX IF NOT EXISTS idx_user_page_permissions_user_id ON public.user_page_permissions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_page_permissions_page_path ON public.user_page_permissions(page_path);
CREATE INDEX IF NOT EXISTS idx_user_page_permissions_created_by ON public.user_page_permissions(created_by);

-- Habilitar Row Level Security (RLS)
ALTER TABLE public.user_page_permissions ENABLE ROW LEVEL SECURITY;

-- Política: Usuários podem ver apenas suas próprias permissões
CREATE POLICY "Users can view their own permissions"
    ON public.user_page_permissions
    FOR SELECT
    USING (auth.uid() = user_id);

-- Política: Apenas owners podem inserir permissões (verificar via raw_user_meta_data)
CREATE POLICY "Only owners can insert permissions"
    ON public.user_page_permissions
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM auth.users
            WHERE id = auth.uid()
            AND (raw_user_meta_data->>'role')::text = 'owner'
        )
    );

-- Política: Apenas owners podem atualizar permissões
CREATE POLICY "Only owners can update permissions"
    ON public.user_page_permissions
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM auth.users
            WHERE id = auth.uid()
            AND (raw_user_meta_data->>'role')::text = 'owner'
        )
    );

-- Política: Apenas owners podem deletar permissões
CREATE POLICY "Only owners can delete permissions"
    ON public.user_page_permissions
    FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM auth.users
            WHERE id = auth.uid()
            AND (raw_user_meta_data->>'role')::text = 'owner'
        )
    );

-- Função para atualizar automaticamente o campo updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger para atualizar updated_at automaticamente
CREATE TRIGGER update_user_page_permissions_updated_at
    BEFORE UPDATE ON public.user_page_permissions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Comentários na tabela e colunas para documentação
COMMENT ON TABLE public.user_page_permissions IS 'Armazena permissões customizadas de acesso às páginas para cada usuário';
COMMENT ON COLUMN public.user_page_permissions.user_id IS 'ID do usuário que possui a permissão';
COMMENT ON COLUMN public.user_page_permissions.page_path IS 'Caminho da página (ex: /dashboard-faturamento)';
COMMENT ON COLUMN public.user_page_permissions.created_by IS 'ID do owner que criou a permissão';

