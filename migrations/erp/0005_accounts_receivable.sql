-- ============================================================================
-- ERP HeadCoach — Fase 1: CONTAS A RECEBER no formato da API TOTVS v2
--
-- Espelha accounts-receivable/v2:
--   * documents/search (DocumentModel) → accounts_receivable_documents (1 linha por PARCELA)
--     invoice[] (NF vinculada)          → accounts_receivable_document_invoices (trigger)
--   * invoices-payment, documents/change-charge-type, bank-slip, payment-link
--     enviados pelo HeadCoach           → accounts_receivable_commands
--
-- Nomes de coluna = campo da API em snake_case. Exceção: o campo `check` da API
-- vira `check_data` (CHECK é palavra reservada no Postgres).
-- Chave = (branch_code, customer_code, receivable_code, installment_code) — o
-- número do título repete entre clientes (sondado: 2.500 parcelas, só 1.712
-- chaves únicas sem o cliente).
-- status: 1 normal · 3 cancelado (2, 4, 5, 6 não ocorrem em 2026).
-- Marco 0 = 17/10/2026 00:00 BRT. Idempotente.
-- ============================================================================

CREATE TABLE IF NOT EXISTS accounts_receivable_documents (
  -- ── chave ──
  branch_code INT NOT NULL,
  customer_code BIGINT NOT NULL,
  receivable_code BIGINT NOT NULL,
  installment_code INT NOT NULL,
  -- ── DocumentModel ──
  customer_cpf_cnpj TEXT,
  max_change_filter_date TIMESTAMP,
  expired_date DATE,
  payment_date DATE,
  issue_date DATE,
  settlement_branch_code INT,
  settlement_date DATE,
  settlement_sequence BIGINT,
  status INT,
  document_type INT,            -- 1 fatura · 3 dinheiro · 4 crédito · 5 débito · 10 adiantamento · 20 credev · 26 PIX ...
  billing_type INT,
  discharge_type INT,
  charge_type INT,
  origin_installment JSONB,
  bearer_code INT,
  bearer_name TEXT,
  installment_value NUMERIC(15, 2),
  paid_value NUMERIC(15, 2),
  net_value NUMERIC(15, 2),
  discount_value NUMERIC(15, 2),
  rebate_value NUMERIC(15, 2),
  interest_value NUMERIC(15, 2),
  assessment_value NUMERIC(15, 2),
  bar_code TEXT,
  digitable_line TEXT,
  our_number BIGINT,
  dac_our_number TEXT,
  qr_code_pix TEXT,
  discharge_user INT,
  registration_user INT,
  charge_account JSONB,
  calculated_values JSONB,
  check_data JSONB,             -- campo `check` da API
  invoice JSONB,                -- [{branchCode, invoiceSequence, invoiceDate, invoiceCode}]
  commissions JSONB,
  classifications JSONB,
  -- ── controle HeadCoach ──
  origem TEXT NOT NULL DEFAULT 'totvs' CHECK (origem IN ('totvs', 'headcoach')),
  dados JSONB,
  primeira_vez_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  sincronizado_em TIMESTAMPTZ,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (branch_code, customer_code, receivable_code, installment_code)
);
CREATE INDEX IF NOT EXISTS ar_doc_expired_idx ON accounts_receivable_documents (expired_date);
CREATE INDEX IF NOT EXISTS ar_doc_issue_idx ON accounts_receivable_documents (issue_date);
CREATE INDEX IF NOT EXISTS ar_doc_payment_idx ON accounts_receivable_documents (payment_date);
CREATE INDEX IF NOT EXISTS ar_doc_customer_idx ON accounts_receivable_documents (customer_code);
CREATE INDEX IF NOT EXISTS ar_doc_customer_doc_idx ON accounts_receivable_documents (customer_cpf_cnpj);
CREATE INDEX IF NOT EXISTS ar_doc_receivable_idx ON accounts_receivable_documents (receivable_code);
CREATE INDEX IF NOT EXISTS ar_doc_aberto_idx ON accounts_receivable_documents (branch_code, document_type, expired_date)
  WHERE status = 1 AND payment_date IS NULL;
CREATE INDEX IF NOT EXISTS ar_doc_bearer_idx ON accounts_receivable_documents (bearer_code);

-- NF vinculada ao título (invoice[] da API), mantida por trigger
CREATE TABLE IF NOT EXISTS accounts_receivable_document_invoices (
  branch_code INT NOT NULL,
  customer_code BIGINT NOT NULL,
  receivable_code BIGINT NOT NULL,
  installment_code INT NOT NULL,
  sequence INT NOT NULL,
  invoice_branch_code INT,
  invoice_sequence BIGINT,
  invoice_date DATE,
  invoice_code BIGINT,
  PRIMARY KEY (branch_code, customer_code, receivable_code, installment_code, sequence),
  FOREIGN KEY (branch_code, customer_code, receivable_code, installment_code)
    REFERENCES accounts_receivable_documents (branch_code, customer_code, receivable_code, installment_code)
    ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ar_doc_inv_nf_idx ON accounts_receivable_document_invoices (invoice_branch_code, invoice_code);

-- BEFORE UPDATE: atualizado_em + preserva o que a busca não trouxe
-- (maxChangeFilterDate só vem no filtro de alteração; invoice/classifications
-- só vêm com expand).
CREATE OR REPLACE FUNCTION ar_documents_before_update() RETURNS TRIGGER AS $$
BEGIN
  NEW.atualizado_em = now();
  NEW.max_change_filter_date = COALESCE(NEW.max_change_filter_date, OLD.max_change_filter_date);
  NEW.invoice = COALESCE(NEW.invoice, OLD.invoice);
  NEW.classifications = COALESCE(NEW.classifications, OLD.classifications);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION ar_documents_invoice_rows() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.invoice IS NOT DISTINCT FROM OLD.invoice THEN
    RETURN NEW;
  END IF;
  DELETE FROM accounts_receivable_document_invoices
   WHERE branch_code = NEW.branch_code AND customer_code = NEW.customer_code
     AND receivable_code = NEW.receivable_code AND installment_code = NEW.installment_code;
  IF jsonb_typeof(NEW.invoice) = 'array' THEN
    INSERT INTO accounts_receivable_document_invoices
      (branch_code, customer_code, receivable_code, installment_code, sequence,
       invoice_branch_code, invoice_sequence, invoice_date, invoice_code)
    SELECT NEW.branch_code, NEW.customer_code, NEW.receivable_code, NEW.installment_code, e.ord::int,
           NULLIF(e.val->>'branchCode', '')::int,
           NULLIF(e.val->>'invoiceSequence', '')::bigint,
           NULLIF(e.val->>'invoiceDate', '')::date,
           NULLIF(e.val->>'invoiceCode', '')::bigint
      FROM jsonb_array_elements(NEW.invoice) WITH ORDINALITY AS e(val, ord);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ar_documents_before_update ON accounts_receivable_documents;
CREATE TRIGGER ar_documents_before_update BEFORE UPDATE ON accounts_receivable_documents
  FOR EACH ROW EXECUTE FUNCTION ar_documents_before_update();
DROP TRIGGER IF EXISTS ar_documents_invoices ON accounts_receivable_documents;
CREATE TRIGGER ar_documents_invoices AFTER INSERT OR UPDATE ON accounts_receivable_documents
  FOR EACH ROW EXECUTE FUNCTION ar_documents_invoice_rows();

-- Comandos enviados pelo HeadCoach ao TOTVS no contas a receber
CREATE TABLE IF NOT EXISTS accounts_receivable_commands (
  id BIGSERIAL PRIMARY KEY,
  command TEXT NOT NULL CHECK (command IN ('invoices-payment', 'change-charge-type', 'bank-slip', 'payment-link')),
  branch_code INT,
  customer_code BIGINT,
  customer_cpf_cnpj TEXT,
  receivable_code BIGINT,
  installment_code INT,
  payload JSONB NOT NULL,
  sucesso BOOLEAN,
  http_status INT,
  resposta JSONB,
  erro TEXT,
  usuario TEXT,
  origem_tabela TEXT,
  origem_id TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ar_cmd_titulo_idx ON accounts_receivable_commands (receivable_code, installment_code);
CREATE INDEX IF NOT EXISTS ar_cmd_data_idx ON accounts_receivable_commands (criado_em DESC);

CREATE OR REPLACE VIEW accounts_receivable_documents_v AS
SELECT d.*,
       p.nome AS customer_name,
       e.descricao AS branch_name,
       e.propria AS branch_propria,
       CASE WHEN d.status = 1 AND d.payment_date IS NULL
            THEN COALESCE(d.installment_value, 0) - COALESCE(d.paid_value, 0) ELSE 0 END AS open_value,
       CASE WHEN d.status = 1 AND d.payment_date IS NULL AND d.expired_date < CURRENT_DATE
            THEN CURRENT_DATE - d.expired_date ELSE 0 END AS days_late
  FROM accounts_receivable_documents d
  LEFT JOIN erp_pessoas p ON p.code = d.customer_code
  LEFT JOIN erp_empresas e ON e.code = d.branch_code;

-- Contas a pagar: mesma proteção do max_change_filter_date (vem null fora do filtro de alteração)
CREATE OR REPLACE FUNCTION ap_duplicates_expense_sync() RETURNS TRIGGER AS $$
BEGIN
  NEW.atualizado_em = now();
  NEW.max_change_filter_date = COALESCE(NEW.max_change_filter_date, OLD.max_change_filter_date);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['accounts_receivable_documents', 'accounts_receivable_document_invoices', 'accounts_receivable_commands'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = 'erp_leitura_autenticado') THEN
      EXECUTE format('CREATE POLICY erp_leitura_autenticado ON %I FOR SELECT TO authenticated USING (true)', t);
    END IF;
  END LOOP;
END $$;

INSERT INTO erp_sync_controle (entidade, descricao, cursor_ate)
VALUES ('contas_receber', 'Contas a receber — títulos (accounts-receivable/v2/documents)', '2026-10-17T03:00:00Z')
ON CONFLICT (entidade) DO NOTHING;
