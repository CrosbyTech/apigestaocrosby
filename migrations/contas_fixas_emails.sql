-- E-mails das despesas fixas encaminhados para o HeadCoach.
--
-- A caixa de Patrimônio (Gmail) encaminha, por filtro, só as mensagens das
-- operadoras para um endereço do domínio (Cloudflare Email Routing), que repassa
-- cada mensagem para POST /api/contas-fixas/email-entrada. Aqui fica o que chegou:
-- o código de confirmação que a operadora manda antes de mostrar a fatura e, mais
-- adiante, as próprias faturas que chegam em anexo.
--
-- Segurança: RLS LIGADO e SEM política — só o servidor lê e grava.
create table if not exists contas_fixas_emails (
  id bigserial primary key,
  recebido_em timestamptz not null default now(),
  envelope_de text,            -- remetente do envelope (no encaminhamento do Gmail é a conta que encaminhou)
  envelope_para text,          -- endereço do domínio que recebeu
  de text,                     -- cabeçalho From: quem escreveu de verdade
  de_nome text,
  assunto text,
  data_envio timestamptz,      -- cabeçalho Date
  message_id text,
  texto text,                  -- corpo em texto (o HTML é convertido)
  codigo text,                 -- código de confirmação achado no texto, quando há
  anexos jsonb not null default '[]'::jsonb, -- [{ nome, tipo, tamanho, path }] (só PDF é guardado)
  tamanho int,
  usado_em timestamptz,        -- quando um bot consumiu o código
  usado_por text
);
create unique index if not exists contas_fixas_emails_msgid on contas_fixas_emails (message_id) where message_id is not null;
create index if not exists contas_fixas_emails_recebido on contas_fixas_emails (recebido_em desc);
create index if not exists contas_fixas_emails_de on contas_fixas_emails (de, recebido_em desc);

-- leitura de fatura (services/contasFixasEmailFaturas.js): o que foi feito com o e-mail
alter table contas_fixas_emails add column if not exists processado_em timestamptz;
alter table contas_fixas_emails add column if not exists resultado text;
alter table contas_fixas_emails add column if not exists fatura_id bigint;

alter table contas_fixas_emails enable row level security;
