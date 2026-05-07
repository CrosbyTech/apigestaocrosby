-- ==========================================================================
-- Migration: Adicionar novos campos da API TOTVS v2 invoices/search
-- Tabela: notas_fiscais (Supabase Fiscal)
-- Data: 2026-04-15
-- ==========================================================================

-- 1) Sequência da NF
ALTER TABLE notas_fiscais
ADD COLUMN IF NOT EXISTS invoice_sequence INTEGER;

-- 2) Origem da NF (Manual, Import, etc.)
ALTER TABLE notas_fiscais
ADD COLUMN IF NOT EXISTS origin TEXT;

-- 3) Código do tipo de documento
ALTER TABLE notas_fiscais
ADD COLUMN IF NOT EXISTS document_type_code INTEGER;

-- 4) CPF/CNPJ da pessoa (cliente/fornecedor)
ALTER TABLE notas_fiscais
ADD COLUMN IF NOT EXISTS person_cpf_cnpj TEXT;

-- 5) Status da NF-e (Authorized, Denied, Canceled, etc.)
ALTER TABLE notas_fiscais
ADD COLUMN IF NOT EXISTS eletronic_invoice_status TEXT;

-- 6) Transportadora - código
ALTER TABLE notas_fiscais
ADD COLUMN IF NOT EXISTS shipping_company_code INTEGER;

-- 7) Transportadora - CPF/CNPJ
ALTER TABLE notas_fiscais
ADD COLUMN IF NOT EXISTS shipping_company_cpf_cnpj TEXT;

-- Índices de performance para os novos campos mais consultados
CREATE INDEX IF NOT EXISTS idx_nf_person_cpf_cnpj
  ON notas_fiscais(person_cpf_cnpj);

CREATE INDEX IF NOT EXISTS idx_nf_eletronic_invoice_status
  ON notas_fiscais(eletronic_invoice_status);

CREATE INDEX IF NOT EXISTS idx_nf_origin
  ON notas_fiscais(origin);

CREATE INDEX IF NOT EXISTS idx_nf_document_type_code
  ON notas_fiscais(document_type_code);
