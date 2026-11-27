-- ============================================================================
-- CONTAS FIXAS DAS LOJAS (Financeiro › Contas a Pagar) — Yago, 26/11/2026.
-- Página que junta o Controle de Filiais (despesas fixas + dados cadastrais) e
-- o CTO. Aqui ficam:
--   contas_fixas_lojas      cadastro das lojas e imóveis (antes lido do TOTVS a cada abertura)
--   contas_fixas_anotacoes  anotação por loja + tipo de despesa ("não se aplica", observação da célula)
--   despesas_fixas_filial   (já existia) ganha COMO PEGAR a conta para pagar
-- Só o servidor acessa as tabelas novas (RLS ligado, sem política).
-- Rodar: node scripts/migrar-contas-fixas-lojas.mjs
-- ============================================================================

CREATE TABLE IF NOT EXISTS contas_fixas_lojas (
  cd_filial VARCHAR(20) PRIMARY KEY,          -- o mesmo código usado em despesas_fixas_filial ('1', '95', 'TERRENO_PAINEL')
  empresa INT,                                 -- código da empresa; nulo = imóvel que não é empresa
  nome TEXT NOT NULL,                          -- como aparece na planilha (NATAL (MATRIZ), MIDWAY…)
  tipo TEXT NOT NULL DEFAULT 'loja_rua' CHECK (tipo IN ('matriz', 'loja_rua', 'loja_shopping', 'imovel')),
  razao_social TEXT,
  nome_fantasia TEXT,
  cnpj TEXT,
  inscricao_estadual TEXT,
  grupo TEXT,
  endereco TEXT,
  bairro TEXT,
  cidade TEXT,
  uf TEXT,
  cep TEXT,
  shopping TEXT,                               -- nome do shopping / condomínio, quando for o caso
  telefone TEXT,
  email TEXT,
  responsavel TEXT,
  centro_custo_code INT,                       -- centro de custo da loja no Contas a Pagar (liga os títulos à loja)
  observacao TEXT,
  ordem INT NOT NULL DEFAULT 0,
  ativo BOOLEAN NOT NULL DEFAULT true,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_por TEXT
);
CREATE INDEX IF NOT EXISTS contas_fixas_lojas_cc ON contas_fixas_lojas (centro_custo_code);
ALTER TABLE contas_fixas_lojas ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS contas_fixas_anotacoes (
  cd_filial VARCHAR(20) NOT NULL,
  tipo_despesa VARCHAR(30) NOT NULL,
  nao_se_aplica BOOLEAN NOT NULL DEFAULT false, -- a loja não tem essa despesa (ex.: energia dentro do boleto do shopping)
  observacao TEXT,
  atualizado_por TEXT,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (cd_filial, tipo_despesa)
);
ALTER TABLE contas_fixas_anotacoes ENABLE ROW LEVEL SECURITY;

-- como pegar a conta para pagar: o canal (robô, e-mail, site…) e a instrução
ALTER TABLE despesas_fixas_filial ADD COLUMN IF NOT EXISTS como_pegar_canal TEXT;
ALTER TABLE despesas_fixas_filial ADD COLUMN IF NOT EXISTS como_pegar TEXT;

NOTIFY pgrst, 'reload schema';

-- ─── contas fixas de ANTES de novembro/2026: cópia dos títulos do TOTVS (Yago, 26/11/2026) ───
-- De janeiro a outubro as contas estavam no TOTVS. Uma linha por título × despesa do rateio
-- (services/contasFixasTotvs.js; carga: node scripts/sincronizar-contas-fixas-totvs.mjs aplicar).
-- A planilha confere cada título com a baixa do TOTVS (liquidacao) e com as baixas do HeadCoach
-- (contas_pagar_pagos_conciliacao e pagamentos_liberacao). De novembro em diante vale só o HeadCoach.
CREATE TABLE IF NOT EXISTS contas_fixas_totvs_titulos (
  id BIGSERIAL PRIMARY KEY,
  empresa INT NOT NULL,
  fornecedor_code BIGINT NOT NULL,
  duplicata BIGINT NOT NULL,
  parcela INT NOT NULL,
  linha INT NOT NULL DEFAULT 1,
  despesa_code INT NOT NULL,
  despesa_nome TEXT,
  centro_custo_code INT,
  percentual NUMERIC(9, 4),
  valor NUMERIC(14, 2) NOT NULL,
  valor_titulo NUMERIC(14, 2) NOT NULL,
  fornecedor_nome TEXT,
  fornecedor_doc TEXT,
  portador_code INT,
  emissao DATE,
  vencimento DATE NOT NULL,
  liquidacao DATE,
  valor_pago_titulo NUMERIC(14, 2) NOT NULL DEFAULT 0,
  juros NUMERIC(14, 2) NOT NULL DEFAULT 0,
  desconto NUMERIC(14, 2) NOT NULL DEFAULT 0,
  status TEXT,
  incluido_por TEXT,
  sincronizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (empresa, fornecedor_code, duplicata, parcela, linha)
);
CREATE INDEX IF NOT EXISTS contas_fixas_totvs_titulos_venc ON contas_fixas_totvs_titulos (vencimento);
CREATE INDEX IF NOT EXISTS contas_fixas_totvs_titulos_dup ON contas_fixas_totvs_titulos (duplicata);
ALTER TABLE contas_fixas_totvs_titulos ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';

-- célula que só considera os fornecedores do cadastro (26/11/2026): lançamento de outro fornecedor no
-- centro de custo da loja é desconsiderado (o aluguel da Matriz é só a SB Imóveis)
ALTER TABLE contas_fixas_anotacoes ADD COLUMN IF NOT EXISTS so_cadastro BOOLEAN NOT NULL DEFAULT false;

NOTIFY pgrst, 'reload schema';
