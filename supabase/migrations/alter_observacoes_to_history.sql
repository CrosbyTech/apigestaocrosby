-- Alterar tabela de observações para suportar histórico de comentários
-- Cada linha será um comentário individual no histórico

-- Adicionar campo para identificar se é o comentário mais recente
ALTER TABLE public.observacoes_despesas_totvs 
ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

-- Adicionar índice para buscar histórico completo
CREATE INDEX IF NOT EXISTS idx_observacoes_historico 
ON public.observacoes_despesas_totvs (cd_empresa, cd_despesaitem, cd_fornecedor, nr_duplicata, nr_parcela, dt_inicio, dt_fim, created_at DESC);

-- Comentário
COMMENT ON COLUMN public.observacoes_despesas_totvs.is_active IS 'Indica se este comentário está ativo (não deletado)';
