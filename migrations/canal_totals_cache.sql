-- Cache de canal-totals do TOTVS, pra alimentar o Dashboard Vendas instantâneo.
-- Atualizado por cron a cada 1h pelos períodos comuns (este mês, mês passado).
-- Resolve divergência fiscal/invoices vs sale-panel/totals do TOTVS.

CREATE TABLE IF NOT EXISTS canal_totals_cache (
  cache_key TEXT NOT NULL,           -- ex: 'mes-atual', 'mes-passado', '2026-06', etc.
  canal TEXT NOT NULL,
  datemin DATE NOT NULL,
  datemax DATE NOT NULL,
  valor_liquido NUMERIC NOT NULL DEFAULT 0,
  valor_bruto NUMERIC NOT NULL DEFAULT 0,
  credev NUMERIC NOT NULL DEFAULT 0,
  invoice_qty INTEGER NOT NULL DEFAULT 0,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (cache_key, canal)
);

CREATE INDEX IF NOT EXISTS idx_canal_totals_cache_range
  ON canal_totals_cache(datemin, datemax);
