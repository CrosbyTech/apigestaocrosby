-- ========================================
-- VERIFICAÇÃO: Real-time está habilitado?
-- ========================================
-- Execute no SQL Editor do Supabase

-- 1. Verificar se a tabela está na publicação do realtime
SELECT 
  schemaname,
  tablename,
  pubname
FROM pg_publication_tables 
WHERE pubname = 'supabase_realtime'
  AND tablename IN ('observacoes_despesas_totvs', 'observacoes_despesas_manuais');

-- Resultado esperado:
-- ┌────────────┬─────────────────────────────────┬───────────────────┐
-- │ schemaname │ tablename                       │ pubname           │
-- ├────────────┼─────────────────────────────────┼───────────────────┤
-- │ public     │ observacoes_despesas_totvs      │ supabase_realtime │
-- │ public     │ observacoes_despesas_manuais    │ supabase_realtime │ (se criou)
-- └────────────┴─────────────────────────────────┴───────────────────┘

-- Se NÃO aparecer nenhuma linha, execute:
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.observacoes_despesas_totvs;


-- ========================================
-- 2. Verificar RLS (Row Level Security)
-- ========================================
SELECT 
  tablename,
  rowsecurity
FROM pg_tables
WHERE schemaname = 'public' 
  AND tablename = 'observacoes_despesas_totvs';

-- Resultado esperado:
-- ┌─────────────────────────────────┬──────────────┐
-- │ tablename                       │ rowsecurity  │
-- ├─────────────────────────────────┼──────────────┤
-- │ observacoes_despesas_totvs      │ true         │
-- └─────────────────────────────────┴──────────────┘


-- ========================================
-- 3. Verificar políticas RLS
-- ========================================
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd
FROM pg_policies
WHERE schemaname = 'public' 
  AND tablename = 'observacoes_despesas_totvs';

-- Deve ter políticas para SELECT e INSERT


-- ========================================
-- 4. HABILITAR REAL-TIME (se não estiver)
-- ========================================
-- Execute APENAS se o item 1 não retornou resultado:

ALTER PUBLICATION supabase_realtime ADD TABLE public.observacoes_despesas_totvs;

-- ========================================
-- 5. Verificar se funcionou
-- ========================================
-- Re-execute a query do item 1 acima


-- ========================================
-- 6. TESTE RÁPIDO: Inserir manualmente
-- ========================================
-- Cole seu UUID de usuário aqui:
-- Você pode pegar com: SELECT id FROM auth.users LIMIT 1;

-- Depois execute:
/*
INSERT INTO public.observacoes_despesas_totvs (
  cd_usuario,
  cd_empresa,
  cd_despesaitem,
  cd_fornecedor,
  nr_duplicata,
  nr_parcela,
  observacao,
  is_active
) VALUES (
  'SEU_UUID_AQUI',  -- ⚠️ TROCAR pelo seu ID de usuário
  1,
  6018,
  76249,
  '5559',
  1,
  'Teste de real-time - funciona?',
  true
);
*/

-- Se o real-time estiver funcionando, essa mensagem deve aparecer
-- automaticamente no modal (sem precisar recarregar)!
