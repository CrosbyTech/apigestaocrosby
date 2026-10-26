-- ============================================================================
-- BOT STONE EXTRATOS — antecipável por conta + comprovantes de saída
--
-- 1) stone_bot_saldos.saldo_antecipavel: valor líquido disponível para
--    antecipar (serviço prepayment da Stone, somado por CNPJ).
-- 2) fluxo_caixa_comprovantes: comprovante (PDF) de cada saída do extrato,
--    baixado do portal pelo bot e guardado no bucket extratos-bancarios.
--    A chave é a mesma das conciliações (conta|data|valor|hash(memo)|n), porque
--    os ids de lançamento mudam a cada reimportação.
-- ============================================================================
ALTER TABLE stone_bot_saldos ADD COLUMN IF NOT EXISTS saldo_antecipavel NUMERIC(14,2);
ALTER TABLE stone_bot_saldos ADD COLUMN IF NOT EXISTS antecipavel_detalhe JSONB; -- [{stonecode, chave, liquido, bruto}]
COMMENT ON COLUMN stone_bot_saldos.saldo_antecipavel IS 'Stone: valor líquido disponível para antecipação (prepayment financial-position, soma das maquininhas do CNPJ)';

CREATE TABLE IF NOT EXISTS fluxo_caixa_comprovantes (
  id              BIGSERIAL PRIMARY KEY,
  conta_id        BIGINT      NOT NULL REFERENCES fluxo_caixa_contas(id) ON DELETE CASCADE,
  chave           TEXT        NOT NULL,                 -- conta|data|valor|sha1(memo)[10]|n (igual fluxo_caixa_conciliacoes.chave)
  data            DATE        NOT NULL,
  valor           NUMERIC(14,2) NOT NULL,
  memo            TEXT,
  stone_entry_id  TEXT,                                 -- id do lançamento na API do portal
  stone_tipo      TEXT,                                 -- outbound_pix_payment | internal | external | payment …
  arquivo_path    TEXT        NOT NULL,                 -- bucket extratos-bancarios
  arquivo_nome    TEXT,
  origem          TEXT        NOT NULL DEFAULT 'bot-stone',
  execucao_id     BIGINT REFERENCES stone_bot_execucoes(id) ON DELETE SET NULL,
  solicitacao_id  UUID,                                 -- preenchido quando o comprovante foi anexado a uma Solicitação Crosby
  solicitacao_em  TIMESTAMPTZ,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (chave)
);
CREATE INDEX IF NOT EXISTS idx_fc_comprov_conta_data ON fluxo_caixa_comprovantes (conta_id, data);
CREATE INDEX IF NOT EXISTS idx_fc_comprov_entry ON fluxo_caixa_comprovantes (stone_entry_id);
COMMENT ON TABLE fluxo_caixa_comprovantes IS 'Comprovantes de saída (PDF do portal Stone) baixados pelo bot, ligados ao lançamento pela chave estável.';
