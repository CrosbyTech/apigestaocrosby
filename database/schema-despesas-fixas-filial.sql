-- Tabela de fornecedores de despesas fixas por filial
-- Execute no Supabase SQL Editor

CREATE TABLE IF NOT EXISTS despesas_fixas_filial (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  cd_filial     VARCHAR(10) NOT NULL,
  cd_fornecedor VARCHAR(50),
  nm_fornecedor VARCHAR(255) NOT NULL,
  tipo_despesa  VARCHAR(20) NOT NULL CHECK (tipo_despesa IN ('ENERGIA', 'AGUA', 'INTERNET', 'TELEFONE', 'ALUGUEL')),
  vencimento    VARCHAR(10),  -- dia do mês (ex: "05", "10")
  forma_pagamento VARCHAR(100),
  observacao    TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Index para busca por filial
CREATE INDEX IF NOT EXISTS idx_despesas_fixas_filial_cd ON despesas_fixas_filial(cd_filial);

-- Trigger para updated_at automático
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_despesas_fixas_filial_updated_at
  BEFORE UPDATE ON despesas_fixas_filial
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS (Row Level Security) - permitir acesso autenticado
ALTER TABLE despesas_fixas_filial ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Leitura autenticada" ON despesas_fixas_filial
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Escrita autenticada" ON despesas_fixas_filial
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Atualização autenticada" ON despesas_fixas_filial
  FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "Exclusão autenticada" ON despesas_fixas_filial
  FOR DELETE USING (auth.role() = 'authenticated');
