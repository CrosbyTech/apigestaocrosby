-- ─────────────────────────────────────────────────────────────────────────
-- RODAR NO SUPABASE DO DRYLAND (Cérebro, umhczriycvtagjqjnrzm) — SQL Editor.
--
-- Leitura dos Contratos PJ (área DP) pelo HeadCoach SEM token de sessão:
-- a RPC dp_pj_listar_headcoach(p_key) confere a chave e, por dentro, faz o
-- login com um usuário DP dedicado ("headcoach"), chama dp_pj_listar e
-- encerra a sessão. Nada é alterado no DP — é só leitura.
--
-- PASSOS:
--   1) No DP (dp.html, como admin): criar o usuário "headcoach" (papel "dp")
--      e definir a senha dele no primeiro acesso.
--   2) Trocar os 3 valores abaixo (chave, usuário, senha) e rodar este arquivo.
--   3) No HeadCoach (Render + .env local): DRYLAND_DP_KEY=<a mesma chave>.
--
-- A chave e a senha ficam só nesta tabela (sem acesso pelo anon) e no env do
-- HeadCoach; o front do HeadCoach nunca vê nenhuma das duas.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.dp_headcoach_cfg (
  id         int primary key default 1 check (id = 1),
  chave      text not null,
  usuario    text not null,
  senha      text not null,
  criado_em  timestamptz not null default now()
);
revoke all on public.dp_headcoach_cfg from anon, authenticated;
alter table public.dp_headcoach_cfg enable row level security;

insert into public.dp_headcoach_cfg (id, chave, usuario, senha)
values (1, 'TROCAR_CHAVE_LONGA_ALEATORIA', 'headcoach', 'TROCAR_SENHA_DO_USUARIO_DP')
on conflict (id) do update
  set chave = excluded.chave, usuario = excluded.usuario, senha = excluded.senha;

create or replace function public.dp_pj_listar_headcoach(p_key text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg   public.dp_headcoach_cfg%rowtype;
  lg    json;
  tok   text;
  res   json;
begin
  select * into cfg from public.dp_headcoach_cfg where id = 1;
  if cfg.chave is null or p_key is null or p_key <> cfg.chave then
    return json_build_object('ok', false, 'erro', 'chave');
  end if;

  lg := public.dp_login(cfg.usuario, cfg.senha);
  if coalesce((lg->>'ok')::boolean, false) is not true then
    return json_build_object('ok', false, 'erro', 'login', 'detalhe', lg->>'erro');
  end if;
  tok := lg->>'token';

  res := public.dp_pj_listar(tok);
  begin
    perform public.dp_logout(tok);
  exception when others then
    null; -- sessão fica pra expirar; a leitura já foi feita
  end;
  return res;
end;
$$;

revoke all on function public.dp_pj_listar_headcoach(text) from public;
grant execute on function public.dp_pj_listar_headcoach(text) to anon, authenticated, service_role;

-- teste (deve devolver {"ok":true,"contratos":[...],"total_mensal":[...]}):
-- select public.dp_pj_listar_headcoach('TROCAR_CHAVE_LONGA_ALEATORIA');
