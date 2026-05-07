-- Migration: Criar função RPC para listar todos os usuários
-- Descrição: Permite que owners busquem lista de usuários do frontend sem usar Service Role Key

-- Função para listar todos os usuários (apenas owners podem chamar)
CREATE OR REPLACE FUNCTION get_all_users()
RETURNS TABLE (
  id uuid,
  email text,
  name text,
  role text,
  created_at timestamptz
) 
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  -- Verificar se o usuário atual é owner
  IF NOT EXISTS (
    SELECT 1 FROM auth.users
    WHERE auth.users.id = auth.uid()
    AND (raw_user_meta_data->>'role')::text = 'owner'
  ) THEN
    RAISE EXCEPTION 'Apenas owners podem listar usuários';
  END IF;

  -- Retornar lista de usuários
  RETURN QUERY
  SELECT 
    u.id,
    u.email::text,
    COALESCE((u.raw_user_meta_data->>'name')::text, 'Sem nome') as name,
    COALESCE((u.raw_user_meta_data->>'role')::text, 'guest') as role,
    u.created_at
  FROM auth.users u
  ORDER BY u.created_at DESC;
END;
$$;

-- Permitir que usuários autenticados chamem a função
GRANT EXECUTE ON FUNCTION get_all_users() TO authenticated;

-- Comentário na função
COMMENT ON FUNCTION get_all_users() IS 'Lista todos os usuários do sistema. Apenas owners podem executar esta função.';

