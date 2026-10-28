-- Setor PATRIMONIO nas Solicitações Crosby (pedido do Yago, 28/10/2026).
--
-- • produto_servico: 'PRODUTO' (o Jesus paga no cartão/PagBank e a solicitação
--   é CONCILIADA com o extrato bancário antes de ir ao TOTVS) ou 'SERVICO'
--   (fluxo normal: pendente → aprovado_gestor → enviado_totvs → Liberação).
-- • patrimonio: número/plaqueta do bem, ao lado da nota fiscal na tela de gestão.
-- • conciliacao_*: rastro da conciliação com o extrato (fluxo_caixa_lancamentos).
-- • status novos: aguardando_conciliacao (PRODUTO recém-aberto) e conciliado
--   (saída encontrada no extrato; pronto para lançar no TOTVS).
-- Idempotente.
alter table solicitacoes_crosby
  add column if not exists produto_servico            text,
  add column if not exists patrimonio                 text,
  add column if not exists conciliado_em              timestamptz,
  add column if not exists conciliado_por_nome        text,
  add column if not exists conciliacao_lancamento_id  bigint,
  add column if not exists conciliacao_banco          text,
  add column if not exists conciliacao_data           date;

alter table solicitacoes_crosby drop constraint if exists solicitacoes_crosby_produto_servico_check;
alter table solicitacoes_crosby add constraint solicitacoes_crosby_produto_servico_check
  check (produto_servico is null or produto_servico in ('PRODUTO', 'SERVICO'));

alter table solicitacoes_crosby drop constraint if exists solicitacoes_crosby_status_check;
alter table solicitacoes_crosby add constraint solicitacoes_crosby_status_check
  check (status = any (array[
    'pendente', 'aprovado_gestor', 'aprovado_financeiro', 'enviado_totvs',
    'nota_fiscal', 'erro_envio', 'rejeitado', 'cancelada',
    'aguardando_conciliacao', 'conciliado'
  ]));

create index if not exists idx_solicitacoes_crosby_setor_status
  on solicitacoes_crosby (setor, status);
