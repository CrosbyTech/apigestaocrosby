-- Adiciona CVV (3 dígitos) auto-gerado ao lead BlueCard.
-- Gerado automaticamente quando o lead é criado pela LP pública.
-- Usado pra rastreabilidade do cartão emitido.
alter table bluecard_leads
  add column if not exists cvv text;

-- Índice pra busca rápida quando o vendedor digita o CVV no caixa
create index if not exists idx_bluecard_leads_cvv
  on bluecard_leads (cvv)
  where cvv is not null;
