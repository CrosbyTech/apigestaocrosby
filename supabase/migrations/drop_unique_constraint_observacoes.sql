-- Migration: Remover constraint UNIQUE para permitir múltiplas observações (sistema de chat)
-- A constraint antiga impedia que múltiplos comentários fossem criados para a mesma despesa

-- 1. Dropar a constraint UNIQUE que está impedindo múltiplas observações
ALTER TABLE public.observacoes_despesas_totvs 
DROP CONSTRAINT IF EXISTS idx_obs_totvs_unique;

-- 2. Dropar índice único se existir (geralmente criado junto com a constraint)
DROP INDEX IF EXISTS public.idx_obs_totvs_unique;

-- Confirmação via comentário
COMMENT ON TABLE public.observacoes_despesas_totvs IS 
'Tabela de observações de despesas TOTVS. Suporta múltiplas observações por despesa (sistema de chat). Constraint unique removida para permitir histórico de comentários.';
