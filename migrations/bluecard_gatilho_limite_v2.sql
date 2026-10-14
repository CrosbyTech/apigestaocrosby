-- Gatilho de limite v2 (14/10/2026) + correção da baixa Pagar.me.
-- Rodar no SQL Editor do Supabase do HeadCoach (dorztqiunewggydvkjnf).

-- 1) Filiais onde cada janela de limite foi aberta (o limite sobe só na filial
--    da compra / participantes, e o fechar restaura exatamente essas).
ALTER TABLE bluecard_liberacoes
  ADD COLUMN IF NOT EXISTS branch_codes JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS titulos_previos JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS limites_anteriores JSONB;

CREATE INDEX IF NOT EXISTS idx_bcl_cpf_status ON bluecard_liberacoes (cpf, status);

-- 2) Solicitações de baixa abertas por sistema não têm arquivo de comprovante
--    (o comprovante é o pedido Pagar.me, citado na observação). O NOT NULL
--    desta coluna rejeitou TODOS os 58 avisos pagamento.pix de 15/09 a 14/10.
ALTER TABLE solicitacoes_baixa
  ALTER COLUMN comprovante_url DROP NOT NULL;
