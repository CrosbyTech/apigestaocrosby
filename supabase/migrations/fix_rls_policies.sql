-- Script de correção: Atualizar políticas RLS para usar raw_user_meta_data
-- Execute este SQL no Supabase SQL Editor

-- Remover políticas antigas
DROP POLICY IF EXISTS "Only owners can insert permissions" ON public.user_page_permissions;
DROP POLICY IF EXISTS "Only owners can update permissions" ON public.user_page_permissions;
DROP POLICY IF EXISTS "Only owners can delete permissions" ON public.user_page_permissions;

-- Criar políticas corrigidas com raw_user_meta_data

-- Política: Apenas owners podem inserir permissões
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

