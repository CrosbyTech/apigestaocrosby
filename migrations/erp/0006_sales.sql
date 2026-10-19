-- ============================================================================
-- ERP HeadCoach — Fase 1: VENDAS no formato da API TOTVS v2
--
--   general/v2/transactions/search (GET)  → general_transactions (+ _items, _installments por trigger)
--   person/v2/list-balance-bonus          → person_balance_bonus (saldo de bônus/cashback por CPF × empresa)
--   voucher/v2/search (GET)               → vouchers
--   escritas do HeadCoach no TOTVS        → general_transaction_commands, person_bonus_commands, voucher_commands
--   vendas_v                              → transações do TOTVS + vendas do PDV no modo HeadCoach
--
-- Nomes de coluna = campo da API em snake_case. Todas as 290 empresas.
-- Transações de TODAS as operações (venda, troca, transferência, entrada...):
-- a operação diz o que é cada uma (erp_operacoes).
-- Marco 0 = 17/10/2026 00:00 BRT. Idempotente.
-- ============================================================================

ALTER TABLE erp_sync_controle ADD COLUMN IF NOT EXISTS checkpoint JSONB;

-- ─── Transações ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS general_transactions (
  branch_code INT NOT NULL,
  transaction_code BIGINT NOT NULL,
  transaction_date DATE,
  customer_code BIGINT,
  representative_code INT,
  lastchange_date TIMESTAMP,
  operation_code INT,
  seller_code INT,
  guide_code INT,
  payment_condition_code INT,
  price_table_code INT,
  status INT,                     -- 1 em andamento · 2 encerrada · 4 atendida · 5 · 6 cancelada
  gross_amount_value NUMERIC(15, 2),
  total_value NUMERIC(15, 2),
  discount_value NUMERIC(15, 2),
  max_change_filter_date TIMESTAMP,
  classifications JSONB,
  items JSONB,
  origin_destination JSONB,
  additional_information JSONB,
  installment JSONB,
  settlement_code JSONB,
  modality JSONB,
  transaction_type JSONB,
  related_fiscal_document JSONB,
  origem TEXT NOT NULL DEFAULT 'totvs' CHECK (origem IN ('totvs', 'headcoach')),
  dados JSONB,
  primeira_vez_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  sincronizado_em TIMESTAMPTZ,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (branch_code, transaction_code)
);
CREATE INDEX IF NOT EXISTS gt_date_idx ON general_transactions (transaction_date);
CREATE INDEX IF NOT EXISTS gt_customer_idx ON general_transactions (customer_code);
CREATE INDEX IF NOT EXISTS gt_seller_idx ON general_transactions (seller_code);
CREATE INDEX IF NOT EXISTS gt_operation_idx ON general_transactions (operation_code, status);
CREATE INDEX IF NOT EXISTS gt_change_idx ON general_transactions (max_change_filter_date);
CREATE INDEX IF NOT EXISTS gt_sync_idx ON general_transactions (sincronizado_em);

CREATE TABLE IF NOT EXISTS general_transaction_items (
  branch_code INT NOT NULL,
  transaction_code BIGINT NOT NULL,
  sequence INT NOT NULL,
  product_code BIGINT,
  measured_unit TEXT,
  quantity NUMERIC(15, 4),
  value NUMERIC(15, 2),
  unit_discount_value NUMERIC(15, 2),
  net_value NUMERIC(15, 2),
  seller_code INT,
  additional_item JSONB,
  promotional_engines JSONB,
  commissions JSONB,
  scanned_barcodes JSONB,
  PRIMARY KEY (branch_code, transaction_code, sequence),
  FOREIGN KEY (branch_code, transaction_code)
    REFERENCES general_transactions (branch_code, transaction_code) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS gti_product_idx ON general_transaction_items (product_code);

CREATE TABLE IF NOT EXISTS general_transaction_installments (
  branch_code INT NOT NULL,
  transaction_code BIGINT NOT NULL,
  sequence INT NOT NULL,
  installment_number INT,
  due_date DATE,
  installment_value NUMERIC(15, 2),
  dados JSONB,
  PRIMARY KEY (branch_code, transaction_code, sequence),
  FOREIGN KEY (branch_code, transaction_code)
    REFERENCES general_transactions (branch_code, transaction_code) ON DELETE CASCADE
);

CREATE OR REPLACE FUNCTION gt_before_update() RETURNS TRIGGER AS $$
BEGIN
  NEW.atualizado_em = now();
  NEW.max_change_filter_date = COALESCE(NEW.max_change_filter_date, OLD.max_change_filter_date);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION gt_child_rows() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.items IS DISTINCT FROM OLD.items THEN
    DELETE FROM general_transaction_items WHERE branch_code = NEW.branch_code AND transaction_code = NEW.transaction_code;
    IF jsonb_typeof(NEW.items) = 'array' THEN
      INSERT INTO general_transaction_items
        (branch_code, transaction_code, sequence, product_code, measured_unit, quantity, value,
         unit_discount_value, net_value, seller_code, additional_item, promotional_engines, commissions, scanned_barcodes)
      SELECT NEW.branch_code, NEW.transaction_code, e.ord::int,
             NULLIF(e.val->>'productCode', '')::bigint,
             btrim(e.val->>'measuredUnit'),
             NULLIF(e.val->>'quantity', '')::numeric,
             NULLIF(e.val->>'value', '')::numeric,
             NULLIF(e.val->>'unitDiscountValue', '')::numeric,
             NULLIF(e.val->>'netValue', '')::numeric,
             NULLIF(e.val->>'sellerCode', '')::int,
             e.val->'additionalItem', e.val->'promotionalEngines', e.val->'commissions', e.val->'scannedBarcodes'
        FROM jsonb_array_elements(NEW.items) WITH ORDINALITY AS e(val, ord);
    END IF;
  END IF;
  IF TG_OP = 'INSERT' OR NEW.installment IS DISTINCT FROM OLD.installment THEN
    DELETE FROM general_transaction_installments WHERE branch_code = NEW.branch_code AND transaction_code = NEW.transaction_code;
    IF jsonb_typeof(NEW.installment) = 'array' THEN
      INSERT INTO general_transaction_installments
        (branch_code, transaction_code, sequence, installment_number, due_date, installment_value, dados)
      SELECT NEW.branch_code, NEW.transaction_code, e.ord::int,
             NULLIF(e.val->>'installmentNumber', '')::int,
             NULLIF(left(e.val->>'dueDate', 10), '')::date,
             NULLIF(e.val->>'installmentValue', '')::numeric,
             e.val
        FROM jsonb_array_elements(NEW.installment) WITH ORDINALITY AS e(val, ord);
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS gt_before_update ON general_transactions;
CREATE TRIGGER gt_before_update BEFORE UPDATE ON general_transactions FOR EACH ROW EXECUTE FUNCTION gt_before_update();
DROP TRIGGER IF EXISTS gt_child_rows ON general_transactions;
CREATE TRIGGER gt_child_rows AFTER INSERT OR UPDATE ON general_transactions FOR EACH ROW EXECUTE FUNCTION gt_child_rows();

CREATE TABLE IF NOT EXISTS general_transaction_commands (
  id BIGSERIAL PRIMARY KEY,
  command TEXT NOT NULL CHECK (command IN ('transactions', 'transaction-receiving')),
  branch_code INT,
  transaction_code BIGINT,
  transaction_date DATE,
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
CREATE INDEX IF NOT EXISTS gtc_tx_idx ON general_transaction_commands (branch_code, transaction_code);
CREATE INDEX IF NOT EXISTS gtc_data_idx ON general_transaction_commands (criado_em DESC);

CREATE OR REPLACE VIEW general_transactions_v AS
SELECT t.*,
       p.nome AS customer_name,
       e.descricao AS branch_name,
       e.propria AS branch_propria,
       o.descricao AS operation_name,
       o.tipo AS operation_type,
       v.nome AS seller_name
  FROM general_transactions t
  LEFT JOIN erp_pessoas p ON p.code = t.customer_code
  LEFT JOIN erp_empresas e ON e.code = t.branch_code
  LEFT JOIN erp_operacoes o ON o.code = t.operation_code
  LEFT JOIN erp_vendedores v ON v.code = t.seller_code;

-- Lista única de vendas: transações do TOTVS + vendas do PDV no modo HeadCoach
CREATE OR REPLACE VIEW vendas_v AS
SELECT 'totvs'::text AS origem,
       t.branch_code,
       t.branch_name,
       t.transaction_code::text AS venda,
       t.transaction_date AS data,
       t.customer_code,
       t.customer_name,
       t.seller_code,
       t.seller_name,
       t.operation_code,
       t.operation_name,
       t.operation_type,
       t.status::text AS status,
       t.gross_amount_value,
       t.discount_value,
       t.total_value,
       NULL::bigint AS pdv_venda_id
  FROM general_transactions_v t
UNION ALL
SELECT 'headcoach'::text,
       v.empresa,
       v.empresa_nome,
       'PDV-' || v.id,
       (v.criado_em AT TIME ZONE 'America/Recife')::date,
       v.cliente_code,
       v.cliente_nome,
       v.vendedor_code,
       v.vendedor_nome,
       v.operacao,
       o.descricao,
       o.tipo,
       v.status,
       v.subtotal,
       v.desconto,
       v.total,
       v.id
  FROM pdv_vendas v
  LEFT JOIN erp_operacoes o ON o.code = v.operacao;

-- ─── Saldo de bônus / cashback (person/v2/list-balance-bonus) ──────────────
-- A API só consulta por CPF; cada consulta cobre as 290 empresas.
-- Guardamos só empresas com saldo ≠ 0; a consulta em si fica em _checks.
CREATE TABLE IF NOT EXISTS person_balance_bonus (
  person_cpf TEXT NOT NULL,
  branch_code INT NOT NULL,
  branch_cnpj TEXT,
  balance_value NUMERIC(15, 2) NOT NULL,
  person_code BIGINT,
  consultado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (person_cpf, branch_code)
);
CREATE INDEX IF NOT EXISTS pbb_person_idx ON person_balance_bonus (person_code);
CREATE INDEX IF NOT EXISTS pbb_branch_idx ON person_balance_bonus (branch_code);

CREATE TABLE IF NOT EXISTS person_balance_bonus_checks (
  person_cpf TEXT PRIMARY KEY,
  person_code BIGINT,
  total_balance NUMERIC(15, 2),
  branches_with_balance INT,
  consultado_em TIMESTAMPTZ,
  motivo TEXT,                    -- carga | venda | revalidacao | comando
  erro TEXT
);
CREATE INDEX IF NOT EXISTS pbbc_saldo_idx ON person_balance_bonus_checks (consultado_em) WHERE total_balance <> 0;
CREATE INDEX IF NOT EXISTS pbbc_person_idx ON person_balance_bonus_checks (person_code);

CREATE OR REPLACE VIEW person_balance_bonus_v AS
SELECT b.*, p.nome AS person_name, e.descricao AS branch_name
  FROM person_balance_bonus b
  LEFT JOIN erp_pessoas p ON p.code = b.person_code
  LEFT JOIN erp_empresas e ON e.code = b.branch_code;

CREATE TABLE IF NOT EXISTS person_bonus_commands (
  id BIGSERIAL PRIMARY KEY,
  command TEXT NOT NULL CHECK (command IN ('bonus-consume', 'bonus-due-date')),
  person_code BIGINT,
  branch_code INT,
  value NUMERIC(15, 2),
  payload JSONB NOT NULL,
  sucesso BOOLEAN,
  http_status INT,
  resposta JSONB,
  erro TEXT,
  usuario TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pbc_person_idx ON person_bonus_commands (person_code);

-- ─── Vouchers (voucher/v2/search) ──────────────────────────────────────────
-- A API ignora filtro de alteração: o job baixa a lista inteira (≈51 mil,
-- 1.000 por página) e marca removido_em no que deixou de vir.
CREATE TABLE IF NOT EXISTS vouchers (
  voucher_number BIGINT PRIMARY KEY,
  description TEXT,
  prefix_code TEXT,
  voucher_code TEXT,
  voucher_type INT,
  status INT,                     -- 1 em andamento · 4 encerrado · 6 cancelado
  value NUMERIC(15, 2),
  percentage NUMERIC(9, 4),
  start_date TIMESTAMP,
  end_date TIMESTAMP,
  inclusion_date TIMESTAMP,
  customer_code BIGINT,
  customer_name TEXT,
  partner_code BIGINT,
  partner_name TEXT,
  closing_date TIMESTAMP,
  integration_code TEXT,
  print_template_code INT,
  quantity NUMERIC(15, 4),
  branchs JSONB,
  filters JSONB,
  triggers JSONB,
  removido_em TIMESTAMPTZ,
  origem TEXT NOT NULL DEFAULT 'totvs' CHECK (origem IN ('totvs', 'headcoach')),
  dados JSONB,
  primeira_vez_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  sincronizado_em TIMESTAMPTZ,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vouchers_customer_idx ON vouchers (customer_code);
CREATE INDEX IF NOT EXISTS vouchers_status_idx ON vouchers (status, end_date);
CREATE INDEX IF NOT EXISTS vouchers_code_idx ON vouchers (voucher_code);

CREATE OR REPLACE FUNCTION vouchers_touch() RETURNS TRIGGER AS $$
BEGIN
  NEW.atualizado_em = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS vouchers_touch ON vouchers;
CREATE TRIGGER vouchers_touch BEFORE UPDATE ON vouchers FOR EACH ROW EXECUTE FUNCTION vouchers_touch();

CREATE TABLE IF NOT EXISTS voucher_commands (
  id BIGSERIAL PRIMARY KEY,
  command TEXT NOT NULL CHECK (command IN ('create', 'update', 'customer/create')),
  voucher_number BIGINT,
  customer_code BIGINT,
  payload JSONB NOT NULL,
  sucesso BOOLEAN,
  http_status INT,
  resposta JSONB,
  erro TEXT,
  usuario TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vc_voucher_idx ON voucher_commands (voucher_number);

-- ─── RLS ───────────────────────────────────────────────────────────────────
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'general_transactions', 'general_transaction_items', 'general_transaction_installments', 'general_transaction_commands',
    'person_balance_bonus', 'person_balance_bonus_checks', 'person_bonus_commands', 'vouchers', 'voucher_commands'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = 'erp_leitura_autenticado') THEN
      EXECUTE format('CREATE POLICY erp_leitura_autenticado ON %I FOR SELECT TO authenticated USING (true)', t);
    END IF;
  END LOOP;
END $$;

INSERT INTO erp_sync_controle (entidade, descricao, cursor_ate) VALUES
  ('transacoes', 'Transações — todas as empresas e operações (general/v2/transactions)', '2026-10-17T03:00:00Z'),
  ('bonus_saldo', 'Saldo de bônus/cashback por CPF (person/v2/list-balance-bonus)', '2026-10-17T03:00:00Z'),
  ('vouchers', 'Vouchers (voucher/v2/search)', NULL)
ON CONFLICT (entidade) DO NOTHING;
