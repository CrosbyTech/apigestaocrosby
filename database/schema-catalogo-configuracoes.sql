-- =============================================
-- CATÁLOGO VIRTUAL — Configurações de Marketing
-- Tabela key-value para Meta Pixel, GA4, UTMs
-- =============================================

CREATE TABLE IF NOT EXISTS catalogo_configuracoes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  chave TEXT NOT NULL UNIQUE,
  valor JSONB DEFAULT '{}'::jsonb,
  updated_by UUID REFERENCES auth.users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Inserir configurações padrão
INSERT INTO catalogo_configuracoes (chave, valor) VALUES
  ('meta_pixel_id', '"" '::jsonb),
  ('ga4_measurement_id', '""'::jsonb),
  ('utm_config', '{
    "auto_capture": true,
    "append_to_whatsapp": true,
    "append_to_orcamento": true,
    "whatsapp_number": "",
    "whatsapp_message_template": "Olá! Vi o produto {produto} no catálogo. {utm_info}",
    "orcamento_message_template": "Solicito orçamento para {produto}. {utm_info}"
  }'::jsonb)
ON CONFLICT (chave) DO NOTHING;

-- RLS
ALTER TABLE catalogo_configuracoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "catalogo_config_select" ON catalogo_configuracoes
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "catalogo_config_update" ON catalogo_configuracoes
  FOR UPDATE TO authenticated USING (true);
CREATE POLICY "catalogo_config_insert" ON catalogo_configuracoes
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "catalogo_config_delete" ON catalogo_configuracoes
  FOR DELETE TO authenticated USING (true);
