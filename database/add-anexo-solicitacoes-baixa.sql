-- =====================================================
-- Adicionar campo de ANEXO na tabela solicitacoes_baixa
-- Para armazenar documentos extras (imagem, PDF, DOCX)
-- =====================================================

ALTER TABLE solicitacoes_baixa
  ADD COLUMN IF NOT EXISTS anexo_url TEXT,
  ADD COLUMN IF NOT EXISTS anexo_path TEXT,
  ADD COLUMN IF NOT EXISTS anexo_nome TEXT;

-- =====================================================
-- STORAGE: Criar bucket para anexos (se ainda não existir)
-- Execute no Supabase Dashboard -> Storage -> New Bucket:
--   Nome: anexos_baixa
--   Public: ON
-- =====================================================

-- Policy para permitir upload por usuários autenticados
CREATE POLICY "Allow authenticated uploads anexos_baixa"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'anexos_baixa'
    AND auth.role() = 'authenticated'
  );

-- Policy para leitura pública
CREATE POLICY "Allow public read anexos_baixa"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'anexos_baixa');

-- Policy para exclusão por usuários autenticados
CREATE POLICY "Allow authenticated delete anexos_baixa"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'anexos_baixa'
    AND auth.role() = 'authenticated'
  );
