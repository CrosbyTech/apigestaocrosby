-- ============================================================================
-- ERP HeadCoach — Fase 0 (segurança)
--
-- O frontend usava a service_role key (supabaseAdmin) direto no navegador em
-- 17 arquivos. A chave foi removida do bundle; essas telas passam a gravar com
-- a sessão do usuário (role `authenticated`). Para nada quebrar, cada tabela
-- que elas tocam ganha uma policy permissiva para `authenticated` (quem não
-- está logado continua sem acesso). Onde RLS está desligado a policy é inerte.
--
-- Buckets de storage usados pelas mesmas telas ganham policy equivalente.
-- Idempotente.
-- ============================================================================
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'solicitacoes_baixa', 'comprovantes_baixa', 'esteira_protesto', 'pagamentos_liberacao',
    'pes_pessoa', 'recuperacao_credito_anexos', 'recuperacao_credito_status',
    'solicitacoes_crosby', 'solicitacoes_credito', 'solicitacoes_renegociacoes',
    'user_companies', 'user_profiles', 'user_profiles_antiga', 'user_page_permissions',
    'classificacoes_inadimplentes', 'observacoes_inadimplentes', 'observacoes_inadimplentes_franquias',
    'solicitacoes_remessa', 'solicitacoes_remessa_titulos', 'antecipacoes_faturas',
    'pagamentos_fabricas', 'call_center_contatos', 'call_center_ligacoes'
  ] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      CONTINUE;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = 'headcoach_autenticado_tudo'
    ) THEN
      EXECUTE format(
        'CREATE POLICY headcoach_autenticado_tudo ON %I FOR ALL TO authenticated USING (true) WITH CHECK (true)', t
      );
    END IF;
  END LOOP;
END $$;

-- Storage: buckets gravados pelas telas (upload de comprovantes/documentos)
DO $$
DECLARE b TEXT;
BEGIN
  FOREACH b IN ARRAY ARRAY['comprovantes_baixa', 'clientes-confianca'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
        AND policyname = 'headcoach_autenticado_' || replace(b, '-', '_')
    ) THEN
      BEGIN
        EXECUTE format(
          'CREATE POLICY %I ON storage.objects FOR ALL TO authenticated USING (bucket_id = %L) WITH CHECK (bucket_id = %L)',
          'headcoach_autenticado_' || replace(b, '-', '_'), b, b
        );
      EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'sem permissão para criar policy no storage (bucket %) — criar pelo painel do Supabase', b;
      END;
    END IF;
  END LOOP;
END $$;
