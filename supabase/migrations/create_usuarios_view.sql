-- Criar uma view para acessar informações dos usuários
-- Esta view permite que o código busque informações de usuário sem expor dados sensíveis

CREATE OR REPLACE VIEW public.usuarios_view AS
SELECT 
  id,
  email,
  raw_user_meta_data
FROM auth.users;

-- Garantir que todos os usuários autenticados possam ler da view
GRANT SELECT ON public.usuarios_view TO authenticated;

-- Comentário na view
COMMENT ON VIEW public.usuarios_view IS 'View para acessar informações básicas dos usuários do auth.users';
