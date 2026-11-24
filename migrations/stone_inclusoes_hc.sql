-- Inclusão de pagamentos na Stone a partir da Liberação de Pagamento do HEADCOACH (Yago, 24/11/2026).
-- A fila é a mesma do botão APROVAR da Liberação antiga (stone_inclusoes); a linha passa a
-- poder apontar para uma liberação do HeadCoach (hc_cp_liberacoes.id) em vez do título antigo.
alter table stone_inclusoes alter column liberacao_id drop not null;
alter table stone_inclusoes add column if not exists hc_liberacao_id bigint;
-- uma liberação do HeadCoach só entra uma vez na fila (a trava contra pagar em dobro)
create unique index if not exists stone_inclusoes_hc_lib_uniq on stone_inclusoes (hc_liberacao_id) where hc_liberacao_id is not null;
-- situação da inclusão guardada na própria liberação (é de lá que a tela lê)
alter table hc_cp_liberacoes add column if not exists inclusao jsonb;
