-- ============================================================================
-- ERP HeadCoach — Fase 0: função de leitura do schema para versionar no git.
-- exec_sql() só devolve 'OK'; esta função devolve o catálogo em JSON para o
-- script scripts/erp-schema-snapshot.mjs (docs/schema/).
-- ============================================================================
CREATE OR REPLACE FUNCTION erp_schema_snapshot()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT jsonb_build_object(
    'gerado_em', now(),
    'tabelas', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'tabela', c.relname,
        'kind', c.relkind,
        'rls', c.relrowsecurity,
        'comentario', obj_description(c.oid, 'pg_class'),
        'linhas_estimadas', c.reltuples::bigint,
        'colunas', (
          SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'coluna', col.column_name, 'tipo', col.data_type,
            'nulo', col.is_nullable = 'YES', 'padrao', col.column_default, 'pos', col.ordinal_position
          ) ORDER BY col.ordinal_position), '[]'::jsonb)
          FROM information_schema.columns col
          WHERE col.table_schema = 'public' AND col.table_name = c.relname
        ),
        'constraints', (
          SELECT COALESCE(jsonb_agg(jsonb_build_object('nome', con.conname, 'tipo', con.contype, 'definicao', pg_get_constraintdef(con.oid)) ORDER BY con.conname), '[]'::jsonb)
          FROM pg_constraint con WHERE con.conrelid = c.oid
        ),
        'indices', (
          SELECT COALESCE(jsonb_agg(jsonb_build_object('nome', i.indexname, 'definicao', i.indexdef) ORDER BY i.indexname), '[]'::jsonb)
          FROM pg_indexes i WHERE i.schemaname = 'public' AND i.tablename = c.relname
        ),
        'policies', (
          SELECT COALESCE(jsonb_agg(jsonb_build_object('nome', p.policyname, 'cmd', p.cmd, 'roles', p.roles::text, 'qual', p.qual, 'with_check', p.with_check) ORDER BY p.policyname), '[]'::jsonb)
          FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname
        )
      ) ORDER BY c.relname), '[]'::jsonb)
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v', 'm')
    ),
    'funcoes', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'nome', p.proname,
        'argumentos', pg_get_function_arguments(p.oid),
        'retorno', pg_get_function_result(p.oid),
        'linguagem', l.lanname
      ) ORDER BY p.proname), '[]'::jsonb)
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      JOIN pg_language l ON l.oid = p.prolang
      WHERE n.nspname = 'public'
    )
  );
$$;

REVOKE ALL ON FUNCTION erp_schema_snapshot() FROM public, anon;
GRANT EXECUTE ON FUNCTION erp_schema_snapshot() TO service_role;
