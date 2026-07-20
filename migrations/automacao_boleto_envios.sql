-- ====================================================================
-- AUTOMAÇÃO FINANCEIRO — ENVIO DE BOLETOS POR WHATSAPP (UAzapi)
-- Fila + log de disparos de boleto para clientes.
--
-- Fluxo:
--   1) Planner (09h seg-sex) consulta contas a receber, seleciona Faturas
--      (documentType=1) NORMAIS em aberto que vencem em D-3 ou D-0, e
--      insere 1 linha 'pendente' por fatura, com scheduled_at espaçado
--      (2-3 min entre cada) para evitar banimento do número.
--   2) Worker (a cada minuto) pega a próxima 'pendente' vencida, RE-CHECA
--      no TOTVS se está paga/cancelada, gera o PDF, e envia via UAzapi.
--   3) A página "Automação Financeiro" (owner) lê esta tabela como log.
-- ====================================================================

CREATE TABLE IF NOT EXISTS automacao_boleto_envios (
  id               BIGSERIAL PRIMARY KEY,
  -- dia de referência do disparo (data em que o planner rodou, fuso BRT)
  data_ref         DATE NOT NULL,
  -- 'D-3' (vence em 3 dias) | 'D-0' (vence hoje)
  tipo             VARCHAR(8) NOT NULL,

  -- identificação da fatura no TOTVS
  cd_empresa       INTEGER,
  cd_cliente       INTEGER,
  nome_cliente     TEXT,
  telefone         TEXT,
  nr_fatura        TEXT,
  nr_parcela       TEXT,

  -- dados do título (snapshot no momento do planejamento)
  vl_fatura        NUMERIC(14,2),
  dt_emissao       DATE,
  dt_vencimento    DATE,
  linha_digitavel  TEXT,

  -- status do disparo:
  --   'pendente'             — na fila, aguardando janela de envio
  --   'enviado'              — PDF entregue com sucesso via UAzapi
  --   'falha'                — erro no envio após tentativas
  --   'pulado_pago'          — re-check detectou pagamento → não enviado
  --   'pulado_cancelado'     — re-check detectou cancelamento → não enviado
  --   'pulado_sem_telefone'  — cliente sem telefone cadastrado
  --   'pulado_sem_boleto'    — fatura sem linha digitável (boleto) no TOTVS
  status           VARCHAR(24) NOT NULL DEFAULT 'pendente',
  erro             TEXT,
  -- texto exato (legenda) que foi enviado ao cliente
  conteudo_enviado TEXT,
  tentativas       INTEGER NOT NULL DEFAULT 0,
  -- modo teste: se preenchido, o envio foi REDIRECIONADO para este número
  -- (BOLETO_COBRANCA_TEST_PHONE) em vez do telefone real do cliente
  redirecionado_para TEXT,

  scheduled_at     TIMESTAMPTZ,
  enviado_em       TIMESTAMPTZ,
  criado_em        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- 1 disparo por fatura/parcela por dia/tipo (evita duplicidade)
  CONSTRAINT uq_boleto_envio
    UNIQUE (data_ref, tipo, cd_empresa, cd_cliente, nr_fatura, nr_parcela)
);

-- Worker: buscar a próxima pendente já vencida
CREATE INDEX IF NOT EXISTS idx_boleto_envios_fila
  ON automacao_boleto_envios(status, scheduled_at)
  WHERE status = 'pendente';

-- Página de log: listar por dia
CREATE INDEX IF NOT EXISTS idx_boleto_envios_data
  ON automacao_boleto_envios(data_ref DESC, criado_em DESC);

COMMENT ON TABLE automacao_boleto_envios IS
  'Fila e log de disparos de boleto por WhatsApp (Automação Financeiro)';
