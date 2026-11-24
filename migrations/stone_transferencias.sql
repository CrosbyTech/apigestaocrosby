-- Transferência ENTRE CONTAS da Stone (Yago, 24/11/2026).
-- stone_contas: as contas Stone do grupo e a chave Pix aleatória de cada uma (o destino de uma
--   transferência só pode ser uma conta daqui — nunca uma chave digitada na hora).
-- stone_transferencias: a fila. O agente local (bots/stone-extratos) inclui o Pix da conta de
--   origem para a chave da conta de destino; quem aprova é o Fábio no app da Stone.
create table if not exists stone_contas (
  stone_account_id text primary key,
  agencia text,
  conta text,
  titular_nome text,
  titular_cnpj text,
  conta_final text not null,            -- últimos 4 dígitos do CNPJ ("0549"), como a Liberação chama a conta
  chave_pix_aleatoria text,             -- chave aleatória (UUID) da conta
  chave_origem text,                    -- portal (lida pelo bot) | manual (colada na tela)
  chave_atualizada_em timestamptz,
  chave_atualizada_por text,
  ativa boolean not null default true,
  atualizado_em timestamptz not null default now()
);
alter table stone_contas enable row level security;

create table if not exists stone_transferencias (
  id bigserial primary key,
  lote uuid not null,
  status text not null default 'fila'
    check (status in ('fila', 'processando', 'incluido', 'efetivada', 'erro', 'bloqueado', 'verificar', 'cancelada')),
  origem_account_id text not null,
  origem_final text not null,
  origem_cnpj text,
  origem_nome text,
  destino_account_id text not null,
  destino_final text not null,
  destino_cnpj text not null,
  destino_nome text,
  destino_chave text not null,          -- a chave do destino no momento do pedido
  tudo boolean not null default false,  -- true = todo o saldo que a conta tiver quando o bot incluir
  valor_centavos integer check (valor_centavos is null or valor_centavos > 0),
  valor_incluido_centavos integer,      -- o que o bot incluiu de fato (com "tudo", o saldo lido na hora)
  descricao text,
  stone_pagamento_id text,
  recebedor_nome text,
  recebedor_doc text,
  erro text,
  solicitado_por text,
  agente text,
  aviso_em timestamptz,
  aviso_erro text,
  conferencia jsonb,                    -- { saida: id do lançamento, entrada: id|null, data } quando aparece no extrato
  efetivada_em timestamptz,
  criado_em timestamptz not null default now(),
  iniciado_em timestamptz,
  concluido_em timestamptz,
  check (origem_account_id <> destino_account_id),
  check (tudo or valor_centavos is not null)
);
-- uma só em andamento por par origem → destino (clique repetido não enfileira duas)
create unique index if not exists stone_transferencias_par_uniq on stone_transferencias (origem_account_id, destino_account_id) where status in ('fila', 'processando');
create index if not exists stone_transferencias_status_idx on stone_transferencias (status, criado_em);
create index if not exists stone_transferencias_lote_idx on stone_transferencias (lote);
alter table stone_transferencias enable row level security;
