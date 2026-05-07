-- Adiciona coluna canal_venda na tabela whatsapp_accounts
-- Valores esperados: 'varejo', 'revenda', 'franquia', 'multimarcas', 'business', 'showroom', 'inbound', 'ricardoeletro', 'bazar', null (todos)

ALTER TABLE whatsapp_accounts
  ADD COLUMN IF NOT EXISTS canal_venda TEXT DEFAULT NULL;

COMMENT ON COLUMN whatsapp_accounts.canal_venda IS
  'Canal de venda associado a este número WhatsApp. Ex: varejo, revenda, franquia, multimarcas, business, showroom, inbound, ricardoeletro, bazar. NULL = sem filtro de canal.';
