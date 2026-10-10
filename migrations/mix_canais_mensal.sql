-- Mix de Canais — faturamento mensal por canal (valor) usado pelo dashboard
-- /mix-canais. Linha aqui tem PRIORIDADE sobre o cálculo automático do New
-- Forecast (rota /sale-panel/faturamento-vendedor-semanal). Serve para:
--   • histórico fechado (jan–jul/2026, vindo do relatório "Ds. Tipo Cliente")
--   • ajuste manual de um mês que o forecast calculou errado
-- Mês sem linha e já iniciado → calculado do New Forecast na hora.
-- Rodar no SQL Editor do projeto Supabase PRINCIPAL.

create table if not exists mix_canais_mensal (
  mes text primary key, -- 'YYYY-MM'
  canais jsonb not null default '{}'::jsonb, -- { CANAL: valor em R$ }
  origem text not null default 'manual', -- 'historico' | 'manual'
  observacao text,
  atualizado_em timestamptz default now()
);

comment on table mix_canais_mensal is
  'Mix de Canais: faturamento mensal por canal digitado/histórico (prioridade sobre o New Forecast).';

-- Histórico jan–jul/2026 (relatório "Ds. Tipo Cliente"). O relatório mostra
-- só 5 canais, mas o Total global é maior: a diferença vai para OUTROS para
-- os percentuais baterem com o relatório.
insert into mix_canais_mensal (mes, canais, origem, observacao) values
  ('2026-01', '{"VAREJO":319965.05,"REVENDA":277992.41,"FRANQUIAS":187166.90,"MULTIMARCAS":166607.03,"BAZAR":25083.61,"OUTROS":17178.50}', 'historico', 'Ds. Tipo Cliente — total global 993.993,50'),
  ('2026-02', '{"VAREJO":280689.46,"REVENDA":225296.15,"FRANQUIAS":106478.30,"MULTIMARCAS":177559.96,"BAZAR":38251.60,"OUTROS":60478.91}', 'historico', 'Ds. Tipo Cliente — total global 888.754,38'),
  ('2026-03', '{"VAREJO":293356.84,"REVENDA":265181.57,"FRANQUIAS":123422.98,"MULTIMARCAS":302042.51,"BAZAR":25075.10,"OUTROS":63495.80}', 'historico', 'Ds. Tipo Cliente — total global 1.072.574,80'),
  ('2026-04', '{"VAREJO":348542.26,"REVENDA":208221.05,"FRANQUIAS":261865.01,"MULTIMARCAS":280552.15,"BAZAR":22055.94,"OUTROS":5924.02}', 'historico', 'Ds. Tipo Cliente — total global 1.127.160,43'),
  ('2026-05', '{"VAREJO":331406.76,"REVENDA":193692.01,"FRANQUIAS":454966.98,"MULTIMARCAS":337400.29,"BAZAR":34794.47,"OUTROS":4940.00}', 'historico', 'Ds. Tipo Cliente — total global 1.357.200,51'),
  ('2026-06', '{"VAREJO":372333.15,"REVENDA":151739.08,"FRANQUIAS":273191.66,"MULTIMARCAS":174790.99,"BAZAR":19104.85,"OUTROS":6380.00}', 'historico', 'Ds. Tipo Cliente — total global 997.539,73'),
  ('2026-07', '{"VAREJO":296520.86,"REVENDA":160574.81,"FRANQUIAS":431350.61,"MULTIMARCAS":289969.70,"BAZAR":24680.11,"OUTROS":13382.81}', 'historico', 'Ds. Tipo Cliente — total global 1.216.478,90')
on conflict (mes) do nothing;
