-- ============================================================================
-- ERP HeadCoach — Fase 1: CONTAS A PAGAR no formato da API TOTVS v2
--
-- Espelha exatamente os modelos de accounts-payable/v2:
--   * DuplicateOutModel        (POST duplicates/search)   → accounts_payable_duplicates
--     expense[] da parcela                                → accounts_payable_duplicate_expenses
--   * CreatedDuplicateCommand  (POST duplicates)          → mesmos campos + colunas do comando
--   * GroupDuplicatesCommand   (POST group-duplicates)    → registrado em accounts_payable_commands
--
-- Nomes de coluna = nome do campo da API em snake_case (branchCode → branch_code).
-- 1 linha por PARCELA, chave = (branch_code, supplier_code, duplicate_code, installment_code)
-- — a mesma da API (sem o fornecedor a chave repete entre fornecedores).
--
-- Marco 0 = 17/10/2026 00:00 (America/Sao_Paulo). A partir dele o job
-- erp-sync mantém a tabela atualizada; o histórico anterior entra depois
-- pela carga (node scripts/erp-carga-inicial.mjs contas_pagar --desde 2023-01-01).
-- Idempotente.
-- ============================================================================

CREATE TABLE IF NOT EXISTS accounts_payable_duplicates (
  -- ── chave (DuplicateOutModel) ──
  branch_code INT NOT NULL,
  supplier_code BIGINT NOT NULL,
  duplicate_code BIGINT NOT NULL,
  installment_code INT NOT NULL,
  -- ── DuplicateOutModel ──
  supplier_cpf_cnpj TEXT,
  bearer_code INT,
  entry_date TIMESTAMP,
  issue_date TIMESTAMP,
  due_date TIMESTAMP,
  settlement_date TIMESTAMP,
  arrival_date TIMESTAMP,
  status TEXT,                  -- N normal · C cancelada · A agrupada · D devolvida · L comissão liquidada · Q quebrada
  duplicate_value NUMERIC(15, 2),
  fees_value NUMERIC(15, 2),
  discount_value NUMERIC(15, 2),
  paid_value NUMERIC(15, 2),
  expense JSONB,                -- [{expenseCode, expenseName, costCenterCode, proratedPercentage, proratedValue}]
  inclusion_type INT,
  user_inclusion_code INT,
  user_inclusion_name TEXT,
  max_change_filter_date TIMESTAMP,
  -- ── CreatedDuplicateCommand (só quando a duplicata nasce pelo HeadCoach) ──
  branch_cnpj TEXT,
  document_type INT,            -- Document: 1 Duplicate, 7 Invoice, 15 Receipt, 50 OutherTitle...
  prevision_type INT,           -- Prevision: 1 Forecast, 2 Real, 3 Consignment
  stage_type INT,               -- Stage: 1 InvoiceNotConfered, 2 ReleasedForPayment, 90 Finished...
  observation TEXT,
  -- ── controle HeadCoach ──
  origem TEXT NOT NULL DEFAULT 'totvs' CHECK (origem IN ('totvs', 'headcoach')),
  dados JSONB,                  -- item bruto devolvido pelo TOTVS
  comando JSONB,                -- payload enviado pelo HeadCoach (quando origem = headcoach)
  primeira_vez_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  sincronizado_em TIMESTAMPTZ,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (branch_code, supplier_code, duplicate_code, installment_code)
);
CREATE INDEX IF NOT EXISTS ap_dup_due_idx ON accounts_payable_duplicates (due_date);
CREATE INDEX IF NOT EXISTS ap_dup_issue_idx ON accounts_payable_duplicates (issue_date);
CREATE INDEX IF NOT EXISTS ap_dup_settlement_idx ON accounts_payable_duplicates (settlement_date);
CREATE INDEX IF NOT EXISTS ap_dup_supplier_idx ON accounts_payable_duplicates (supplier_code);
CREATE INDEX IF NOT EXISTS ap_dup_supplier_doc_idx ON accounts_payable_duplicates (supplier_cpf_cnpj);
CREATE INDEX IF NOT EXISTS ap_dup_status_idx ON accounts_payable_duplicates (status, branch_code);
CREATE INDEX IF NOT EXISTS ap_dup_change_idx ON accounts_payable_duplicates (max_change_filter_date);

-- Rateio de despesa da parcela (expense[]) em linhas — mantido por trigger a
-- partir da coluna expense da duplicata, então nunca diverge dela.
CREATE TABLE IF NOT EXISTS accounts_payable_duplicate_expenses (
  branch_code INT NOT NULL,
  supplier_code BIGINT NOT NULL,
  duplicate_code BIGINT NOT NULL,
  installment_code INT NOT NULL,
  sequence INT NOT NULL,
  expense_code INT,
  expense_name TEXT,
  cost_center_code INT,
  prorated_percentage NUMERIC(9, 4),
  prorated_value NUMERIC(15, 2),
  PRIMARY KEY (branch_code, supplier_code, duplicate_code, installment_code, sequence),
  FOREIGN KEY (branch_code, supplier_code, duplicate_code, installment_code)
    REFERENCES accounts_payable_duplicates (branch_code, supplier_code, duplicate_code, installment_code)
    ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ap_dup_exp_expense_idx ON accounts_payable_duplicate_expenses (expense_code);
CREATE INDEX IF NOT EXISTS ap_dup_exp_cc_idx ON accounts_payable_duplicate_expenses (cost_center_code);

CREATE OR REPLACE FUNCTION ap_duplicates_expense_sync() RETURNS TRIGGER AS $$
BEGIN
  NEW.atualizado_em = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION ap_duplicates_expense_rows() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.expense IS NOT DISTINCT FROM OLD.expense THEN
    RETURN NEW;
  END IF;
  DELETE FROM accounts_payable_duplicate_expenses
   WHERE branch_code = NEW.branch_code AND supplier_code = NEW.supplier_code
     AND duplicate_code = NEW.duplicate_code AND installment_code = NEW.installment_code;
  IF jsonb_typeof(NEW.expense) = 'array' THEN
    INSERT INTO accounts_payable_duplicate_expenses
      (branch_code, supplier_code, duplicate_code, installment_code, sequence,
       expense_code, expense_name, cost_center_code, prorated_percentage, prorated_value)
    SELECT NEW.branch_code, NEW.supplier_code, NEW.duplicate_code, NEW.installment_code, e.ord::int,
           NULLIF(e.val->>'expenseCode', '')::int,
           e.val->>'expenseName',
           NULLIF(e.val->>'costCenterCode', '')::int,
           NULLIF(e.val->>'proratedPercentage', '')::numeric,
           NULLIF(e.val->>'proratedValue', '')::numeric
      FROM jsonb_array_elements(NEW.expense) WITH ORDINALITY AS e(val, ord);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ap_duplicates_touch ON accounts_payable_duplicates;
CREATE TRIGGER ap_duplicates_touch BEFORE UPDATE ON accounts_payable_duplicates
  FOR EACH ROW EXECUTE FUNCTION ap_duplicates_expense_sync();

DROP TRIGGER IF EXISTS ap_duplicates_expenses ON accounts_payable_duplicates;
CREATE TRIGGER ap_duplicates_expenses AFTER INSERT OR UPDATE ON accounts_payable_duplicates
  FOR EACH ROW EXECUTE FUNCTION ap_duplicates_expense_rows();

-- Comandos enviados pelo HeadCoach ao TOTVS (criação e agrupamento), com o
-- payload exato do CreatedDuplicateCommand / GroupDuplicatesCommand e a resposta.
CREATE TABLE IF NOT EXISTS accounts_payable_commands (
  id BIGSERIAL PRIMARY KEY,
  command TEXT NOT NULL CHECK (command IN ('create', 'group')),
  branch_cnpj TEXT,
  supplier_cpf_cnpj TEXT,
  duplicate_code BIGINT,
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
CREATE INDEX IF NOT EXISTS ap_cmd_dup_idx ON accounts_payable_commands (duplicate_code);
CREATE INDEX IF NOT EXISTS ap_cmd_data_idx ON accounts_payable_commands (criado_em DESC);

-- Visão com nomes do fornecedor e da empresa (para telas e conferência)
CREATE OR REPLACE VIEW accounts_payable_duplicates_v AS
SELECT d.*,
       p.nome AS supplier_name,
       e.descricao AS branch_name,
       e.propria AS branch_propria,
       (COALESCE(d.duplicate_value, 0) + COALESCE(d.fees_value, 0) - COALESCE(d.discount_value, 0) - COALESCE(d.paid_value, 0)) AS open_value
  FROM accounts_payable_duplicates d
  LEFT JOIN erp_pessoas p ON p.code = d.supplier_code
  LEFT JOIN erp_empresas e ON e.code = d.branch_code;

-- RLS: leitura para usuários autenticados; escrita só pelo backend (service_role)
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['accounts_payable_duplicates', 'accounts_payable_duplicate_expenses', 'accounts_payable_commands'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = 'erp_leitura_autenticado') THEN
      EXECUTE format('CREATE POLICY erp_leitura_autenticado ON %I FOR SELECT TO authenticated USING (true)', t);
    END IF;
  END LOOP;
END $$;

-- Controle do sync: cursor começa no marco 0 (00:00 de 17/10/2026, BRT = 03:00 UTC)
INSERT INTO erp_sync_controle (entidade, descricao, cursor_ate)
VALUES ('contas_pagar', 'Contas a pagar — duplicatas (accounts-payable/v2/duplicates)', '2026-10-17T03:00:00Z')
ON CONFLICT (entidade) DO NOTHING;
