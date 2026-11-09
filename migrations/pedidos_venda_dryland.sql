-- ============================================================================
-- PEDIDOS DE VENDA DO DRYLAND (página /expedicao/pedidos-venda)
-- O pedido nasce no Dryland (site/vendedor → separação em
-- dryland-missao-separacao/separar). Ao confirmar a separação o Dryland abre o
-- pedido de venda no TOTVS. O HeadCoach guarda o PEDIDO DO DRYLAND (ref MT###,
-- RV###, VJ###, PE###, FR###, TR###…), não o do TOTVS, para virar a base
-- quando o TOTVS sair. Cópia feita pelo job pedidos-venda-sync (5 min) a partir
-- da RPC lv_sep_listar do Supabase do Dryland. Nada é apagado: o que some do
-- Dryland fica com sumiu_do_dryland_em preenchido. Idempotente.
-- ============================================================================
CREATE TABLE IF NOT EXISTS pedidos_venda_dryland (
  ref TEXT PRIMARY KEY,               -- nº do pedido no Dryland (ex.: RV215)
  tipo TEXT,                          -- revenda-site, varejo-site, multimarca-site, franquia-site, transferencia, brinde
  canal TEXT,                         -- revenda, varejo, multimarca, franquia, transferencia, brinde
  eh_venda BOOLEAN NOT NULL DEFAULT true,
  cliente TEXT,
  vendedor_code INT,
  vendedor_nome TEXT,
  pagamento TEXT,                     -- pix, cartao, boleto_faturado, credev…
  obs TEXT,
  criado_em TIMESTAMPTZ,              -- criação no Dryland
  qtd_itens INT NOT NULL DEFAULT 0,
  qtd_pecas INT NOT NULL DEFAULT 0,
  qtd_separada INT NOT NULL DEFAULT 0,
  valor_total NUMERIC(14, 2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'aguardando',   -- aguardando · em_separacao · separado
  totvs_pedidos BIGINT[] NOT NULL DEFAULT '{}', -- pedido(s) de venda que o Dryland abriu no TOTVS
  separado_em TIMESTAMPTZ,
  sumiu_do_dryland_em TIMESTAMPTZ,
  primeiro_visto_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  sincronizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pvd_criado ON pedidos_venda_dryland (criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_pvd_canal ON pedidos_venda_dryland (canal, status);

CREATE TABLE IF NOT EXISTS pedidos_venda_dryland_itens (
  dryland_id BIGINT PRIMARY KEY,      -- id da linha em lv_separacao
  ref TEXT NOT NULL,
  cod TEXT,
  descricao TEXT,
  cor TEXT,
  tamanho TEXT,
  qtd INT NOT NULL DEFAULT 0,
  separado INT NOT NULL DEFAULT 0,
  preco NUMERIC(14, 2),
  estoque TEXT,                       -- de qual estoque sai (max, credev, brejinho…)
  totvs BIGINT,                       -- pedido TOTVS da linha
  troca_pendente JSONB,
  marcado_em TIMESTAMPTZ,
  obs TEXT,
  criado_em TIMESTAMPTZ,
  sumiu_do_dryland_em TIMESTAMPTZ,
  sincronizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pvdi_ref ON pedidos_venda_dryland_itens (ref);
