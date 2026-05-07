-- Migration: Criar tabela de histórico de observações para despesas manuais
-- Similar ao sistema de observações para despesas TOTVS, mas para despesas manuais

-- 1. Criar tabela de observações de despesas manuais (sistema de chat)
CREATE TABLE IF NOT EXISTS public.observacoes_despesas_manuais (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cd_usuario UUID NOT NULL REFERENCES auth.users(id),
  id_despesa_manual UUID NOT NULL REFERENCES public.despesas_manuais_dre(id) ON DELETE CASCADE,
  observacao TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Criar índice para otimizar consultas de histórico
CREATE INDEX IF NOT EXISTS idx_obs_manuais_historico 
ON public.observacoes_despesas_manuais(id_despesa_manual, is_active, created_at);

-- 3. Criar índice para buscar por usuário
CREATE INDEX IF NOT EXISTS idx_obs_manuais_usuario 
ON public.observacoes_despesas_manuais(cd_usuario);

-- 4. Habilitar Row Level Security (RLS)
ALTER TABLE public.observacoes_despesas_manuais ENABLE ROW LEVEL SECURITY;

-- 5. Criar política para permitir SELECT para usuários autenticados
CREATE POLICY "Usuários autenticados podem ver observações de despesas manuais"
ON public.observacoes_despesas_manuais
FOR SELECT
TO authenticated
USING (true);

-- 6. Criar política para permitir INSERT para usuários autenticados
CREATE POLICY "Usuários autenticados podem criar observações de despesas manuais"
ON public.observacoes_despesas_manuais
FOR INSERT
TO authenticated
WITH CHECK (cd_usuario = auth.uid());

-- 7. Criar política para permitir UPDATE apenas do próprio comentário
CREATE POLICY "Usuários podem atualizar suas próprias observações"
ON public.observacoes_despesas_manuais
FOR UPDATE
TO authenticated
USING (cd_usuario = auth.uid())
WITH CHECK (cd_usuario = auth.uid());

-- 8. Adicionar comentários explicativos
COMMENT ON TABLE public.observacoes_despesas_manuais IS 
'Histórico de observações (chat) para despesas manuais. Permite múltiplas observações por despesa com rastreamento de usuário e timestamp.';

COMMENT ON COLUMN public.observacoes_despesas_manuais.id IS 
'Identificador único da observação';

COMMENT ON COLUMN public.observacoes_despesas_manuais.cd_usuario IS 
'ID do usuário que criou a observação (FK para auth.users)';

COMMENT ON COLUMN public.observacoes_despesas_manuais.id_despesa_manual IS 
'ID da despesa manual (FK para despesas_manuais_dre)';

COMMENT ON COLUMN public.observacoes_despesas_manuais.observacao IS 
'Conteúdo da observação/comentário';

COMMENT ON COLUMN public.observacoes_despesas_manuais.is_active IS 
'Indica se a observação está ativa (suporta soft delete)';

COMMENT ON COLUMN public.observacoes_despesas_manuais.created_at IS 
'Data/hora de criação da observação';

COMMENT ON COLUMN public.observacoes_despesas_manuais.updated_at IS 
'Data/hora da última atualização da observação';

-- 9. Migrar observações existentes do campo observacoes para a nova tabela
INSERT INTO public.observacoes_despesas_manuais (cd_usuario, id_despesa_manual, observacao, created_at, updated_at)
SELECT 
  COALESCE(cd_usuario, (SELECT id FROM auth.users LIMIT 1)), -- Usar cd_usuario ou primeiro usuário como fallback
  id,
  observacoes,
  COALESCE(dt_cadastro, NOW()),
  COALESCE(dt_alteracao, dt_cadastro, NOW())
FROM public.despesas_manuais_dre
WHERE observacoes IS NOT NULL 
  AND observacoes != ''
  AND ativo = true;

-- 10. Comentário sobre o campo antigo (manter por compatibilidade temporária)
COMMENT ON COLUMN public.despesas_manuais_dre.observacoes IS 
'DEPRECIADO: Campo antigo de observações. Migrado para tabela observacoes_despesas_manuais. Manter por compatibilidade temporária.';
