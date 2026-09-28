-- ============================================================================
-- PDV CROSBY v2
--  1) Operações fiscais por empresa (NFCE / NFE / TROCA) na configuração,
--     substituindo a regra fixa que estava no frontend.
--  2) pdv_epc_movimentos — rastreio de cada etiqueta RFID vendida, devolvida
--     ou estornada por cancelamento.
-- Idempotente: pode rodar várias vezes.
-- ============================================================================

-- ─── 1) Operações por empresa ───────────────────────────────────────────────
ALTER TABLE pdv_fiscal_config ADD COLUMN IF NOT EXISTS operacao_nfce INT;
ALTER TABLE pdv_fiscal_config ADD COLUMN IF NOT EXISTS operacao_nfe INT;
ALTER TABLE pdv_fiscal_config ADD COLUMN IF NOT EXISTS operacao_troca INT;
-- Apelido da loja só para leitura na tela de administração
ALTER TABLE pdv_fiscal_config ADD COLUMN IF NOT EXISTS empresa_nome TEXT;

-- Semeia as operações com a regra que estava fixa no código:
--   empresas 1..99 → NFCE 510, NFE 521, TROCA 1
--   empresas 95 e 98 → NFCE 545, NFE 548, TROCA 555
UPDATE pdv_fiscal_config
   SET operacao_nfce  = COALESCE(operacao_nfce,  CASE WHEN empresa IN (95, 98) THEN 545 ELSE 510 END),
       operacao_nfe   = COALESCE(operacao_nfe,   CASE WHEN empresa IN (95, 98) THEN 548 ELSE 521 END),
       operacao_troca = COALESCE(operacao_troca, CASE WHEN empresa IN (95, 98) THEN 555 ELSE 1   END)
 WHERE empresa BETWEEN 1 AND 99;

-- ─── 2) Movimentação de EPC (etiquetas RFID) ────────────────────────────────
CREATE TABLE IF NOT EXISTS pdv_epc_movimentos (
  id BIGSERIAL PRIMARY KEY,
  epc TEXT NOT NULL,
  -- venda = saída da peça | devolucao = entrada (TROCA) | estorno = venda cancelada
  tipo TEXT NOT NULL DEFAULT 'venda'
    CHECK (tipo IN ('venda', 'devolucao', 'estorno')),
  empresa INT NOT NULL,
  venda_id BIGINT REFERENCES pdv_vendas (id) ON DELETE CASCADE,
  item_id BIGINT REFERENCES pdv_venda_itens (id) ON DELETE CASCADE,
  product_code INT,
  sku TEXT,
  produto_nome TEXT,
  referencia TEXT,
  valor_unit NUMERIC(14, 2),
  cliente_code INT,
  cliente_nome TEXT,
  vendedor_code INT,
  vendedor_nome TEXT,
  nota_id BIGINT REFERENCES pdv_notas_fiscais (id) ON DELETE SET NULL,
  chave_nf TEXT,
  ocorrido_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pdv_epc_mov_epc ON pdv_epc_movimentos (epc, ocorrido_em DESC);
CREATE INDEX IF NOT EXISTS idx_pdv_epc_mov_empresa_data
  ON pdv_epc_movimentos (empresa, ocorrido_em DESC);
CREATE INDEX IF NOT EXISTS idx_pdv_epc_mov_venda ON pdv_epc_movimentos (venda_id);
CREATE INDEX IF NOT EXISTS idx_pdv_epc_mov_produto ON pdv_epc_movimentos (product_code);

-- Um EPC só pode ter um movimento por venda e tipo (evita duplicar em re-emissão)
CREATE UNIQUE INDEX IF NOT EXISTS uq_pdv_epc_mov
  ON pdv_epc_movimentos (epc, venda_id, tipo);

-- Última situação conhecida de cada etiqueta
CREATE OR REPLACE VIEW pdv_epc_situacao AS
SELECT DISTINCT ON (epc)
  epc,
  tipo,
  empresa,
  venda_id,
  product_code,
  produto_nome,
  referencia,
  valor_unit,
  cliente_nome,
  vendedor_nome,
  chave_nf,
  ocorrido_em
FROM pdv_epc_movimentos
ORDER BY epc, ocorrido_em DESC, id DESC;
