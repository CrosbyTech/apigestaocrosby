-- Boleto Pagar.me pago mas ainda não creditado (João, 30/10/2026): entra na
-- Solicitação de Baixa já no pagamento, com a baixa BLOQUEADA até o dinheiro
-- cair na conta (liberar_em = data de crédito). A tela libera quando chega o dia.
alter table solicitacoes_baixa add column if not exists bloqueado boolean not null default false;
alter table solicitacoes_baixa add column if not exists liberar_em date;
