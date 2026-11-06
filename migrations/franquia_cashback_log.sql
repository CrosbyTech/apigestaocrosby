-- ============================================================================
-- franquia_cashback_log — idempotência do cashback de franquia (Fase 2)
--
-- Registra cada crédito de cashback já feito, por (filial, cliente, dia), pra o
-- job nunca creditar a mesma venda duas vezes. O crédito é feito por dia: a
-- soma das vendas elegíveis (ops 9009/9063) daquele cliente naquela filial
-- naquele dia vira 1 bônus de 20%.
--
-- Backlog creditado manualmente em 06/11/2026 (período 07/10–06/11) NÃO está
-- aqui — por isso o job/endpoint só credita a partir de FRANQUIA_CASHBACK_INICIO
-- (2026-11-07), evitando recreditar o que já foi.
-- ============================================================================
create table if not exists public.franquia_cashback_log (
  id            bigint generated always as identity primary key,
  branch_code   integer       not null,
  person_code   integer       not null,
  dia           date          not null,
  valor_venda   numeric(14,2) not null,
  cashback      numeric(14,2) not null,
  creditado_em  timestamptz   not null default now(),
  constraint franquia_cashback_log_uk unique (branch_code, person_code, dia)
);

create index if not exists idx_franquia_cashback_log_dia
  on public.franquia_cashback_log (dia);
