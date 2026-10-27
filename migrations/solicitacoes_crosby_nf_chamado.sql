-- Vínculo solicitação de pagamento ↔ chamado de NF no Dryland.
-- O front (SolicitacoesCrosby.jsx) já grava estes campos desde o fluxo
-- "nota_fiscal", mas as colunas nunca foram criadas: o update falhava em
-- silêncio e a automação abria chamados em duplicidade. Idempotente.
-- (Jojo, 27/10/2026)
alter table solicitacoes_crosby add column if not exists nf_chamado_dryland_id bigint;
alter table solicitacoes_crosby add column if not exists nf_chamado_dryland_numero integer;
alter table solicitacoes_crosby add column if not exists nf_chamado_aberto_em timestamptz;
alter table solicitacoes_crosby add column if not exists nf_escriturado_em timestamptz;
create index if not exists solicitacoes_crosby_nf_chamado_idx on solicitacoes_crosby (nf_chamado_dryland_id);
