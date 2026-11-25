-- HEADCOACH › CONTAS A PAGAR: marca de escrituração da nota fiscal na duplicata.
-- Pedido do Yago (25/11/2026): a solicitação com nota fiscal não fica mais travada
-- esperando a escrituração; ela vai para o contas a pagar e a duplicata mostra que a
-- nota ainda não foi escriturada. O status pode ser trocado na tela.
--   escrituracao: null = não se aplica · 'pendente' = não escriturada · 'escriturada'
--   escrituracao_por: quem trocou por último (vazio = veio da solicitação e ninguém mexeu;
--   só nesse caso o chamado de escrituração concluído atualiza a marca sozinho)
-- Só acréscimos: pode rodar de novo.
ALTER TABLE hc_cp_titulos ADD COLUMN IF NOT EXISTS escrituracao TEXT;
ALTER TABLE hc_cp_titulos ADD COLUMN IF NOT EXISTS escrituracao_em TIMESTAMPTZ;
ALTER TABLE hc_cp_titulos ADD COLUMN IF NOT EXISTS escrituracao_por TEXT;
ALTER TABLE hc_cp_titulos DROP CONSTRAINT IF EXISTS hc_cp_titulos_escrituracao_check;
ALTER TABLE hc_cp_titulos ADD CONSTRAINT hc_cp_titulos_escrituracao_check CHECK (escrituracao IS NULL OR escrituracao IN ('pendente', 'escriturada'));
CREATE INDEX IF NOT EXISTS idx_hc_cp_titulos_escrituracao ON hc_cp_titulos (escrituracao) WHERE escrituracao IS NOT NULL;
