-- Remapeamento manual de NF → vendedor para o replica do SQL oficial.
--
-- Contexto: o relatório SQL "0326 - Vendas por Vendedor Financeiro" do TOTVS
-- agrupa por CD_COMPVEND (vendedor da TRANSAÇÃO). A API REST do TOTVS só
-- expõe `dealerCode` do PRODUTO. Em raros casos esses dois divergem (ex.: NF
-- 12227 tem produto com dealer Arthur=259 mas a transação está atribuída ao
-- Rafael=21).
--
-- Esta tabela permite cadastrar essas exceções manualmente para o card
-- "Faturamento por Vendedor — Mensal" bater 100% com o relatório oficial.

CREATE TABLE IF NOT EXISTS forecast_vendedor_remap (
  id BIGSERIAL PRIMARY KEY,
  invoice_code BIGINT NOT NULL,
  branch_code INT NOT NULL,
  dealer_origem INT,                  -- dealer atualmente atribuído (informativo)
  dealer_destino INT,                 -- para onde o valor vai (NULL = excluir totalmente)
  razao TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (branch_code, invoice_code)
);
-- Migration retroativa: permite NULL em dealer_destino (significa "excluir essa NF do relatório")
ALTER TABLE forecast_vendedor_remap ALTER COLUMN dealer_destino DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_fvr_invoice ON forecast_vendedor_remap (invoice_code);

-- Seed do caso conhecido: NF 12227 em jun/2026 (R$ 4.772,00) atribuída ao
-- Arthur (259) no produto, mas o relatório oficial coloca no Rafael (21).
INSERT INTO forecast_vendedor_remap
  (invoice_code, branch_code, dealer_origem, dealer_destino, razao)
VALUES
  (12227, 99, 259, 21, 'PDF oficial jun/2026: vendedor da transação = Rafael (21), não Arthur (259)'),
  -- NF#11894 (R$ 1.431,08) atribuída ao Yago no produto mas o PDF NÃO inclui essa
  -- venda em nenhum vendedor. Provavelmente excluída por regra interna do SQL.
  (11894, 99, 241, NULL, 'PDF oficial jun/2026: NF não aparece no relatório (R$ 1.431,08 de Yago)'),
  -- NF#12365 (R$ 494,40) pra PSS TECNOLOGIA (provavelmente classificação franquia)
  -- atribuída ao Cleyton no produto mas o PDF NÃO inclui.
  (12365, 99, 161, NULL, 'PDF oficial jun/2026: NF não aparece no relatório (R$ 494,40 de Cleyton, cliente PSS TECNOLOGIA)')
ON CONFLICT (branch_code, invoice_code) DO NOTHING;
