-- ============================================================================
-- ERP HeadCoach — Fase 0 (fundação)
--
-- 1. Controle de migrations (schema_migrations)
-- 2. Modo por módulo/empresa (erp_config)
-- 3. Fila de integração HeadCoach → TOTVS (integracao_outbox + log)
-- 4. Controle do sync TOTVS → HeadCoach (erp_sync_controle + erp_sync_log)
-- 5. Cadastros mestres (erp_*) com a chave natural do TOTVS
--
-- Convenções:
--   * `origem` = 'totvs' (veio do sync) | 'headcoach' (nasceu aqui)
--   * `dados` = JSON bruto devolvido pelo TOTVS (auditoria / campos não mapeados)
--   * `totvs_alterado_em` = maxChangeFilterDate do TOTVS (cursor do delta)
--   * `sincronizado_em` = última vez que o sync tocou a linha
-- Idempotente: pode rodar mais de uma vez.
-- ============================================================================

-- ─── 1. Controle de migrations ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS schema_migrations (
  name TEXT PRIMARY KEY,
  checksum TEXT,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── 2. Modo por módulo / empresa ──────────────────────────────────────────
-- empresa NULL = padrão global. Linha por empresa sobrepõe o padrão.
CREATE TABLE IF NOT EXISTS erp_config (
  id BIGSERIAL PRIMARY KEY,
  empresa INT,
  modulo TEXT NOT NULL CHECK (modulo IN ('vendas', 'receber', 'pagar', 'estoque', 'pessoas', 'produtos', 'fiscal')),
  modo TEXT NOT NULL DEFAULT 'totvs' CHECK (modo IN ('totvs', 'dual', 'headcoach')),
  observacao TEXT,
  atualizado_por TEXT,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS erp_config_empresa_modulo_uidx
  ON erp_config (COALESCE(empresa, 0), modulo);

INSERT INTO erp_config (empresa, modulo, modo, observacao)
SELECT NULL, m, 'totvs', 'padrão global (fase 0)'
FROM unnest(ARRAY['vendas', 'receber', 'pagar', 'estoque', 'pessoas', 'produtos', 'fiscal']) AS m
ON CONFLICT DO NOTHING;

-- ─── 3. Outbox HeadCoach → TOTVS ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS integracao_outbox (
  id BIGSERIAL PRIMARY KEY,
  destino TEXT NOT NULL DEFAULT 'totvs',
  operacao TEXT NOT NULL,
  -- chave natural da operação (idempotência): ex. 'ap:1:2026101:1'
  chave TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pendente'
    CHECK (status IN ('pendente', 'processando', 'enviado', 'erro', 'cancelado')),
  tentativas INT NOT NULL DEFAULT 0,
  max_tentativas INT NOT NULL DEFAULT 8,
  proxima_tentativa TIMESTAMPTZ NOT NULL DEFAULT now(),
  processando_desde TIMESTAMPTZ,
  ultimo_erro TEXT,
  http_status INT,
  resposta JSONB,
  -- de onde veio (tabela/linha do HeadCoach) para rastrear
  origem_tabela TEXT,
  origem_id TEXT,
  empresa INT,
  criado_por TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  enviado_em TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS integracao_outbox_chave_uidx
  ON integracao_outbox (destino, operacao, chave) WHERE chave IS NOT NULL;
CREATE INDEX IF NOT EXISTS integracao_outbox_status_idx
  ON integracao_outbox (status, proxima_tentativa);
CREATE INDEX IF NOT EXISTS integracao_outbox_origem_idx
  ON integracao_outbox (origem_tabela, origem_id);

CREATE TABLE IF NOT EXISTS integracao_outbox_log (
  id BIGSERIAL PRIMARY KEY,
  outbox_id BIGINT NOT NULL REFERENCES integracao_outbox (id) ON DELETE CASCADE,
  tentativa INT NOT NULL,
  status TEXT NOT NULL,
  http_status INT,
  erro TEXT,
  resposta JSONB,
  duracao_ms INT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS integracao_outbox_log_outbox_idx ON integracao_outbox_log (outbox_id);

-- ─── 4. Controle do sync TOTVS → HeadCoach ─────────────────────────────────
CREATE TABLE IF NOT EXISTS erp_sync_controle (
  entidade TEXT PRIMARY KEY,
  descricao TEXT,
  ultimo_delta_em TIMESTAMPTZ,
  ultimo_full_em TIMESTAMPTZ,
  -- até onde o delta já cobriu (próximo delta parte daqui, com sobreposição)
  cursor_ate TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'ocioso' CHECK (status IN ('ocioso', 'rodando', 'erro')),
  ultimo_erro TEXT,
  total_totvs INT,
  total_local INT,
  ultima_duracao_ms INT,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS erp_sync_log (
  id BIGSERIAL PRIMARY KEY,
  entidade TEXT NOT NULL,
  modo TEXT NOT NULL CHECK (modo IN ('full', 'delta')),
  iniciado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  concluido_em TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'rodando' CHECK (status IN ('rodando', 'ok', 'erro')),
  registros INT NOT NULL DEFAULT 0,
  paginas INT NOT NULL DEFAULT 0,
  erro TEXT,
  detalhes JSONB,
  disparado_por TEXT
);
CREATE INDEX IF NOT EXISTS erp_sync_log_entidade_idx ON erp_sync_log (entidade, iniciado_em DESC);

-- ─── 5. Cadastros mestres ──────────────────────────────────────────────────

-- Empresas / filiais (person/v2/branchesList)
CREATE TABLE IF NOT EXISTS erp_empresas (
  code INT PRIMARY KEY,
  descricao TEXT,
  cnpj TEXT,
  person_code BIGINT,
  person_name TEXT,
  fantasia TEXT,
  grupo TEXT,
  ie TEXT,
  uf TEXT,
  cidade TEXT,
  cidade_ibge INT,
  endereco JSONB,
  regime_tributario TEXT,
  ativo BOOLEAN NOT NULL DEFAULT true,
  -- CNPJ próprio (cobertos por certificado A1) — vem de config/sefazFiliais.js
  propria BOOLEAN NOT NULL DEFAULT false,
  certificado TEXT,
  totvs_alterado_em TIMESTAMPTZ,
  origem TEXT NOT NULL DEFAULT 'totvs',
  dados JSONB,
  sincronizado_em TIMESTAMPTZ,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS erp_empresas_cnpj_idx ON erp_empresas (cnpj);

-- Pessoas PF/PJ (person/v2/individuals + legal-entities)
CREATE TABLE IF NOT EXISTS erp_pessoas (
  code BIGINT PRIMARY KEY,
  tipo TEXT NOT NULL CHECK (tipo IN ('PF', 'PJ')),
  nome TEXT,
  fantasia TEXT,
  cpf_cnpj TEXT,
  ie TEXT,
  rg TEXT,
  nascimento DATE,
  genero TEXT,
  estado_civil TEXT,
  email TEXT,
  telefone TEXT,
  whatsapp TEXT,
  cep TEXT,
  uf TEXT,
  cidade TEXT,
  cidade_ibge INT,
  endereco JSONB,
  enderecos JSONB,
  telefones JSONB,
  emails JSONB,
  classificacoes JSONB,
  is_cliente BOOLEAN,
  is_fornecedor BOOLEAN,
  is_representante BOOLEAN,
  is_funcionario BOOLEAN,
  is_transportadora BOOLEAN,
  inativo BOOLEAN NOT NULL DEFAULT false,
  status_cliente TEXT,
  empresa_cadastro INT,
  inserido_em TIMESTAMPTZ,
  regime_tributario TEXT,
  cnae INT,
  observacoes TEXT,
  totvs_alterado_em TIMESTAMPTZ,
  origem TEXT NOT NULL DEFAULT 'totvs',
  dados JSONB,
  sincronizado_em TIMESTAMPTZ,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS erp_pessoas_cpf_cnpj_idx ON erp_pessoas (cpf_cnpj);
CREATE INDEX IF NOT EXISTS erp_pessoas_nome_idx ON erp_pessoas (nome);
CREATE INDEX IF NOT EXISTS erp_pessoas_tipo_idx ON erp_pessoas (tipo, inativo);
CREATE INDEX IF NOT EXISTS erp_pessoas_alterado_idx ON erp_pessoas (totvs_alterado_em);

-- Representantes comerciais (person/v2/representatives/search)
CREATE TABLE IF NOT EXISTS erp_representantes (
  code INT PRIMARY KEY,
  nome TEXT,
  cpf_cnpj TEXT,
  inativo BOOLEAN NOT NULL DEFAULT false,
  supervisor_code INT,
  supervisor_nome TEXT,
  empresa_cadastro INT,
  telefones JSONB,
  emails JSONB,
  enderecos JSONB,
  classificacoes JSONB,
  tabelas_preco JSONB,
  totvs_alterado_em TIMESTAMPTZ,
  origem TEXT NOT NULL DEFAULT 'totvs',
  dados JSONB,
  sincronizado_em TIMESTAMPTZ,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Vendedores (sale-panel/v2/sellers-list/search por empresa)
CREATE TABLE IF NOT EXISTS erp_vendedores (
  code INT PRIMARY KEY,
  nome TEXT,
  empresas INT[] NOT NULL DEFAULT '{}',
  pessoa_code BIGINT,
  ativo BOOLEAN NOT NULL DEFAULT true,
  origem TEXT NOT NULL DEFAULT 'totvs',
  sincronizado_em TIMESTAMPTZ,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Produtos (product/v2/products/search) — 1 linha por SKU (cor+tamanho)
CREATE TABLE IF NOT EXISTS erp_produtos (
  code INT PRIMARY KEY,
  nome TEXT,
  sku TEXT,
  referencia_code TEXT,
  referencia_id INT,
  referencia_nome TEXT,
  cor_code TEXT,
  cor_nome TEXT,
  tamanho TEXT,
  grade_code INT,
  ncm TEXT,
  cest TEXT,
  cst_origem TEXT,
  unidade TEXT,
  prefixo_ean TEXT,
  ativo BOOLEAN NOT NULL DEFAULT true,
  bloqueado BOOLEAN NOT NULL DEFAULT false,
  produto_acabado BOOLEAN,
  materia_prima BOOLEAN,
  material_granel BOOLEAN,
  producao_propria BOOLEAN,
  estoque_min NUMERIC(14, 3),
  estoque_max NUMERIC(14, 3),
  estoque_ideal NUMERIC(14, 3),
  classificacoes JSONB,
  fornecedores JSONB,
  categorias JSONB,
  totvs_alterado_em TIMESTAMPTZ,
  origem TEXT NOT NULL DEFAULT 'totvs',
  dados JSONB,
  sincronizado_em TIMESTAMPTZ,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS erp_produtos_referencia_idx ON erp_produtos (referencia_code);
CREATE INDEX IF NOT EXISTS erp_produtos_sku_idx ON erp_produtos (sku);
CREATE INDEX IF NOT EXISTS erp_produtos_nome_idx ON erp_produtos (nome);
CREATE INDEX IF NOT EXISTS erp_produtos_alterado_idx ON erp_produtos (totvs_alterado_em);

-- Códigos de barras / EPC RFID do produto (products.barCodes)
CREATE TABLE IF NOT EXISTS erp_codigos_barras (
  id BIGSERIAL PRIMARY KEY,
  produto_code INT NOT NULL,
  codigo TEXT NOT NULL,
  tipo TEXT,
  principal BOOLEAN NOT NULL DEFAULT false,
  origem TEXT NOT NULL DEFAULT 'totvs',
  dados JSONB,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (codigo, produto_code)
);
CREATE INDEX IF NOT EXISTS erp_codigos_barras_codigo_idx ON erp_codigos_barras (codigo);
CREATE INDEX IF NOT EXISTS erp_codigos_barras_produto_idx ON erp_codigos_barras (produto_code);

CREATE TABLE IF NOT EXISTS erp_cores (
  code TEXT PRIMARY KEY,
  nome TEXT,
  ativo BOOLEAN NOT NULL DEFAULT true,
  dados JSONB,
  origem TEXT NOT NULL DEFAULT 'totvs',
  sincronizado_em TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS erp_grades (
  code INT PRIMARY KEY,
  nome TEXT,
  tipo TEXT,
  tamanhos JSONB,
  totvs_alterado_em TIMESTAMPTZ,
  origem TEXT NOT NULL DEFAULT 'totvs',
  sincronizado_em TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS erp_unidades (
  code TEXT PRIMARY KEY,
  descricao TEXT,
  origem TEXT NOT NULL DEFAULT 'totvs',
  sincronizado_em TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS erp_classificacao_tipos (
  code INT PRIMARY KEY,
  descricao TEXT,
  descricao_aux TEXT,
  is_group BOOLEAN,
  origem TEXT NOT NULL DEFAULT 'totvs',
  sincronizado_em TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS erp_classificacoes (
  tipo_code INT NOT NULL,
  code TEXT NOT NULL,
  nome TEXT,
  nome_aux TEXT,
  tipo_nome TEXT,
  totvs_alterado_em TIMESTAMPTZ,
  origem TEXT NOT NULL DEFAULT 'totvs',
  sincronizado_em TIMESTAMPTZ,
  PRIMARY KEY (tipo_code, code)
);

-- Tabelas de preço (product/v2/price-tables-headers)
CREATE TABLE IF NOT EXISTS erp_tabelas_preco (
  code INT PRIMARY KEY,
  descricao TEXT,
  nome TEXT,
  tipo TEXT,
  inicio DATE,
  fim DATE,
  variacao_pct NUMERIC(9, 4),
  variacao_valor NUMERIC(14, 2),
  classificacoes_pedido JSONB,
  classificacoes_pessoa JSONB,
  condicoes_pagamento JSONB,
  totvs_alterado_em TIMESTAMPTZ,
  origem TEXT NOT NULL DEFAULT 'totvs',
  dados JSONB,
  sincronizado_em TIMESTAMPTZ
);

-- Preço por produto/empresa/tipo de preço (product/v2/prices/search)
CREATE TABLE IF NOT EXISTS erp_precos (
  produto_code INT NOT NULL,
  empresa INT NOT NULL,
  preco_code INT NOT NULL,
  preco_nome TEXT,
  preco NUMERIC(14, 2),
  preco_promocional NUMERIC(14, 2),
  promocao JSONB,
  origem TEXT NOT NULL DEFAULT 'totvs',
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (produto_code, empresa, preco_code)
);

-- Custo por produto/empresa/tipo de custo (product/v2/costs/search)
CREATE TABLE IF NOT EXISTS erp_custos (
  produto_code INT NOT NULL,
  empresa INT NOT NULL,
  custo_code INT NOT NULL,
  custo_nome TEXT,
  custo NUMERIC(14, 4),
  origem TEXT NOT NULL DEFAULT 'totvs',
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (produto_code, empresa, custo_code)
);

-- Preço de tabela (product/v2/price-tables/search)
CREATE TABLE IF NOT EXISTS erp_precos_tabela (
  tabela_code INT NOT NULL,
  produto_code INT NOT NULL,
  empresa INT NOT NULL,
  preco NUMERIC(14, 2),
  preco_original NUMERIC(14, 2),
  escala INT,
  origem TEXT NOT NULL DEFAULT 'totvs',
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tabela_code, produto_code, empresa)
);

-- Operações (general/v2/operations com expand)
CREATE TABLE IF NOT EXISTS erp_operacoes (
  code INT PRIMARY KEY,
  descricao TEXT,
  financeira BOOLEAN,
  inativa BOOLEAN NOT NULL DEFAULT false,
  tipo TEXT,                 -- 'E' entrada | 'S' saída
  documento_tipo INT,
  modelo_documento INT,      -- 55 NF-e, 65 NFC-e, 35 ...
  regra_fiscal INT,
  modo_operacao TEXT,
  finalidade_nfe INT,
  indicador_presenca INT,
  tipo_danfe INT,
  operacao_vinculada INT,
  valores JSONB,             -- tipos de preço/custo usados
  saldos JSONB,              -- estoques movimentados (code, movementType, isKardex)
  calculos JSONB,
  classificacoes JSONB,
  movimenta_estoque BOOLEAN,
  totvs_alterado_em TIMESTAMPTZ,
  origem TEXT NOT NULL DEFAULT 'totvs',
  dados JSONB,
  sincronizado_em TIMESTAMPTZ
);

-- Condições de pagamento (general/v2/payment-conditions)
CREATE TABLE IF NOT EXISTS erp_condicoes_pagamento (
  code INT PRIMARY KEY,
  nome TEXT,
  parcelas INT,
  dias JSONB,
  desconto_pct NUMERIC(9, 4),
  juros_pct NUMERIC(9, 4),
  bloqueada BOOLEAN NOT NULL DEFAULT false,
  origem TEXT NOT NULL DEFAULT 'totvs',
  dados JSONB,
  sincronizado_em TIMESTAMPTZ
);

-- Portadores (accounts-receivable/v2/bearers)
CREATE TABLE IF NOT EXISTS erp_portadores (
  code INT PRIMARY KEY,
  descricao TEXT,
  tipo TEXT,
  totvs_alterado_em TIMESTAMPTZ,
  origem TEXT NOT NULL DEFAULT 'totvs',
  sincronizado_em TIMESTAMPTZ
);

-- Itens de despesa e centros de custo: o TOTVS não expõe endpoint de cadastro;
-- são derivados das duplicatas do contas a pagar (expense[]) e podem ser
-- completados/editados no HeadCoach.
CREATE TABLE IF NOT EXISTS erp_despesas_itens (
  code INT PRIMARY KEY,
  nome TEXT,
  ativo BOOLEAN NOT NULL DEFAULT true,
  origem TEXT NOT NULL DEFAULT 'totvs',
  sincronizado_em TIMESTAMPTZ,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS erp_centros_custo (
  code INT PRIMARY KEY,
  nome TEXT,
  ativo BOOLEAN NOT NULL DEFAULT true,
  origem TEXT NOT NULL DEFAULT 'totvs',
  sincronizado_em TIMESTAMPTZ,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Estoques (código/descrição dos depósitos: 1 = FISICO...) — derivado das operações
CREATE TABLE IF NOT EXISTS erp_estoques (
  code INT PRIMARY KEY,
  descricao TEXT,
  origem TEXT NOT NULL DEFAULT 'totvs',
  sincronizado_em TIMESTAMPTZ
);

-- Saldo de cashback (person/v2/list-balance-bonus) — por CPF e empresa.
-- O TOTVS só consulta por CPF; o saldo é atualizado sob demanda (PDV) e
-- passa a ser mantido aqui quando o módulo 'vendas' virar headcoach.
CREATE TABLE IF NOT EXISTS erp_bonus_saldo (
  cpf TEXT NOT NULL,
  empresa INT NOT NULL,
  pessoa_code BIGINT,
  saldo NUMERIC(14, 2) NOT NULL DEFAULT 0,
  origem TEXT NOT NULL DEFAULT 'totvs',
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (cpf, empresa)
);

-- ─── 6. Trigger genérica de atualizado_em ──────────────────────────────────
CREATE OR REPLACE FUNCTION erp_touch_atualizado_em() RETURNS TRIGGER AS $$
BEGIN
  NEW.atualizado_em = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'erp_config', 'integracao_outbox', 'erp_empresas', 'erp_pessoas', 'erp_representantes',
    'erp_vendedores', 'erp_produtos', 'erp_despesas_itens', 'erp_centros_custo'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger WHERE tgname = t || '_touch' AND tgrelid = t::regclass
    ) THEN
      EXECUTE format(
        'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION erp_touch_atualizado_em()',
        t || '_touch', t
      );
    END IF;
  END LOOP;
END $$;

-- ─── 7. RLS: leitura para usuários autenticados; escrita só pelo backend ───
-- (o backend usa service_role, que ignora RLS)
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'erp_config', 'integracao_outbox', 'integracao_outbox_log', 'erp_sync_controle', 'erp_sync_log',
    'erp_empresas', 'erp_pessoas', 'erp_representantes', 'erp_vendedores', 'erp_produtos',
    'erp_codigos_barras', 'erp_cores', 'erp_grades', 'erp_unidades', 'erp_classificacao_tipos',
    'erp_classificacoes', 'erp_tabelas_preco', 'erp_precos', 'erp_custos', 'erp_precos_tabela',
    'erp_operacoes', 'erp_condicoes_pagamento', 'erp_portadores', 'erp_despesas_itens',
    'erp_centros_custo', 'erp_estoques', 'erp_bonus_saldo'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = 'erp_leitura_autenticado'
    ) THEN
      EXECUTE format(
        'CREATE POLICY erp_leitura_autenticado ON %I FOR SELECT TO authenticated USING (true)', t
      );
    END IF;
  END LOOP;
END $$;

-- ─── 8. Seed do controle de sync ───────────────────────────────────────────
INSERT INTO erp_sync_controle (entidade, descricao) VALUES
  ('empresas', 'Empresas/filiais (person/v2/branchesList)'),
  ('pessoas_pf', 'Pessoas físicas (person/v2/individuals)'),
  ('pessoas_pj', 'Pessoas jurídicas (person/v2/legal-entities)'),
  ('representantes', 'Representantes (person/v2/representatives)'),
  ('vendedores', 'Vendedores (sale-panel/v2/sellers-list)'),
  ('produtos', 'Produtos/SKUs + códigos de barras (product/v2/products)'),
  ('cores', 'Cores (product/v2/colors)'),
  ('grades', 'Grades/tamanhos (product/v2/grid)'),
  ('unidades', 'Unidades de medida (product/v2/measurement-unit)'),
  ('classificacoes', 'Tipos e classificações de produto (product/v2/classifications)'),
  ('tabelas_preco', 'Cabeçalhos de tabela de preço (product/v2/price-tables-headers)'),
  ('precos', 'Preços por produto/empresa (product/v2/prices)'),
  ('custos', 'Custos por produto/empresa (product/v2/costs)'),
  ('precos_tabela', 'Preços de tabela por produto/empresa (product/v2/price-tables)'),
  ('operacoes', 'Operações/CFOP (general/v2/operations)'),
  ('condicoes_pagamento', 'Condições de pagamento (general/v2/payment-conditions)'),
  ('portadores', 'Portadores (accounts-receivable/v2/bearers)'),
  ('despesas_centros', 'Itens de despesa e centros de custo (derivados do contas a pagar)')
ON CONFLICT (entidade) DO NOTHING;
