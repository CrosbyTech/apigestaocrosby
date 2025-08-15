-- =====================================================
-- OTIMIZAÇÃO DE PERFORMANCE - CONTAS A PAGAR
-- =====================================================
-- Índices recomendados para melhorar a performance da consulta
-- Execute estes comandos no banco de dados para otimizar as consultas

-- 1. Índice principal na tabela vr_fcp_duplicatai (tabela principal)
CREATE INDEX IF NOT EXISTS idx_vr_fcp_duplicatai_empresa_vencimento 
ON vr_fcp_duplicatai (cd_empresa, dt_vencimento DESC);

-- 2. Índice composto para JOIN com vr_fcp_despduplicatai
CREATE INDEX IF NOT EXISTS idx_vr_fcp_duplicatai_nr_duplicata 
ON vr_fcp_duplicatai (nr_duplicata);

-- 3. Índice na tabela vr_fcp_despduplicatai para JOIN
CREATE INDEX IF NOT EXISTS idx_vr_fcp_despduplicatai_nr_duplicata 
ON vr_fcp_despduplicatai (nr_duplicata);

-- 4. Índice na tabela obs_dupi para JOIN composto
CREATE INDEX IF NOT EXISTS idx_obs_dupi_duplicata_fornecedor 
ON obs_dupi (nr_duplicata, cd_fornecedor);

-- 5. Índice na tabela fcp_despesaitem
CREATE INDEX IF NOT EXISTS idx_fcp_despesaitem_cd_despesaitem 
ON fcp_despesaitem (cd_despesaitem);

-- 6. Índice na tabela vr_pes_fornecedor
CREATE INDEX IF NOT EXISTS idx_vr_pes_fornecedor_cd_fornecedor 
ON vr_pes_fornecedor (cd_fornecedor);

-- 7. Índice na tabela gec_ccusto
CREATE INDEX IF NOT EXISTS idx_gec_ccusto_cd_ccusto 
ON gec_ccusto (cd_ccusto);

-- 8. Índice adicional para filtros por situação e estágio
CREATE INDEX IF NOT EXISTS idx_vr_fcp_duplicatai_situacao_estagio 
ON vr_fcp_duplicatai (tp_situacao, tp_estagio);

-- 9. Índice para consultas por fornecedor
CREATE INDEX IF NOT EXISTS idx_vr_fcp_duplicatai_fornecedor 
ON vr_fcp_duplicatai (cd_fornecedor);

-- 10. Índice para consultas por data de liquidação
CREATE INDEX IF NOT EXISTS idx_vr_fcp_duplicatai_dt_liq 
ON vr_fcp_duplicatai (dt_liq DESC);

-- =====================================================
-- ANÁLISE DE PERFORMANCE
-- =====================================================

-- Para verificar se os índices estão sendo utilizados:
-- EXPLAIN ANALYZE SELECT ... (sua query aqui)

-- Para verificar estatísticas das tabelas:
-- ANALYZE vr_fcp_duplicatai;
-- ANALYZE vr_fcp_despduplicatai;
-- ANALYZE obs_dupi;
-- ANALYZE fcp_despesaitem;
-- ANALYZE vr_pes_fornecedor;
-- ANALYZE gec_ccusto;

-- =====================================================
-- RECOMENDAÇÕES ADICIONAIS
-- =====================================================

-- 1. Particionamento por data (se a tabela for muito grande):
-- CREATE TABLE vr_fcp_duplicatai_2025 PARTITION OF vr_fcp_duplicatai
-- FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');

-- 2. Materialização de views frequentes:
-- CREATE MATERIALIZED VIEW mv_contas_pagar_resumo AS
-- SELECT cd_empresa, dt_vencimento, COUNT(*), SUM(vl_duplicata)
-- FROM vr_fcp_duplicatai
-- GROUP BY cd_empresa, dt_vencimento;

-- 3. Configurações do PostgreSQL para melhor performance:
-- shared_buffers = 25% da RAM
-- effective_cache_size = 75% da RAM
-- work_mem = 4MB (ajustar conforme necessidade)
-- maintenance_work_mem = 256MB

-- =====================================================
-- MONITORAMENTO DE PERFORMANCE
-- =====================================================

-- Query para monitorar performance:
/*
SELECT 
    schemaname,
    tablename,
    attname,
    n_distinct,
    correlation
FROM pg_stats 
WHERE tablename IN ('vr_fcp_duplicatai', 'vr_fcp_despduplicatai', 'obs_dupi')
ORDER BY tablename, attname;
*/

-- Query para verificar uso de índices:
/*
SELECT 
    schemaname,
    tablename,
    indexname,
    idx_scan,
    idx_tup_read,
    idx_tup_fetch
FROM pg_stat_user_indexes 
WHERE tablename IN ('vr_fcp_duplicatai', 'vr_fcp_despduplicatai', 'obs_dupi')
ORDER BY idx_scan DESC;
*/ 