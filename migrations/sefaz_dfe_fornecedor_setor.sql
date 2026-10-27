-- Memória fornecedor → setor (Manifestação do Destinatário › Pendentes).
-- Pedido da Niziany (27/10/2026): o sistema lembra o setor escolhido para um
-- fornecedor e preenche as próximas notas dele; "sem setor" fica só para
-- fornecedor novo. Idempotente.
create table if not exists sefaz_dfe_fornecedor_setor (
  emitente_cnpj text primary key,
  setor text not null,
  origem text not null default 'manual', -- manual | planilha
  emitente_nome text,
  atualizado_em timestamptz not null default now()
);
