-- Fila de inclusão de pagamentos na Stone (botão APROVAR da Liberação de Pagamento).
-- Um título só entra uma vez: o índice único em liberacao_id é a trava contra pagamento em dobro.
create table if not exists stone_inclusoes (
  id bigserial primary key,
  liberacao_id uuid not null,
  lote uuid not null,
  status text not null default 'fila'
    check (status in ('fila', 'processando', 'incluido', 'erro', 'bloqueado', 'verificar', 'cancelada')),
  forma text not null,
  conta_final text not null,
  conta_cnpj text,
  stone_account_id text,
  chave_pix text,
  chave_tipo text,
  valor_centavos integer not null check (valor_centavos > 0),
  fornecedor text,
  descricao text,
  teste boolean not null default false,
  stone_pagamento_id text,
  recebedor_nome text,
  recebedor_doc text,
  erro text,
  solicitado_por text,
  agente text,
  aviso_em timestamptz,
  aviso_erro text,
  criado_em timestamptz not null default now(),
  iniciado_em timestamptz,
  concluido_em timestamptz
);

create unique index if not exists stone_inclusoes_liberacao_uniq on stone_inclusoes (liberacao_id);
create index if not exists stone_inclusoes_status_idx on stone_inclusoes (status, criado_em);
create index if not exists stone_inclusoes_lote_idx on stone_inclusoes (lote);

alter table stone_inclusoes enable row level security;
