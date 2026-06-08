-- Expedição Showroom — controle de envio das vendas showroom/novidades
-- NFs vêm do TOTVS via sync; status/transportadora/rastreio são editados aqui.
create table if not exists expedicao_showroom (
  id bigserial primary key,
  -- Chave da NF (única)
  branch_code int not null,
  invoice_code bigint not null,
  transaction_code text,
  issue_date date,
  -- Dados TOTVS
  person_code int,
  person_name text,           -- nome da loja/cliente
  operation_code int,
  operation_name text,
  total_value numeric(14,2) default 0,
  volume_qty int default 0,   -- soma de items quantity
  -- Controle de expedição
  status text not null default 'enviado_blue', -- enviado_blue | recebido_blue | enviado_cliente
  transportadora text,        -- latam | azul | correios | retirada | taxista | paulao
  codigo_rastreio text,
  observacao text,
  -- Audit
  totvs_synced_at timestamptz default now(),
  atualizado_em timestamptz default now(),
  atualizado_por text,
  constraint uq_expedicao_nf unique (branch_code, invoice_code)
);

create index if not exists idx_expedicao_status on expedicao_showroom (status);
create index if not exists idx_expedicao_transportadora on expedicao_showroom (transportadora);
create index if not exists idx_expedicao_issue_date on expedicao_showroom (issue_date desc);
create index if not exists idx_expedicao_person on expedicao_showroom (person_code);

-- Trigger pra atualizar atualizado_em
create or replace function trg_expedicao_touch() returns trigger as $$
begin
  new.atualizado_em = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_expedicao_touch on expedicao_showroom;
create trigger trg_expedicao_touch
before update on expedicao_showroom
for each row execute function trg_expedicao_touch();
