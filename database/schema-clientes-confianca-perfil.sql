-- Tabela de perfil de clientes Confiança
CREATE TABLE IF NOT EXISTS clientes_confianca_perfil (
  id BIGSERIAL PRIMARY KEY,
  person_code INTEGER NOT NULL UNIQUE,
  instagram TEXT,
  foto_path TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tabela de documentos anexados ao perfil do cliente
CREATE TABLE IF NOT EXISTS clientes_confianca_documentos (
  id BIGSERIAL PRIMARY KEY,
  person_code INTEGER NOT NULL,
  nome_arquivo TEXT NOT NULL,
  file_path TEXT NOT NULL,
  tipo TEXT,
  uploaded_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index para busca por person_code
CREATE INDEX IF NOT EXISTS idx_clientes_confianca_docs_person ON clientes_confianca_documentos(person_code);

-- Criar bucket no Storage (executar manualmente no Supabase Dashboard):
-- Nome: clientes-confianca
-- Tipo: Público (para fotos) ou Privado (para documentos)
-- Recomendação: criar como PÚBLICO para facilitar exibição de fotos

-- Criar bucket via SQL (alternativa ao Dashboard)
INSERT INTO storage.buckets (id, name, public)
VALUES ('clientes-confianca', 'clientes-confianca', true)
ON CONFLICT (id) DO NOTHING;

-- Storage Policies (necessárias para upload/download/delete funcionar)
CREATE POLICY "Permitir upload clientes-confianca"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'clientes-confianca');

CREATE POLICY "Permitir leitura clientes-confianca"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'clientes-confianca');

CREATE POLICY "Permitir update clientes-confianca"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'clientes-confianca');

CREATE POLICY "Permitir delete clientes-confianca"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'clientes-confianca');

-- Permitir leitura pública (para exibir fotos sem auth)
CREATE POLICY "Permitir leitura publica clientes-confianca"
  ON storage.objects FOR SELECT TO anon
  USING (bucket_id = 'clientes-confianca');

-- RLS Policies
ALTER TABLE clientes_confianca_perfil ENABLE ROW LEVEL SECURITY;
ALTER TABLE clientes_confianca_documentos ENABLE ROW LEVEL SECURITY;

-- Permitir leitura para todos autenticados
CREATE POLICY "Leitura perfil clientes confianca" ON clientes_confianca_perfil
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Escrita perfil clientes confianca" ON clientes_confianca_perfil
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Leitura docs clientes confianca" ON clientes_confianca_documentos
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Escrita docs clientes confianca" ON clientes_confianca_documentos
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
