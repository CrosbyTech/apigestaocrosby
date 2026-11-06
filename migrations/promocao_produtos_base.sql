-- Base de produtos para a busca por nome/tamanho da tela Preço Promocional
-- (/promocoes/valores). Carregada do relatório de produtos acabados do TOTVS
-- (CSV ;, ISO-8859-1: Produto;Descrição;Espécie;Grupo;Físico;Cd.Cor;Ds.Cor;Ds.Tamanho)
-- porque o erp_produtos ainda não teve a carga completa. A busca junta as duas.
CREATE TABLE IF NOT EXISTS promocao_produtos_base (
  code INT PRIMARY KEY,
  nome TEXT NOT NULL,
  unidade TEXT,
  referencia_code TEXT,
  fisico NUMERIC(14, 3),
  cor_code TEXT,
  cor_nome TEXT,
  tamanho TEXT,
  fonte TEXT,
  importado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS promocao_produtos_base_tamanho_idx ON promocao_produtos_base (tamanho);
CREATE INDEX IF NOT EXISTS promocao_produtos_base_nome_trgm_idx ON promocao_produtos_base USING gin (nome gin_trgm_ops);
