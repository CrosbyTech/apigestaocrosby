-- Previsão de Recebimento (réplica da aba "Fluxo de Recebíveis" do Dryland — João, 27/10/2026)
-- Marcação manual por cliente: SIM / TALVEZ / NÃO sobrepõe a classificação automática.
create table if not exists previsao_recebimento_marcacoes (
  cd_cliente integer primary key,
  status text not null check (status in ('sim','talvez','nao','auto')),  -- 'auto' = voltou ao automático (nada é apagado)
  por text,
  motivo text,
  em timestamptz not null default now()
);
-- Histórico semanal (sábado a sexta): o que estava previsto por cliente/status e o que foi pago
create table if not exists previsao_recebimento_semanas (
  id bigserial primary key,
  semana date not null,            -- sábado que abre a semana
  cd_cliente integer not null,
  canal text,
  status text not null,
  previsto numeric(14,2) not null default 0,
  titulos jsonb not null default '[]'::jsonb,  -- [{e,f,p,venc,valor}]
  gravado_em timestamptz not null default now(),
  unique (semana, cd_cliente)
);
create index if not exists previsao_recebimento_semanas_semana_idx on previsao_recebimento_semanas (semana);

-- 'auto' = marcação manual desfeita (mantém o registro; não apagamos linhas)
alter table previsao_recebimento_marcacoes drop constraint if exists previsao_recebimento_marcacoes_status_check;
alter table previsao_recebimento_marcacoes add constraint previsao_recebimento_marcacoes_status_check check (status in ('sim','talvez','nao','auto'));

-- Snapshot semanal FIXO (João, 27/10/2026): a tela lê daqui, não calcula ao abrir.
create table if not exists previsao_recebimento_snapshot (
  semana date primary key,
  idx int,
  dados jsonb not null,
  gerado_em timestamptz not null default now()
);
