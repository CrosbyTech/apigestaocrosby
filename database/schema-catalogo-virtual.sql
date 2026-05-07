-- =============================================
-- CATÁLOGO VIRTUAL — Schema Completo
-- Tabelas: banners, categorias, produtos, produto_imagens
-- Storage Bucket: catalogo-virtual
-- =============================================

-- 1. BANNERS
CREATE TABLE IF NOT EXISTS catalogo_banners (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  titulo TEXT,
  imagem_path TEXT NOT NULL,
  link_url TEXT,
  ordem INTEGER DEFAULT 0,
  ativo BOOLEAN DEFAULT true,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. CATEGORIAS (árvore com parent_id)
CREATE TABLE IF NOT EXISTS catalogo_categorias (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  nome TEXT NOT NULL,
  slug TEXT,
  parent_id UUID REFERENCES catalogo_categorias(id) ON DELETE SET NULL,
  ordem INTEGER DEFAULT 0,
  ativo BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. PRODUTOS
CREATE TABLE IF NOT EXISTS catalogo_produtos (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  nome TEXT NOT NULL,
  descricao TEXT,
  codigo_produto TEXT,
  marca TEXT,
  especificacoes TEXT,
  preco DECIMAL(15, 2),
  categoria_id UUID REFERENCES catalogo_categorias(id) ON DELETE SET NULL,
  ativo BOOLEAN DEFAULT true,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. IMAGENS DO PRODUTO
CREATE TABLE IF NOT EXISTS catalogo_produto_imagens (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  produto_id UUID NOT NULL REFERENCES catalogo_produtos(id) ON DELETE CASCADE,
  imagem_path TEXT NOT NULL,
  principal BOOLEAN DEFAULT false,
  ordem INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- ÍNDICES
-- =============================================
CREATE INDEX IF NOT EXISTS idx_catalogo_banners_ordem ON catalogo_banners(ordem);
CREATE INDEX IF NOT EXISTS idx_catalogo_categorias_parent ON catalogo_categorias(parent_id);
CREATE INDEX IF NOT EXISTS idx_catalogo_produtos_categoria ON catalogo_produtos(categoria_id);
CREATE INDEX IF NOT EXISTS idx_catalogo_produto_imagens_produto ON catalogo_produto_imagens(produto_id);

-- =============================================
-- STORAGE BUCKET
-- =============================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('catalogo-virtual', 'catalogo-virtual', true)
ON CONFLICT (id) DO NOTHING;

-- =============================================
-- RLS POLICIES
-- =============================================
ALTER TABLE catalogo_banners ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalogo_categorias ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalogo_produtos ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalogo_produto_imagens ENABLE ROW LEVEL SECURITY;

-- Leitura para todos autenticados
CREATE POLICY "catalogo_banners_select" ON catalogo_banners FOR SELECT TO authenticated USING (true);
CREATE POLICY "catalogo_banners_insert" ON catalogo_banners FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "catalogo_banners_update" ON catalogo_banners FOR UPDATE TO authenticated USING (true);
CREATE POLICY "catalogo_banners_delete" ON catalogo_banners FOR DELETE TO authenticated USING (true);

CREATE POLICY "catalogo_categorias_select" ON catalogo_categorias FOR SELECT TO authenticated USING (true);
CREATE POLICY "catalogo_categorias_insert" ON catalogo_categorias FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "catalogo_categorias_update" ON catalogo_categorias FOR UPDATE TO authenticated USING (true);
CREATE POLICY "catalogo_categorias_delete" ON catalogo_categorias FOR DELETE TO authenticated USING (true);

CREATE POLICY "catalogo_produtos_select" ON catalogo_produtos FOR SELECT TO authenticated USING (true);
CREATE POLICY "catalogo_produtos_insert" ON catalogo_produtos FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "catalogo_produtos_update" ON catalogo_produtos FOR UPDATE TO authenticated USING (true);
CREATE POLICY "catalogo_produtos_delete" ON catalogo_produtos FOR DELETE TO authenticated USING (true);

CREATE POLICY "catalogo_produto_imagens_select" ON catalogo_produto_imagens FOR SELECT TO authenticated USING (true);
CREATE POLICY "catalogo_produto_imagens_insert" ON catalogo_produto_imagens FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "catalogo_produto_imagens_update" ON catalogo_produto_imagens FOR UPDATE TO authenticated USING (true);
CREATE POLICY "catalogo_produto_imagens_delete" ON catalogo_produto_imagens FOR DELETE TO authenticated USING (true);

-- Leitura pública para o catálogo (anon)
CREATE POLICY "catalogo_banners_anon_select" ON catalogo_banners FOR SELECT TO anon USING (ativo = true);
CREATE POLICY "catalogo_categorias_anon_select" ON catalogo_categorias FOR SELECT TO anon USING (ativo = true);
CREATE POLICY "catalogo_produtos_anon_select" ON catalogo_produtos FOR SELECT TO anon USING (ativo = true);
CREATE POLICY "catalogo_produto_imagens_anon_select" ON catalogo_produto_imagens FOR SELECT TO anon USING (true);

-- Storage Policies
CREATE POLICY "catalogo_upload" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'catalogo-virtual');

CREATE POLICY "catalogo_read_auth" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'catalogo-virtual');

CREATE POLICY "catalogo_read_public" ON storage.objects FOR SELECT TO anon
  USING (bucket_id = 'catalogo-virtual');

CREATE POLICY "catalogo_update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'catalogo-virtual');

CREATE POLICY "catalogo_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'catalogo-virtual');
