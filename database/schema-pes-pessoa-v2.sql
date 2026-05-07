-- =============================================
-- MIGRATION: pes_pessoa v2 - Todos os campos do schema TOTVS
-- Adiciona colunas para armazenar TODOS os dados retornados
-- pela API TOTVS person/v2 (individuals + legal-entities)
-- =============================================

-- Tipo pessoa (PF/PJ)
ALTER TABLE public.pes_pessoa ADD COLUMN IF NOT EXISTS tipo_pessoa varchar(2);

-- Dados gerais
ALTER TABLE public.pes_pessoa ADD COLUMN IF NOT EXISTS fantasy_name varchar(255);
ALTER TABLE public.pes_pessoa ADD COLUMN IF NOT EXISTS uf varchar(5);
ALTER TABLE public.pes_pessoa ADD COLUMN IF NOT EXISTS branch_insert_code integer;
ALTER TABLE public.pes_pessoa ADD COLUMN IF NOT EXISTS insert_date timestamptz;
ALTER TABLE public.pes_pessoa ADD COLUMN IF NOT EXISTS max_change_filter_date timestamptz;

-- Flags de classificação
ALTER TABLE public.pes_pessoa ADD COLUMN IF NOT EXISTS is_customer boolean;
ALTER TABLE public.pes_pessoa ADD COLUMN IF NOT EXISTS is_supplier boolean;
ALTER TABLE public.pes_pessoa ADD COLUMN IF NOT EXISTS is_representative boolean;
ALTER TABLE public.pes_pessoa ADD COLUMN IF NOT EXISTS is_purchasing_guide boolean;
ALTER TABLE public.pes_pessoa ADD COLUMN IF NOT EXISTS is_shipping_company boolean;
ALTER TABLE public.pes_pessoa ADD COLUMN IF NOT EXISTS customer_status varchar(50);
ALTER TABLE public.pes_pessoa ADD COLUMN IF NOT EXISTS person_status varchar(50);

-- Dados PJ específicos
ALTER TABLE public.pes_pessoa ADD COLUMN IF NOT EXISTS home_page varchar(500);
ALTER TABLE public.pes_pessoa ADD COLUMN IF NOT EXISTS code_activity varchar(50);
ALTER TABLE public.pes_pessoa ADD COLUMN IF NOT EXISTS code_activity_cnae integer;
ALTER TABLE public.pes_pessoa ADD COLUMN IF NOT EXISTS code_activity_cnae2 integer;
ALTER TABLE public.pes_pessoa ADD COLUMN IF NOT EXISTS number_employees integer;
ALTER TABLE public.pes_pessoa ADD COLUMN IF NOT EXISTS monthly_invoicing numeric(15,2);
ALTER TABLE public.pes_pessoa ADD COLUMN IF NOT EXISTS share_capital numeric(15,2);
ALTER TABLE public.pes_pessoa ADD COLUMN IF NOT EXISTS type_tax_regime varchar(100);
ALTER TABLE public.pes_pessoa ADD COLUMN IF NOT EXISTS type_sub_tributary varchar(100);
ALTER TABLE public.pes_pessoa ADD COLUMN IF NOT EXISTS type_description_suframa varchar(200);
ALTER TABLE public.pes_pessoa ADD COLUMN IF NOT EXISTS registration_municipal varchar(50);
ALTER TABLE public.pes_pessoa ADD COLUMN IF NOT EXISTS description_junta_cial varchar(255);
ALTER TABLE public.pes_pessoa ADD COLUMN IF NOT EXISTS date_reg_junta_cial date;
ALTER TABLE public.pes_pessoa ADD COLUMN IF NOT EXISTS code_main_related integer;
ALTER TABLE public.pes_pessoa ADD COLUMN IF NOT EXISTS cpf_cnpj_main_related varchar(20);
ALTER TABLE public.pes_pessoa ADD COLUMN IF NOT EXISTS name_main_related varchar(255);

-- Contato extraído (campo principal para consultas rápidas)
ALTER TABLE public.pes_pessoa ADD COLUMN IF NOT EXISTS telefone varchar(30);
ALTER TABLE public.pes_pessoa ADD COLUMN IF NOT EXISTS email varchar(255);

-- Dados aninhados (JSONB) - armazena arrays/objetos completos da API
ALTER TABLE public.pes_pessoa ADD COLUMN IF NOT EXISTS phones jsonb;
ALTER TABLE public.pes_pessoa ADD COLUMN IF NOT EXISTS emails jsonb;
ALTER TABLE public.pes_pessoa ADD COLUMN IF NOT EXISTS addresses jsonb;
ALTER TABLE public.pes_pessoa ADD COLUMN IF NOT EXISTS observations jsonb;
ALTER TABLE public.pes_pessoa ADD COLUMN IF NOT EXISTS customer_observations jsonb;
ALTER TABLE public.pes_pessoa ADD COLUMN IF NOT EXISTS additional_fields jsonb;
ALTER TABLE public.pes_pessoa ADD COLUMN IF NOT EXISTS classifications jsonb;
ALTER TABLE public.pes_pessoa ADD COLUMN IF NOT EXISTS person_references jsonb;
ALTER TABLE public.pes_pessoa ADD COLUMN IF NOT EXISTS relateds jsonb;
ALTER TABLE public.pes_pessoa ADD COLUMN IF NOT EXISTS partners jsonb;
ALTER TABLE public.pes_pessoa ADD COLUMN IF NOT EXISTS shipping_company jsonb;
ALTER TABLE public.pes_pessoa ADD COLUMN IF NOT EXISTS contacts jsonb;
ALTER TABLE public.pes_pessoa ADD COLUMN IF NOT EXISTS statistics jsonb;
ALTER TABLE public.pes_pessoa ADD COLUMN IF NOT EXISTS preferences jsonb;
ALTER TABLE public.pes_pessoa ADD COLUMN IF NOT EXISTS payment_methods jsonb;
ALTER TABLE public.pes_pessoa ADD COLUMN IF NOT EXISTS social_networks jsonb;
ALTER TABLE public.pes_pessoa ADD COLUMN IF NOT EXISTS representatives jsonb;

-- Timestamp de atualização
ALTER TABLE public.pes_pessoa ADD COLUMN IF NOT EXISTS updated_at timestamptz default now();

-- Índices úteis
CREATE INDEX IF NOT EXISTS idx_pes_pessoa_tipo ON public.pes_pessoa (tipo_pessoa);
CREATE INDEX IF NOT EXISTS idx_pes_pessoa_cpf ON public.pes_pessoa (cpf);
CREATE INDEX IF NOT EXISTS idx_pes_pessoa_nome ON public.pes_pessoa (nm_pessoa);
CREATE INDEX IF NOT EXISTS idx_pes_pessoa_insert_date ON public.pes_pessoa (insert_date);
CREATE INDEX IF NOT EXISTS idx_pes_pessoa_is_customer ON public.pes_pessoa (is_customer);
