-- ============================================================================
-- sales_closing_records — dados do painel de FECHAMENTO DE MÊS (TVs)
--
-- Alimentada pelo job jobs/sales-closing-sync.job.js, que puxa os números
-- EXATAMENTE da mesma rota do "New Forecast":
--     POST /api/totvs/sale-panel/faturamento-vendedor-semanal  { mes }
--
-- Essa rota devolve dados JÁ AGREGADOS por canal e por semana (s1..s5) — não
-- vendas individuais. Por isso a chave de upsert é (mes, canal), e não um
-- "ID de venda" (que não existe nessa camada). Se um dia for preciso granular
-- por nota, a fonte é /sale-panel/faturamento-vendedor-detalhe (ver o job).
--
-- Fuso de referência: America/Fortaleza (UTC-3, sem horário de verão) — Natal/RN.
-- ============================================================================

create table if not exists public.sales_closing_records (
  id             bigint generated always as identity primary key,

  mes            text        not null,          -- 'YYYY-MM' (mês de fechamento, TZ Fortaleza)
  canal          text        not null,          -- FRANQUIAS, REVENDA, VAREJO, MTM_*, NOVIDADES,
                                                 -- SHOWROOM, BAZAR, RICARDO_ELETRO, BLUECRED, TOTAL_GERAL

  s1             numeric(14,2) not null default 0,
  s2             numeric(14,2) not null default 0,
  s3             numeric(14,2) not null default 0,
  s4             numeric(14,2) not null default 0,
  s5             numeric(14,2) not null default 0,
  total_mes      numeric(14,2) not null default 0,

  -- Detalhe do canal (para a visão rotativa do painel):
  --   VAREJO    -> por loja     [{ nome, branch_code, valor }]
  --   REVENDA   -> por vendedor [{ nome, valor }]
  --   FRANQUIAS -> por vendedor [{ nome, valor }]
  -- (Multimarcas é montado no front a partir dos 3 canais MTM.)
  detalhe        jsonb       not null default '[]'::jsonb,

  fechado        boolean     not null default false,  -- trava da meia-noite: mês encerrado
  datemin        date,
  datemax        date,
  atualizado_em  timestamptz not null default now(),

  -- chave natural do upsert (equivalente ao "ID da venda", mas na granularidade
  -- que a rota do forecast entrega)
  constraint sales_closing_records_mes_canal_key unique (mes, canal)
);

-- Consulta do painel: filtra por mês e ordena por canal.
create index if not exists idx_sales_closing_mes on public.sales_closing_records (mes);
