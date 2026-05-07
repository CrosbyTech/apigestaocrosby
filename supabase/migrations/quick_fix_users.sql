-- ============================================
-- SCRIPT RÁPIDO - Execute no SQL Editor do Supabase
-- ============================================

-- 1. Função para listar usuários
CREATE OR REPLACE FUNCTION get_all_users()
RETURNS TABLE (
  id UUID,
  email TEXT,
  name TEXT,
  role TEXT,
  created_at TIMESTAMPTZ
) 
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    u.id,
    u.email,
    COALESCE(
      u.raw_user_meta_data->>'name',
      u.raw_user_meta_data->>'full_name',
      u.email
    ) as name,
    COALESCE(u.raw_user_meta_data->>'role', 'user') as role,
    u.created_at
  FROM auth.users u
  ORDER BY u.email;
END;
$$;

-- Dar permissão
GRANT EXECUTE ON FUNCTION get_all_users() TO authenticated;

-- Testar
SELECT * FROM get_all_users();
