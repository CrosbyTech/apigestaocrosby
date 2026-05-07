-- Migration: Habilitar Realtime para observações (chat em tempo real)
-- Permite que mudanças nas tabelas sejam transmitidas em tempo real para clientes conectados

-- ⚠️ ATENÇÃO: Execute SOMENTE APÓS executar create_observacoes_despesas_manuais.sql
-- A tabela observacoes_despesas_manuais DEVE EXISTIR antes de executar esta migration!

-- 1. Habilitar Realtime para observações TOTVS
ALTER PUBLICATION supabase_realtime ADD TABLE public.observacoes_despesas_totvs;

-- 2. Habilitar Realtime para observações de Despesas Manuais
-- NOTA: A tabela observacoes_despesas_manuais tem FK para despesas_manuais_dre
ALTER PUBLICATION supabase_realtime ADD TABLE public.observacoes_despesas_manuais;

-- 3. Comentários explicativos
COMMENT ON TABLE public.observacoes_despesas_totvs IS 
'Tabela de observações de despesas TOTVS. Suporta múltiplas observações por despesa (sistema de chat). REALTIME HABILITADO para atualizações em tempo real.';

COMMENT ON TABLE public.observacoes_despesas_manuais IS 
'Histórico de observações (chat) para despesas manuais (despesas_manuais_dre). Permite múltiplas observações por despesa. REALTIME HABILITADO para atualizações em tempo real.';
