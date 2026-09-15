-- Solicitações de baixa abertas automaticamente (BlueCard · Pix Pagar.me).
-- origem: quem abriu ('bluecard_pagarme'; NULL = pessoa pelo HeadCoach).
-- ref_externa: chave de idempotência ('pagarme:<cobranca_id>:<parcela_id>') —
-- reentrega do webhook não duplica a solicitação.
-- Rodar no SQL Editor do Supabase do HeadCoach (dorztqiunewggydvkjnf).

ALTER TABLE solicitacoes_baixa
  ADD COLUMN IF NOT EXISTS origem TEXT,
  ADD COLUMN IF NOT EXISTS ref_externa TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS ux_solicitacoes_baixa_ref_externa
  ON solicitacoes_baixa (ref_externa)
  WHERE ref_externa IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_solicitacoes_baixa_origem
  ON solicitacoes_baixa (origem)
  WHERE origem IS NOT NULL;
