-- Faturamento histórico por transação (NF) — mirror da planilha "Crescimento 24x25.xlsx" aba "Base 2425"
-- Uma linha por NF (não agregado). Mantém todos os campos relevantes da planilha.
CREATE TABLE IF NOT EXISTS faturamento_transacao_historico (
  id BIGSERIAL PRIMARY KEY,
  loja TEXT,                                -- Grupoempresa (ex: "Crosby Cascavel - CE")
  data_transacao DATE NOT NULL,             -- Dt. Transacao
  cod_cliente INTEGER,                      -- Cod. Cliente
  cliente_nome TEXT,                        -- CLIENTE
  tipo_cliente TEXT,                        -- Ds. Tipo Cliente (raw: VAREJO/FRANQUIA/etc)
  canal TEXT NOT NULL,                      -- Canal mapeado (varejo/franquia/multimarcas/...)
  dt_cadastro DATE,                         -- Dt. Cadastro
  vl_fat NUMERIC(14,2) NOT NULL DEFAULT 0,  -- VL.FAT.
  credev NUMERIC(14,2) NOT NULL DEFAULT 0,  -- CREDEV
  total NUMERIC(14,2) NOT NULL DEFAULT 0,   -- Total (líquido = vl_fat - credev)
  cidade_uf TEXT,                           -- CIDADE/UF
  fone TEXT,                                -- Fone
  observacao TEXT,                          -- Obs
  origem TEXT NOT NULL DEFAULT 'manual',    -- 'planilha-import' | 'totvs-sync' | 'manual'
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fth_data ON faturamento_transacao_historico (data_transacao);
CREATE INDEX IF NOT EXISTS idx_fth_canal_data ON faturamento_transacao_historico (canal, data_transacao);
CREATE INDEX IF NOT EXISTS idx_fth_cliente ON faturamento_transacao_historico (cod_cliente);
CREATE INDEX IF NOT EXISTS idx_fth_ano_mes
  ON faturamento_transacao_historico ((EXTRACT(YEAR FROM data_transacao)), (EXTRACT(MONTH FROM data_transacao)));
