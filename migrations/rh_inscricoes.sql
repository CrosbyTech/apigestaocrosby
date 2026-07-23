-- RH / Banco de Talentos — Inscrições (candidatos)
-- Submissões da LP pública /vagas/<slug>. O currículo é guardado no bucket
-- privado 'curriculos' do Supabase Storage; aqui salvamos só o caminho.
create table if not exists rh_inscricoes (
  id             bigserial primary key,
  vaga_id        bigint references rh_vagas(id) on delete set null,
  vaga_slug      text,
  -- Dados do candidato
  nome           text not null,
  email          text,
  telefone       text,
  cargo          text,
  cidade         text,
  estado         text,
  indicacao      text,             -- 'Sim' | 'Não'
  indicado_por   text,
  -- Currículo (Supabase Storage — bucket 'curriculos')
  curriculo_path text,
  curriculo_nome text,
  -- Metadata
  origem         text default 'lp_vagas',
  ip             text,
  user_agent     text,
  -- Funil do RH
  status         text not null default 'novo',
  observacao     text,
  -- Audit
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);

create index if not exists idx_rh_inscricoes_vaga   on rh_inscricoes (vaga_id);
create index if not exists idx_rh_inscricoes_status on rh_inscricoes (status);
create index if not exists idx_rh_inscricoes_criado on rh_inscricoes (criado_em desc);

-- Trigger pra atualizar atualizado_em
create or replace function trg_rh_inscricoes_touch() returns trigger as $$
begin
  new.atualizado_em = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_rh_inscricoes_touch on rh_inscricoes;
create trigger trg_rh_inscricoes_touch
before update on rh_inscricoes
for each row execute function trg_rh_inscricoes_touch();
