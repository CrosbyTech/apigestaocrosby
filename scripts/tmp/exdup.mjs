import 'dotenv/config';
import supabase from '../../config/supabase.js';
const { data: s } = await supabase.from('solicitacoes_crosby').select('id,status,duplicate_code,payload_totvs,cd_empresa,nm_empresa,supplier_name,supplier_cpf_cnpj,valor_total,forma_pagamento,setor,tipo_solicitacao,descricao').eq('status', 'enviado_totvs').order('enviado_totvs_em', { ascending: false }).limit(1);
console.log(JSON.stringify(s?.[0], null, 1).slice(0, 2500));
const { data: d } = await supabase.from('accounts_payable_duplicates_v').select('branch_code,supplier_code,supplier_name,supplier_cpf_cnpj,duplicate_code,duplicate_value,issue_date,expense,bearer_code,document_type,origem').contains('expense', [{ expenseCode: 7008 }]).order('issue_date', { ascending: false }).limit(5);
for (const x of d || []) console.log(x.branch_code, x.supplier_code, x.supplier_name, x.supplier_cpf_cnpj, x.duplicate_code, x.duplicate_value, String(x.issue_date).slice(0,10), JSON.stringify(x.expense), x.bearer_code, x.document_type, x.origem);
process.exit(0);
