-- ==========================================================================
-- Migration: Adicionar TODOS os campos da API TOTVS v2 invoices/search
-- Tabela: notas_fiscais (Supabase Fiscal)
-- Data: 2026-04-15
-- EXECUTAR CADA BLOCO SEPARADAMENTE SE O EDITOR FIZER ROLLBACK EM ERRO
-- ==========================================================================

-- ===== BLOCO 1: Campos escalares simples =====
ALTER TABLE notas_fiscais ADD COLUMN IF NOT EXISTS invoice_date DATE;
ALTER TABLE notas_fiscais ADD COLUMN IF NOT EXISTS user_code INTEGER;
ALTER TABLE notas_fiscais ADD COLUMN IF NOT EXISTS release_date DATE;
ALTER TABLE notas_fiscais ADD COLUMN IF NOT EXISTS exit_time TEXT;
ALTER TABLE notas_fiscais ADD COLUMN IF NOT EXISTS last_change_date TIMESTAMPTZ;
ALTER TABLE notas_fiscais ADD COLUMN IF NOT EXISTS max_change_filter_date TIMESTAMPTZ;
ALTER TABLE notas_fiscais ADD COLUMN IF NOT EXISTS payment_condition_code INTEGER;
ALTER TABLE notas_fiscais ADD COLUMN IF NOT EXISTS payment_condition_name TEXT;
ALTER TABLE notas_fiscais ADD COLUMN IF NOT EXISTS terminal_code INTEGER;
ALTER TABLE notas_fiscais ADD COLUMN IF NOT EXISTS seller_cpf TEXT;
ALTER TABLE notas_fiscais ADD COLUMN IF NOT EXISTS observation_nfe TEXT;

-- ===== BLOCO 2: Campos de PDV =====
ALTER TABLE notas_fiscais ADD COLUMN IF NOT EXISTS inclusion_component_code TEXT;
ALTER TABLE notas_fiscais ADD COLUMN IF NOT EXISTS peripheral_pdv_code TEXT;
ALTER TABLE notas_fiscais ADD COLUMN IF NOT EXISTS version_pdv TEXT;
ALTER TABLE notas_fiscais ADD COLUMN IF NOT EXISTS mobile_version TEXT;
ALTER TABLE notas_fiscais ADD COLUMN IF NOT EXISTS id_document_pdv TEXT;

-- ===== BLOCO 3: Valores financeiros faltantes =====
ALTER TABLE notas_fiscais ADD COLUMN IF NOT EXISTS additional_value DECIMAL(15, 2);
ALTER TABLE notas_fiscais ADD COLUMN IF NOT EXISTS shipping_value DECIMAL(15, 2);
ALTER TABLE notas_fiscais ADD COLUMN IF NOT EXISTS base_icms_value DECIMAL(15, 2);
ALTER TABLE notas_fiscais ADD COLUMN IF NOT EXISTS icms_value DECIMAL(15, 2);
ALTER TABLE notas_fiscais ADD COLUMN IF NOT EXISTS icms_sub_st_value DECIMAL(15, 2);

-- ===== BLOCO 4: Objetos complexos armazenados como JSONB =====
ALTER TABLE notas_fiscais ADD COLUMN IF NOT EXISTS eletronic JSONB;
ALTER TABLE notas_fiscais ADD COLUMN IF NOT EXISTS ecf JSONB;
ALTER TABLE notas_fiscais ADD COLUMN IF NOT EXISTS sat JSONB;
ALTER TABLE notas_fiscais ADD COLUMN IF NOT EXISTS shipping_company JSONB;
ALTER TABLE notas_fiscais ADD COLUMN IF NOT EXISTS person JSONB;
ALTER TABLE notas_fiscais ADD COLUMN IF NOT EXISTS production_order JSONB;
ALTER TABLE notas_fiscais ADD COLUMN IF NOT EXISTS sales_order JSONB;
ALTER TABLE notas_fiscais ADD COLUMN IF NOT EXISTS payments JSONB;
ALTER TABLE notas_fiscais ADD COLUMN IF NOT EXISTS observation_nf JSONB;
ALTER TABLE notas_fiscais ADD COLUMN IF NOT EXISTS referenced_tax_invoice JSONB;
