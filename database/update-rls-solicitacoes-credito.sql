-- Atualizar políticas RLS para solicitacoes_credito
-- Execute este script para corrigir o acesso às solicitações

-- 1. Remover política antiga
DROP POLICY IF EXISTS "Usuários podem ver suas próprias solicitações" ON solicitacoes_credito;

-- 2. Criar nova política que permite ver todas as solicitações para usuários autenticados
-- (O filtro por empresa será feito no frontend através das empresas vinculadas)
CREATE POLICY "Usuários podem ver solicitações"
  ON solicitacoes_credito
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Verificar políticas ativas
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual 
FROM pg_policies 
WHERE tablename = 'solicitacoes_credito';
