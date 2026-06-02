-- BlueCard Leads — captura de submissões da LP pública (/lp/bluecard)
-- "Grandes Nomes do Brasil" — formulário pra emitir cartão BlueCard exclusivo.
create table if not exists bluecard_leads (
  id          bigserial primary key,
  nome        text not null,
  whatsapp    text not null,
  email       text not null,
  cpf         text not null,
  empresa     text,
  instagram   text,
  data_nasc   text,
  cep         text,
  endereco    text,
  numero      text,
  complemento text,
  -- Metadata
  origem      text default 'lp_bluecard',
  ip          text,
  user_agent  text,
  -- Status do lead pro funil (contatado, qualificado, convertido, etc.)
  status      text not null default 'novo',
  observacao  text,
  contatado_em timestamptz,
  convertido_em timestamptz,
  -- Audit
  criado_em   timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index if not exists idx_bluecard_leads_criado on bluecard_leads (criado_em desc);
create index if not exists idx_bluecard_leads_status on bluecard_leads (status);
create index if not exists idx_bluecard_leads_cpf on bluecard_leads (cpf);

-- Trigger pra atualizar atualizado_em
create or replace function trg_bluecard_leads_touch() returns trigger as $$
begin
  new.atualizado_em = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_bluecard_leads_touch on bluecard_leads;
create trigger trg_bluecard_leads_touch
before update on bluecard_leads
for each row execute function trg_bluecard_leads_touch();
