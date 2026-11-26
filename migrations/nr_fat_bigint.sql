-- Faturas do HeadCoach são numeradas a partir de 9.000.000.000 (BASE_FATURA em
-- services/hcContasReceber.js) e não cabem em integer: a solicitação de baixa do
-- boleto do HeadCoach pago na Pagar.me não era gravada ("out of range for type
-- integer"). Só alarga o tipo (nenhum valor muda). BRUCE, aprovado pelo Yago em 26/11/2026.
--   node scripts/migrar-nr-fat-bigint.mjs
ALTER TABLE solicitacoes_baixa ALTER COLUMN nr_fat TYPE bigint;
ALTER TABLE solicitacoes_remessa_titulos ALTER COLUMN nr_fat TYPE bigint;
