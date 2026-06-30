-- Colunas usadas pelo botão "LIBERAR PARA PAGAMENTO" em src/pages/SolicitacoesCrosby.jsx
-- Registram quando/por quem a solicitação foi enviada à página de Liberação de Pagamento
-- e o vínculo com a linha criada em pagamentos_liberacao.
alter table solicitacoes_crosby
  add column if not exists liberado_pagamento_em        timestamptz,
  add column if not exists liberado_pagamento_por        uuid,
  add column if not exists liberado_pagamento_por_nome   text,
  add column if not exists pagamento_liberacao_id        uuid references pagamentos_liberacao (id) on delete set null;

create index if not exists idx_solicitacoes_crosby_pagamento_liberacao_id
  on solicitacoes_crosby (pagamento_liberacao_id)
  where pagamento_liberacao_id is not null;
