-- ============================================
-- FUNÇÃO PARA LISTAR TODOS OS USUÁRIOS
-- Execute este script no SQL Editor do Supabase
-- ============================================

-- Função para listar usuários (requer permissões de serviço)
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

-- Dar permissão para usuários autenticados executarem a função
GRANT EXECUTE ON FUNCTION get_all_users() TO authenticated;

-- ============================================
-- ALTERNATIVA: CRIAR TABELA DE PERFIS DE USUÁRIOS
-- ============================================

-- Criar tabela de perfis se não existir
CREATE TABLE IF NOT EXISTS user_profiles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT,
  role TEXT DEFAULT 'user',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Habilitar RLS
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- Política: todos podem ler perfis
CREATE POLICY "Todos podem ver perfis"
  ON user_profiles FOR SELECT
  TO authenticated
  USING (true);

-- Política: usuários podem atualizar seu próprio perfil
CREATE POLICY "Usuários podem atualizar próprio perfil"
  ON user_profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Política: owners e admins podem inserir perfis
CREATE POLICY "Admins podem inserir perfis"
  ON user_profiles FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE id = auth.uid()
      AND (raw_user_meta_data->>'role' = 'owner' OR raw_user_meta_data->>'role' = 'admin')
    )
  );

-- Trigger para criar perfil automaticamente ao criar usuário
CREATE OR REPLACE FUNCTION create_user_profile()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO user_profiles (user_id, email, name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', NEW.raw_user_meta_data->>'full_name'),
    COALESCE(NEW.raw_user_meta_data->>'role', 'user')
  )
  ON CONFLICT (user_id) DO UPDATE
  SET 
    email = EXCLUDED.email,
    name = EXCLUDED.name,
    role = EXCLUDED.role,
    updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Criar trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT OR UPDATE ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION create_user_profile();

-- Popular tabela com usuários existentes
INSERT INTO user_profiles (user_id, email, name, role)
SELECT 
  id,
  email,
  COALESCE(raw_user_meta_data->>'name', raw_user_meta_data->>'full_name', email),
  COALESCE(raw_user_meta_data->>'role', 'user')
FROM auth.users
ON CONFLICT (user_id) DO NOTHING;

-- ============================================
-- ÍNDICES PARA PERFORMANCE
-- ============================================

CREATE INDEX IF NOT EXISTS idx_user_profiles_role ON user_profiles(role);
CREATE INDEX IF NOT EXISTS idx_user_profiles_email ON user_profiles(email);
