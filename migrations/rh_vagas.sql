-- RH / Banco de Talentos — Vagas
-- Cada vaga gera um link público exclusivo (/vagas/<slug>) onde o candidato
-- se inscreve. O RH cria/edita as vagas pelo painel (gestaocrosby → /rh/vagas).
create table if not exists rh_vagas (
  id                bigserial primary key,
  slug              text not null unique,
  titulo            text not null,
  cargo             text,
  cidade            text,
  estado            text,
  tipo_contratacao  text,             -- CLT, Estágio, PJ, Temporário, etc.
  descricao         text,
  requisitos        text,
  beneficios        text,
  ativo             boolean not null default true,
  -- Audit
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now()
);

create index if not exists idx_rh_vagas_slug   on rh_vagas (slug);
create index if not exists idx_rh_vagas_ativo  on rh_vagas (ativo);
create index if not exists idx_rh_vagas_criado on rh_vagas (criado_em desc);

-- Trigger pra atualizar atualizado_em
create or replace function trg_rh_vagas_touch() returns trigger as $$
begin
  new.atualizado_em = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_rh_vagas_touch on rh_vagas;
create trigger trg_rh_vagas_touch
before update on rh_vagas
for each row execute function trg_rh_vagas_touch();
