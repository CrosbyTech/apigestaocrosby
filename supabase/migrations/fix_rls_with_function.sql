-- SOLUÇÃO DEFINITIVA: Criar função para verificar se é owner
-- Execute este SQL no Supabase SQL Editor

-- 1. Criar função que verifica se usuário atual é owner
CREATE OR REPLACE FUNCTION is_owner()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM auth.users
    WHERE id = auth.uid()
    AND (raw_user_meta_data->>'role')::text = 'owner'
  );
END;
$$;

-- 2. Remover políticas antigas
DROP POLICY IF EXISTS "Only owners can insert permissions" ON public.user_page_permissions;
DROP POLICY IF EXISTS "Only owners can update permissions" ON public.user_page_permissions;
DROP POLICY IF EXISTS "Only owners can delete permissions" ON public.user_page_permissions;

-- 3. Criar novas políticas usando a função
CREATE POLICY "Only owners can insert permissions"
    ON public.user_page_permissions
    FOR INSERT
    WITH CHECK (is_owner());

CREATE POLICY "Only owners can update permissions"
    ON public.user_page_permissions
    FOR UPDATE
    USING (is_owner());

CREATE POLICY "Only owners can delete permissions"
    ON public.user_page_permissions
    FOR DELETE
    USING (is_owner());

-- 4. Garantir que a função pode ser executada por usuários autenticados
GRANT EXECUTE ON FUNCTION is_owner() TO authenticated;

-- Comentário
COMMENT ON FUNCTION is_owner() IS 'Verifica se o usuário autenticado atual tem role de owner';

