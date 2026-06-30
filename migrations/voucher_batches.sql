-- Histórico de batches de vouchers criados via /tecnologia/criar-vouchers.
-- Salva configuração + resultados (cliente, voucherNumber, voucherCode, status)
-- pra consulta posterior, re-disparo manual e análise de falhas.

CREATE TABLE IF NOT EXISTS voucher_batches (
  id BIGSERIAL PRIMARY KEY,
  branch_code_registration INT NOT NULL,
  voucher_type INT NOT NULL DEFAULT 1,
  prefix_code TEXT NOT NULL,
  print_template_code INT NOT NULL DEFAULT 1,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  percentage NUMERIC(5, 2) NOT NULL,
  voucher_branches JSONB,         -- array de branchCodes onde voucher é válido
  origem TEXT NOT NULL,           -- 'totvs' | 'csv'
  total_clientes INT NOT NULL DEFAULT 0,
  sucessos INT NOT NULL DEFAULT 0,
  falhas INT NOT NULL DEFAULT 0,
  resultados JSONB NOT NULL,      -- array de { customerCode, success, voucherNumber, voucherCode, error }
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_voucher_batches_created_at ON voucher_batches (created_at DESC);
