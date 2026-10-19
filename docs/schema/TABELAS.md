# Schema do Supabase principal (public)

Gerado por `node scripts/erp-schema-snapshot.mjs` em 2026-10-17T16:16:55.057Z. 309 tabelas/views, 267 funções.

| Tabela | Tipo | RLS | Policies | Colunas | Linhas (est.) |
|---|---|---|---|---|---|
| accounts_payable_commands | tabela | sim | 1 | 14 | -1 |
| accounts_payable_duplicate_expenses | tabela | sim | 1 | 10 | 9620 |
| accounts_payable_duplicates | tabela | sim | 1 | 32 | 8060 |
| accounts_payable_duplicates_v | view | não | 0 | 36 | -1 |
| accounts_receivable_commands | tabela | sim | 1 | 16 | -1 |
| accounts_receivable_document_invoices | tabela | sim | 1 | 9 | 969 |
| accounts_receivable_documents | tabela | sim | 1 | 45 | 1866 |
| accounts_receivable_documents_v | view | não | 0 | 50 | -1 |
| analises_credito | tabela | sim | 3 | 22 | 125 |
| antecipacoes_faturas | tabela | sim | 5 | 19 | 0 |
| app_aspect_group | tabela | não | 0 | 5 | -1 |
| app_aspect_group_instance | tabela | não | 0 | 5 | -1 |
| app_aspect_item | tabela | não | 0 | 6 | -1 |
| app_evaluation | tabela | não | 0 | 12 | -1 |
| app_evaluation_aspect | tabela | não | 0 | 7 | -1 |
| atendimentos | tabela | sim | 1 | 10 | 156 |
| audios_crosby | tabela | não | 0 | 6 | -1 |
| auditor_auditorias | view | não | 0 | 18 | -1 |
| auditor_infracoes | view | não | 0 | 11 | -1 |
| auditor_resumo_loja | view | não | 0 | 6 | -1 |
| auditor_resumo_vendedor | view | não | 0 | 6 | -1 |
| auditor_top_infracoes | view | não | 0 | 3 | -1 |
| auditor_validacoes | view | não | 0 | 7 | -1 |
| automacao_boleto_envios | tabela | sim | 0 | 21 | 1622 |
| avaliacao_franquias | tabela | não | 0 | 13 | 1253 |
| avaliacao_lojas | tabela | sim | 1 | 45 | 7267 |
| avaliacao_sdr_franquia | tabela | não | 0 | 13 | 235 |
| balanco_lv | tabela | sim | 1 | 14 | 100 |
| banco_de_talentos | tabela | sim | 1 | 12 | 1418 |
| base_do_rh | tabela | sim | 1 | 17 | 226 |
| bd_banco_horas | tabela | sim | 1 | 4 | 57 |
| bluecard_eventos | tabela | sim | 0 | 8 | 370 |
| bluecard_leads | tabela | não | 0 | 36 | 405 |
| bluecard_liberacoes | tabela | sim | 0 | 17 | 37 |
| bluecard_titulos | tabela | sim | 0 | 18 | 231 |
| bluecred_contratos | tabela | não | 0 | 11 | -1 |
| call_center_contatos | tabela | sim | 2 | 10 | 346 |
| call_center_ligacoes | tabela | sim | 2 | 11 | 2630 |
| canal_totals_cache | tabela | não | 0 | 9 | 45 |
| candidates | tabela | sim | 1 | 6 | -1 |
| carts | tabela | não | 0 | 6 | -1 |
| case | tabela | sim | 2 | 18 | -1 |
| case_document | tabela | sim | 1 | 9 | -1 |
| case_movement | tabela | sim | 1 | 8 | -1 |
| case_notification | tabela | sim | 1 | 22 | -1 |
| case_notification_lawyer | tabela | sim | 1 | 3 | -1 |
| case_tag | tabela | sim | 1 | 3 | -1 |
| catalogo_banners | tabela | sim | 5 | 9 | -1 |
| catalogo_categorias | tabela | sim | 5 | 8 | -1 |
| catalogo_configuracoes | tabela | sim | 4 | 6 | -1 |
| catalogo_produto_imagens | tabela | sim | 5 | 6 | -1 |
| catalogo_produtos | tabela | sim | 5 | 12 | -1 |
| classificacoes_inadimplentes | tabela | sim | 5 | 13 | 204 |
| client | tabela | sim | 1 | 16 | 5 |
| client_address | tabela | sim | 1 | 13 | 5 |
| client_contact | tabela | sim | 1 | 11 | 8 |
| client_interaction | tabela | sim | 1 | 10 | 8 |
| client_note | tabela | sim | 1 | 6 | 8 |
| client_payment | tabela | sim | 1 | 11 | -1 |
| client_status | tabela | sim | 3 | 7 | 5 |
| client_tag | tabela | sim | 1 | 3 | -1 |
| client_type | tabela | sim | 3 | 6 | 2 |
| cliente_cartao | tabela | não | 0 | 4 | 935 |
| clientes_confianca_documentos | tabela | sim | 2 | 8 | 422 |
| clientes_confianca_perfil | tabela | sim | 2 | 6 | 30 |
| clientes_empresa | tabela | não | 0 | 20 | -1 |
| clientes_filial_salvos | tabela | sim | 0 | 10 | -1 |
| companies | tabela | sim | 2 | 10 | -1 |
| configuracoes | tabela | sim | 1 | 5 | -1 |
| contas_autorizacoes | tabela | não | 0 | 13 | 38 |
| contatos_whatsapp | tabela | não | 0 | 11 | 3008 |
| conversas | tabela | não | 0 | 11 | -1 |
| cotacao_usd_brl | tabela | não | 0 | 4 | 95 |
| court | tabela | sim | 1 | 5 | -1 |
| crm_lead_generation_calls | tabela | não | 0 | 15 | 1255 |
| crm_roubos | tabela | não | 1 | 10 | -1 |
| crm_seller_metas | tabela | não | 0 | 12 | 1 |
| crm_varejo_avisos | tabela | não | 0 | 11 | -1 |
| crm_varejo_competicoes | tabela | não | 0 | 19 | -1 |
| crm_varejo_x1 | tabela | sim | 0 | 11 | -1 |
| custom_fields | tabela | sim | 4 | 16 | -1 |
| custos_producao | tabela | não | 0 | 3 | 456 |
| dashboard_config | tabela | sim | 1 | 15 | 13 |
| dashboard_folder | tabela | sim | 1 | 9 | -1 |
| dashboards | tabela | sim | 4 | 8 | 1 |
| database_connections | tabela | sim | 2 | 20 | -1 |
| despesas_fixas_filial | tabela | sim | 4 | 15 | 43 |
| despesas_industria_pagamentos | tabela | sim | 4 | 13 | 34 |
| despesas_manuais_dre | tabela | sim | 1 | 12 | -1 |
| devolucoes_mercadoria | tabela | sim | 0 | 39 | -1 |
| devolucoes_transacoes | tabela | sim | 0 | 32 | -1 |
| employee | tabela | sim | 2 | 51 | 5 |
| employee_documents | tabela | sim | 2 | 10 | -1 |
| employee_medical_leaves | tabela | sim | 2 | 8 | -1 |
| employee_salary | tabela | sim | 2 | 7 | -1 |
| employee_vacations | tabela | sim | 2 | 9 | -1 |
| employees | tabela | sim | 4 | 12 | -1 |
| endividamentos | tabela | sim | 4 | 24 | 27 |
| envio_adv | tabela | sim | 1 | 9 | 218 |
| envio_em_massa | tabela | sim | 1 | 9 | 9154 |
| erp_bonus_saldo | tabela | sim | 1 | 6 | -1 |
| erp_centros_custo | tabela | sim | 1 | 6 | -1 |
| erp_classificacao_tipos | tabela | sim | 1 | 6 | 36 |
| erp_classificacoes | tabela | sim | 1 | 8 | 320 |
| erp_codigos_barras | tabela | sim | 1 | 8 | 3962 |
| erp_condicoes_pagamento | tabela | sim | 1 | 10 | 94 |
| erp_config | tabela | sim | 1 | 7 | -1 |
| erp_cores | tabela | sim | 1 | 6 | 855 |
| erp_custos | tabela | sim | 1 | 7 | 49098 |
| erp_despesas_itens | tabela | sim | 1 | 6 | 302 |
| erp_empresas | tabela | sim | 1 | 22 | 290 |
| erp_estoques | tabela | sim | 1 | 4 | -1 |
| erp_grades | tabela | sim | 1 | 7 | -1 |
| erp_operacoes | tabela | sim | 1 | 22 | 926 |
| erp_pessoas | tabela | sim | 1 | 40 | 23466 |
| erp_portadores | tabela | sim | 1 | 6 | 390 |
| erp_precos | tabela | sim | 1 | 9 | 17000 |
| erp_precos_tabela | tabela | sim | 1 | 8 | -1 |
| erp_produtos | tabela | sim | 1 | 33 | 9500 |
| erp_representantes | tabela | sim | 1 | 18 | 53 |
| erp_sync_controle | tabela | sim | 1 | 11 | 19 |
| erp_sync_log | tabela | sim | 1 | 11 | -1 |
| erp_tabelas_preco | tabela | sim | 1 | 15 | -1 |
| erp_unidades | tabela | sim | 1 | 4 | 101 |
| erp_vendedores | tabela | sim | 1 | 9 | 199 |
| erros_producao | tabela | sim | 1 | 5 | 49 |
| esteira_protesto | tabela | sim | 5 | 20 | 276 |
| expedicao_showroom | tabela | não | 0 | 20 | 772 |
| faturamento_diario_canal | tabela | não | 0 | 11 | 2653 |
| faturamento_transacao_historico | tabela | não | 0 | 20 | 143011 |
| faturamento_vendedor_mensal | tabela | sim | 3 | 9 | 857 |
| fila_atendimentos | tabela | não | 0 | 17 | -1 |
| fila_lojas_config | tabela | não | 0 | 8 | -1 |
| fila_motivos_nao_venda | tabela | não | 0 | 5 | -1 |
| fila_status_log | tabela | não | 0 | 7 | -1 |
| fila_vendedora_status | tabela | não | 0 | 7 | -1 |
| fila_vendedoras | tabela | não | 0 | 8 | -1 |
| fluxo_caixa_contas | tabela | sim | 0 | 13 | -1 |
| fluxo_caixa_importacoes | tabela | sim | 0 | 13 | 17 |
| fluxo_caixa_lancamentos | tabela | sim | 0 | 25 | 688 |
| fluxo_caixa_transferencias | tabela | sim | 0 | 11 | 41 |
| followers_instagram | tabela | não | 0 | 3 | 51 |
| forecast_budget_trimestral | tabela | sim | 0 | 13 | -1 |
| forecast_canal_metas | tabela | não | 0 | 9 | 168 |
| forecast_canal_metas_log | tabela | não | 0 | 13 | 149 |
| forecast_canal_snapshot | tabela | não | 0 | 8 | -1 |
| forecast_comparativo_ref | tabela | não | 0 | 11 | 68 |
| forecast_credev_ajustes | tabela | sim | 0 | 6 | -1 |
| forecast_credev_overrides | tabela | não | 0 | 13 | -1 |
| forecast_credev_overrides_log | tabela | não | 0 | 13 | -1 |
| forecast_faturamento_vendedor | tabela | não | 0 | 10 | 10 |
| forecast_faturamento_vendedor_sync | tabela | não | 0 | 8 | -1 |
| forecast_painel_vendas | tabela | não | 0 | 8 | 8889 |
| forecast_per_seller_cache | tabela | não | 0 | 10 | 991 |
| forecast_promessa_canais | tabela | não | 0 | 9 | -1 |
| forecast_promessa_mensal_metas | tabela | não | 0 | 11 | -1 |
| forecast_promessa_metas | tabela | não | 0 | 12 | -1 |
| forecast_vendedor_remap | tabela | sim | 0 | 7 | -1 |
| gestao_aso | tabela | sim | 1 | 6 | 192 |
| gestao_pedidos | tabela | sim | 1 | 17 | 4892 |
| hires | tabela | sim | 1 | 6 | -1 |
| id_clickup | tabela | não | 0 | 13 | 123 |
| inadimplencia_mtm_representantes_timeline | tabela | sim | 3 | 7 | 1874 |
| inadimplencia_mtm_timeline | tabela | sim | 3 | 9 | 158 |
| inadimplencia_revenda_representantes_timeline | tabela | sim | 3 | 7 | 143 |
| inadimplencia_revenda_timeline | tabela | sim | 3 | 9 | 23 |
| inadimplencia_timeline | tabela | sim | 2 | 13 | 154 |
| instance_access_config | tabela | sim | 4 | 6 | 105 |
| insurance | tabela | sim | 1 | 7 | -1 |
| integracao_outbox | tabela | sim | 1 | 20 | -1 |
| integracao_outbox_log | tabela | sim | 1 | 9 | -1 |
| lawyer | tabela | sim | 1 | 6 | -1 |
| lideranca_logistica | tabela | sim | 1 | 5 | 61 |
| lojas | tabela | sim | 1 | 8 | -1 |
| medical_exams | tabela | sim | 1 | 5 | -1 |
| message_queue | tabela | sim | 4 | 42 | 5012 |
| meta_ad_accounts | tabela | não | 0 | 8 | -1 |
| meta_webhook_events | tabela | não | 0 | 11 | -1 |
| meta_whatsapp_gastos_dia | tabela | não | 0 | 8 | 381 |
| metas_mensais_calculadas | tabela | não | 0 | 10 | 90 |
| metas_semanais_varejo | tabela | não | 0 | 11 | 1401 |
| metas_varejo | tabela | sim | 1 | 8 | 0 |
| metric_instagram | tabela | não | 0 | 7 | 1475 |
| modules | tabela | sim | 2 | 7 | 9 |
| motivos_nao_conversao | tabela | sim | 1 | 5 | -1 |
| nct_expedicao | tabela | sim | 2 | 9 | 66 |
| nct_lv | tabela | sim | 1 | 9 | 133 |
| nct_pcp | tabela | sim | 1 | 9 | 97 |
| new_forecast_canais_extra | tabela | sim | 0 | 3 | -1 |
| new_forecast_config | tabela | sim | 0 | 8 | 9 |
| new_forecast_semana_cache | tabela | sim | 0 | 5 | -1 |
| nf_observacoes | tabela | sim | 4 | 5 | -1 |
| notas_fiscais | tabela | sim | 0 | 69 | 124196 |
| notice_reads | tabela | sim | 2 | 5 | 55 |
| notice_recipients | tabela | sim | 1 | 5 | 234 |
| notices | tabela | sim | 4 | 8 | -1 |
| notificacoes_credito | tabela | sim | 3 | 11 | 4 |
| notificacoes_renegociacao | tabela | sim | 3 | 11 | -1 |
| notificacoes_sistema | tabela | sim | 2 | 10 | 646 |
| observacoes_despesas_manuais | tabela | sim | 3 | 7 | -1 |
| observacoes_despesas_totvs | tabela | sim | 5 | 13 | 13 |
| observacoes_inadimplentes | tabela | não | 1 | 6 | -1 |
| observacoes_inadimplentes_franquias | tabela | não | 1 | 6 | -1 |
| orders | tabela | sim | 1 | 11 | -1 |
| pagamentos_fabricas | tabela | sim | 5 | 27 | 55 |
| pagamentos_liberacao | tabela | sim | 5 | 37 | 1510 |
| pagarme_boletos | tabela | sim | 0 | 32 | 1283 |
| pages | tabela | sim | 2 | 10 | 15 |
| patient | tabela | sim | 1 | 17 | 3 |
| patient_address | tabela | sim | 1 | 16 | -1 |
| patient_contact | tabela | sim | 1 | 8 | -1 |
| patient_interaction | tabela | sim | 1 | 12 | -1 |
| patient_note | tabela | sim | 1 | 8 | -1 |
| patient_service | tabela | sim | 1 | 7 | -1 |
| patient_status | tabela | sim | 1 | 7 | -1 |
| patient_tag | tabela | sim | 1 | 4 | -1 |
| patient_type | tabela | sim | 1 | 6 | -1 |
| pdv_cupons_troca | tabela | sim | 0 | 14 | -1 |
| pdv_epc_movimentos | tabela | sim | 0 | 19 | -1 |
| pdv_epc_situacao | view | não | 0 | 12 | -1 |
| pdv_fiscal_config | tabela | sim | 0 | 20 | -1 |
| pdv_notas_fiscais | tabela | sim | 0 | 25 | -1 |
| pdv_venda_itens | tabela | sim | 0 | 16 | -1 |
| pdv_venda_pagamentos | tabela | sim | 0 | 10 | -1 |
| pdv_vendas | tabela | sim | 0 | 23 | -1 |
| pes_pessoa | tabela | não | 1 | 69 | 105026 |
| pesquisa_de_satisfacao_rh | tabela | sim | 1 | 3 | 170 |
| pessoas_bluecred | tabela | não | 0 | 7 | 40 |
| prescription | tabela | sim | 1 | 10 | -1 |
| processo_seletivo | tabela | sim | 1 | 10 | 2968 |
| products | tabela | sim | 1 | 10 | -1 |
| profession | tabela | sim | 1 | 6 | -1 |
| professional | tabela | sim | 1 | 10 | -1 |
| promocao_grupos | tabela | sim | 0 | 14 | -1 |
| promocao_vouchers | tabela | sim | 0 | 13 | 45 |
| reach_instagram | tabela | sim | 1 | 3 | 344 |
| recuperacao_credito_anexos | tabela | sim | 2 | 7 | -1 |
| recuperacao_credito_status | tabela | sim | 2 | 6 | 78 |
| retorno_bancario | tabela | sim | 5 | 21 | 153 |
| rh_documentos_admissao | tabela | não | 0 | 14 | -1 |
| rh_inscricoes | tabela | não | 0 | 20 | -1 |
| rh_vagas | tabela | não | 0 | 13 | -1 |
| role_page_perms | tabela | sim | 2 | 8 | 80 |
| sac_franquias | tabela | sim | 1 | 8 | 355 |
| saldo_bancario | tabela | sim | 2 | 4 | 9 |
| sales_closing_records | tabela | sim | 0 | 14 | 34 |
| schema_migrations | tabela | não | 0 | 3 | -1 |
| sefaz_dfe_controle | tabela | sim | 0 | 9 | 20 |
| sefaz_dfe_notas | tabela | sim | 0 | 23 | 2973 |
| setor_usuarios | tabela | sim | 2 | 5 | 61 |
| setores | tabela | sim | 2 | 6 | -1 |
| sms_enviados | tabela | sim | 0 | 10 | 7418 |
| solicitacoes_baixa | tabela | não | 5 | 35 | 290 |
| solicitacoes_credito | tabela | sim | 5 | 23 | 2 |
| solicitacoes_crosby | tabela | sim | 5 | 69 | 790 |
| solicitacoes_remessa | tabela | sim | 5 | 10 | -1 |
| solicitacoes_remessa_titulos | tabela | sim | 4 | 15 | -1 |
| solicitacoes_renegociacoes | tabela | sim | 4 | 21 | -1 |
| tag | tabela | sim | 1 | 6 | -1 |
| tech_chips | tabela | não | 0 | 23 | 100 |
| tech_chips_log | tabela | não | 0 | 8 | -1 |
| tech_cotacoes | tabela | não | 0 | 15 | -1 |
| tech_cotacoes_fornecedores | tabela | não | 0 | 18 | -1 |
| tech_patrimonio | tabela | não | 0 | 23 | 884 |
| tech_patrimonio_log | tabela | não | 0 | 8 | -1 |
| template_disparos | tabela | sim | 0 | 24 | -1 |
| terminations | tabela | sim | 1 | 9 | -1 |
| totvs_operacoes | tabela | não | 1 | 5 | -1 |
| treinamento_franquias | tabela | sim | 1 | 6 | 145 |
| user_companies | tabela | sim | 6 | 6 | 238 |
| user_instance_permissions | tabela | sim | 4 | 7 | 129 |
| user_page_permissions | tabela | sim | 6 | 6 | 3406 |
| user_profiles | tabela | sim | 3 | 8 | -1 |
| user_profiles_antiga | tabela | sim | 5 | 8 | 17 |
| users | tabela | sim | 2 | 16 | 161 |
| usuarios | tabela | não | 0 | 5 | -1 |
| usuarios_view | view | não | 0 | 3 | -1 |
| v_vendedores_integracao | view | não | 0 | 11 | -1 |
| vacancies | tabela | sim | 1 | 5 | -1 |
| vendedores | tabela | sim | 1 | 7 | -1 |
| voucher_batches | tabela | sim | 0 | 16 | -1 |
| vw_aspect_groups_with_instances | view | não | 0 | 6 | -1 |
| vw_case_value | view | não | 0 | 3 | -1 |
| vw_clients | view | não | 0 | 34 | -1 |
| vw_database_connections | view | não | 0 | 22 | -1 |
| vw_employees | view | não | 0 | 58 | -1 |
| vw_instance_user_access | view | não | 0 | 10 | -1 |
| vw_kpi_evaluations | view | não | 0 | 4 | -1 |
| vw_meta_whatsapp_gastos | view | não | 0 | 10 | -1 |
| vw_metas_mensais_resumo | view | não | 0 | 12 | -1 |
| vw_metas_semanais_detalhadas | view | não | 0 | 15 | -1 |
| vw_patients | view | não | 0 | 19 | -1 |
| vw_rh | view | não | 0 | 3 | -1 |
| vw_role_page_perms | view | não | 0 | 10 | -1 |
| vw_user_accessible_instances | view | não | 0 | 6 | -1 |
| vw_user_effective_pages | view | não | 0 | 14 | -1 |
| vw_users | view | não | 0 | 13 | -1 |
| warnings | tabela | sim | 1 | 9 | -1 |
| weekly_forecasts | tabela | sim | 1 | 9 | -1 |
| whatsapp_accounts | tabela | não | 0 | 9 | 17 |
| whatsapp_logs_disparos | tabela | não | 0 | 9 | -1 |
| whatsapp_template_stats | tabela | não | 0 | 19 | 252 |
| widgets | tabela | sim | 4 | 9 | 1 |
| wishlists | tabela | não | 0 | 3 | -1 |
| wix_carrinhos_abandonados | tabela | não | 0 | 16 | -1 |
| wix_pedido_items | tabela | não | 0 | 15 | 15516 |
| wix_pedidos | tabela | não | 0 | 38 | 203 |
| wix_produto_variantes | tabela | não | 0 | 12 | 257 |
| wix_produtos | tabela | não | 0 | 22 | 29 |

## accounts_payable_commands

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | bigint | não | `nextval('accounts_payable_commands_id_seq'::regclass)` |
| command | text | não |  |
| branch_cnpj | text | sim |  |
| supplier_cpf_cnpj | text | sim |  |
| duplicate_code | bigint | sim |  |
| payload | jsonb | não |  |
| sucesso | boolean | sim |  |
| http_status | integer | sim |  |
| resposta | jsonb | sim |  |
| erro | text | sim |  |
| usuario | text | sim |  |
| origem_tabela | text | sim |  |
| origem_id | text | sim |  |
| criado_em | timestamp with time zone | não | `now()` |

Constraints: `accounts_payable_commands_command_check` CHECK ((command = ANY (ARRAY['create'::text, 'group'::text]))); `accounts_payable_commands_pkey` PRIMARY KEY (id)

Índices: `accounts_payable_commands_pkey`, `ap_cmd_data_idx`, `ap_cmd_dup_idx`

Policies: `erp_leitura_autenticado` (SELECT → {authenticated})

## accounts_payable_duplicate_expenses

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| branch_code | integer | não |  |
| supplier_code | bigint | não |  |
| duplicate_code | bigint | não |  |
| installment_code | integer | não |  |
| sequence | integer | não |  |
| expense_code | integer | sim |  |
| expense_name | text | sim |  |
| cost_center_code | integer | sim |  |
| prorated_percentage | numeric | sim |  |
| prorated_value | numeric | sim |  |

Constraints: `accounts_payable_duplicate_ex_branch_code_supplier_code_du_fkey` FOREIGN KEY (branch_code, supplier_code, duplicate_code, installment_code) REFERENCES accounts_payable_duplicates(branch_code, supplier_code, duplicate_code, installment_code) ON DELETE CASCADE; `accounts_payable_duplicate_expenses_pkey` PRIMARY KEY (branch_code, supplier_code, duplicate_code, installment_code, sequence)

Índices: `accounts_payable_duplicate_expenses_pkey`, `ap_dup_exp_cc_idx`, `ap_dup_exp_expense_idx`

Policies: `erp_leitura_autenticado` (SELECT → {authenticated})

## accounts_payable_duplicates

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| branch_code | integer | não |  |
| supplier_code | bigint | não |  |
| duplicate_code | bigint | não |  |
| installment_code | integer | não |  |
| supplier_cpf_cnpj | text | sim |  |
| bearer_code | integer | sim |  |
| entry_date | timestamp without time zone | sim |  |
| issue_date | timestamp without time zone | sim |  |
| due_date | timestamp without time zone | sim |  |
| settlement_date | timestamp without time zone | sim |  |
| arrival_date | timestamp without time zone | sim |  |
| status | text | sim |  |
| duplicate_value | numeric | sim |  |
| fees_value | numeric | sim |  |
| discount_value | numeric | sim |  |
| paid_value | numeric | sim |  |
| expense | jsonb | sim |  |
| inclusion_type | integer | sim |  |
| user_inclusion_code | integer | sim |  |
| user_inclusion_name | text | sim |  |
| max_change_filter_date | timestamp without time zone | sim |  |
| branch_cnpj | text | sim |  |
| document_type | integer | sim |  |
| prevision_type | integer | sim |  |
| stage_type | integer | sim |  |
| observation | text | sim |  |
| origem | text | não | `'totvs'::text` |
| dados | jsonb | sim |  |
| comando | jsonb | sim |  |
| primeira_vez_em | timestamp with time zone | não | `now()` |
| sincronizado_em | timestamp with time zone | sim |  |
| atualizado_em | timestamp with time zone | não | `now()` |

Constraints: `accounts_payable_duplicates_origem_check` CHECK ((origem = ANY (ARRAY['totvs'::text, 'headcoach'::text]))); `accounts_payable_duplicates_pkey` PRIMARY KEY (branch_code, supplier_code, duplicate_code, installment_code)

Índices: `accounts_payable_duplicates_pkey`, `ap_dup_change_idx`, `ap_dup_due_idx`, `ap_dup_issue_idx`, `ap_dup_settlement_idx`, `ap_dup_status_idx`, `ap_dup_supplier_doc_idx`, `ap_dup_supplier_idx`

Policies: `erp_leitura_autenticado` (SELECT → {authenticated})

## accounts_payable_duplicates_v

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| branch_code | integer | sim |  |
| supplier_code | bigint | sim |  |
| duplicate_code | bigint | sim |  |
| installment_code | integer | sim |  |
| supplier_cpf_cnpj | text | sim |  |
| bearer_code | integer | sim |  |
| entry_date | timestamp without time zone | sim |  |
| issue_date | timestamp without time zone | sim |  |
| due_date | timestamp without time zone | sim |  |
| settlement_date | timestamp without time zone | sim |  |
| arrival_date | timestamp without time zone | sim |  |
| status | text | sim |  |
| duplicate_value | numeric | sim |  |
| fees_value | numeric | sim |  |
| discount_value | numeric | sim |  |
| paid_value | numeric | sim |  |
| expense | jsonb | sim |  |
| inclusion_type | integer | sim |  |
| user_inclusion_code | integer | sim |  |
| user_inclusion_name | text | sim |  |
| max_change_filter_date | timestamp without time zone | sim |  |
| branch_cnpj | text | sim |  |
| document_type | integer | sim |  |
| prevision_type | integer | sim |  |
| stage_type | integer | sim |  |
| observation | text | sim |  |
| origem | text | sim |  |
| dados | jsonb | sim |  |
| comando | jsonb | sim |  |
| primeira_vez_em | timestamp with time zone | sim |  |
| sincronizado_em | timestamp with time zone | sim |  |
| atualizado_em | timestamp with time zone | sim |  |
| supplier_name | text | sim |  |
| branch_name | text | sim |  |
| branch_propria | boolean | sim |  |
| open_value | numeric | sim |  |

## accounts_receivable_commands

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | bigint | não | `nextval('accounts_receivable_commands_id_seq'::regclass)` |
| command | text | não |  |
| branch_code | integer | sim |  |
| customer_code | bigint | sim |  |
| customer_cpf_cnpj | text | sim |  |
| receivable_code | bigint | sim |  |
| installment_code | integer | sim |  |
| payload | jsonb | não |  |
| sucesso | boolean | sim |  |
| http_status | integer | sim |  |
| resposta | jsonb | sim |  |
| erro | text | sim |  |
| usuario | text | sim |  |
| origem_tabela | text | sim |  |
| origem_id | text | sim |  |
| criado_em | timestamp with time zone | não | `now()` |

Constraints: `accounts_receivable_commands_command_check` CHECK ((command = ANY (ARRAY['invoices-payment'::text, 'change-charge-type'::text, 'bank-slip'::text, 'payment-link'::text]))); `accounts_receivable_commands_pkey` PRIMARY KEY (id)

Índices: `accounts_receivable_commands_pkey`, `ar_cmd_data_idx`, `ar_cmd_titulo_idx`

Policies: `erp_leitura_autenticado` (SELECT → {authenticated})

## accounts_receivable_document_invoices

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| branch_code | integer | não |  |
| customer_code | bigint | não |  |
| receivable_code | bigint | não |  |
| installment_code | integer | não |  |
| sequence | integer | não |  |
| invoice_branch_code | integer | sim |  |
| invoice_sequence | bigint | sim |  |
| invoice_date | date | sim |  |
| invoice_code | bigint | sim |  |

Constraints: `accounts_receivable_document__branch_code_customer_code_re_fkey` FOREIGN KEY (branch_code, customer_code, receivable_code, installment_code) REFERENCES accounts_receivable_documents(branch_code, customer_code, receivable_code, installment_code) ON DELETE CASCADE; `accounts_receivable_document_invoices_pkey` PRIMARY KEY (branch_code, customer_code, receivable_code, installment_code, sequence)

Índices: `accounts_receivable_document_invoices_pkey`, `ar_doc_inv_nf_idx`

Policies: `erp_leitura_autenticado` (SELECT → {authenticated})

## accounts_receivable_documents

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| branch_code | integer | não |  |
| customer_code | bigint | não |  |
| receivable_code | bigint | não |  |
| installment_code | integer | não |  |
| customer_cpf_cnpj | text | sim |  |
| max_change_filter_date | timestamp without time zone | sim |  |
| expired_date | date | sim |  |
| payment_date | date | sim |  |
| issue_date | date | sim |  |
| settlement_branch_code | integer | sim |  |
| settlement_date | date | sim |  |
| settlement_sequence | bigint | sim |  |
| status | integer | sim |  |
| document_type | integer | sim |  |
| billing_type | integer | sim |  |
| discharge_type | integer | sim |  |
| charge_type | integer | sim |  |
| origin_installment | jsonb | sim |  |
| bearer_code | integer | sim |  |
| bearer_name | text | sim |  |
| installment_value | numeric | sim |  |
| paid_value | numeric | sim |  |
| net_value | numeric | sim |  |
| discount_value | numeric | sim |  |
| rebate_value | numeric | sim |  |
| interest_value | numeric | sim |  |
| assessment_value | numeric | sim |  |
| bar_code | text | sim |  |
| digitable_line | text | sim |  |
| our_number | bigint | sim |  |
| dac_our_number | text | sim |  |
| qr_code_pix | text | sim |  |
| discharge_user | integer | sim |  |
| registration_user | integer | sim |  |
| charge_account | jsonb | sim |  |
| calculated_values | jsonb | sim |  |
| check_data | jsonb | sim |  |
| invoice | jsonb | sim |  |
| commissions | jsonb | sim |  |
| classifications | jsonb | sim |  |
| origem | text | não | `'totvs'::text` |
| dados | jsonb | sim |  |
| primeira_vez_em | timestamp with time zone | não | `now()` |
| sincronizado_em | timestamp with time zone | sim |  |
| atualizado_em | timestamp with time zone | não | `now()` |

Constraints: `accounts_receivable_documents_origem_check` CHECK ((origem = ANY (ARRAY['totvs'::text, 'headcoach'::text]))); `accounts_receivable_documents_pkey` PRIMARY KEY (branch_code, customer_code, receivable_code, installment_code)

Índices: `accounts_receivable_documents_pkey`, `ar_doc_aberto_idx`, `ar_doc_bearer_idx`, `ar_doc_customer_doc_idx`, `ar_doc_customer_idx`, `ar_doc_expired_idx`, `ar_doc_issue_idx`, `ar_doc_payment_idx`, `ar_doc_receivable_idx`

Policies: `erp_leitura_autenticado` (SELECT → {authenticated})

## accounts_receivable_documents_v

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| branch_code | integer | sim |  |
| customer_code | bigint | sim |  |
| receivable_code | bigint | sim |  |
| installment_code | integer | sim |  |
| customer_cpf_cnpj | text | sim |  |
| max_change_filter_date | timestamp without time zone | sim |  |
| expired_date | date | sim |  |
| payment_date | date | sim |  |
| issue_date | date | sim |  |
| settlement_branch_code | integer | sim |  |
| settlement_date | date | sim |  |
| settlement_sequence | bigint | sim |  |
| status | integer | sim |  |
| document_type | integer | sim |  |
| billing_type | integer | sim |  |
| discharge_type | integer | sim |  |
| charge_type | integer | sim |  |
| origin_installment | jsonb | sim |  |
| bearer_code | integer | sim |  |
| bearer_name | text | sim |  |
| installment_value | numeric | sim |  |
| paid_value | numeric | sim |  |
| net_value | numeric | sim |  |
| discount_value | numeric | sim |  |
| rebate_value | numeric | sim |  |
| interest_value | numeric | sim |  |
| assessment_value | numeric | sim |  |
| bar_code | text | sim |  |
| digitable_line | text | sim |  |
| our_number | bigint | sim |  |
| dac_our_number | text | sim |  |
| qr_code_pix | text | sim |  |
| discharge_user | integer | sim |  |
| registration_user | integer | sim |  |
| charge_account | jsonb | sim |  |
| calculated_values | jsonb | sim |  |
| check_data | jsonb | sim |  |
| invoice | jsonb | sim |  |
| commissions | jsonb | sim |  |
| classifications | jsonb | sim |  |
| origem | text | sim |  |
| dados | jsonb | sim |  |
| primeira_vez_em | timestamp with time zone | sim |  |
| sincronizado_em | timestamp with time zone | sim |  |
| atualizado_em | timestamp with time zone | sim |  |
| customer_name | text | sim |  |
| branch_name | text | sim |  |
| branch_propria | boolean | sim |  |
| open_value | numeric | sim |  |
| days_late | integer | sim |  |

## analises_credito

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | bigint | não | `nextval('analises_credito_id_seq'::regclass)` |
| person_code | integer | não |  |
| cliente_nome | text | sim |  |
| cliente_cpf_cnpj | text | sim |  |
| cliente_uf | text | sim |  |
| solicitado_por | uuid | sim |  |
| solicitado_por_nome | text | sim |  |
| solicitado_por_email | text | sim |  |
| solicitado_em | timestamp with time zone | não | `now()` |
| observacoes_solicitacao | text | sim |  |
| status | text | não | `'pendente'::text` |
| limite_aprovado | numeric | sim |  |
| observacoes_analise | text | sim |  |
| aprovado_por | uuid | sim |  |
| aprovado_por_nome | text | sim |  |
| aprovado_em | timestamp with time zone | sim |  |
| created_at | timestamp with time zone | não | `now()` |
| updated_at | timestamp with time zone | não | `now()` |
| branch_code | integer | sim |  |
| totvs_sync_status | text | sim |  |
| totvs_sync_message | text | sim |  |
| totvs_sync_em | timestamp with time zone | sim |  |

Constraints: `analises_credito_aprovado_por_fkey` FOREIGN KEY (aprovado_por) REFERENCES auth.users(id) ON DELETE SET NULL; `analises_credito_pkey` PRIMARY KEY (id); `analises_credito_solicitado_por_fkey` FOREIGN KEY (solicitado_por) REFERENCES auth.users(id) ON DELETE SET NULL; `analises_credito_status_check` CHECK ((status = ANY (ARRAY['pendente'::text, 'aprovada'::text, 'rejeitada'::text, 'cancelada'::text]))); `analises_credito_totvs_sync_status_check` CHECK (((totvs_sync_status IS NULL) OR (totvs_sync_status = ANY (ARRAY['pendente'::text, 'sincronizado'::text, 'erro'::text]))))

Índices: `analises_credito_pkey`, `idx_analises_credito_person_code`, `idx_analises_credito_solicitado_em`, `idx_analises_credito_status`

Policies: `analises_credito_insert_auth` (INSERT → {public}); `analises_credito_select_all` (SELECT → {public}); `analises_credito_update_auth` (UPDATE → {public})

## antecipacoes_faturas

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |
| cd_cliente | character varying | não |  |
| nm_cliente | character varying | sim |  |
| nr_fatura | character varying | não |  |
| nr_parcela | character varying | sim |  |
| vl_fatura | numeric | sim |  |
| dt_vencimento | date | sim |  |
| cd_empresa | character varying | sim |  |
| banco_antecipado | character varying | não |  |
| usuario_id | uuid | não |  |
| usuario_email | character varying | sim |  |
| usuario_nome | character varying | sim |  |
| created_at | timestamp with time zone | não | `timezone('utc'::text, now())` |
| updated_at | timestamp with time zone | não | `timezone('utc'::text, now())` |
| observacoes | text | sim |  |
| valor_descontado | numeric | sim | `NULL::numeric` |
| titulos_recomprados | numeric | sim | `NULL::numeric` |
| credito_debito_cedente | numeric | sim | `NULL::numeric` |
| saldo_pagar_cedente | numeric | sim | `NULL::numeric` |

Constraints: `antecipacoes_faturas_cd_cliente_nr_fatura_nr_parcela_key` UNIQUE (cd_cliente, nr_fatura, nr_parcela); `antecipacoes_faturas_pkey` PRIMARY KEY (id); `antecipacoes_faturas_usuario_id_fkey` FOREIGN KEY (usuario_id) REFERENCES auth.users(id) ON DELETE CASCADE; `check_credito_debito_cedente_positive` CHECK (((credito_debito_cedente IS NULL) OR (credito_debito_cedente >= (0)::numeric))); `check_saldo_pagar_cedente_positive` CHECK (((saldo_pagar_cedente IS NULL) OR (saldo_pagar_cedente >= (0)::numeric))); `check_titulos_recomprados_positive` CHECK (((titulos_recomprados IS NULL) OR (titulos_recomprados >= (0)::numeric))); `check_valor_descontado_positive` CHECK (((valor_descontado IS NULL) OR (valor_descontado >= (0)::numeric)))

Índices: `antecipacoes_faturas_cd_cliente_nr_fatura_nr_parcela_key`, `antecipacoes_faturas_pkey`, `idx_antecipacoes_banco`, `idx_antecipacoes_banco_antecipado`, `idx_antecipacoes_cd_cliente`, `idx_antecipacoes_created_at`, `idx_antecipacoes_dt_vencimento`, `idx_antecipacoes_nr_fatura`, `idx_antecipacoes_usuario`

Policies: `Usuários podem atualizar suas próprias antecipações` (UPDATE → {authenticated}); `Usuários podem criar antecipações` (INSERT → {authenticated}); `Usuários podem deletar suas próprias antecipações` (DELETE → {authenticated}); `Usuários podem ver suas próprias antecipações` (SELECT → {authenticated}); `headcoach_autenticado_tudo` (ALL → {authenticated})

## app_aspect_group

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | smallint | não |  |
| name | text | não |  |
| description | text | sim |  |
| created_at | timestamp with time zone | não | `now()` |
| updated_at | timestamp with time zone | não | `now()` |

Constraints: `app_aspect_group_name_key` UNIQUE (name); `app_aspect_group_pkey` PRIMARY KEY (id)

Índices: `app_aspect_group_name_key`, `app_aspect_group_pkey`

## app_aspect_group_instance

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | smallint | não |  |
| aspect_group_id | smallint | não |  |
| instance_id | text | não |  |
| created_at | timestamp with time zone | não | `now()` |
| updated_at | timestamp with time zone | não | `now()` |

Constraints: `app_aspect_group_instance_aspect_group_id_fkey` FOREIGN KEY (aspect_group_id) REFERENCES app_aspect_group(id) ON DELETE CASCADE; `app_aspect_group_instance_pkey` PRIMARY KEY (id); `uq_aspect_group_instance` UNIQUE (aspect_group_id, instance_id)

Índices: `app_aspect_group_instance_pkey`, `ix_app_aspect_group_instance_group`, `ix_app_aspect_group_instance_instance`, `uq_aspect_group_instance`

## app_aspect_item

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | smallint | não |  |
| aspect_group_id | smallint | não |  |
| name | text | não |  |
| description | text | sim |  |
| created_at | timestamp with time zone | não | `now()` |
| updated_at | timestamp with time zone | não | `now()` |

Constraints: `app_aspect_item_aspect_group_id_fkey` FOREIGN KEY (aspect_group_id) REFERENCES app_aspect_group(id) ON DELETE CASCADE; `app_aspect_item_name_key` UNIQUE (name); `app_aspect_item_pkey` PRIMARY KEY (id)

Índices: `app_aspect_item_name_key`, `app_aspect_item_pkey`, `ix_app_aspect_item_group`

## app_evaluation

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | integer | não |  |
| instance_id | text | não |  |
| remote_jid | text | não |  |
| started_by_from_me | boolean | não | `false` |
| score | numeric | sim |  |
| comment | text | sim |  |
| start_ts | timestamp with time zone | não |  |
| end_ts | timestamp with time zone | não |  |
| created_at | timestamp with time zone | não | `now()` |
| updated_at | timestamp with time zone | não | `now()` |
| generated_sale | boolean | não | `false` |
| salesperson_name | text | sim |  |

Constraints: `app_evaluation_pkey` PRIMARY KEY (id); `app_evaluation_score_check` CHECK (((score >= (0)::numeric) AND (score <= (5)::numeric))); `ck_eval_ts_order` CHECK ((end_ts >= start_ts)); `uq_contact_eval` UNIQUE (instance_id, remote_jid, start_ts)

Índices: `app_evaluation_pkey`, `ix_app_evaluation_instance_start`, `uq_contact_eval`

## app_evaluation_aspect

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | integer | não |  |
| evaluation_id | integer | não |  |
| aspect_id | smallint | não |  |
| aspect_score | numeric | não |  |
| aspect_comment | text | sim |  |
| created_at | timestamp with time zone | não | `now()` |
| updated_at | timestamp with time zone | não | `now()` |

Constraints: `app_evaluation_aspect_aspect_id_fkey` FOREIGN KEY (aspect_id) REFERENCES app_aspect_item(id); `app_evaluation_aspect_aspect_score_check` CHECK (((aspect_score >= (0)::numeric) AND (aspect_score <= (5)::numeric))); `app_evaluation_aspect_evaluation_id_fkey` FOREIGN KEY (evaluation_id) REFERENCES app_evaluation(id) ON DELETE CASCADE; `app_evaluation_aspect_pkey` PRIMARY KEY (id); `uq_eval_aspect` UNIQUE (evaluation_id, aspect_id)

Índices: `app_evaluation_aspect_pkey`, `ix_app_evaluation_aspect_aspect`, `uq_eval_aspect`

## atendimentos

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | integer | não | `nextval('atendimentos_id_seq'::regclass)` |
| vendedor_id | integer | sim |  |
| data_inicio | timestamp with time zone | não | `now()` |
| data_fim | timestamp with time zone | sim |  |
| status | text | não | `'in_progress'::text` |
| motivo_nao_conversao_id | integer | sim |  |
| comentario | text | sim |  |
| created_at | timestamp with time zone | sim | `now()` |
| updated_at | timestamp with time zone | sim | `now()` |
| loja_id | integer | sim |  |

Constraints: `atendimentos_loja_id_fkey` FOREIGN KEY (loja_id) REFERENCES lojas(id); `atendimentos_motivo_nao_conversao_id_fkey` FOREIGN KEY (motivo_nao_conversao_id) REFERENCES motivos_nao_conversao(id); `atendimentos_pkey` PRIMARY KEY (id); `atendimentos_vendedor_id_fkey` FOREIGN KEY (vendedor_id) REFERENCES vendedores(id); `status_check` CHECK ((status = ANY (ARRAY['in_progress'::text, 'sale'::text, 'no_sale'::text])))

Índices: `atendimentos_pkey`

Policies: `Allow all operations on atendimentos` (ALL → {public})

## audios_crosby

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | integer | não | `nextval('audios_crosby_id_seq'::regclass)` |
| nome_arquivo | character varying | não |  |
| fase_funil | character varying | sim |  |
| url_minio | text | não |  |
| transcricao | text | não |  |
| descricao_interna | character varying | sim |  |

Constraints: `audios_crosby_nome_arquivo_key` UNIQUE (nome_arquivo); `audios_crosby_pkey` PRIMARY KEY (id)

Índices: `audios_crosby_nome_arquivo_key`, `audios_crosby_pkey`

## auditor_auditorias

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | uuid | sim |  |
| created_at | timestamp with time zone | sim |  |
| loja | text | sim |  |
| vendedor | text | sim |  |
| canal | text | sim |  |
| evolution_instance_id | text | sim |  |
| evolution_remote_jid | text | sim |  |
| conversa_inicio | timestamp with time zone | sim |  |
| conversa_fim | timestamp with time zone | sim |  |
| nota_geral | numeric | sim |  |
| classificacao | text | sim |  |
| total_infracoes | integer | sim |  |
| total_infracoes_criticas | integer | sim |  |
| houve_venda | boolean | sim |  |
| resultado | jsonb | sim |  |
| conversa | jsonb | sim |  |
| modelo | text | sim |  |
| system_prompt_version | text | sim |  |

## auditor_infracoes

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | uuid | sim |  |
| auditoria_id | uuid | sim |  |
| created_at | timestamp with time zone | sim |  |
| loja | text | sim |  |
| vendedor | text | sim |  |
| codigo | text | sim |  |
| categoria | text | sim |  |
| severidade | text | sim |  |
| descricao | text | sim |  |
| evidencia | text | sim |  |
| impacto_comercial | text | sim |  |

## auditor_resumo_loja

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| loja | text | sim |  |
| total_auditorias | bigint | sim |  |
| nota_media | numeric | sim |  |
| infracoes_total | bigint | sim |  |
| infracoes_criticas_total | bigint | sim |  |
| vendas | bigint | sim |  |

## auditor_resumo_vendedor

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| loja | text | sim |  |
| vendedor | text | sim |  |
| total_auditorias | bigint | sim |  |
| nota_media | numeric | sim |  |
| infracoes_total | bigint | sim |  |
| infracoes_criticas_total | bigint | sim |  |

## auditor_top_infracoes

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| categoria | text | sim |  |
| severidade | text | sim |  |
| total | bigint | sim |  |

## auditor_validacoes

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | uuid | sim |  |
| auditoria_id | uuid | sim |  |
| avaliador | text | sim |  |
| status | text | sim |  |
| log_correcao | text | sim |  |
| created_at | timestamp with time zone | sim |  |
| updated_at | timestamp with time zone | sim |  |

## automacao_boleto_envios

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | bigint | não | `nextval('automacao_boleto_envios_id_seq'::regclass)` |
| data_ref | date | não |  |
| tipo | character varying | não |  |
| cd_empresa | integer | sim |  |
| cd_cliente | integer | sim |  |
| nome_cliente | text | sim |  |
| telefone | text | sim |  |
| nr_fatura | text | sim |  |
| nr_parcela | text | sim |  |
| vl_fatura | numeric | sim |  |
| dt_emissao | date | sim |  |
| dt_vencimento | date | sim |  |
| linha_digitavel | text | sim |  |
| status | character varying | não | `'pendente'::character varying` |
| erro | text | sim |  |
| conteudo_enviado | text | sim |  |
| tentativas | integer | não | `0` |
| scheduled_at | timestamp with time zone | sim |  |
| enviado_em | timestamp with time zone | sim |  |
| criado_em | timestamp with time zone | não | `now()` |
| atualizado_em | timestamp with time zone | não | `now()` |

Constraints: `automacao_boleto_envios_pkey` PRIMARY KEY (id); `uq_boleto_envio` UNIQUE (data_ref, tipo, cd_empresa, cd_cliente, nr_fatura, nr_parcela)

Índices: `automacao_boleto_envios_pkey`, `idx_boleto_envios_data`, `idx_boleto_envios_fila`, `uq_boleto_envio`

## avaliacao_franquias

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| phone_number | character varying | não |  |
| loja | character varying | sim |  |
| nota | numeric | sim | `NULL::numeric` |
| motivo | character varying | sim |  |
| inicio | timestamp without time zone | sim |  |
| fim | timestamp without time zone | sim |  |
| duração | interval | sim |  |
| tempo_resposta | interval | sim |  |
| contact_name | character varying | sim | `NULL::character varying` |
| categoria_reg | character varying | sim | `NULL::character varying` |
| inbox_name | character varying | sim | `NULL::character varying` |
| id | integer | não | `nextval('avaliacao_franquias_id_seq'::regclass)` |
| updated | timestamp with time zone | sim | `now()` |

Constraints: `avaliacao_franquias_unique` UNIQUE (id)

Índices: `avaliacao_franquias_unique`

## avaliacao_lojas

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| phone_number | character varying | não |  |
| loja | character varying | sim |  |
| nota | numeric | sim | `NULL::numeric` |
| resumo | character varying | sim |  |
| inicio | timestamp without time zone | sim |  |
| fim | timestamp without time zone | sim |  |
| duração | interval | sim |  |
| tempo_resposta | interval | sim |  |
| contact_name | character varying | sim | `NULL::character varying` |
| categoria_reg | character varying | sim | `NULL::character varying` |
| inbox_name | character varying | sim | `NULL::character varying` |
| id | integer | não | `nextval('avaliacao_lojas_id_seq'::regclass)` |
| updated | timestamp with time zone | sim | `now()` |
| rapport_conexao | character varying | sim |  |
| nota_rapport | numeric | sim |  |
| clareza_obejtividade | character varying | sim |  |
| nota_clareza | character varying | sim |  |
| lidar_objecao | character varying | sim |  |
| nota_objecao | character varying | sim |  |
| gatilho_urgencia | character varying | sim |  |
| nota_gatilho | numeric | sim |  |
| prova_social | character varying | sim |  |
| nota_prova_social | numeric | sim |  |
| reciprocidade | character varying | sim |  |
| nota_reciprocidade | numeric | sim |  |
| compromisso | character varying | sim |  |
| nota_compromisso | character varying | sim |  |
| tom_de_voz | character varying | sim |  |
| nota_tom_de_voz | numeric | sim |  |
| chamar_pelo_nome | character varying | sim |  |
| nota_chamar_pelo_nome | numeric | sim |  |
| utilizacao_giria | character varying | sim |  |
| nota_utilizacao_giria | numeric | sim |  |
| sugestao_produto | character varying | sim |  |
| nota_sugestao_produto | numeric | sim |  |
| av_tempo_resposta | character varying | sim |  |
| nota_tempo_resposta | numeric | sim |  |
| fechamento | character varying | sim |  |
| nota_fechamento | numeric | sim |  |
| av_combos | character varying | sim |  |
| nota_combos | numeric | sim |  |
| upgrade_frete | character varying | sim |  |
| nota_upgrade_frete | numeric | sim |  |
| interacao_cliente | character varying | sim |  |
| pontos_melhoria | character varying | sim |  |

Constraints: `avaliacao_lojas_unique` UNIQUE (id)

Índices: `avaliacao_lojas_unique`

Policies: `a` (ALL → {public})

## avaliacao_sdr_franquia

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| phone_number | character varying | não |  |
| loja | character varying | sim |  |
| nota | numeric | sim | `NULL::numeric` |
| motivo | character varying | sim |  |
| início | timestamp without time zone | sim |  |
| fim | timestamp without time zone | sim |  |
| duração | interval | sim |  |
| tempo_resposta | interval | sim |  |
| contact_name | character varying | sim | `NULL::character varying` |
| categoria_reg | character varying | sim | `NULL::character varying` |
| inbox_name | character varying | sim | `NULL::character varying` |
| id | integer | não | `nextval('avaliacao_sdr_franquia_id_seq'::regclass)` |
| updated | timestamp without time zone | sim | `now()` |

Constraints: `avaliacao_sdr_unique` UNIQUE (id)

Índices: `avaliacao_sdr_unique`

## balanco_lv

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | character varying | não |  |
| name | character varying | sim |  |
| status | character varying | sim |  |
| date_created | timestamp with time zone | sim |  |
| date_update | timestamp with time zone | sim |  |
| data_do_balanco | date | sim |  |
| conformidade | character varying | sim |  |
| %_acuracidade | numeric | sim |  |
| divergencia | integer | sim |  |
| justificativa_divergencia | text | sim |  |
| qtd_balanco | integer | sim |  |
| qtd_sistema | integer | sim |  |
| setor | character varying | sim |  |
| valor_divergente_r$ | numeric | sim |  |

Constraints: `balanco_lv_pkey` PRIMARY KEY (id)

Índices: `balanco_lv_pkey`

Policies: `a` (ALL → {public})

## banco_de_talentos

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | character varying | não |  |
| name | character varying | sim | `NULL::character varying` |
| Cidade | character varying | sim | `NULL::character varying` |
| Estado | character varying | sim | `NULL::character varying` |
| Passos | character varying | sim | `NULL::character varying` |
| cargo | character varying | sim | `NULL::character varying` |
| indicado | character varying | sim | `NULL::character varying` |
| obs | character varying | sim | `NULL::character varying` |
| gênero | character varying | sim | `NULL::character varying` |
| data de inscricao | character varying | sim | `NULL::character varying` |
| status | character varying | sim | `NULL::character varying` |
| telefone | character varying | sim | `NULL::character varying` |

Constraints: `bancoDeTalentos_pkey` PRIMARY KEY (id)

Índices: `bancoDeTalentos_pkey`

Policies: `a` (ALL → {public})

## base_do_rh

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | character varying | não |  |
| name | character varying | sim |  |
| data_admissao | date | sim |  |
| data_nascimento | date | sim |  |
| genero | character varying | sim | `NULL::character varying` |
| idade | character varying | sim | `NULL::character varying` |
| endereco | character varying | sim | `NULL::character varying` |
| setor | character varying | sim | `NULL::character varying` |
| valor_salario | numeric | sim | `NULL::numeric` |
| dados_bancarios | character varying | sim | `NULL::character varying` |
| filial | character varying | sim | `NULL::character varying` |
| status | character varying | sim | `NULL::character varying` |
| dataDeDemissao | date | sim |  |
| cpf | character varying | sim | `NULL::character varying` |
| desligamento | character varying | sim | `NULL::character varying` |
| tipoDeAso | character varying | sim | `NULL::character varying` |
| validadeASO | character varying | sim | `NULL::character varying` |

Constraints: `BaseDoRh_pkey` PRIMARY KEY (id)

Índices: `BaseDoRh_pkey`

Policies: `a` (ALL → {public})

## bd_banco_horas

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | integer | não | `nextval('"BdBancoHoras_id_seq"'::regclass)` |
| bancoHoras | character varying | sim | `NULL::character varying` |
| setor | character varying | sim | `NULL::character varying` |
| mês | character varying | sim | `NULL::character varying` |

Constraints: `BdBancoHoras_pkey` PRIMARY KEY (id)

Índices: `BdBancoHoras_pkey`

Policies: `a` (ALL → {public})

## bluecard_eventos

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | bigint | não | `nextval('bluecard_eventos_id_seq'::regclass)` |
| recebido_em | timestamp with time zone | não | `now()` |
| evento | text | não |  |
| dedupe_hash | text | não |  |
| payload | jsonb | não |  |
| status | text | não | `'recebido'::text` |
| processado_em | timestamp with time zone | sim |  |
| erro | text | sim |  |

Constraints: `bluecard_eventos_dedupe_hash_key` UNIQUE (dedupe_hash); `bluecard_eventos_pkey` PRIMARY KEY (id)

Índices: `bluecard_eventos_dedupe_hash_key`, `bluecard_eventos_pkey`, `idx_bce_evento`, `idx_bce_recebido`, `idx_bce_status`

## bluecard_leads

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | bigint | não | `nextval('bluecard_leads_id_seq'::regclass)` |
| nome | text | não |  |
| whatsapp | text | não |  |
| email | text | não |  |
| cpf | text | não |  |
| empresa | text | sim |  |
| instagram | text | sim |  |
| data_nasc | text | sim |  |
| cep | text | sim |  |
| endereco | text | sim |  |
| numero | text | sim |  |
| complemento | text | sim |  |
| origem | text | sim | `'lp_bluecard'::text` |
| ip | text | sim |  |
| user_agent | text | sim |  |
| status | text | não | `'1_msg_enviada'::text` |
| observacao | text | sim |  |
| contatado_em | timestamp with time zone | sim |  |
| convertido_em | timestamp with time zone | sim |  |
| criado_em | timestamp with time zone | não | `now()` |
| atualizado_em | timestamp with time zone | não | `now()` |
| totvs_person_code | bigint | sim |  |
| totvs_synced_at | timestamp with time zone | sim |  |
| totvs_sync_error | text | sim |  |
| cvv | text | sim |  |
| indicado_por | text | sim |  |
| cidade | text | sim |  |
| estado | text | sim |  |
| sexo | text | sim |  |
| codigo_rastreio | text | sim |  |
| data_envio | date | sim |  |
| ltv | numeric | sim |  |
| ticket_medio | numeric | sim |  |
| qtd_compras | integer | sim |  |
| ultima_compra | date | sim |  |
| stats_synced_at | timestamp with time zone | sim |  |

Constraints: `bluecard_leads_pkey` PRIMARY KEY (id)

Índices: `bluecard_leads_pkey`, `idx_bluecard_leads_cpf`, `idx_bluecard_leads_criado`, `idx_bluecard_leads_cvv`, `idx_bluecard_leads_indicado_por`, `idx_bluecard_leads_status`, `idx_bluecard_leads_totvs`

## bluecard_liberacoes

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| compra_id | text | não |  |
| documento | text | sim |  |
| cpf | text | não |  |
| nome | text | sim |  |
| customer_code | bigint | sim |  |
| branch_code | integer | sim |  |
| valor_cents | bigint | não |  |
| abertos_cents | bigint | sim | `0` |
| limite_cents | bigint | não |  |
| status | text | não | `'liberado'::text` |
| liberado_em | timestamp with time zone | não | `now()` |
| venda_detectada_em | timestamp with time zone | sim |  |
| zerado_em | timestamp with time zone | sim |  |
| atualizado_em | timestamp with time zone | não | `now()` |
| limites_anteriores | jsonb | sim |  |
| branch_codes | jsonb | sim | `'[]'::jsonb` |
| titulos_previos | jsonb | sim | `'[]'::jsonb` |

Constraints: `bluecard_liberacoes_pkey` PRIMARY KEY (compra_id)

Índices: `bluecard_liberacoes_pkey`, `idx_bcl_cpf`, `idx_bcl_cpf_status`, `idx_bcl_liberado`, `idx_bcl_status`

## bluecard_titulos

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| externo_id | text | não |  |
| compra_id | text | sim |  |
| documento | text | sim |  |
| cpf | text | sim |  |
| parcela | integer | sim |  |
| de | integer | sim |  |
| valor_cents | bigint | sim |  |
| vencimento | date | sim |  |
| totvs_branch_code | integer | sim |  |
| totvs_receivable_code | bigint | sim |  |
| totvs_installment_code | integer | sim |  |
| status | text | não | `'aberto'::text` |
| pago_em | timestamp with time zone | sim |  |
| valor_pago_cents | bigint | sim |  |
| meio | text | sim |  |
| notificado_bluecard_em | timestamp with time zone | sim |  |
| criado_em | timestamp with time zone | não | `now()` |
| atualizado_em | timestamp with time zone | não | `now()` |

Constraints: `bluecard_titulos_pkey` PRIMARY KEY (externo_id)

Índices: `bluecard_titulos_pkey`, `idx_bct_compra`, `idx_bct_pago_em`, `idx_bct_status`, `idx_bct_totvs`

## bluecred_contratos

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |
| autentique_doc_id | text | não |  |
| cliente_nome | text | não |  |
| cliente_cpf | text | não |  |
| cliente_whatsapp | text | sim |  |
| status | text | não | `'pendente'::text` |
| total_assinantes | integer | não | `2` |
| total_assinados | integer | não | `0` |
| assinaturas | jsonb | não | `'[]'::jsonb` |
| created_at | timestamp with time zone | não | `now()` |
| updated_at | timestamp with time zone | não | `now()` |

Constraints: `bluecred_contratos_autentique_doc_id_key` UNIQUE (autentique_doc_id); `bluecred_contratos_pkey` PRIMARY KEY (id)

Índices: `bluecred_contratos_autentique_doc_id_key`, `bluecred_contratos_pkey`, `idx_bluecred_contratos_cliente_cpf`, `idx_bluecred_contratos_created_at`, `idx_bluecred_contratos_status`

## call_center_contatos

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| cd_cliente | character varying | não |  |
| nm_cliente | character varying | sim |  |
| telefone | character varying | sim |  |
| ultima_ligacao | date | sim |  |
| proximo_contato | date | sim |  |
| status_contato | character varying | sim |  |
| observacao | text | sim |  |
| usuario | character varying | sim |  |
| data_alteracao | timestamp with time zone | sim | `now()` |
| ultimo_sms | date | sim |  |

Constraints: `call_center_contatos_pkey` PRIMARY KEY (cd_cliente)

Índices: `call_center_contatos_pkey`, `idx_call_center_contatos_proximo_contato`, `idx_call_center_contatos_ultima_ligacao`

Policies: `call_center_contatos_authenticated` (ALL → {authenticated}); `headcoach_autenticado_tudo` (ALL → {authenticated})

## call_center_ligacoes

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | integer | não | `nextval('call_center_ligacoes_id_seq'::regclass)` |
| cd_cliente | character varying | não |  |
| nm_cliente | character varying | sim |  |
| telefone | character varying | sim |  |
| data_ligacao | date | não |  |
| status_ligacao | character varying | não |  |
| proximo_contato | date | sim |  |
| observacao | text | sim |  |
| valor_vencido | numeric | sim |  |
| usuario | character varying | não |  |
| data_criacao | timestamp with time zone | sim | `now()` |

Constraints: `call_center_ligacoes_pkey` PRIMARY KEY (id)

Índices: `call_center_ligacoes_pkey`, `idx_call_center_ligacoes_cd_cliente`, `idx_call_center_ligacoes_data`

Policies: `call_center_ligacoes_authenticated` (ALL → {authenticated}); `headcoach_autenticado_tudo` (ALL → {authenticated})

## canal_totals_cache

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| cache_key | text | não |  |
| canal | text | não |  |
| datemin | date | não |  |
| datemax | date | não |  |
| valor_liquido | numeric | não | `0` |
| valor_bruto | numeric | não | `0` |
| credev | numeric | não | `0` |
| invoice_qty | integer | não | `0` |
| atualizado_em | timestamp with time zone | não | `now()` |

Constraints: `canal_totals_cache_pkey` PRIMARY KEY (cache_key, canal)

Índices: `canal_totals_cache_pkey`, `idx_canal_totals_cache_range`

## candidates

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |
| vacancy_id | uuid | sim |  |
| name | text | não |  |
| state | text | sim |  |
| status | USER-DEFINED | sim | `'screening'::candidate_status` |
| created_at | timestamp with time zone | sim | `now()` |

Constraints: `candidates_pkey` PRIMARY KEY (id); `candidates_vacancy_id_fkey` FOREIGN KEY (vacancy_id) REFERENCES vacancies(id) ON DELETE CASCADE

Índices: `candidates_pkey`

Policies: `HR and Admin can view all candidates` (SELECT → {public})

## carts

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| user_id | uuid | não |  |
| items | jsonb | não | `'[]'::jsonb` |
| updated_at | timestamp with time zone | sim | `now()` |
| notified_at | timestamp with time zone | sim |  |
| converted_at | timestamp with time zone | sim |  |
| notify_count | integer | sim | `0` |

Constraints: `carts_pkey` PRIMARY KEY (user_id); `carts_user_id_fkey` FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE

Índices: `carts_pkey`

## case

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | integer | não |  |
| case_number | text | não |  |
| case_prefix | text | sim |  |
| parts | text | sim |  |
| court_division | text | sim |  |
| priority | boolean | sim |  |
| filed_at | date | sim |  |
| last_event_at | timestamp with time zone | sim |  |
| ca | text | sim |  |
| status | text | sim |  |
| case_value | real | sim |  |
| under_seal | boolean | sim |  |
| legal_aid | boolean | sim |  |
| injunction_requested | boolean | sim |  |
| subjects | text | sim |  |
| created_at | timestamp with time zone | não | `now()` |
| updated_at | timestamp with time zone | não | `now()` |
| custom_fields | jsonb | sim |  |

Constraints: `case_case_number_key` UNIQUE (case_number); `case_pkey` PRIMARY KEY (id)

Índices: `case_case_number_key`, `case_pkey`, `idx_case_custom_fields`, `idx_case_filed_at`, `idx_case_last_event_at`, `idx_case_status_last_event_at`

Policies: `case_select` (SELECT → {authenticated}); `case_write` (ALL → {authenticated})

## case_document

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | integer | não |  |
| case_id | integer | sim |  |
| type | text | sim |  |
| pages | smallint | sim |  |
| text_len | integer | sim |  |
| url | text | sim |  |
| is_scanned | boolean | sim |  |
| created_at | timestamp with time zone | não | `now()` |
| updated_at | timestamp with time zone | não | `now()` |

Constraints: `case_document_pkey` PRIMARY KEY (id)

Índices: `case_document_pkey`

Policies: `case_document_select` (SELECT → {authenticated})

## case_movement

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | text | não |  |
| case_id | bigint | não |  |
| date | timestamp with time zone | não |  |
| movement_name | text | sim |  |
| movement_type | text | sim |  |
| movement_child | jsonb | sim | `'{}'::jsonb` |
| created_at | timestamp with time zone | não | `now()` |
| updated_at | timestamp with time zone | não | `now()` |

Constraints: `case_movement_case_id_fkey` FOREIGN KEY (case_id) REFERENCES "case"(id) ON DELETE CASCADE; `case_movement_pkey` PRIMARY KEY (id)

Índices: `case_movement_pkey`, `idx_case_movement_case_id`, `idx_case_movement_date`

Policies: `case_select` (SELECT → {authenticated})

## case_notification

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | bigint | não |  |
| availability_date | date | sim |  |
| court_acronym | text | sim |  |
| communication_type | text | sim |  |
| court_id | bigint | sim |  |
| content | text | sim |  |
| case_number | text | sim |  |
| masked_case_number | text | sim |  |
| channel | text | sim |  |
| channel_name | text | sim |  |
| document_link | text | sim |  |
| document_type | text | sim |  |
| class_code | text | sim |  |
| communication_number | smallint | sim |  |
| is_active | boolean | sim |  |
| hash | text | sim |  |
| status | text | sim |  |
| cancellation_reason | text | sim |  |
| cancellation_date | date | sim |  |
| created_at | timestamp with time zone | não | `now()` |
| updated_at | timestamp with time zone | não | `now()` |
| recipients | jsonb | sim |  |

Constraints: `case_notification_pkey` PRIMARY KEY (id); `fk_case_notification_court` FOREIGN KEY (court_id) REFERENCES court(id) ON DELETE SET NULL

Índices: `case_notification_pkey`

Policies: `case_select` (SELECT → {authenticated})

## case_notification_lawyer

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| case_notification_id | bigint | não |  |
| lawyer_id | bigint | não |  |
| created_at | timestamp with time zone | não | `now()` |

Constraints: `case_notification_lawyer_case_notification_id_fkey` FOREIGN KEY (case_notification_id) REFERENCES case_notification(id) ON DELETE CASCADE; `case_notification_lawyer_lawyer_id_fkey` FOREIGN KEY (lawyer_id) REFERENCES lawyer(id) ON DELETE CASCADE; `case_notification_lawyer_pkey` PRIMARY KEY (case_notification_id, lawyer_id)

Índices: `case_notification_lawyer_pkey`

Policies: `case_notification_lawyer_select` (SELECT → {authenticated})

## case_tag

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| case_id | integer | não |  |
| tag_id | uuid | não |  |
| created_at | timestamp with time zone | não | `now()` |

Constraints: `case_tag_case_id_fkey` FOREIGN KEY (case_id) REFERENCES "case"(id) ON DELETE CASCADE; `case_tag_pkey` PRIMARY KEY (case_id, tag_id); `case_tag_tag_id_fkey` FOREIGN KEY (tag_id) REFERENCES tag(id) ON DELETE CASCADE

Índices: `case_tag_pkey`, `idx_case_tag_case`, `idx_case_tag_tag`

Policies: `case_tag_all` (ALL → {authenticated})

## catalogo_banners

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |
| titulo | text | sim |  |
| imagem_path | text | não |  |
| link_url | text | sim |  |
| ordem | integer | sim | `0` |
| ativo | boolean | sim | `true` |
| created_by | uuid | sim |  |
| created_at | timestamp with time zone | sim | `now()` |
| updated_at | timestamp with time zone | sim | `now()` |

Constraints: `catalogo_banners_created_by_fkey` FOREIGN KEY (created_by) REFERENCES auth.users(id); `catalogo_banners_pkey` PRIMARY KEY (id)

Índices: `catalogo_banners_pkey`, `idx_catalogo_banners_ordem`

Policies: `catalogo_banners_anon_select` (SELECT → {anon}); `catalogo_banners_delete` (DELETE → {authenticated}); `catalogo_banners_insert` (INSERT → {authenticated}); `catalogo_banners_select` (SELECT → {authenticated}); `catalogo_banners_update` (UPDATE → {authenticated})

## catalogo_categorias

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |
| nome | text | não |  |
| slug | text | sim |  |
| parent_id | uuid | sim |  |
| ordem | integer | sim | `0` |
| ativo | boolean | sim | `true` |
| created_at | timestamp with time zone | sim | `now()` |
| updated_at | timestamp with time zone | sim | `now()` |

Constraints: `catalogo_categorias_parent_id_fkey` FOREIGN KEY (parent_id) REFERENCES catalogo_categorias(id) ON DELETE SET NULL; `catalogo_categorias_pkey` PRIMARY KEY (id)

Índices: `catalogo_categorias_pkey`, `idx_catalogo_categorias_parent`

Policies: `catalogo_categorias_anon_select` (SELECT → {anon}); `catalogo_categorias_delete` (DELETE → {authenticated}); `catalogo_categorias_insert` (INSERT → {authenticated}); `catalogo_categorias_select` (SELECT → {authenticated}); `catalogo_categorias_update` (UPDATE → {authenticated})

## catalogo_configuracoes

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |
| chave | text | não |  |
| valor | jsonb | sim | `'{}'::jsonb` |
| updated_by | uuid | sim |  |
| updated_at | timestamp with time zone | sim | `now()` |
| created_at | timestamp with time zone | sim | `now()` |

Constraints: `catalogo_configuracoes_chave_key` UNIQUE (chave); `catalogo_configuracoes_pkey` PRIMARY KEY (id); `catalogo_configuracoes_updated_by_fkey` FOREIGN KEY (updated_by) REFERENCES auth.users(id)

Índices: `catalogo_configuracoes_chave_key`, `catalogo_configuracoes_pkey`

Policies: `catalogo_config_delete` (DELETE → {authenticated}); `catalogo_config_insert` (INSERT → {authenticated}); `catalogo_config_select` (SELECT → {authenticated}); `catalogo_config_update` (UPDATE → {authenticated})

## catalogo_produto_imagens

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |
| produto_id | uuid | não |  |
| imagem_path | text | não |  |
| principal | boolean | sim | `false` |
| ordem | integer | sim | `0` |
| created_at | timestamp with time zone | sim | `now()` |

Constraints: `catalogo_produto_imagens_pkey` PRIMARY KEY (id); `catalogo_produto_imagens_produto_id_fkey` FOREIGN KEY (produto_id) REFERENCES catalogo_produtos(id) ON DELETE CASCADE

Índices: `catalogo_produto_imagens_pkey`, `idx_catalogo_produto_imagens_produto`

Policies: `catalogo_produto_imagens_anon_select` (SELECT → {anon}); `catalogo_produto_imagens_delete` (DELETE → {authenticated}); `catalogo_produto_imagens_insert` (INSERT → {authenticated}); `catalogo_produto_imagens_select` (SELECT → {authenticated}); `catalogo_produto_imagens_update` (UPDATE → {authenticated})

## catalogo_produtos

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |
| nome | text | não |  |
| descricao | text | sim |  |
| codigo_produto | text | sim |  |
| marca | text | sim |  |
| especificacoes | text | sim |  |
| preco | numeric | sim |  |
| categoria_id | uuid | sim |  |
| ativo | boolean | sim | `true` |
| created_by | uuid | sim |  |
| created_at | timestamp with time zone | sim | `now()` |
| updated_at | timestamp with time zone | sim | `now()` |

Constraints: `catalogo_produtos_categoria_id_fkey` FOREIGN KEY (categoria_id) REFERENCES catalogo_categorias(id) ON DELETE SET NULL; `catalogo_produtos_created_by_fkey` FOREIGN KEY (created_by) REFERENCES auth.users(id); `catalogo_produtos_pkey` PRIMARY KEY (id)

Índices: `catalogo_produtos_pkey`, `idx_catalogo_produtos_categoria`

Policies: `catalogo_produtos_anon_select` (SELECT → {anon}); `catalogo_produtos_delete` (DELETE → {authenticated}); `catalogo_produtos_insert` (INSERT → {authenticated}); `catalogo_produtos_select` (SELECT → {authenticated}); `catalogo_produtos_update` (UPDATE → {authenticated})

## classificacoes_inadimplentes

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |
| cd_cliente | character varying | não |  |
| nm_cliente | character varying | não |  |
| valor_total | numeric | sim |  |
| ds_siglaest | character varying | sim |  |
| situacao | character varying | sim |  |
| feeling | character varying | sim |  |
| status | character varying | sim |  |
| usuario | character varying | não |  |
| data_alteracao | timestamp with time zone | sim | `now()` |
| created_at | timestamp with time zone | sim | `now()` |
| updated_at | timestamp with time zone | sim | `now()` |
| representante | character varying | sim |  |

Constraints: `classificacoes_inadimplentes_cd_cliente_key` UNIQUE (cd_cliente); `classificacoes_inadimplentes_pkey` PRIMARY KEY (id)

Índices: `classificacoes_inadimplentes_cd_cliente_key`, `classificacoes_inadimplentes_pkey`, `idx_classificacoes_cd_cliente`, `idx_classificacoes_data`, `idx_classificacoes_situacao`, `idx_classificacoes_usuario`

Policies: `Usuários autenticados podem atualizar classificações` (UPDATE → {authenticated}); `Usuários autenticados podem deletar classificações` (DELETE → {authenticated}); `Usuários autenticados podem inserir classificações` (INSERT → {authenticated}); `Usuários autenticados podem ler classificações` (SELECT → {authenticated}); `headcoach_autenticado_tudo` (ALL → {authenticated})

## client

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |
| code | text | não |  |
| name | text | não |  |
| document | text | sim |  |
| document_clean | text | sim |  |
| type | smallint | não |  |
| status | smallint | não |  |
| email | text | sim |  |
| phone | text | sim |  |
| website | text | sim |  |
| avatar_url | text | sim |  |
| source | text | sim |  |
| owner_user_id | uuid | sim |  |
| created_at | timestamp with time zone | não | `now()` |
| updated_at | timestamp with time zone | não | `now()` |
| custom_fields | jsonb | sim |  |

Constraints: `client_code_key` UNIQUE (code); `client_document_fmt_chk` CHECK (((document_clean IS NULL) OR (document_clean = ''::text) OR (document_clean ~ '^[0-9]{11}$'::text) OR (document_clean ~ '^[0-9]{14}$'::text))); `client_owner_user_id_fkey` FOREIGN KEY (owner_user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL; `client_pkey` PRIMARY KEY (id); `client_status_fkey` FOREIGN KEY (status) REFERENCES client_status(id) ON UPDATE RESTRICT ON DELETE RESTRICT; `client_type_fkey` FOREIGN KEY (type) REFERENCES client_type(id) ON UPDATE RESTRICT ON DELETE RESTRICT

Índices: `client_code_key`, `client_pkey`, `idx_client_avatar_url`, `idx_client_custom_fields`, `idx_client_document_clean`, `idx_client_name_lower`, `idx_client_status`, `idx_client_type`, `uq_client_document_clean`

Policies: `client_all` (ALL → {authenticated})

## client_address

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |
| client_id | uuid | não |  |
| street | text | sim |  |
| number | text | sim |  |
| complement | text | sim |  |
| district | text | sim |  |
| city | text | não |  |
| state | character | não |  |
| postal_code | character | não |  |
| country | character | não | `'BR'::bpchar` |
| is_primary | boolean | não | `true` |
| created_at | timestamp with time zone | não | `now()` |
| updated_at | timestamp with time zone | não | `now()` |

Constraints: `client_address_client_id_fkey` FOREIGN KEY (client_id) REFERENCES client(id) ON DELETE CASCADE; `client_address_country_chk` CHECK ((country ~ '^[A-Z]{2}$'::text)); `client_address_pkey` PRIMARY KEY (id); `client_address_postal_chk` CHECK ((postal_code ~ '^[0-9]{8}$'::text)); `client_address_state_chk` CHECK ((state ~ '^[A-Z]{2}$'::text))

Índices: `client_address_pkey`, `idx_client_address_client`, `uq_client_address_primary`

Policies: `client_address_all` (ALL → {authenticated})

## client_contact

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |
| client_id | uuid | não |  |
| name | text | não |  |
| role | text | sim |  |
| email | text | sim |  |
| phone | text | sim |  |
| whatsapp | text | sim |  |
| phone_clean | text | sim |  |
| whatsapp_clean | text | sim |  |
| created_at | timestamp with time zone | não | `now()` |
| updated_at | timestamp with time zone | não | `now()` |

Constraints: `client_contact_client_id_fkey` FOREIGN KEY (client_id) REFERENCES client(id) ON DELETE CASCADE; `client_contact_email_chk` CHECK (((email IS NULL) OR (email ~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$'::text))); `client_contact_phone_chk` CHECK (((phone IS NULL) OR (regexp_replace(phone, '[^0-9]'::text, ''::text, 'g'::text) ~ '^[0-9]{8,15}$'::text))); `client_contact_pkey` PRIMARY KEY (id); `client_contact_whatsapp_chk` CHECK (((whatsapp IS NULL) OR (regexp_replace(whatsapp, '[^0-9]'::text, ''::text, 'g'::text) ~ '^[0-9]{8,15}$'::text)))

Índices: `client_contact_pkey`, `idx_client_contact_client`, `idx_client_contact_email_lower`, `idx_client_contact_phone`, `idx_client_contact_whatsapp`, `uq_client_contact_name_per_client`

Policies: `client_contact_all` (ALL → {authenticated})

## client_interaction

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |
| client_id | uuid | não |  |
| occurred_at | timestamp with time zone | não | `now()` |
| channel | text | não |  |
| subject | text | sim |  |
| notes | text | sim |  |
| next_step | text | sim |  |
| created_by | uuid | sim |  |
| created_at | timestamp with time zone | não | `now()` |
| updated_at | timestamp with time zone | não | `now()` |

Constraints: `client_interaction_channel_chk` CHECK ((channel = ANY (ARRAY['call'::text, 'meeting'::text, 'email'::text, 'whatsapp'::text, 'sms'::text, 'other'::text]))); `client_interaction_client_id_fkey` FOREIGN KEY (client_id) REFERENCES client(id) ON DELETE CASCADE; `client_interaction_created_by_fkey` FOREIGN KEY (created_by) REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL; `client_interaction_pkey` PRIMARY KEY (id)

Índices: `client_interaction_pkey`, `idx_client_interaction_channel`, `idx_client_interaction_client_occ`

Policies: `client_interaction_all` (ALL → {authenticated})

## client_note

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |
| client_id | uuid | não |  |
| note | text | não |  |
| created_by | uuid | sim |  |
| created_at | timestamp with time zone | não | `now()` |
| updated_at | timestamp with time zone | não | `now()` |

Constraints: `client_note_client_id_fkey` FOREIGN KEY (client_id) REFERENCES client(id) ON DELETE CASCADE; `client_note_created_by_fkey` FOREIGN KEY (created_by) REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL; `client_note_pkey` PRIMARY KEY (id)

Índices: `client_note_pkey`, `idx_client_note_client_created`

Policies: `client_note_all` (ALL → {authenticated})

## client_payment

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | bigint | não |  |
| client_id | uuid | não |  |
| code | text | sim |  |
| contract_id | bigint | sim |  |
| status | text | sim |  |
| method | text | sim |  |
| value | real | sim |  |
| due_date | date | sim |  |
| payment_date | date | sim |  |
| created_at | timestamp with time zone | não | `now()` |
| updated_at | timestamp with time zone | não | `now()` |

Constraints: `client_payment_client_id_fkey` FOREIGN KEY (client_id) REFERENCES client(id) ON DELETE CASCADE; `client_payment_pkey` PRIMARY KEY (id)

Índices: `client_payment_pkey`, `idx_client_payment_client`, `idx_client_payment_code_lower`, `idx_client_payment_contract_id`, `idx_client_payment_due_date`, `idx_client_payment_payment_date`, `idx_client_payment_status`, `uq_client_payment_code_per_client`

Policies: `client_payment_all` (ALL → {authenticated})

## client_status

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | smallint | não |  |
| code | text | não |  |
| name | text | não |  |
| order_index | smallint | não |  |
| created_at | timestamp with time zone | não | `now()` |
| updated_at | timestamp with time zone | não | `now()` |
| color | text | sim |  |

Constraints: `client_status_code_key` UNIQUE (code); `client_status_order_index_key` UNIQUE (order_index); `client_status_pkey` PRIMARY KEY (id)

Índices: `client_status_code_key`, `client_status_order_index_key`, `client_status_pkey`, `ux_client_status_name_lower`

Policies: `client_status_ins` (INSERT → {authenticated}); `client_status_select` (SELECT → {authenticated}); `client_status_upd` (UPDATE → {authenticated})

## client_tag

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| client_id | uuid | não |  |
| tag_id | uuid | não |  |
| created_at | timestamp with time zone | não | `now()` |

Constraints: `client_tag_client_id_fkey` FOREIGN KEY (client_id) REFERENCES client(id) ON DELETE CASCADE; `client_tag_pkey` PRIMARY KEY (client_id, tag_id); `client_tag_tag_id_fkey` FOREIGN KEY (tag_id) REFERENCES tag(id) ON DELETE CASCADE

Índices: `client_tag_pkey`, `idx_client_tag_tag`

Policies: `client_tag_all` (ALL → {authenticated})

## client_type

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | smallint | não |  |
| code | text | não |  |
| name | text | não |  |
| order_index | smallint | não |  |
| created_at | timestamp with time zone | não | `now()` |
| updated_at | timestamp with time zone | não | `now()` |

Constraints: `client_type_code_key` UNIQUE (code); `client_type_order_index_key` UNIQUE (order_index); `client_type_pkey` PRIMARY KEY (id)

Índices: `client_type_code_key`, `client_type_order_index_key`, `client_type_pkey`, `ux_client_type_name_lower`

Policies: `client_type_ins` (INSERT → {authenticated}); `client_type_select` (SELECT → {authenticated}); `client_type_upd` (UPDATE → {authenticated})

## cliente_cartao

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | integer | não | `nextval('bank.cliente_cartao_id_seq'::regclass)` |
| cd_pessoa | character varying | sim |  |
| sufixo_voucher | character varying | sim |  |
| vl_cartao | character varying | sim |  |

Constraints: `cliente_cartao_pk` PRIMARY KEY (id); `cliente_cartao_unique` UNIQUE (cd_pessoa, sufixo_voucher)

Índices: `cliente_cartao_pk`, `cliente_cartao_unique`

## clientes_confianca_documentos

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | bigint | não | `nextval('clientes_confianca_documentos_id_seq'::regclass)` |
| person_code | integer | não |  |
| nome_arquivo | text | não |  |
| file_path | text | não |  |
| tipo | text | sim |  |
| uploaded_by | uuid | sim |  |
| created_at | timestamp with time zone | sim | `now()` |
| categoria | text | sim |  |

Constraints: `clientes_confianca_documentos_pkey` PRIMARY KEY (id); `clientes_confianca_documentos_uploaded_by_fkey` FOREIGN KEY (uploaded_by) REFERENCES auth.users(id)

Índices: `clientes_confianca_documentos_pkey`, `idx_clientes_confianca_docs_categoria`, `idx_clientes_confianca_docs_person`

Policies: `Escrita docs clientes confianca` (ALL → {authenticated}); `Leitura docs clientes confianca` (SELECT → {authenticated})

## clientes_confianca_perfil

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | bigint | não | `nextval('clientes_confianca_perfil_id_seq'::regclass)` |
| person_code | integer | não |  |
| instagram | text | sim |  |
| foto_path | text | sim |  |
| created_at | timestamp with time zone | sim | `now()` |
| updated_at | timestamp with time zone | sim | `now()` |

Constraints: `clientes_confianca_perfil_person_code_key` UNIQUE (person_code); `clientes_confianca_perfil_pkey` PRIMARY KEY (id)

Índices: `clientes_confianca_perfil_person_code_key`, `clientes_confianca_perfil_pkey`

Policies: `Escrita perfil clientes confianca` (ALL → {authenticated}); `Leitura perfil clientes confianca` (SELECT → {authenticated})

## clientes_empresa

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | integer | não | `nextval('clientes_empresa_id_seq'::regclass)` |
| codigo_empresa | integer | não |  |
| code | integer | não |  |
| cd_empresacad | integer | sim |  |
| tipo_pessoa | character varying | sim |  |
| nm_pessoa | text | sim |  |
| fantasy_name | text | sim |  |
| cpf_cnpj | text | sim |  |
| rg | text | sim |  |
| uf | character varying | sim |  |
| telefone | text | sim |  |
| email | text | sim |  |
| is_customer | boolean | sim |  |
| is_inactive | boolean | sim |  |
| customer_status | text | sim |  |
| person_status | text | sim |  |
| insert_date | timestamp with time zone | sim |  |
| dados | jsonb | sim |  |
| criado_em | timestamp with time zone | não | `now()` |
| atualizado_em | timestamp with time zone | não | `now()` |

Constraints: `clientes_empresa_codigo_empresa_code_key` UNIQUE (codigo_empresa, code); `clientes_empresa_pkey` PRIMARY KEY (id)

Índices: `clientes_empresa_codigo_empresa_code_key`, `clientes_empresa_pkey`, `idx_clientes_empresa_codigo`, `idx_clientes_empresa_cpfcnpj`, `idx_clientes_empresa_nome`, `idx_clientes_empresa_tipo`

## clientes_filial_salvos

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | bigint | não | `nextval('clientes_filial_salvos_id_seq'::regclass)` |
| branch_code | integer | não |  |
| branch_name | text | sim |  |
| lista_nome | text | sim |  |
| total_clientes | integer | não | `0` |
| faturamento_total | numeric | não | `0` |
| filtros | jsonb | sim |  |
| clientes | jsonb | não |  |
| created_by | text | sim |  |
| created_at | timestamp with time zone | não | `now()` |

Constraints: `clientes_filial_salvos_pkey` PRIMARY KEY (id)

Índices: `clientes_filial_salvos_pkey`, `idx_cfs_branch_code`, `idx_cfs_created_at`

## companies

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |
| name | text | não |  |
| slug | text | não |  |
| type | text | não | `'company'::text` |
| schema_name | text | não |  |
| parent_id | uuid | sim |  |
| active | boolean | não | `true` |
| settings | jsonb | sim | `'{}'::jsonb` |
| created_at | timestamp with time zone | não | `now()` |
| updated_at | timestamp with time zone | não | `now()` |

Constraints: `companies_parent_id_fkey` FOREIGN KEY (parent_id) REFERENCES companies(id) ON DELETE SET NULL; `companies_pkey` PRIMARY KEY (id); `companies_schema_name_key` UNIQUE (schema_name); `companies_slug_key` UNIQUE (slug); `companies_type_check` CHECK ((type = ANY (ARRAY['company'::text, 'franchise_master'::text, 'franchise'::text])))

Índices: `companies_pkey`, `companies_schema_name_key`, `companies_slug_key`, `idx_companies_active`, `idx_companies_parent_id`, `idx_companies_schema_name`, `idx_companies_type`

Policies: `companies_select` (SELECT → {authenticated}); `companies_write` (ALL → {authenticated})

## configuracoes

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | integer | não | `nextval('configuracoes_id_seq'::regclass)` |
| chave | text | não |  |
| valor | text | sim |  |
| created_at | timestamp with time zone | sim | `now()` |
| updated_at | timestamp with time zone | sim | `now()` |

Constraints: `configuracoes_chave_key` UNIQUE (chave); `configuracoes_pkey` PRIMARY KEY (id)

Índices: `configuracoes_chave_key`, `configuracoes_pkey`

Policies: `Allow all operations on configuracoes` (ALL → {public})

## contas_autorizacoes

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |
| chave_unica | text | não |  |
| cd_fornecedor | text | não |  |
| nr_duplicata | text | não |  |
| cd_empresa | text | não |  |
| nr_parcela | text | não |  |
| autorizado_por | text | não |  |
| autorizado_em | timestamp with time zone | sim | `now()` |
| created_at | timestamp with time zone | sim | `now()` |
| updated_at | timestamp with time zone | sim | `now()` |
| status | text | sim | `'AUTORIZADO'::text` |
| enviado_por | text | sim |  |
| data_envio_pagamento | timestamp without time zone | sim |  |

Constraints: `contas_autorizacoes_chave_unica_key` UNIQUE (chave_unica); `contas_autorizacoes_pkey` PRIMARY KEY (id)

Índices: `contas_autorizacoes_chave_unica_key`, `contas_autorizacoes_pkey`, `idx_contas_autorizacoes_data`, `idx_contas_autorizacoes_empresa`, `idx_contas_autorizacoes_fornecedor`

## contatos_whatsapp

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | bigint | não | `nextval('contatos_whatsapp_id_seq'::regclass)` |
| nome | text | sim |  |
| telefone | text | não |  |
| instancias | text | sim |  |
| fontes | text | sim |  |
| qtd_msgs | integer | sim | `0` |
| primeiro_contato | timestamp without time zone | sim |  |
| ultimo_contato | timestamp without time zone | sim |  |
| criado_em | timestamp without time zone | sim | `now()` |
| atualizado_em | timestamp without time zone | sim | `now()` |
| status | text | sim |  |

Constraints: `contatos_whatsapp_pkey` PRIMARY KEY (id); `contatos_whatsapp_telefone_key` UNIQUE (telefone)

Índices: `contatos_whatsapp_pkey`, `contatos_whatsapp_telefone_key`, `idx_contatos_status`, `idx_contatos_telefone`, `idx_contatos_ultimo`

## conversas

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | text | não |  |
| name | text | sim |  |
| connection_status | text | sim |  |
| owner_jid | text | sim |  |
| profile_pic | text | sim |  |
| token | text | sim |  |
| profile_name | text | sim |  |
| businessid | text | sim |  |
| created_at | timestamp without time zone | sim |  |
| updated_at | timestamp without time zone | sim |  |
| disconnection_at | timestamp without time zone | sim |  |

Constraints: `conversas_pkey` PRIMARY KEY (id)

Índices: `conversas_pkey`

## cotacao_usd_brl

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| data | date | não |  |
| cotacao | numeric | não |  |
| fonte | text | sim | `'awesomeapi'::text` |
| synced_at | timestamp with time zone | sim | `now()` |

Constraints: `cotacao_usd_brl_pkey` PRIMARY KEY (data)

Índices: `cotacao_usd_brl_pkey`

## court

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | bigint | não |  |
| court_acronym | text | sim |  |
| court_section | text | sim |  |
| created_at | timestamp with time zone | não | `now()` |
| updated_at | timestamp with time zone | não | `now()` |

Constraints: `court_pkey` PRIMARY KEY (id)

Índices: `court_pkey`

Policies: `court_select` (SELECT → {authenticated})

## crm_lead_generation_calls

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |
| vendedor_code | integer | não |  |
| vendedor_nome | text | sim |  |
| modulo | text | não |  |
| person_code | integer | não |  |
| person_nome | text | sim |  |
| person_telefone | text | sim |  |
| person_cidade | text | sim |  |
| person_uf | text | sim |  |
| categoria | text | não |  |
| data_contato | timestamp with time zone | não | `now()` |
| atendida | boolean | não |  |
| observacao | text | sim |  |
| created_at | timestamp with time zone | não | `now()` |
| user_login | text | sim |  |

Constraints: `crm_lead_generation_calls_pkey` PRIMARY KEY (id)

Índices: `crm_lead_generation_calls_pkey`, `crm_lgc_categoria_idx`, `crm_lgc_modulo_data_idx`, `crm_lgc_person_idx`, `crm_lgc_vendedor_idx`

## crm_roubos

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | bigint | não | `nextval('crm_roubos_id_seq'::regclass)` |
| task_id | text | sim |  |
| canal_lead | text | sim |  |
| tel | text | sim |  |
| nome | text | sim |  |
| de_inst | text | não |  |
| para_inst | text | não |  |
| status | text | não |  |
| created_at | timestamp with time zone | não | `now()` |
| updated_at | timestamp with time zone | sim |  |

Constraints: `crm_roubos_pkey` PRIMARY KEY (id); `crm_roubos_status_check` CHECK ((status = ANY (ARRAY['disputa'::text, 'cedido'::text, 'evitado'::text])))

Índices: `crm_roubos_pkey`, `idx_crm_roubos_created_at`

Policies: `crm_roubos_all_access` (ALL → {public})

## crm_seller_metas

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |
| seller_code | integer | não |  |
| seller_name | text | sim |  |
| modulo | text | não |  |
| period_type | text | não |  |
| period_key | text | não |  |
| valor_meta | numeric | não |  |
| created_at | timestamp with time zone | não | `now()` |
| updated_at | timestamp with time zone | não | `now()` |
| updated_by | text | sim |  |
| meta_kind | text | não | `'faturamento'::text` |
| entity_type | text | não | `'seller'::text` |

Constraints: `crm_seller_metas_entity_type_check` CHECK ((entity_type = ANY (ARRAY['seller'::text, 'branch'::text]))); `crm_seller_metas_meta_kind_check` CHECK ((meta_kind = ANY (ARRAY['faturamento'::text, 'aberturas'::text, 'reativacoes'::text]))); `crm_seller_metas_period_type_check` CHECK ((period_type = ANY (ARRAY['mensal'::text, 'semanal'::text]))); `crm_seller_metas_pkey` PRIMARY KEY (id); `crm_seller_metas_unique` UNIQUE (entity_type, seller_code, modulo, meta_kind, period_type, period_key)

Índices: `crm_seller_metas_lookup_idx`, `crm_seller_metas_pkey`, `crm_seller_metas_seller_idx`, `crm_seller_metas_unique`

## crm_varejo_avisos

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | integer | não | `nextval('crm_varejo_avisos_id_seq'::regclass)` |
| titulo | text | não |  |
| conteudo | text | não |  |
| prioridade | character varying | não | `'normal'::character varying` |
| ano | integer | sim |  |
| semana_iso | integer | sim |  |
| expira_em | date | sim |  |
| ativo | boolean | não | `true` |
| criado_em | timestamp with time zone | não | `now()` |
| atualizado_em | timestamp with time zone | não | `now()` |
| criado_por | text | sim |  |

Constraints: `crm_varejo_avisos_pkey` PRIMARY KEY (id)

Índices: `crm_varejo_avisos_pkey`, `idx_crm_varejo_avisos_periodo`, `idx_crm_varejo_avisos_recentes`

## crm_varejo_competicoes

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |
| nome | text | não |  |
| descricao | text | sim |  |
| premiacao | text | sim |  |
| data_inicio | date | não |  |
| data_fim | date | não |  |
| duracao_preset | text | sim |  |
| branch_codes | ARRAY | não |  |
| meta_tipo | text | não | `'faturamento'::text` |
| meta_valor | numeric | sim |  |
| status | text | não | `'ativa'::text` |
| vencedor_branch | integer | sim |  |
| vencedor_valor | numeric | sim |  |
| ranking_final | jsonb | sim |  |
| encerrada_em | timestamp with time zone | sim |  |
| encerrada_por | text | sim |  |
| criado_por | text | não |  |
| created_at | timestamp with time zone | não | `now()` |
| updated_at | timestamp with time zone | não | `now()` |

Constraints: `crm_varejo_competicoes_branch_codes_check` CHECK ((array_length(branch_codes, 1) >= 2)); `crm_varejo_competicoes_duracao_preset_check` CHECK ((duracao_preset = ANY (ARRAY['1w'::text, '15d'::text, '1m'::text, 'custom'::text]))); `crm_varejo_competicoes_meta_tipo_check` CHECK ((meta_tipo = ANY (ARRAY['faturamento'::text, 'aberturas'::text, 'reativacoes'::text]))); `crm_varejo_competicoes_periodo_valido` CHECK ((data_fim >= data_inicio)); `crm_varejo_competicoes_pkey` PRIMARY KEY (id); `crm_varejo_competicoes_status_check` CHECK ((status = ANY (ARRAY['ativa'::text, 'encerrada'::text, 'cancelada'::text])))

Índices: `crm_varejo_competicoes_branches_idx`, `crm_varejo_competicoes_periodo_idx`, `crm_varejo_competicoes_pkey`, `crm_varejo_competicoes_status_idx`

## crm_varejo_x1

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | bigint | não | `nextval('crm_varejo_x1_id_seq'::regclass)` |
| nome | text | não |  |
| descricao | text | sim |  |
| premiacao | text | sim |  |
| data_inicio | date | não |  |
| data_fim | date | não |  |
| confrontos | jsonb | não | `'[]'::jsonb` |
| status | text | não | `'ativa'::text` |
| ranking_final | jsonb | sim |  |
| criado_por | text | sim |  |
| created_at | timestamp with time zone | não | `now()` |

Constraints: `crm_varejo_x1_pkey` PRIMARY KEY (id)

Índices: `crm_varejo_x1_pkey`

## custom_fields

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |
| entity | text | não | `'client'::text` |
| field_key | text | não | `'default'::text` |
| label | text | não |  |
| field_type | text | não | `'text'::text` |
| placeholder | text | sim |  |
| description | text | sim |  |
| is_required | boolean | não | `false` |
| is_active | boolean | não | `true` |
| options | jsonb | sim |  |
| max_length | integer | sim |  |
| min_value | numeric | sim |  |
| max_value | numeric | sim |  |
| mask | text | sim |  |
| created_at | timestamp with time zone | não | `now()` |
| updated_at | timestamp with time zone | não | `now()` |

Constraints: `custom_fields_pkey` PRIMARY KEY (id); `uq_custom_fields_entity_key` UNIQUE (entity, field_key)

Índices: `custom_fields_pkey`, `idx_custom_fields_active`, `idx_custom_fields_entity`, `uq_custom_fields_entity_key`

Policies: `custom_fields_delete` (DELETE → {authenticated}); `custom_fields_insert` (INSERT → {authenticated}); `custom_fields_select` (SELECT → {authenticated}); `custom_fields_update` (UPDATE → {authenticated})

## custos_producao

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| custo | character varying | sim |  |
| modelo | character varying | sim |  |
| cd_modelo | character varying | não |  |

Constraints: `custos_producao_pk` PRIMARY KEY (cd_modelo)

Índices: `custos_producao_pk`

## dashboard_config

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | bigint | não |  |
| instance_id | uuid | não | `'00000000-0000-0000-0000-000000000000'::uuid` |
| folder_id | bigint | não |  |
| title | text | não |  |
| type | text | não |  |
| schema | text | não |  |
| view | text | não |  |
| metadata | jsonb | não | `'{}'::jsonb` |
| grid_cols | integer | não | `1` |
| grid_rows | integer | não | `1` |
| position | integer | sim |  |
| enabled | boolean | sim | `true` |
| created_at | timestamp with time zone | sim | `now()` |
| updated_at | timestamp with time zone | sim | `now()` |
| connection_id | uuid | sim |  |

Constraints: `dashboard_config_connection_id_fkey` FOREIGN KEY (connection_id) REFERENCES database_connections(id) ON DELETE SET NULL; `dashboard_config_folder_id_fkey` FOREIGN KEY (folder_id) REFERENCES dashboard_folder(id) ON DELETE CASCADE; `dashboard_config_pkey` PRIMARY KEY (id)

Índices: `dashboard_config_pkey`, `idx_dashboard_config_connection_id`, `idx_dashboard_config_folder_id`, `idx_dashboard_config_instance_folder`, `idx_dashboard_enabled_position`

Policies: `dashboard_all` (ALL → {authenticated})

## dashboard_folder

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | bigint | não |  |
| instance_id | uuid | não | `'00000000-0000-0000-0000-000000000000'::uuid` |
| name | text | não |  |
| description | text | sim |  |
| profile_id | integer | sim |  |
| position | smallint | sim |  |
| enabled | boolean | sim | `true` |
| created_at | timestamp with time zone | sim | `now()` |
| updated_at | timestamp with time zone | sim | `now()` |

Constraints: `dashboard_folder_pkey` PRIMARY KEY (id)

Índices: `dashboard_folder_pkey`, `idx_dashboard_folder_enabled_position`

Policies: `dashboard_folder_all` (ALL → {authenticated})

## dashboards

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |
| nome | character varying | não |  |
| descricao | text | sim |  |
| usuarios | ARRAY | não | `'{}'::integer[]` |
| created_by | uuid | não |  |
| created_at | timestamp with time zone | sim | `CURRENT_TIMESTAMP` |
| updated_at | timestamp with time zone | sim | `CURRENT_TIMESTAMP` |
| is_active | boolean | sim | `true` |

Constraints: `dashboards_pkey` PRIMARY KEY (id)

Índices: `dashboards_pkey`, `idx_dashboards_created_by`, `idx_dashboards_usuarios`

Policies: `Authenticated users can create dashboards` (INSERT → {public}); `Users can delete their own dashboards` (DELETE → {public}); `Users can update their own dashboards` (UPDATE → {public}); `Users can view their dashboards` (SELECT → {public})

## database_connections

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |
| name | character varying | não |  |
| description | text | sim |  |
| db_type | USER-DEFINED | não |  |
| host | character varying | não |  |
| port | integer | não |  |
| database_name | character varying | não |  |
| username | character varying | não |  |
| password_encrypted | text | não |  |
| ssl_enabled | boolean | sim | `false` |
| connection_timeout | integer | sim | `5000` |
| max_pool_size | integer | sim | `10` |
| status | USER-DEFINED | sim | `'inactive'::connection_status` |
| last_test_at | timestamp with time zone | sim |  |
| last_test_success | boolean | sim |  |
| last_test_error | text | sim |  |
| instance_id | uuid | sim |  |
| created_by | uuid | sim |  |
| created_at | timestamp with time zone | não | `now()` |
| updated_at | timestamp with time zone | não | `now()` |

Constraints: `database_connections_created_by_fkey` FOREIGN KEY (created_by) REFERENCES auth.users(id); `database_connections_name_key` UNIQUE (name, instance_id); `database_connections_pkey` PRIMARY KEY (id)

Índices: `database_connections_name_key`, `database_connections_pkey`, `idx_database_connections_created_by`, `idx_database_connections_db_type`, `idx_database_connections_instance`, `idx_database_connections_status`

Policies: `Authenticated users can read connections` (SELECT → {public}); `Owners can manage database connections` (ALL → {public})

## despesas_fixas_filial

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |
| cd_filial | character varying | não |  |
| cd_fornecedor | character varying | sim |  |
| nm_fornecedor | character varying | não |  |
| tipo_despesa | character varying | não |  |
| vencimento | character varying | sim |  |
| forma_pagamento | character varying | sim |  |
| observacao | text | sim |  |
| created_at | timestamp with time zone | sim | `now()` |
| updated_at | timestamp with time zone | sim | `now()` |
| contrato_vencimento | date | sim |  |
| contrato_path | text | sim |  |
| contrato_nome | text | sim |  |
| contrato_tipo | text | sim |  |
| contrato_alerta_vencimento | date | sim |  |

Constraints: `despesas_fixas_filial_pkey` PRIMARY KEY (id); `despesas_fixas_filial_tipo_despesa_check` CHECK (((tipo_despesa)::text = ANY ((ARRAY['ENERGIA'::character varying, 'AGUA'::character varying, 'INTERNET'::character varying, 'TELEFONE'::character varying, 'ALUGUEL'::character varying, 'AGUA_MINERAL'::character varying, 'CONDOMINIO'::character varying])::text[])))

Índices: `despesas_fixas_filial_pkey`, `idx_despesas_fixas_contrato_venc`, `idx_despesas_fixas_filial_cd`

Policies: `Despesa filial: delete financeiro` (DELETE → {authenticated}); `Despesa filial: insert financeiro` (INSERT → {authenticated}); `Despesa filial: leitura autenticada` (SELECT → {authenticated}); `Despesa filial: update financeiro` (UPDATE → {authenticated})

## despesas_industria_pagamentos

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | bigint | não | `nextval('despesas_industria_pagamentos_id_seq'::regclass)` |
| cd_fornecedor | text | não |  |
| nm_fornecedor | text | sim |  |
| categoria_codigo | integer | não |  |
| valor_real | numeric | sim |  |
| dt_atualizacao | timestamp with time zone | sim | `now()` |
| comprovante_path | text | sim |  |
| comprovante_nome | text | sim |  |
| comprovante_tipo | text | sim |  |
| updated_by | text | sim |  |
| created_at | timestamp with time zone | sim | `now()` |
| updated_at | timestamp with time zone | sim | `now()` |
| checado | boolean | não | `false` |

Constraints: `despesas_industria_pagamentos_pkey` PRIMARY KEY (id); `uniq_fornecedor_categoria` UNIQUE (cd_fornecedor, categoria_codigo)

Índices: `despesas_industria_pagamentos_pkey`, `idx_dip_categoria`, `idx_dip_fornecedor`, `uniq_fornecedor_categoria`

Policies: `Atualizacao autenticada` (UPDATE → {public}); `Exclusao autenticada` (DELETE → {public}); `Insercao autenticada` (INSERT → {public}); `Leitura autenticada` (SELECT → {public})

## despesas_manuais_dre

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | uuid | não | `extensions.uuid_generate_v4()` |
| dt_inicio | date | não |  |
| dt_fim | date | não |  |
| categoria_principal | character varying | não |  |
| cd_despesaitem | integer | não |  |
| fornecedor | character varying | sim |  |
| cd_fornecedor | integer | sim |  |
| valor | numeric | não |  |
| cd_usuario | integer | sim |  |
| dt_cadastro | timestamp without time zone | sim | `now()` |
| observacoes | text | sim |  |
| ativo | boolean | sim | `true` |

Constraints: `check_categoria_principal` CHECK (((categoria_principal)::text = ANY ((ARRAY['OPERACIONAL'::character varying, 'FINANCEIRA'::character varying])::text[]))); `check_valor_positivo` CHECK ((valor > (0)::numeric)); `despesas_manuais_dre_pkey` PRIMARY KEY (id)

Índices: `despesas_manuais_dre_pkey`, `idx_despesas_manuais_categoria`, `idx_despesas_manuais_fornecedor`, `idx_despesas_manuais_periodo`

Policies: `dre` (ALL → {public})

## devolucoes_mercadoria

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | bigint | não | `nextval('devolucoes_mercadoria_id_seq'::regclass)` |
| origem | text | não | `'publico'::text` |
| cliente_code | integer | não |  |
| cliente_nome | text | sim |  |
| cliente_cpf_cnpj | text | não |  |
| cliente_tipo | text | sim |  |
| cliente_empresa | integer | sim |  |
| cliente_empresa_nome | text | sim |  |
| cliente_telefone | text | sim |  |
| cliente_email | text | sim |  |
| vendedor_code | integer | sim |  |
| vendedor_nome | text | sim |  |
| tipo | text | não |  |
| qtd_pecas | integer | não | `1` |
| observacao | text | sim |  |
| fotos | jsonb | não | `'[]'::jsonb` |
| status | text | não | `'aguardando_devolucao'::text` |
| observacao_interna | text | sim |  |
| motivo_cancelamento | text | sim |  |
| chamado_dryland_id | bigint | sim |  |
| chamado_dryland_numero | integer | sim |  |
| chamado_aberto_em | timestamp with time zone | sim |  |
| chamado_status | text | sim |  |
| chamado_concluido_em | timestamp with time zone | sim |  |
| avaliacao_producao | text | sim |  |
| transacao_branch | integer | sim |  |
| transacao_code | bigint | sim |  |
| transacao_date | date | sim |  |
| transacao_total | numeric | sim |  |
| transacao_status | integer | sim |  |
| transacao_operacao | integer | sim |  |
| transacao_qtd_epcs | integer | sim |  |
| transacao_em | timestamp with time zone | sim |  |
| transacao_atendida_em | timestamp with time zone | sim |  |
| transacao_por | text | sim |  |
| criado_por | text | sim |  |
| ip_origem | text | sim |  |
| criado_em | timestamp with time zone | não | `now()` |
| atualizado_em | timestamp with time zone | não | `now()` |

Constraints: `devolucoes_mercadoria_origem_check` CHECK ((origem = ANY (ARRAY['publico'::text, 'interno'::text]))); `devolucoes_mercadoria_pkey` PRIMARY KEY (id); `devolucoes_mercadoria_status_check` CHECK ((status = ANY (ARRAY['aguardando_avaliacao'::text, 'aguardando_devolucao'::text, 'em_devolucao'::text, 'concluida'::text, 'cancelada'::text]))); `devolucoes_mercadoria_tipo_check` CHECK ((tipo = ANY (ARRAY['tradicional'::text, 'defeito'::text])))

Índices: `devolucoes_mercadoria_pkey`, `idx_devolucoes_chamado`, `idx_devolucoes_cliente`, `idx_devolucoes_status`, `idx_devolucoes_transacao`

## devolucoes_transacoes

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | bigint | não | `nextval('devolucoes_transacoes_id_seq'::regclass)` |
| devolucao_id | bigint | sim |  |
| empresa | integer | não |  |
| transacao_code | bigint | sim |  |
| transacao_date | date | sim |  |
| transacao_status | integer | não | `1` |
| operacao | integer | sim |  |
| cfop | integer | sim |  |
| total | numeric | não | `0` |
| atendida_em | timestamp with time zone | sim |  |
| cliente_code | integer | sim |  |
| cliente_nome | text | sim |  |
| vendedor_code | integer | sim |  |
| vendedor_nome | text | sim |  |
| nf_numero | integer | sim |  |
| nf_serie | text | sim |  |
| nf_data | date | sim |  |
| nf_empresa | integer | sim |  |
| nf_chave | text | sim |  |
| nf_total | numeric | sim |  |
| nf_qtd_pecas | integer | sim |  |
| qtd_recebida | integer | não | `0` |
| qtd_faltando | integer | não | `0` |
| qtd_sobrando | integer | não | `0` |
| valor_faltando | numeric | não | `0` |
| recebidos | jsonb | não | `'[]'::jsonb` |
| faltando | jsonb | não | `'[]'::jsonb` |
| sobrando | jsonb | não | `'[]'::jsonb` |
| criado_por | text | sim |  |
| criado_em | timestamp with time zone | não | `now()` |
| atualizado_em | timestamp with time zone | não | `now()` |
| origem | text | não | `'totvs'::text` |

Constraints: `devolucoes_transacoes_pkey` PRIMARY KEY (id)

Índices: `devolucoes_transacoes_pkey`, `idx_dev_trx_cliente`, `idx_dev_trx_data`, `idx_dev_trx_nf`, `uq_dev_trx`

## employee

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |
| code | text | não |  |
| name | text | não |  |
| cpf_raw | text | sim |  |
| cpf | character varying | sim |  |
| ctps_number | text | sim |  |
| ctps_series | text | sim |  |
| pis_number | text | sim |  |
| voter_number | text | sim |  |
| voter_zone | text | sim |  |
| voter_section | text | sim |  |
| identity_number | text | sim |  |
| identity_expedition | date | sim |  |
| identity_agency | text | sim |  |
| identity_agency_uf | text | sim |  |
| email | text | sim |  |
| driver_license_number | text | sim |  |
| driver_license_category | text | sim |  |
| driver_license_expiration | date | sim |  |
| cbo_code | text | sim |  |
| work_schedule_name | text | sim |  |
| contracting_party_name | text | sim |  |
| phone | text | sim |  |
| phone_clean | text | sim |  |
| hire_date | date | não |  |
| department | text | sim |  |
| position | text | sim |  |
| status | text | não | `'active'::text` |
| avatar_url | text | sim |  |
| birthday | date | sim |  |
| gender | USER-DEFINED | não | `'other'::gender_enum` |
| nationality | text | sim |  |
| birth_city | text | sim |  |
| birth_uf | text | sim |  |
| education_level | USER-DEFINED | sim |  |
| race | USER-DEFINED | sim |  |
| mother_name | text | sim |  |
| father_name | text | sim |  |
| marital_status | text | sim |  |
| spouse_name | text | sim |  |
| address_street | text | sim |  |
| address_number | text | sim |  |
| address_complement | text | sim |  |
| address_district | text | sim |  |
| address_city | text | sim |  |
| address_state | text | sim |  |
| address_zip | text | sim |  |
| address_country | text | sim |  |
| created_at | timestamp with time zone | não | `now()` |
| updated_at | timestamp with time zone | não | `now()` |
| custom_fields | jsonb | sim |  |

Constraints: `employee_code_key` UNIQUE (code); `employee_cpf_fmt_chk` CHECK (((cpf IS NULL) OR ((cpf)::text ~ '^[0-9]{11}$'::text))); `employee_cpf_unique` UNIQUE (cpf); `employee_email_fmt_chk` CHECK (((email IS NULL) OR (email ~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$'::text))); `employee_phone_chk` CHECK (((phone_clean IS NULL) OR (phone_clean ~ '^\+?[0-9]{8,15}$'::text))); `employee_pkey` PRIMARY KEY (id); `employee_status_check` CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text, 'terminated'::text])))

Índices: `employee_code_key`, `employee_cpf_unique`, `employee_pkey`, `idx_employee_custom_fields`, `idx_employee_department`, `idx_employee_position`, `idx_employee_status`

Policies: `employee_select` (SELECT → {authenticated}); `employee_write` (ALL → {authenticated})

## employee_documents

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |
| employee_id | uuid | não |  |
| name | text | não |  |
| document_type | text | não |  |
| file_url | text | não |  |
| mime_type | text | sim |  |
| size_bytes | integer | sim |  |
| hash_sha256 | character | sim |  |
| created_at | timestamp with time zone | não | `now()` |
| updated_at | timestamp with time zone | não | `now()` |

Constraints: `employee_documents_employee_id_fkey` FOREIGN KEY (employee_id) REFERENCES employee(id) ON DELETE CASCADE; `employee_documents_hash_chk` CHECK (((hash_sha256 IS NULL) OR (hash_sha256 ~ '^[0-9a-f]{64}$'::text))); `employee_documents_pkey` PRIMARY KEY (id); `employee_documents_size_chk` CHECK (((size_bytes IS NULL) OR (size_bytes > 0))); `employee_documents_type_chk` CHECK ((document_type ~ '^[A-Za-z0-9_\-]{3,50}$'::text))

Índices: `employee_documents_pkey`, `idx_employee_documents_emp_type`, `idx_employee_documents_hash`

Policies: `employee_documents_select` (SELECT → {authenticated}); `employee_documents_write` (ALL → {authenticated})

## employee_medical_leaves

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |
| employee_id | uuid | não |  |
| start_date | date | não |  |
| end_date | date | não |  |
| reason | text | sim |  |
| document_url | text | sim |  |
| created_at | timestamp with time zone | não | `now()` |
| updated_at | timestamp with time zone | não | `now()` |

Constraints: `employee_medical_leaves_date_chk` CHECK ((start_date <= end_date)); `employee_medical_leaves_employee_id_fkey` FOREIGN KEY (employee_id) REFERENCES employee(id) ON DELETE CASCADE; `employee_medical_leaves_pkey` PRIMARY KEY (id)

Índices: `employee_medical_leaves_pkey`, `idx_employee_medical_leaves_emp_dates`

Policies: `employee_medical_leaves_select` (SELECT → {authenticated}); `employee_medical_leaves_write` (ALL → {authenticated})

## employee_salary

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |
| employee_id | uuid | não |  |
| amount | numeric | não |  |
| effective_date | date | não |  |
| notes | text | sim |  |
| created_at | timestamp with time zone | não | `now()` |
| updated_at | timestamp with time zone | não | `now()` |

Constraints: `employee_salary_amount_chk` CHECK ((amount > (0)::numeric)); `employee_salary_effective_not_future_chk` CHECK ((effective_date <= (CURRENT_DATE + '31 days'::interval))); `employee_salary_employee_id_fkey` FOREIGN KEY (employee_id) REFERENCES employee(id) ON DELETE CASCADE; `employee_salary_pkey` PRIMARY KEY (id)

Índices: `employee_salary_pkey`, `idx_salary_employee_date_desc`, `uq_salary_employee_date`

Policies: `employee_salary_select` (SELECT → {authenticated}); `employee_salary_write` (ALL → {authenticated})

## employee_vacations

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |
| employee_id | uuid | não |  |
| start_date | date | não |  |
| end_date | date | não |  |
| days_count | integer | não |  |
| status | text | não | `'scheduled'::text` |
| notes | text | sim |  |
| created_at | timestamp with time zone | não | `now()` |
| updated_at | timestamp with time zone | não | `now()` |

Constraints: `employee_vacations_date_chk` CHECK ((start_date <= end_date)); `employee_vacations_days_count_chk` CHECK (((days_count = ((end_date - start_date) + 1)) AND (days_count > 0))); `employee_vacations_employee_id_fkey` FOREIGN KEY (employee_id) REFERENCES employee(id) ON DELETE CASCADE; `employee_vacations_no_overlap` EXCLUDE USING gist (employee_id WITH =, daterange(start_date, end_date, '[]'::text) WITH &&) WHERE ((status = ANY (ARRAY['approved'::text, 'taken'::text]))); `employee_vacations_pkey` PRIMARY KEY (id); `employee_vacations_status_check` CHECK ((status = ANY (ARRAY['scheduled'::text, 'approved'::text, 'taken'::text, 'cancelled'::text])))

Índices: `employee_vacations_no_overlap`, `employee_vacations_pkey`, `idx_employee_vacations_emp_start`, `idx_employee_vacations_status`

Policies: `employee_vacations_select` (SELECT → {authenticated}); `employee_vacations_write` (ALL → {authenticated})

## employees

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |
| name | text | não |  |
| gender | text | sim |  |
| department | text | sim |  |
| branch | text | sim |  |
| admission_date | date | sim |  |
| termination_date | date | sim |  |
| birthday | date | sim |  |
| vacation_start | date | sim |  |
| status | USER-DEFINED | sim | `'active'::employee_status` |
| created_by | uuid | sim |  |
| created_at | timestamp with time zone | sim | `now()` |

Constraints: `employees_pkey` PRIMARY KEY (id)

Índices: `employees_pkey`

Policies: `HR and Admin can insert employees` (INSERT → {public}); `HR and Admin can update employees` (UPDATE → {public}); `HR and Admin can view all employees` (SELECT → {public}); `Managers can view department employees` (SELECT → {public})

## endividamentos

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |
| created_at | timestamp with time zone | não | `now()` |
| user_id | uuid | não |  |
| instituicao | text | não |  |
| razao_social_tomador | text | não |  |
| cnpj_tomador | text | sim |  |
| ag | text | sim |  |
| cc | text | sim |  |
| linha_credito | text | sim |  |
| numero_contrato | text | sim |  |
| data_contratacao | date | sim |  |
| vencimento_final | date | sim |  |
| limite_aprovado | numeric | sim |  |
| saldo_devedor_sem_juros | numeric | sim |  |
| saldo_devedor_com_juros | numeric | sim |  |
| valor_mensal_pmt | numeric | sim |  |
| quantidade_pmt | integer | sim |  |
| pmt_pagas | integer | sim |  |
| diferenca_pmt_vencer | numeric | sim |  |
| data_inicial_pagamento | date | sim |  |
| taxa_juros_mes | numeric | sim |  |
| avalista | text | sim |  |
| garantias | text | sim |  |
| anexo_path | text | sim |  |

Constraints: `endividamentos_pkey` PRIMARY KEY (id); `endividamentos_user_id_fkey` FOREIGN KEY (user_id) REFERENCES auth.users(id)

Índices: `endividamentos_pkey`

Policies: `endiv_delete_own` (DELETE → {public}); `endiv_insert_own` (INSERT → {public}); `endiv_select_own` (SELECT → {public}); `endiv_update_own` (UPDATE → {public})

## envio_adv

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | character varying | não |  |
| idParent | character varying | sim | `NULL::character varying` |
| status | character varying | sim | `NULL::character varying` |
| motivoAdv | character varying | sim | `NULL::character varying` |
| tipoDeAdv | character varying | sim | `NULL::character varying` |
| name | character varying | sim | `NULL::character varying` |
| EnviarADV | character varying | sim | `NULL::character varying` |
| filial | character varying | sim | `NULL::character varying` |
| data_adv | character varying | sim | `NULL::character varying` |

Constraints: `envioAdv_pkey` PRIMARY KEY (id)

Índices: `envioAdv_pkey`

Policies: `a` (ALL → {public})

## envio_em_massa

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | bigint | não |  |
| nr_contato | character varying | não |  |
| nm_nome | character varying | sim |  |
| tp_mensagem | json | sim |  |
| tp_status | USER-DEFINED | sim | `'enviar'::enum_status` |
| cd_user | character varying | sim |  |
| dt_update | timestamp with time zone | sim | `now()` |
| dt_create | timestamp with time zone | sim | `now()` |
| nm_instancia | character varying | sim |  |

Constraints: `envio_em__massa_pk` PRIMARY KEY (id)

Índices: `envio_em__massa_pk`, `ix_envio_em_massa_cd_user`

Policies: `a` (ALL → {public})

## erp_bonus_saldo

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| cpf | text | não |  |
| empresa | integer | não |  |
| pessoa_code | bigint | sim |  |
| saldo | numeric | não | `0` |
| origem | text | não | `'totvs'::text` |
| atualizado_em | timestamp with time zone | não | `now()` |

Constraints: `erp_bonus_saldo_pkey` PRIMARY KEY (cpf, empresa)

Índices: `erp_bonus_saldo_pkey`

Policies: `erp_leitura_autenticado` (SELECT → {authenticated})

## erp_centros_custo

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| code | integer | não |  |
| nome | text | sim |  |
| ativo | boolean | não | `true` |
| origem | text | não | `'totvs'::text` |
| sincronizado_em | timestamp with time zone | sim |  |
| atualizado_em | timestamp with time zone | não | `now()` |

Constraints: `erp_centros_custo_pkey` PRIMARY KEY (code)

Índices: `erp_centros_custo_pkey`

Policies: `erp_leitura_autenticado` (SELECT → {authenticated})

## erp_classificacao_tipos

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| code | integer | não |  |
| descricao | text | sim |  |
| descricao_aux | text | sim |  |
| is_group | boolean | sim |  |
| origem | text | não | `'totvs'::text` |
| sincronizado_em | timestamp with time zone | sim |  |

Constraints: `erp_classificacao_tipos_pkey` PRIMARY KEY (code)

Índices: `erp_classificacao_tipos_pkey`

Policies: `erp_leitura_autenticado` (SELECT → {authenticated})

## erp_classificacoes

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| tipo_code | integer | não |  |
| code | text | não |  |
| nome | text | sim |  |
| nome_aux | text | sim |  |
| tipo_nome | text | sim |  |
| totvs_alterado_em | timestamp with time zone | sim |  |
| origem | text | não | `'totvs'::text` |
| sincronizado_em | timestamp with time zone | sim |  |

Constraints: `erp_classificacoes_pkey` PRIMARY KEY (tipo_code, code)

Índices: `erp_classificacoes_pkey`

Policies: `erp_leitura_autenticado` (SELECT → {authenticated})

## erp_codigos_barras

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | bigint | não | `nextval('erp_codigos_barras_id_seq'::regclass)` |
| produto_code | integer | não |  |
| codigo | text | não |  |
| tipo | text | sim |  |
| principal | boolean | não | `false` |
| origem | text | não | `'totvs'::text` |
| dados | jsonb | sim |  |
| criado_em | timestamp with time zone | não | `now()` |

Constraints: `erp_codigos_barras_codigo_produto_code_key` UNIQUE (codigo, produto_code); `erp_codigos_barras_pkey` PRIMARY KEY (id)

Índices: `erp_codigos_barras_codigo_idx`, `erp_codigos_barras_codigo_produto_code_key`, `erp_codigos_barras_pkey`, `erp_codigos_barras_produto_idx`

Policies: `erp_leitura_autenticado` (SELECT → {authenticated})

## erp_condicoes_pagamento

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| code | integer | não |  |
| nome | text | sim |  |
| parcelas | integer | sim |  |
| dias | jsonb | sim |  |
| desconto_pct | numeric | sim |  |
| juros_pct | numeric | sim |  |
| bloqueada | boolean | não | `false` |
| origem | text | não | `'totvs'::text` |
| dados | jsonb | sim |  |
| sincronizado_em | timestamp with time zone | sim |  |

Constraints: `erp_condicoes_pagamento_pkey` PRIMARY KEY (code)

Índices: `erp_condicoes_pagamento_pkey`

Policies: `erp_leitura_autenticado` (SELECT → {authenticated})

## erp_config

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | bigint | não | `nextval('erp_config_id_seq'::regclass)` |
| empresa | integer | sim |  |
| modulo | text | não |  |
| modo | text | não | `'totvs'::text` |
| observacao | text | sim |  |
| atualizado_por | text | sim |  |
| atualizado_em | timestamp with time zone | não | `now()` |

Constraints: `erp_config_modo_check` CHECK ((modo = ANY (ARRAY['totvs'::text, 'dual'::text, 'headcoach'::text]))); `erp_config_modulo_check` CHECK ((modulo = ANY (ARRAY['vendas'::text, 'receber'::text, 'pagar'::text, 'estoque'::text, 'pessoas'::text, 'produtos'::text, 'fiscal'::text]))); `erp_config_pkey` PRIMARY KEY (id)

Índices: `erp_config_empresa_modulo_uidx`, `erp_config_pkey`

Policies: `erp_leitura_autenticado` (SELECT → {authenticated})

## erp_cores

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| code | text | não |  |
| nome | text | sim |  |
| ativo | boolean | não | `true` |
| dados | jsonb | sim |  |
| origem | text | não | `'totvs'::text` |
| sincronizado_em | timestamp with time zone | sim |  |

Constraints: `erp_cores_pkey` PRIMARY KEY (code)

Índices: `erp_cores_pkey`

Policies: `erp_leitura_autenticado` (SELECT → {authenticated})

## erp_custos

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| produto_code | integer | não |  |
| empresa | integer | não |  |
| custo_code | integer | não |  |
| custo_nome | text | sim |  |
| custo | numeric | sim |  |
| origem | text | não | `'totvs'::text` |
| atualizado_em | timestamp with time zone | não | `now()` |

Constraints: `erp_custos_pkey` PRIMARY KEY (produto_code, empresa, custo_code)

Índices: `erp_custos_pkey`

Policies: `erp_leitura_autenticado` (SELECT → {authenticated})

## erp_despesas_itens

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| code | integer | não |  |
| nome | text | sim |  |
| ativo | boolean | não | `true` |
| origem | text | não | `'totvs'::text` |
| sincronizado_em | timestamp with time zone | sim |  |
| atualizado_em | timestamp with time zone | não | `now()` |

Constraints: `erp_despesas_itens_pkey` PRIMARY KEY (code)

Índices: `erp_despesas_itens_pkey`

Policies: `erp_leitura_autenticado` (SELECT → {authenticated})

## erp_empresas

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| code | integer | não |  |
| descricao | text | sim |  |
| cnpj | text | sim |  |
| person_code | bigint | sim |  |
| person_name | text | sim |  |
| fantasia | text | sim |  |
| grupo | text | sim |  |
| ie | text | sim |  |
| uf | text | sim |  |
| cidade | text | sim |  |
| cidade_ibge | integer | sim |  |
| endereco | jsonb | sim |  |
| regime_tributario | text | sim |  |
| ativo | boolean | não | `true` |
| propria | boolean | não | `false` |
| certificado | text | sim |  |
| totvs_alterado_em | timestamp with time zone | sim |  |
| origem | text | não | `'totvs'::text` |
| dados | jsonb | sim |  |
| sincronizado_em | timestamp with time zone | sim |  |
| criado_em | timestamp with time zone | não | `now()` |
| atualizado_em | timestamp with time zone | não | `now()` |

Constraints: `erp_empresas_pkey` PRIMARY KEY (code)

Índices: `erp_empresas_cnpj_idx`, `erp_empresas_pkey`

Policies: `erp_leitura_autenticado` (SELECT → {authenticated})

## erp_estoques

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| code | integer | não |  |
| descricao | text | sim |  |
| origem | text | não | `'totvs'::text` |
| sincronizado_em | timestamp with time zone | sim |  |

Constraints: `erp_estoques_pkey` PRIMARY KEY (code)

Índices: `erp_estoques_pkey`

Policies: `erp_leitura_autenticado` (SELECT → {authenticated})

## erp_grades

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| code | integer | não |  |
| nome | text | sim |  |
| tipo | text | sim |  |
| tamanhos | jsonb | sim |  |
| totvs_alterado_em | timestamp with time zone | sim |  |
| origem | text | não | `'totvs'::text` |
| sincronizado_em | timestamp with time zone | sim |  |

Constraints: `erp_grades_pkey` PRIMARY KEY (code)

Índices: `erp_grades_pkey`

Policies: `erp_leitura_autenticado` (SELECT → {authenticated})

## erp_operacoes

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| code | integer | não |  |
| descricao | text | sim |  |
| financeira | boolean | sim |  |
| inativa | boolean | não | `false` |
| tipo | text | sim |  |
| documento_tipo | integer | sim |  |
| modelo_documento | integer | sim |  |
| regra_fiscal | integer | sim |  |
| modo_operacao | text | sim |  |
| finalidade_nfe | integer | sim |  |
| indicador_presenca | integer | sim |  |
| tipo_danfe | integer | sim |  |
| operacao_vinculada | integer | sim |  |
| valores | jsonb | sim |  |
| saldos | jsonb | sim |  |
| calculos | jsonb | sim |  |
| classificacoes | jsonb | sim |  |
| movimenta_estoque | boolean | sim |  |
| totvs_alterado_em | timestamp with time zone | sim |  |
| origem | text | não | `'totvs'::text` |
| dados | jsonb | sim |  |
| sincronizado_em | timestamp with time zone | sim |  |

Constraints: `erp_operacoes_pkey` PRIMARY KEY (code)

Índices: `erp_operacoes_pkey`

Policies: `erp_leitura_autenticado` (SELECT → {authenticated})

## erp_pessoas

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| code | bigint | não |  |
| tipo | text | não |  |
| nome | text | sim |  |
| fantasia | text | sim |  |
| cpf_cnpj | text | sim |  |
| ie | text | sim |  |
| rg | text | sim |  |
| nascimento | date | sim |  |
| genero | text | sim |  |
| estado_civil | text | sim |  |
| email | text | sim |  |
| telefone | text | sim |  |
| whatsapp | text | sim |  |
| cep | text | sim |  |
| uf | text | sim |  |
| cidade | text | sim |  |
| cidade_ibge | integer | sim |  |
| endereco | jsonb | sim |  |
| enderecos | jsonb | sim |  |
| telefones | jsonb | sim |  |
| emails | jsonb | sim |  |
| classificacoes | jsonb | sim |  |
| is_cliente | boolean | sim |  |
| is_fornecedor | boolean | sim |  |
| is_representante | boolean | sim |  |
| is_funcionario | boolean | sim |  |
| is_transportadora | boolean | sim |  |
| inativo | boolean | não | `false` |
| status_cliente | text | sim |  |
| empresa_cadastro | integer | sim |  |
| inserido_em | timestamp with time zone | sim |  |
| regime_tributario | text | sim |  |
| cnae | integer | sim |  |
| observacoes | text | sim |  |
| totvs_alterado_em | timestamp with time zone | sim |  |
| origem | text | não | `'totvs'::text` |
| dados | jsonb | sim |  |
| sincronizado_em | timestamp with time zone | sim |  |
| criado_em | timestamp with time zone | não | `now()` |
| atualizado_em | timestamp with time zone | não | `now()` |

Constraints: `erp_pessoas_pkey` PRIMARY KEY (code); `erp_pessoas_tipo_check` CHECK ((tipo = ANY (ARRAY['PF'::text, 'PJ'::text])))

Índices: `erp_pessoas_alterado_idx`, `erp_pessoas_cpf_cnpj_idx`, `erp_pessoas_nome_idx`, `erp_pessoas_pkey`, `erp_pessoas_tipo_idx`

Policies: `erp_leitura_autenticado` (SELECT → {authenticated})

## erp_portadores

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| code | integer | não |  |
| descricao | text | sim |  |
| tipo | text | sim |  |
| totvs_alterado_em | timestamp with time zone | sim |  |
| origem | text | não | `'totvs'::text` |
| sincronizado_em | timestamp with time zone | sim |  |

Constraints: `erp_portadores_pkey` PRIMARY KEY (code)

Índices: `erp_portadores_pkey`

Policies: `erp_leitura_autenticado` (SELECT → {authenticated})

## erp_precos

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| produto_code | integer | não |  |
| empresa | integer | não |  |
| preco_code | integer | não |  |
| preco_nome | text | sim |  |
| preco | numeric | sim |  |
| preco_promocional | numeric | sim |  |
| promocao | jsonb | sim |  |
| origem | text | não | `'totvs'::text` |
| atualizado_em | timestamp with time zone | não | `now()` |

Constraints: `erp_precos_pkey` PRIMARY KEY (produto_code, empresa, preco_code)

Índices: `erp_precos_pkey`

Policies: `erp_leitura_autenticado` (SELECT → {authenticated})

## erp_precos_tabela

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| tabela_code | integer | não |  |
| produto_code | integer | não |  |
| empresa | integer | não |  |
| preco | numeric | sim |  |
| preco_original | numeric | sim |  |
| escala | integer | sim |  |
| origem | text | não | `'totvs'::text` |
| atualizado_em | timestamp with time zone | não | `now()` |

Constraints: `erp_precos_tabela_pkey` PRIMARY KEY (tabela_code, produto_code, empresa)

Índices: `erp_precos_tabela_pkey`

Policies: `erp_leitura_autenticado` (SELECT → {authenticated})

## erp_produtos

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| code | integer | não |  |
| nome | text | sim |  |
| sku | text | sim |  |
| referencia_code | text | sim |  |
| referencia_id | integer | sim |  |
| referencia_nome | text | sim |  |
| cor_code | text | sim |  |
| cor_nome | text | sim |  |
| tamanho | text | sim |  |
| grade_code | integer | sim |  |
| ncm | text | sim |  |
| cest | text | sim |  |
| cst_origem | text | sim |  |
| unidade | text | sim |  |
| prefixo_ean | text | sim |  |
| ativo | boolean | não | `true` |
| bloqueado | boolean | não | `false` |
| produto_acabado | boolean | sim |  |
| materia_prima | boolean | sim |  |
| material_granel | boolean | sim |  |
| producao_propria | boolean | sim |  |
| estoque_min | numeric | sim |  |
| estoque_max | numeric | sim |  |
| estoque_ideal | numeric | sim |  |
| classificacoes | jsonb | sim |  |
| fornecedores | jsonb | sim |  |
| categorias | jsonb | sim |  |
| totvs_alterado_em | timestamp with time zone | sim |  |
| origem | text | não | `'totvs'::text` |
| dados | jsonb | sim |  |
| sincronizado_em | timestamp with time zone | sim |  |
| criado_em | timestamp with time zone | não | `now()` |
| atualizado_em | timestamp with time zone | não | `now()` |

Constraints: `erp_produtos_pkey` PRIMARY KEY (code)

Índices: `erp_produtos_alterado_idx`, `erp_produtos_nome_idx`, `erp_produtos_pkey`, `erp_produtos_referencia_idx`, `erp_produtos_sku_idx`

Policies: `erp_leitura_autenticado` (SELECT → {authenticated})

## erp_representantes

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| code | integer | não |  |
| nome | text | sim |  |
| cpf_cnpj | text | sim |  |
| inativo | boolean | não | `false` |
| supervisor_code | integer | sim |  |
| supervisor_nome | text | sim |  |
| empresa_cadastro | integer | sim |  |
| telefones | jsonb | sim |  |
| emails | jsonb | sim |  |
| enderecos | jsonb | sim |  |
| classificacoes | jsonb | sim |  |
| tabelas_preco | jsonb | sim |  |
| totvs_alterado_em | timestamp with time zone | sim |  |
| origem | text | não | `'totvs'::text` |
| dados | jsonb | sim |  |
| sincronizado_em | timestamp with time zone | sim |  |
| criado_em | timestamp with time zone | não | `now()` |
| atualizado_em | timestamp with time zone | não | `now()` |

Constraints: `erp_representantes_pkey` PRIMARY KEY (code)

Índices: `erp_representantes_pkey`

Policies: `erp_leitura_autenticado` (SELECT → {authenticated})

## erp_sync_controle

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| entidade | text | não |  |
| descricao | text | sim |  |
| ultimo_delta_em | timestamp with time zone | sim |  |
| ultimo_full_em | timestamp with time zone | sim |  |
| cursor_ate | timestamp with time zone | sim |  |
| status | text | não | `'ocioso'::text` |
| ultimo_erro | text | sim |  |
| total_totvs | integer | sim |  |
| total_local | integer | sim |  |
| ultima_duracao_ms | integer | sim |  |
| atualizado_em | timestamp with time zone | não | `now()` |

Constraints: `erp_sync_controle_pkey` PRIMARY KEY (entidade); `erp_sync_controle_status_check` CHECK ((status = ANY (ARRAY['ocioso'::text, 'rodando'::text, 'erro'::text])))

Índices: `erp_sync_controle_pkey`

Policies: `erp_leitura_autenticado` (SELECT → {authenticated})

## erp_sync_log

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | bigint | não | `nextval('erp_sync_log_id_seq'::regclass)` |
| entidade | text | não |  |
| modo | text | não |  |
| iniciado_em | timestamp with time zone | não | `now()` |
| concluido_em | timestamp with time zone | sim |  |
| status | text | não | `'rodando'::text` |
| registros | integer | não | `0` |
| paginas | integer | não | `0` |
| erro | text | sim |  |
| detalhes | jsonb | sim |  |
| disparado_por | text | sim |  |

Constraints: `erp_sync_log_modo_check` CHECK ((modo = ANY (ARRAY['full'::text, 'delta'::text]))); `erp_sync_log_pkey` PRIMARY KEY (id); `erp_sync_log_status_check` CHECK ((status = ANY (ARRAY['rodando'::text, 'ok'::text, 'erro'::text])))

Índices: `erp_sync_log_entidade_idx`, `erp_sync_log_pkey`

Policies: `erp_leitura_autenticado` (SELECT → {authenticated})

## erp_tabelas_preco

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| code | integer | não |  |
| descricao | text | sim |  |
| nome | text | sim |  |
| tipo | text | sim |  |
| inicio | date | sim |  |
| fim | date | sim |  |
| variacao_pct | numeric | sim |  |
| variacao_valor | numeric | sim |  |
| classificacoes_pedido | jsonb | sim |  |
| classificacoes_pessoa | jsonb | sim |  |
| condicoes_pagamento | jsonb | sim |  |
| totvs_alterado_em | timestamp with time zone | sim |  |
| origem | text | não | `'totvs'::text` |
| dados | jsonb | sim |  |
| sincronizado_em | timestamp with time zone | sim |  |

Constraints: `erp_tabelas_preco_pkey` PRIMARY KEY (code)

Índices: `erp_tabelas_preco_pkey`

Policies: `erp_leitura_autenticado` (SELECT → {authenticated})

## erp_unidades

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| code | text | não |  |
| descricao | text | sim |  |
| origem | text | não | `'totvs'::text` |
| sincronizado_em | timestamp with time zone | sim |  |

Constraints: `erp_unidades_pkey` PRIMARY KEY (code)

Índices: `erp_unidades_pkey`

Policies: `erp_leitura_autenticado` (SELECT → {authenticated})

## erp_vendedores

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| code | integer | não |  |
| nome | text | sim |  |
| empresas | ARRAY | não | `'{}'::integer[]` |
| pessoa_code | bigint | sim |  |
| ativo | boolean | não | `true` |
| origem | text | não | `'totvs'::text` |
| sincronizado_em | timestamp with time zone | sim |  |
| criado_em | timestamp with time zone | não | `now()` |
| atualizado_em | timestamp with time zone | não | `now()` |

Constraints: `erp_vendedores_pkey` PRIMARY KEY (code)

Índices: `erp_vendedores_pkey`

Policies: `erp_leitura_autenticado` (SELECT → {authenticated})

## erros_producao

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | character varying | não |  |
| name | text | sim |  |
| status | character varying | sim |  |
| date_created | timestamp with time zone | sim |  |
| date_updated | timestamp with time zone | sim |  |

Constraints: `erros_producao_pkey` PRIMARY KEY (id)

Índices: `erros_producao_pkey`

Policies: `a` (ALL → {public})

## esteira_protesto

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | bigint | não | `nextval('esteira_protesto_id_seq'::regclass)` |
| cd_empresa | integer | não |  |
| cd_cliente | text | não |  |
| nm_cliente | text | sim |  |
| nr_fat | numeric | não |  |
| nr_parcela | integer | não | `1` |
| vl_fatura | numeric | não | `0` |
| vl_juros | numeric | não | `0` |
| dt_emissao | date | sim |  |
| dt_vencimento | date | sim |  |
| cd_portador | text | sim |  |
| nm_portador | text | sim |  |
| status | text | não | `'pendente'::text` |
| user_id | uuid | sim |  |
| user_nome | text | sim |  |
| user_email | text | sim |  |
| created_at | timestamp with time zone | sim | `now()` |
| updated_at | timestamp with time zone | sim | `now()` |
| nr_cpfcnpj | text | sim |  |
| nosso_numero | text | sim |  |

Constraints: `esteira_protesto_cd_empresa_nr_fat_nr_parcela_key` UNIQUE (cd_empresa, nr_fat, nr_parcela); `esteira_protesto_pkey` PRIMARY KEY (id)

Índices: `esteira_protesto_cd_empresa_nr_fat_nr_parcela_key`, `esteira_protesto_pkey`, `idx_esteira_protesto_cliente`, `idx_esteira_protesto_status`

Policies: `Permitir atualização esteira_protesto` (UPDATE → {public}); `Permitir exclusão esteira_protesto` (DELETE → {public}); `Permitir inserção esteira_protesto` (INSERT → {public}); `Permitir leitura esteira_protesto` (SELECT → {public}); `headcoach_autenticado_tudo` (ALL → {authenticated})

## expedicao_showroom

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | bigint | não | `nextval('expedicao_showroom_id_seq'::regclass)` |
| branch_code | integer | não |  |
| invoice_code | bigint | não |  |
| transaction_code | text | sim |  |
| issue_date | date | sim |  |
| person_code | integer | sim |  |
| person_name | text | sim |  |
| operation_code | integer | sim |  |
| operation_name | text | sim |  |
| total_value | numeric | sim | `0` |
| volume_qty | integer | sim | `0` |
| status | text | sim |  |
| transportadora | text | sim |  |
| codigo_rastreio | text | sim |  |
| observacao | text | sim |  |
| totvs_synced_at | timestamp with time zone | sim | `now()` |
| atualizado_em | timestamp with time zone | sim | `now()` |
| atualizado_por | text | sim |  |
| person_fantasy_name | text | sim |  |
| volume_caixas | integer | não | `0` |

Constraints: `expedicao_showroom_pkey` PRIMARY KEY (id); `uq_expedicao_nf` UNIQUE (branch_code, invoice_code)

Índices: `expedicao_showroom_pkey`, `idx_expedicao_issue_date`, `idx_expedicao_person`, `idx_expedicao_status`, `idx_expedicao_transportadora`, `uq_expedicao_nf`

## faturamento_diario_canal

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | bigint | não | `nextval('faturamento_diario_canal_id_seq'::regclass)` |
| data | date | não |  |
| canal | text | não |  |
| valor | numeric | não | `0` |
| quantidade | integer | sim |  |
| observacao | text | sim |  |
| origem | text | não | `'manual'::text` |
| atualizado_em | timestamp with time zone | não | `now()` |
| atualizado_por | text | sim |  |
| valor_bruto | numeric | sim | `0` |
| credev | numeric | sim | `0` |

Constraints: `faturamento_diario_canal_pkey` PRIMARY KEY (id); `uq_fdc` UNIQUE (data, canal)

Índices: `faturamento_diario_canal_pkey`, `idx_fdc_ano_mes`, `idx_fdc_canal_data`, `idx_fdc_data`, `uq_fdc`

## faturamento_transacao_historico

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | bigint | não | `nextval('faturamento_transacao_historico_id_seq'::regclass)` |
| loja | text | sim |  |
| data_transacao | date | não |  |
| cod_cliente | integer | sim |  |
| cliente_nome | text | sim |  |
| tipo_cliente | text | sim |  |
| canal | text | não |  |
| dt_cadastro | date | sim |  |
| vl_fat | numeric | não | `0` |
| credev | numeric | não | `0` |
| total | numeric | não | `0` |
| cidade_uf | text | sim |  |
| fone | text | sim |  |
| observacao | text | sim |  |
| origem | text | não | `'manual'::text` |
| atualizado_em | timestamp with time zone | não | `now()` |
| nf_uid | text | sim |  |
| branch_code | integer | sim |  |
| invoice_code | text | sim |  |
| operation_code | integer | sim |  |

Constraints: `faturamento_transacao_historico_pkey` PRIMARY KEY (id); `uq_fth_nf_uid` UNIQUE (nf_uid)

Índices: `faturamento_transacao_historico_pkey`, `idx_fth_ano_mes`, `idx_fth_branch`, `idx_fth_canal_data`, `idx_fth_cliente`, `idx_fth_data`, `uq_fth_nf_uid`

## faturamento_vendedor_mensal

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | bigint | não | `nextval('faturamento_vendedor_mensal_id_seq'::regclass)` |
| mes | date | não |  |
| seller_code | integer | não |  |
| seller_name | text | sim |  |
| qtd | integer | não | `0` |
| valor | numeric | não | `0` |
| fechado_em | timestamp with time zone | sim | `now()` |
| periodo_ini | date | sim |  |
| periodo_fim | date | sim |  |

Constraints: `faturamento_vendedor_mensal_mes_seller_code_key` UNIQUE (mes, seller_code); `faturamento_vendedor_mensal_pkey` PRIMARY KEY (id)

Índices: `faturamento_vendedor_mensal_mes_seller_code_key`, `faturamento_vendedor_mensal_pkey`, `idx_fat_vend_mensal_mes`, `idx_fat_vend_mensal_seller`

Policies: `atualizacao faturamento_vendedor_mensal` (UPDATE → {public}); `insercao faturamento_vendedor_mensal` (INSERT → {public}); `leitura faturamento_vendedor_mensal` (SELECT → {public})

## fila_atendimentos

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | integer | não | `nextval('fila_atendimentos_id_seq'::regclass)` |
| branch_code | integer | não |  |
| vendedora_id | integer | não |  |
| vendedora_nome | text | não |  |
| inicio | timestamp with time zone | não | `now()` |
| fim | timestamp with time zone | sim |  |
| duracao_segundos | integer | sim |  |
| houve_venda | boolean | sim |  |
| cliente_cpf_cnpj | text | sim |  |
| cliente_nome | text | sim |  |
| cliente_validado | boolean | sim | `false` |
| valor_venda | numeric | sim |  |
| nota_fiscal_id | text | sim |  |
| motivo_nao_venda_id | integer | sim |  |
| motivo_nao_venda_txt | text | sim |  |
| observacao | text | sim |  |
| criado_em | timestamp with time zone | não | `now()` |

Constraints: `fila_atendimentos_motivo_nao_venda_id_fkey` FOREIGN KEY (motivo_nao_venda_id) REFERENCES fila_motivos_nao_venda(id); `fila_atendimentos_pkey` PRIMARY KEY (id); `fila_atendimentos_vendedora_id_fkey` FOREIGN KEY (vendedora_id) REFERENCES fila_vendedoras(id)

Índices: `fila_atendimentos_pkey`, `idx_fila_atendimentos_branch_data`, `idx_fila_atendimentos_data`, `idx_fila_atendimentos_vendedora`

## fila_lojas_config

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | integer | não | `nextval('fila_lojas_config_id_seq'::regclass)` |
| branch_code | integer | não |  |
| nome | text | sim |  |
| pin | character varying | não |  |
| ativo | boolean | não | `true` |
| criado_em | timestamp with time zone | não | `now()` |
| atualizado_em | timestamp with time zone | não | `now()` |
| criado_por | text | sim |  |

Constraints: `fila_lojas_config_branch_code_key` UNIQUE (branch_code); `fila_lojas_config_pkey` PRIMARY KEY (id)

Índices: `fila_lojas_config_branch_code_key`, `fila_lojas_config_pkey`

## fila_motivos_nao_venda

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | integer | não | `nextval('fila_motivos_nao_venda_id_seq'::regclass)` |
| motivo | text | não |  |
| ordem | integer | não | `0` |
| ativo | boolean | não | `true` |
| criado_em | timestamp with time zone | não | `now()` |

Constraints: `fila_motivos_nao_venda_motivo_key` UNIQUE (motivo); `fila_motivos_nao_venda_pkey` PRIMARY KEY (id)

Índices: `fila_motivos_nao_venda_motivo_key`, `fila_motivos_nao_venda_pkey`

## fila_status_log

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | integer | não | `nextval('fila_status_log_id_seq'::regclass)` |
| vendedora_id | integer | não |  |
| branch_code | integer | não |  |
| status_anterior | character varying | sim |  |
| status_novo | character varying | não |  |
| duracao_segundos | integer | sim |  |
| criado_em | timestamp with time zone | não | `now()` |

Constraints: `fila_status_log_pkey` PRIMARY KEY (id); `fila_status_log_vendedora_id_fkey` FOREIGN KEY (vendedora_id) REFERENCES fila_vendedoras(id) ON DELETE CASCADE

Índices: `fila_status_log_pkey`, `idx_fila_status_log_vend`

## fila_vendedora_status

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| vendedora_id | integer | não |  |
| branch_code | integer | não |  |
| status | character varying | não | `'disponivel'::character varying` |
| posicao_fila | integer | sim |  |
| atendimento_id | integer | sim |  |
| inicio_status | timestamp with time zone | não | `now()` |
| atualizado_em | timestamp with time zone | não | `now()` |

Constraints: `fila_vendedora_status_pkey` PRIMARY KEY (vendedora_id); `fila_vendedora_status_vendedora_id_fkey` FOREIGN KEY (vendedora_id) REFERENCES fila_vendedoras(id) ON DELETE CASCADE

Índices: `fila_vendedora_status_pkey`, `idx_fila_vendedora_status_branch`

## fila_vendedoras

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | integer | não | `nextval('fila_vendedoras_id_seq'::regclass)` |
| branch_code | integer | não |  |
| nome | text | não |  |
| totvs_id | text | sim |  |
| apelido | text | sim |  |
| ativo | boolean | não | `true` |
| criado_em | timestamp with time zone | não | `now()` |
| atualizado_em | timestamp with time zone | não | `now()` |

Constraints: `fila_vendedoras_branch_code_nome_key` UNIQUE (branch_code, nome); `fila_vendedoras_pkey` PRIMARY KEY (id)

Índices: `fila_vendedoras_branch_code_nome_key`, `fila_vendedoras_pkey`, `idx_fila_vendedoras_branch`

## fluxo_caixa_contas

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | bigint | não | `nextval('fluxo_caixa_contas_id_seq'::regclass)` |
| banco | text | não |  |
| banco_codigo | text | sim |  |
| banco_nome | text | sim |  |
| agencia | text | não | `''::text` |
| conta | text | não |  |
| conta_dv | text | sim |  |
| titular_nome | text | sim |  |
| titular_cnpj | text | sim |  |
| apelido | text | sim |  |
| ativo | boolean | não | `true` |
| criado_em | timestamp with time zone | não | `now()` |
| atualizado_em | timestamp with time zone | não | `now()` |

Constraints: `fluxo_caixa_contas_banco_agencia_conta_key` UNIQUE (banco, agencia, conta); `fluxo_caixa_contas_pkey` PRIMARY KEY (id)

Índices: `fluxo_caixa_contas_banco_agencia_conta_key`, `fluxo_caixa_contas_pkey`

## fluxo_caixa_importacoes

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | bigint | não | `nextval('fluxo_caixa_importacoes_id_seq'::regclass)` |
| conta_id | bigint | não |  |
| arquivo_nome | text | sim |  |
| arquivo_hash | text | sim |  |
| periodo_inicio | date | sim |  |
| periodo_fim | date | sim |  |
| saldo_inicial | numeric | sim |  |
| saldo_final | numeric | sim |  |
| qtd_lancamentos | integer | não | `0` |
| inconsistencias | integer | não | `0` |
| avisos | jsonb | sim |  |
| usuario | text | sim |  |
| importado_em | timestamp with time zone | não | `now()` |

Constraints: `fluxo_caixa_importacoes_conta_id_fkey` FOREIGN KEY (conta_id) REFERENCES fluxo_caixa_contas(id) ON DELETE CASCADE; `fluxo_caixa_importacoes_pkey` PRIMARY KEY (id)

Índices: `fluxo_caixa_importacoes_pkey`, `idx_fc_import_conta`

## fluxo_caixa_lancamentos

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | bigint | não | `nextval('fluxo_caixa_lancamentos_id_seq'::regclass)` |
| conta_id | bigint | não |  |
| importacao_id | bigint | sim |  |
| data | date | não |  |
| hora | text | sim |  |
| seq | integer | não | `0` |
| valor | numeric | não |  |
| natureza | character | não |  |
| tipo | text | não |  |
| forma | text | não | `'OUTROS'::text` |
| categoria | text | não | `'outros'::text` |
| descricao | text | sim |  |
| memo | text | sim |  |
| documento | text | sim |  |
| contraparte_nome | text | sim |  |
| contraparte_doc | text | sim |  |
| contraparte_banco | text | sim |  |
| bandeira | text | sim |  |
| loja | text | sim |  |
| saldo_apos | numeric | sim |  |
| pagina | integer | sim |  |
| transferencia_id | bigint | sim |  |
| fornecedor | text | sim |  |
| observacao | text | sim |  |
| criado_em | timestamp with time zone | não | `now()` |

Constraints: `fk_fc_lanc_transferencia` FOREIGN KEY (transferencia_id) REFERENCES fluxo_caixa_transferencias(id) ON DELETE SET NULL; `fluxo_caixa_lancamentos_conta_id_fkey` FOREIGN KEY (conta_id) REFERENCES fluxo_caixa_contas(id) ON DELETE CASCADE; `fluxo_caixa_lancamentos_importacao_id_fkey` FOREIGN KEY (importacao_id) REFERENCES fluxo_caixa_importacoes(id) ON DELETE SET NULL; `fluxo_caixa_lancamentos_pkey` PRIMARY KEY (id)

Índices: `fluxo_caixa_lancamentos_pkey`, `idx_fc_lanc_conta_data`, `idx_fc_lanc_data`, `idx_fc_lanc_doc`, `idx_fc_lanc_forma`, `idx_fc_lanc_tipo`, `idx_fc_lanc_transf`

## fluxo_caixa_transferencias

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | bigint | não | `nextval('fluxo_caixa_transferencias_id_seq'::regclass)` |
| data | date | não |  |
| data_entrada | date | sim |  |
| valor | numeric | não |  |
| origem_conta_id | bigint | sim |  |
| destino_conta_id | bigint | sim |  |
| origem_lancamento_id | bigint | sim |  |
| destino_lancamento_id | bigint | sim |  |
| metodo | text | não | `'auto'::text` |
| confianca | text | sim |  |
| criado_em | timestamp with time zone | não | `now()` |

Constraints: `fluxo_caixa_transferencias_destino_conta_id_fkey` FOREIGN KEY (destino_conta_id) REFERENCES fluxo_caixa_contas(id) ON DELETE CASCADE; `fluxo_caixa_transferencias_destino_lancamento_id_fkey` FOREIGN KEY (destino_lancamento_id) REFERENCES fluxo_caixa_lancamentos(id) ON DELETE CASCADE; `fluxo_caixa_transferencias_origem_conta_id_fkey` FOREIGN KEY (origem_conta_id) REFERENCES fluxo_caixa_contas(id) ON DELETE CASCADE; `fluxo_caixa_transferencias_origem_lancamento_id_fkey` FOREIGN KEY (origem_lancamento_id) REFERENCES fluxo_caixa_lancamentos(id) ON DELETE CASCADE; `fluxo_caixa_transferencias_pkey` PRIMARY KEY (id)

Índices: `fluxo_caixa_transferencias_pkey`, `idx_fc_transf_data`

## followers_instagram

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | bigint | não |  |
| follower_count | bigint | não |  |
| end_time | timestamp with time zone | não |  |

Constraints: `followers_instagram_pkey` PRIMARY KEY (id)

Índices: `followers_instagram_pkey`

## forecast_budget_trimestral

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | bigint | não | `nextval('forecast_budget_trimestral_id_seq'::regclass)` |
| ano | integer | não |  |
| trimestre | integer | não |  |
| canal | text | não |  |
| canal_label | text | sim |  |
| budget_trafego | numeric | não | `0` |
| budget_marketing | numeric | não | `0` |
| meta_faturamento | numeric | não | `0` |
| observacao | text | sim |  |
| created_by | text | sim |  |
| updated_by | text | sim |  |
| created_at | timestamp with time zone | não | `now()` |
| updated_at | timestamp with time zone | não | `now()` |

Constraints: `forecast_budget_trimestral_ano_trimestre_canal_key` UNIQUE (ano, trimestre, canal); `forecast_budget_trimestral_pkey` PRIMARY KEY (id); `forecast_budget_trimestral_trimestre_check` CHECK (((trimestre >= 1) AND (trimestre <= 4)))

Índices: `forecast_budget_trimestral_ano_trimestre_canal_key`, `forecast_budget_trimestral_pkey`, `idx_forecast_budget_ano_trim`

## forecast_canal_metas

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |
| canal | text | não |  |
| period_type | text | não |  |
| period_key | text | não |  |
| valor_meta | numeric | não |  |
| created_at | timestamp with time zone | não | `now()` |
| updated_at | timestamp with time zone | não | `now()` |
| updated_by | text | sim |  |
| justificativa | text | sim |  |

Constraints: `forecast_canal_metas_period_type_check` CHECK ((period_type = ANY (ARRAY['mensal'::text, 'semanal'::text]))); `forecast_canal_metas_pkey` PRIMARY KEY (id); `forecast_canal_metas_unique` UNIQUE (canal, period_type, period_key)

Índices: `forecast_canal_metas_lookup_idx`, `forecast_canal_metas_period_idx`, `forecast_canal_metas_pkey`, `forecast_canal_metas_unique`

## forecast_canal_metas_log

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | integer | não | `nextval('forecast_canal_metas_log_id_seq'::regclass)` |
| canal | text | não |  |
| period_type | character varying | não |  |
| period_key | text | não |  |
| acao | character varying | não |  |
| valor_meta_anterior | numeric | sim |  |
| valor_meta_novo | numeric | sim |  |
| justificativa_anterior | text | sim |  |
| justificativa_nova | text | sim |  |
| alterado_em | timestamp with time zone | não | `now()` |
| alterado_por | text | sim |  |
| user_role | text | sim |  |
| ip_origem | text | sim |  |

Constraints: `forecast_canal_metas_log_pkey` PRIMARY KEY (id)

Índices: `forecast_canal_metas_log_pkey`, `idx_forecast_canal_metas_log_data`, `idx_forecast_canal_metas_log_periodo`

## forecast_canal_snapshot

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | bigint | não | `nextval('forecast_canal_snapshot_id_seq'::regclass)` |
| canal | text | não |  |
| period_type | text | não |  |
| period_key | text | não |  |
| valor_oficial | numeric | não |  |
| observacao | text | sim |  |
| ativo | boolean | não | `true` |
| criado_em | timestamp with time zone | não | `now()` |

Constraints: `forecast_canal_snapshot_pkey` PRIMARY KEY (id); `uq_fcs` UNIQUE (canal, period_type, period_key)

Índices: `forecast_canal_snapshot_pkey`, `idx_fcs_canal`, `uq_fcs`

## forecast_comparativo_ref

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | integer | não | `nextval('forecast_comparativo_ref_id_seq'::regclass)` |
| canal | text | não |  |
| ano | integer | não |  |
| mes | integer | não |  |
| valor_full | numeric | não | `0` |
| valor_acumulado | numeric | não | `0` |
| dia_acumulado | integer | sim |  |
| observacao | text | sim |  |
| criado_em | timestamp with time zone | não | `now()` |
| atualizado_em | timestamp with time zone | não | `now()` |
| atualizado_por | text | sim |  |

Constraints: `forecast_comparativo_ref_canal_ano_mes_key` UNIQUE (canal, ano, mes); `forecast_comparativo_ref_mes_check` CHECK (((mes >= 1) AND (mes <= 12))); `forecast_comparativo_ref_pkey` PRIMARY KEY (id)

Índices: `forecast_comparativo_ref_canal_ano_mes_key`, `forecast_comparativo_ref_pkey`, `idx_forecast_comparativo_ref_ano_mes`

## forecast_credev_ajustes

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| invoice_code | bigint | não |  |
| branch_code | integer | não |  |
| is_adiantamento | boolean | sim |  |
| obs | text | sim |  |
| marcado_por | text | sim |  |
| marcado_em | timestamp with time zone | sim |  |

Constraints: `forecast_credev_ajustes_pkey` PRIMARY KEY (invoice_code, branch_code)

Índices: `forecast_credev_ajustes_pkey`

## forecast_credev_overrides

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | integer | não | `nextval('forecast_credev_overrides_id_seq'::regclass)` |
| branch_code | integer | não |  |
| transaction_code | bigint | não |  |
| invoice_code | bigint | sim |  |
| canal | text | não |  |
| credev_amount | numeric | sim |  |
| motivo | text | não |  |
| ativo | boolean | não | `true` |
| created_by | text | sim |  |
| created_at | timestamp with time zone | não | `now()` |
| deactivated_by | text | sim |  |
| deactivated_at | timestamp with time zone | sim |  |
| issue_date | date | sim |  |

Constraints: `credev_override_motivo_nao_vazio` CHECK ((length(TRIM(BOTH FROM motivo)) > 0)); `forecast_credev_overrides_pkey` PRIMARY KEY (id)

Índices: `forecast_credev_overrides_pkey`, `idx_credev_override_canal`, `idx_credev_override_created_at`, `idx_credev_override_invoice`, `idx_credev_override_issue_date`, `idx_credev_override_unico_ativo`

## forecast_credev_overrides_log

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | integer | não | `nextval('forecast_credev_overrides_log_id_seq'::regclass)` |
| override_id | integer | sim |  |
| branch_code | integer | não |  |
| transaction_code | bigint | não |  |
| invoice_code | bigint | sim |  |
| canal | text | não |  |
| acao | character varying | não |  |
| motivo | text | sim |  |
| credev_amount | numeric | sim |  |
| alterado_por | text | sim |  |
| alterado_em | timestamp with time zone | não | `now()` |
| ip_origem | text | sim |  |
| issue_date | date | sim |  |

Constraints: `forecast_credev_overrides_log_pkey` PRIMARY KEY (id)

Índices: `forecast_credev_overrides_log_pkey`, `idx_credev_override_log_data`, `idx_credev_override_log_invoice`

## forecast_faturamento_vendedor

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | bigint | não | `nextval('forecast_faturamento_vendedor_id_seq'::regclass)` |
| grupo | text | não |  |
| periodo_tipo | text | não |  |
| periodo_key | text | não |  |
| seller_code | text | não |  |
| seller_name | text | sim |  |
| bruto | numeric | não | `0` |
| credev | numeric | não | `0` |
| liquido | numeric | não | `0` |
| atualizado_em | timestamp with time zone | não | `now()` |

Constraints: `forecast_faturamento_vendedor_pkey` PRIMARY KEY (id); `uq_fat_vend` UNIQUE (grupo, periodo_tipo, periodo_key, seller_code)

Índices: `forecast_faturamento_vendedor_pkey`, `idx_fat_vend_periodo`, `uq_fat_vend`

## forecast_faturamento_vendedor_sync

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | bigint | não | `nextval('forecast_faturamento_vendedor_sync_id_seq'::regclass)` |
| periodo_tipo | text | sim |  |
| periodo_key | text | sim |  |
| linhas | integer | sim |  |
| origem | text | sim |  |
| ok | boolean | sim |  |
| erro | text | sim |  |
| criado_em | timestamp with time zone | não | `now()` |

Constraints: `forecast_faturamento_vendedor_sync_pkey` PRIMARY KEY (id)

Índices: `forecast_faturamento_vendedor_sync_pkey`

## forecast_painel_vendas

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | bigint | não | `nextval('forecast_painel_vendas_id_seq'::regclass)` |
| data | date | não |  |
| seller_code | integer | não |  |
| seller_name | text | sim |  |
| branch_code | integer | sim |  |
| valor | numeric | não | `0` |
| atualizado_em | timestamp with time zone | sim | `now()` |
| qtd | integer | sim | `0` |

Constraints: `forecast_painel_vendas_data_seller_code_branch_code_key` UNIQUE (data, seller_code, branch_code); `forecast_painel_vendas_pkey` PRIMARY KEY (id)

Índices: `forecast_painel_vendas_data_seller_code_branch_code_key`, `forecast_painel_vendas_pkey`, `idx_painel_vendas_data`, `idx_painel_vendas_data_seller`, `idx_painel_vendas_seller`

## forecast_per_seller_cache

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | bigint | não | `nextval('forecast_per_seller_cache_id_seq'::regclass)` |
| data | date | não |  |
| canal | text | não |  |
| entidade_tipo | text | não |  |
| entidade_nome | text | não |  |
| entidade_uf | text | sim |  |
| valor_bruto | numeric | não | `0` |
| credev_value | numeric | não | `0` |
| valor_liquido | numeric | não | `0` |
| atualizado_em | timestamp with time zone | não | `now()` |

Constraints: `forecast_per_seller_cache_data_canal_entidade_nome_key` UNIQUE (data, canal, entidade_nome); `forecast_per_seller_cache_pkey` PRIMARY KEY (id)

Índices: `forecast_per_seller_cache_data_canal_entidade_nome_key`, `forecast_per_seller_cache_pkey`, `idx_fpsc_canal_data`, `idx_fpsc_data`, `idx_fpsc_entidade`

## forecast_promessa_canais

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | integer | não | `nextval('forecast_promessa_canais_id_seq'::regclass)` |
| nome | text | não |  |
| ordem | integer | não | `0` |
| tipo | character varying | não |  |
| fonte_config | jsonb | não | `'{}'::jsonb` |
| ativo | boolean | não | `true` |
| criado_em | timestamp with time zone | não | `now()` |
| atualizado_em | timestamp with time zone | não | `now()` |
| criado_por | text | sim |  |

Constraints: `forecast_promessa_canais_pkey` PRIMARY KEY (id)

Índices: `forecast_promessa_canais_pkey`, `idx_forecast_promessa_canais_ativo`

## forecast_promessa_mensal_metas

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | integer | não | `nextval('forecast_promessa_mensal_metas_id_seq'::regclass)` |
| canal_id | integer | não |  |
| ano | integer | não |  |
| mes | integer | não |  |
| meta_mensal | numeric | não | `0` |
| forecast_mensal | numeric | não | `0` |
| faturamento_manual | numeric | sim |  |
| observacao | text | sim |  |
| criado_em | timestamp with time zone | não | `now()` |
| atualizado_em | timestamp with time zone | não | `now()` |
| criado_por | text | sim |  |

Constraints: `forecast_promessa_mensal_metas_canal_id_ano_mes_key` UNIQUE (canal_id, ano, mes); `forecast_promessa_mensal_metas_canal_id_fkey` FOREIGN KEY (canal_id) REFERENCES forecast_promessa_canais(id) ON DELETE CASCADE; `forecast_promessa_mensal_metas_mes_check` CHECK (((mes >= 1) AND (mes <= 12))); `forecast_promessa_mensal_metas_pkey` PRIMARY KEY (id)

Índices: `forecast_promessa_mensal_metas_canal_id_ano_mes_key`, `forecast_promessa_mensal_metas_pkey`, `idx_forecast_promessa_mensal_periodo`

## forecast_promessa_metas

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | integer | não | `nextval('forecast_promessa_metas_id_seq'::regclass)` |
| canal_id | integer | não |  |
| ano | integer | não |  |
| semana_iso | integer | não |  |
| data_inicio | date | não |  |
| data_fim | date | não |  |
| meta_realista | numeric | não | `0` |
| faturamento_manual | numeric | sim |  |
| observacao | text | sim |  |
| criado_em | timestamp with time zone | não | `now()` |
| atualizado_em | timestamp with time zone | não | `now()` |
| criado_por | text | sim |  |

Constraints: `forecast_promessa_metas_canal_id_ano_semana_iso_key` UNIQUE (canal_id, ano, semana_iso); `forecast_promessa_metas_canal_id_fkey` FOREIGN KEY (canal_id) REFERENCES forecast_promessa_canais(id) ON DELETE CASCADE; `forecast_promessa_metas_pkey` PRIMARY KEY (id)

Índices: `forecast_promessa_metas_canal_id_ano_semana_iso_key`, `forecast_promessa_metas_pkey`, `idx_forecast_promessa_metas_periodo`

## forecast_vendedor_remap

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | bigint | não | `nextval('forecast_vendedor_remap_id_seq'::regclass)` |
| invoice_code | bigint | não |  |
| branch_code | integer | não |  |
| dealer_origem | integer | sim |  |
| dealer_destino | integer | sim |  |
| razao | text | sim |  |
| created_at | timestamp with time zone | não | `now()` |

Constraints: `forecast_vendedor_remap_branch_code_invoice_code_key` UNIQUE (branch_code, invoice_code); `forecast_vendedor_remap_pkey` PRIMARY KEY (id)

Índices: `forecast_vendedor_remap_branch_code_invoice_code_key`, `forecast_vendedor_remap_pkey`, `idx_fvr_invoice`

## gestao_aso

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | character varying | não |  |
| funcao | character varying | sim | `NULL::character varying` |
| tipoDeAso | character varying | sim | `NULL::character varying` |
| filial | character varying | sim | `NULL::character varying` |
| validadeASO | character varying | sim | `NULL::character varying` |
| status | character varying | sim | `NULL::character varying` |

Constraints: `GestaoASO_pkey` PRIMARY KEY (id)

Índices: `GestaoASO_pkey`

Policies: `a` (ALL → {public})

## gestao_pedidos

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | character varying | não |  |
| name | character varying | sim |  |
| status | character varying | sim |  |
| date_create | timestamp with time zone | sim |  |
| produtos | text | sim |  |
| nota_fiscal | character varying | sim |  |
| data_envio | timestamp with time zone | sim |  |
| estado | character varying | sim |  |
| franqueado | character varying | sim |  |
| numero_pedido_totvs | character varying | sim |  |
| previsao_de_entrega | date | sim |  |
| quantidade_pecas | integer | sim |  |
| quantidade_de_volumes | integer | sim |  |
| rastreamento | character varying | sim |  |
| tipo_de_pedido | character varying | sim |  |
| transportadora | character varying | sim |  |
| telefone | character varying | sim |  |

Constraints: `gestao_pedidos_pkey` PRIMARY KEY (id)

Índices: `gestao_pedidos_pkey`

Policies: `a` (ALL → {public})

## hires

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |
| employee_id | uuid | sim |  |
| date | date | não |  |
| department | text | sim |  |
| branch | text | sim |  |
| created_at | timestamp with time zone | sim | `now()` |

Constraints: `hires_employee_id_fkey` FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE; `hires_pkey` PRIMARY KEY (id)

Índices: `hires_pkey`

Policies: `HR and Admin can view all hires` (SELECT → {public})

## id_clickup

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id_clickup | character varying | sim |  |
| username | character varying | sim |  |
| sector | character varying | sim | `NULL::character varying` |
| id_slack | character varying | sim | `NULL::character varying` |
| email | character varying | sim | `NULL::character varying` |
| name_instance | character varying | sim | `NULL::character varying` |
| cd_grupoempresa | character varying | sim | `NULL::character varying` |
| ativo | boolean | sim | `true` |
| cd_user | character varying | sim |  |
| id | character varying | não | `nextval('id_clickup_id_seq'::regclass)` |
| id_chat | character varying | sim |  |
| id_vendedor | character varying | sim |  |
| id_campo | character varying | sim |  |

Constraints: `id_clickup_pkey` PRIMARY KEY (id)

Índices: `id_clickup_pkey`, `ix_id_clickup_cd_user`

## inadimplencia_mtm_representantes_timeline

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | bigint | não | `nextval('inadimplencia_mtm_representantes_timeline_id_seq'::regclass)` |
| data | date | não |  |
| representante | text | não |  |
| valor_total | numeric | não | `0` |
| qtd_clientes | integer | não | `0` |
| created_at | timestamp with time zone | sim | `now()` |
| updated_at | timestamp with time zone | sim | `now()` |

Constraints: `inadimplencia_mtm_representantes_timelin_data_representante_key` UNIQUE (data, representante); `inadimplencia_mtm_representantes_timeline_pkey` PRIMARY KEY (id)

Índices: `idx_inadimplencia_mtm_rep_timeline_data`, `inadimplencia_mtm_representantes_timelin_data_representante_key`, `inadimplencia_mtm_representantes_timeline_pkey`

Policies: `Permitir atualização inadimplencia_mtm_rep_timeline` (UPDATE → {public}); `Permitir inserção inadimplencia_mtm_rep_timeline` (INSERT → {public}); `Permitir leitura inadimplencia_mtm_rep_timeline` (SELECT → {public})

## inadimplencia_mtm_timeline

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | bigint | não | `nextval('inadimplencia_mtm_timeline_id_seq'::regclass)` |
| data | date | não |  |
| valor_total | numeric | não | `0` |
| qtd_clientes | integer | não | `0` |
| qtd_titulos | integer | não | `0` |
| created_at | timestamp with time zone | sim | `now()` |
| updated_at | timestamp with time zone | sim | `now()` |
| valor_atrasados | numeric | não | `0` |
| valor_inadimplentes | numeric | não | `0` |

Constraints: `inadimplencia_mtm_timeline_data_key` UNIQUE (data); `inadimplencia_mtm_timeline_pkey` PRIMARY KEY (id)

Índices: `idx_inadimplencia_mtm_timeline_data`, `inadimplencia_mtm_timeline_data_key`, `inadimplencia_mtm_timeline_pkey`

Policies: `Permitir atualização inadimplencia_mtm_timeline` (UPDATE → {public}); `Permitir inserção inadimplencia_mtm_timeline` (INSERT → {public}); `Permitir leitura inadimplencia_mtm_timeline` (SELECT → {public})

## inadimplencia_revenda_representantes_timeline

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | bigint | não | `nextval('inadimplencia_revenda_representantes_timeline_id_seq'::regclass)` |
| data | date | não |  |
| representante | text | não |  |
| valor_total | numeric | não | `0` |
| qtd_clientes | integer | não | `0` |
| created_at | timestamp with time zone | sim | `now()` |
| updated_at | timestamp with time zone | sim | `now()` |

Constraints: `inadimplencia_revenda_representantes_tim_data_representante_key` UNIQUE (data, representante); `inadimplencia_revenda_representantes_timeline_pkey` PRIMARY KEY (id)

Índices: `idx_inadimplencia_revenda_rep_timeline_data`, `inadimplencia_revenda_representantes_tim_data_representante_key`, `inadimplencia_revenda_representantes_timeline_pkey`

Policies: `Permitir atualização inadimplencia_revenda_rep_timeline` (UPDATE → {public}); `Permitir inserção inadimplencia_revenda_rep_timeline` (INSERT → {public}); `Permitir leitura inadimplencia_revenda_rep_timeline` (SELECT → {public})

## inadimplencia_revenda_timeline

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | bigint | não | `nextval('inadimplencia_revenda_timeline_id_seq'::regclass)` |
| data | date | não |  |
| valor_total | numeric | não | `0` |
| qtd_clientes | integer | não | `0` |
| qtd_titulos | integer | não | `0` |
| valor_atrasados | numeric | não | `0` |
| valor_inadimplentes | numeric | não | `0` |
| created_at | timestamp with time zone | sim | `now()` |
| updated_at | timestamp with time zone | sim | `now()` |

Constraints: `inadimplencia_revenda_timeline_data_key` UNIQUE (data); `inadimplencia_revenda_timeline_pkey` PRIMARY KEY (id)

Índices: `idx_inadimplencia_revenda_timeline_data`, `inadimplencia_revenda_timeline_data_key`, `inadimplencia_revenda_timeline_pkey`

Policies: `Permitir atualização inadimplencia_revenda_timeline` (UPDATE → {public}); `Permitir inserção inadimplencia_revenda_timeline` (INSERT → {public}); `Permitir leitura inadimplencia_revenda_timeline` (SELECT → {public})

## inadimplencia_timeline

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | bigint | não | `nextval('inadimplencia_timeline_id_seq'::regclass)` |
| data | date | não |  |
| valor_total | numeric | não | `0` |
| qtd_titulos | integer | não | `0` |
| qtd_clientes | integer | não | `0` |
| created_at | timestamp with time zone | sim | `now()` |
| updated_at | timestamp with time zone | sim | `now()` |
| valor_multimarcas | numeric | não | `0` |
| valor_franquias | numeric | não | `0` |
| qtd_titulos_multimarcas | integer | não | `0` |
| qtd_titulos_franquias | integer | não | `0` |
| qtd_clientes_multimarcas | integer | não | `0` |
| qtd_clientes_franquias | integer | não | `0` |

Constraints: `inadimplencia_timeline_data_key` UNIQUE (data); `inadimplencia_timeline_pkey` PRIMARY KEY (id)

Índices: `idx_inadimplencia_timeline_data`, `inadimplencia_timeline_data_key`, `inadimplencia_timeline_pkey`

Policies: `Escrita inadimplencia_timeline` (ALL → {public}); `Leitura inadimplencia_timeline` (SELECT → {public})

## instance_access_config

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |
| instance_id | text | não |  |
| access_type | text | não | `'public'::text` |
| created_by | uuid | sim |  |
| created_at | timestamp with time zone | sim | `now()` |
| updated_at | timestamp with time zone | sim | `now()` |

Constraints: `instance_access_config_access_type_check` CHECK ((access_type = ANY (ARRAY['public'::text, 'restricted'::text]))); `instance_access_config_created_by_fkey` FOREIGN KEY (created_by) REFERENCES auth.users(id); `instance_access_config_instance_id_key` UNIQUE (instance_id); `instance_access_config_pkey` PRIMARY KEY (id)

Índices: `idx_instance_access_config_access_type`, `idx_instance_access_config_instance_id`, `instance_access_config_instance_id_key`, `instance_access_config_pkey`

Policies: `instance_access_config_delete` (DELETE → {public}); `instance_access_config_insert` (INSERT → {public}); `instance_access_config_select` (SELECT → {public}); `instance_access_config_update` (UPDATE → {public})

## insurance

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | smallint | não |  |
| code | text | não |  |
| cnpj | text | sim |  |
| name | text | não |  |
| color | text | não | `'#555555'::text` |
| created_at | timestamp with time zone | não | `now()` |
| updated_at | timestamp with time zone | não | `now()` |

Constraints: `insurance_code_key` UNIQUE (code); `insurance_pkey` PRIMARY KEY (id)

Índices: `insurance_code_key`, `insurance_pkey`, `ux_insurance_name_lower`

Policies: `insurance_all` (ALL → {authenticated})

## integracao_outbox

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | bigint | não | `nextval('integracao_outbox_id_seq'::regclass)` |
| destino | text | não | `'totvs'::text` |
| operacao | text | não |  |
| chave | text | sim |  |
| payload | jsonb | não | `'{}'::jsonb` |
| status | text | não | `'pendente'::text` |
| tentativas | integer | não | `0` |
| max_tentativas | integer | não | `8` |
| proxima_tentativa | timestamp with time zone | não | `now()` |
| processando_desde | timestamp with time zone | sim |  |
| ultimo_erro | text | sim |  |
| http_status | integer | sim |  |
| resposta | jsonb | sim |  |
| origem_tabela | text | sim |  |
| origem_id | text | sim |  |
| empresa | integer | sim |  |
| criado_por | text | sim |  |
| criado_em | timestamp with time zone | não | `now()` |
| atualizado_em | timestamp with time zone | não | `now()` |
| enviado_em | timestamp with time zone | sim |  |

Constraints: `integracao_outbox_pkey` PRIMARY KEY (id); `integracao_outbox_status_check` CHECK ((status = ANY (ARRAY['pendente'::text, 'processando'::text, 'enviado'::text, 'erro'::text, 'cancelado'::text])))

Índices: `integracao_outbox_chave_uidx`, `integracao_outbox_origem_idx`, `integracao_outbox_pkey`, `integracao_outbox_status_idx`

Policies: `erp_leitura_autenticado` (SELECT → {authenticated})

## integracao_outbox_log

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | bigint | não | `nextval('integracao_outbox_log_id_seq'::regclass)` |
| outbox_id | bigint | não |  |
| tentativa | integer | não |  |
| status | text | não |  |
| http_status | integer | sim |  |
| erro | text | sim |  |
| resposta | jsonb | sim |  |
| duracao_ms | integer | sim |  |
| criado_em | timestamp with time zone | não | `now()` |

Constraints: `integracao_outbox_log_outbox_id_fkey` FOREIGN KEY (outbox_id) REFERENCES integracao_outbox(id) ON DELETE CASCADE; `integracao_outbox_log_pkey` PRIMARY KEY (id)

Índices: `integracao_outbox_log_outbox_idx`, `integracao_outbox_log_pkey`

Policies: `erp_leitura_autenticado` (SELECT → {authenticated})

## lawyer

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | bigint | não |  |
| name | text | sim |  |
| oab_number | text | sim |  |
| oab_state | text | sim |  |
| created_at | timestamp with time zone | não | `now()` |
| updated_at | timestamp with time zone | não | `now()` |

Constraints: `lawyer_pkey` PRIMARY KEY (id)

Índices: `lawyer_pkey`

Policies: `lawyer_select` (SELECT → {authenticated})

## lideranca_logistica

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | character varying | não |  |
| name | text | sim |  |
| status | character varying | sim |  |
| date_created | timestamp with time zone | sim |  |
| date_update | timestamp with time zone | sim |  |

Constraints: `tarefas_pkey` PRIMARY KEY (id)

Índices: `tarefas_pkey`

Policies: `a` (ALL → {public})

## lojas

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | integer | não | `nextval('lojas_id_seq'::regclass)` |
| nome | text | não |  |
| cor_principal | text | sim | `'#3b82f6'::text` |
| cor_secundaria | text | sim | `'#06b6d4'::text` |
| logomarca_url | text | sim |  |
| ativo | boolean | sim | `true` |
| created_at | timestamp with time zone | sim | `now()` |
| updated_at | timestamp with time zone | sim | `now()` |

Constraints: `lojas_pkey` PRIMARY KEY (id)

Índices: `lojas_pkey`

Policies: `Allow all operations on lojas` (ALL → {public})

## medical_exams

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |
| employee_id | uuid | sim |  |
| date | date | não |  |
| status | USER-DEFINED | sim | `'pending'::exam_status` |
| created_at | timestamp with time zone | sim | `now()` |

Constraints: `medical_exams_employee_id_fkey` FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE; `medical_exams_pkey` PRIMARY KEY (id)

Índices: `medical_exams_pkey`

Policies: `HR and Admin can view all medical exams` (SELECT → {public})

## message_queue

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |
| account_id | bigint | não |  |
| campaign_id | uuid | sim | `gen_random_uuid()` |
| campaign_name | text | sim |  |
| contact_external_id | text | sim |  |
| contact_name | text | sim |  |
| phone_number | text | não |  |
| template_name | text | não |  |
| template_language | text | não | `'pt_BR'::text` |
| template_category | text | sim |  |
| template_payload | jsonb | não | `'{}'::jsonb` |
| template_variables | jsonb | não | `'{}'::jsonb` |
| metadata | jsonb | não | `'{}'::jsonb` |
| status | text | não | `'pending'::text` |
| priority | smallint | não | `100` |
| scheduled_at | timestamp with time zone | não | `now()` |
| next_retry_at | timestamp with time zone | sim |  |
| processing_started_at | timestamp with time zone | sim |  |
| sent_at | timestamp with time zone | sim |  |
| delivered_at | timestamp with time zone | sim |  |
| read_at | timestamp with time zone | sim |  |
| replied_at | timestamp with time zone | sim |  |
| canceled_at | timestamp with time zone | sim |  |
| provider_message_id | text | sim |  |
| conversation_category | text | sim |  |
| estimated_cost | numeric | sim | `0` |
| real_cost | numeric | sim | `0` |
| attempt_count | integer | não | `0` |
| max_attempts | integer | não | `6` |
| daily_tier_limit | integer | não | `1000` |
| last_error | text | sim |  |
| error_log | jsonb | não | `'[]'::jsonb` |
| dedupe_key | text | sim |  |
| locked_by | text | sim |  |
| locked_at | timestamp with time zone | sim |  |
| created_by | uuid | sim |  |
| created_at | timestamp with time zone | não | `now()` |
| updated_at | timestamp with time zone | não | `now()` |
| meta_message_id | text | sim |  |
| reply_text | text | sim |  |
| last_inbound_at | timestamp with time zone | sim |  |
| error_code | integer | sim |  |

Constraints: `message_queue_account_id_fkey` FOREIGN KEY (account_id) REFERENCES whatsapp_accounts(id) ON DELETE CASCADE; `message_queue_created_by_fkey` FOREIGN KEY (created_by) REFERENCES auth.users(id); `message_queue_pkey` PRIMARY KEY (id); `message_queue_status_check` CHECK ((status = ANY (ARRAY['pending'::text, 'retrying'::text, 'processing'::text, 'sent'::text, 'delivered'::text, 'read'::text, 'replied'::text, 'paused'::text, 'failed'::text, 'canceled'::text])))

Índices: `idx_message_queue_account_status`, `idx_message_queue_campaign_status`, `idx_message_queue_dedupe_key`, `idx_message_queue_dispatch_window`, `idx_message_queue_meta_message_id`, `idx_message_queue_phone_status`, `idx_message_queue_provider_message_id`, `idx_message_queue_sent_at`, `idx_mq_error_code`, `message_queue_pkey`

Policies: `message_queue_delete_authenticated` (DELETE → {authenticated}); `message_queue_insert_authenticated` (INSERT → {authenticated}); `message_queue_select_authenticated` (SELECT → {authenticated}); `message_queue_update_authenticated` (UPDATE → {authenticated})

## meta_ad_accounts

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |
| ad_account_id | text | sim |  |
| conjunto_id | text | sim |  |
| access_token | text | sim |  |
| canal_venda | text | sim |  |
| created_at | timestamp with time zone | não | `now()` |
| campaign_name | character varying | sim |  |
| name | text | sim |  |

Constraints: `meta_ad_accounts_ad_account_id_key` UNIQUE (conjunto_id); `meta_ad_accounts_pkey` PRIMARY KEY (id)

Índices: `meta_ad_accounts_ad_account_id_key`, `meta_ad_accounts_pkey`

## meta_webhook_events

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | bigint | não | `nextval('meta_webhook_events_id_seq'::regclass)` |
| received_at | timestamp with time zone | sim | `now()` |
| object_type | text | sim |  |
| entry_id | text | sim |  |
| change_field | text | sim |  |
| meta_message_id | text | sim |  |
| status | text | sim |  |
| recipient_id | text | sim |  |
| error_code | integer | sim |  |
| error_message | text | sim |  |
| raw | jsonb | sim |  |

Constraints: `meta_webhook_events_pkey` PRIMARY KEY (id)

Índices: `idx_meta_wh_error_code`, `idx_meta_wh_meta_id`, `idx_meta_wh_received`, `idx_meta_wh_status`, `meta_webhook_events_pkey`

## meta_whatsapp_gastos_dia

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| account_id | bigint | não |  |
| waba_id | text | não |  |
| data | date | não |  |
| pricing_category | text | não |  |
| pricing_type | text | não |  |
| volume | integer | não | `0` |
| cost_usd | numeric | não | `0` |
| synced_at | timestamp with time zone | sim | `now()` |

Constraints: `meta_whatsapp_gastos_dia_pkey` PRIMARY KEY (account_id, data, pricing_category, pricing_type)

Índices: `idx_mwgd_data`, `idx_mwgd_waba_data`, `meta_whatsapp_gastos_dia_pkey`

## metas_mensais_calculadas

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | bigint | não | `nextval('metas_mensais_calculadas_id_seq'::regclass)` |
| tipo | character varying | não |  |
| nome | character varying | não |  |
| mes | character varying | não |  |
| bronze | numeric | não | `0` |
| prata | numeric | não | `0` |
| ouro | numeric | não | `0` |
| diamante | numeric | não | `0` |
| calculado_em | timestamp with time zone | sim | `now()` |
| usuario | character varying | não |  |

Constraints: `metas_mensais_calculadas_pkey` PRIMARY KEY (id); `metas_mensais_calculadas_tipo_check` CHECK (((tipo)::text = ANY ((ARRAY['lojas'::character varying, 'vendedores'::character varying])::text[]))); `unique_meta_mensal_calculada` UNIQUE (tipo, nome, mes)

Índices: `idx_metas_mensais_calculadas_mes`, `idx_metas_mensais_calculadas_nome`, `idx_metas_mensais_calculadas_tipo`, `metas_mensais_calculadas_pkey`, `unique_meta_mensal_calculada`

## metas_semanais_varejo

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | bigint | não | `nextval('metas_semanais_varejo_id_seq'::regclass)` |
| tipo | character varying | não |  |
| nome | character varying | não |  |
| semana_inicio | date | não |  |
| semana_fim | date | não |  |
| campo | character varying | não |  |
| valor | numeric | não |  |
| mes_referencia | character varying | não |  |
| numero_semana | integer | não |  |
| usuario | character varying | não |  |
| data_alteracao | timestamp with time zone | sim | `now()` |

Constraints: `metas_semanais_varejo_campo_check` CHECK (((campo)::text = ANY ((ARRAY['bronze'::character varying, 'prata'::character varying, 'ouro'::character varying, 'diamante'::character varying])::text[]))); `metas_semanais_varejo_numero_semana_check` CHECK (((numero_semana >= 1) AND (numero_semana <= 5))); `metas_semanais_varejo_pkey` PRIMARY KEY (id); `metas_semanais_varejo_tipo_check` CHECK (((tipo)::text = ANY ((ARRAY['lojas'::character varying, 'vendedores'::character varying])::text[]))); `unique_meta_semanal_per_entity` UNIQUE (tipo, nome, campo, semana_inicio)

Índices: `idx_metas_semanais_data_alteracao`, `idx_metas_semanais_mes_referencia`, `idx_metas_semanais_nome`, `idx_metas_semanais_nome_mes`, `idx_metas_semanais_numero_semana`, `idx_metas_semanais_semana_inicio`, `idx_metas_semanais_tipo`, `idx_metas_semanais_tipo_mes`, `metas_semanais_varejo_pkey`, `unique_meta_semanal_per_entity`

## metas_varejo

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | bigint | não | `nextval('metas_varejo_id_seq'::regclass)` |
| tipo | character varying | não |  |
| nome | character varying | não |  |
| campo | character varying | não |  |
| valor | character varying | não |  |
| mes | character varying | não |  |
| usuario | character varying | não |  |
| data_alteracao | timestamp with time zone | sim | `now()` |

Constraints: `metas_varejo_campo_check` CHECK (((campo)::text = ANY ((ARRAY['bronze'::character varying, 'prata'::character varying, 'ouro'::character varying, 'diamante'::character varying])::text[]))); `metas_varejo_pkey` PRIMARY KEY (id); `metas_varejo_tipo_check` CHECK (((tipo)::text = ANY ((ARRAY['lojas'::character varying, 'vendedores'::character varying])::text[]))); `unique_meta_per_entity_per_month` UNIQUE (tipo, nome, campo, mes)

Índices: `idx_metas_varejo_data_alteracao`, `idx_metas_varejo_mes`, `idx_metas_varejo_nome`, `idx_metas_varejo_tipo`, `idx_metas_varejo_tipo_mes`, `metas_varejo_pkey`, `unique_meta_per_entity_per_month`

Policies: `Permitir ALL para usuários autenticados` (ALL → {public})

## metric_instagram

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| key_unic | bigint | não |  |
| id | text | não |  |
| caption | text | sim |  |
| link_count | integer | sim |  |
| comments_count | integer | sim |  |
| media_url | text | sim |  |
| created_at | timestamp with time zone | não | `now()` |

Constraints: `instagram_pkey` PRIMARY KEY (key_unic)

Índices: `instagram_pkey`

## modules

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | integer | não | `nextval('modules_id_seq'::regclass)` |
| key | text | não |  |
| name | text | não |  |
| description | text | sim |  |
| active | boolean | não | `true` |
| created_at | timestamp with time zone | não | `now()` |
| updated_at | timestamp with time zone | não | `now()` |

Constraints: `modules_key_key` UNIQUE (key); `modules_pkey` PRIMARY KEY (id)

Índices: `idx_modules_active`, `modules_key_key`, `modules_pkey`

Policies: `modules_all` (ALL → {authenticated}); `modules_select` (SELECT → {authenticated})

## motivos_nao_conversao

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | integer | não | `nextval('motivos_nao_conversao_id_seq'::regclass)` |
| descricao | text | não |  |
| ativo | boolean | sim | `true` |
| created_at | timestamp with time zone | sim | `now()` |
| updated_at | timestamp with time zone | sim | `now()` |

Constraints: `motivos_nao_conversao_pkey` PRIMARY KEY (id)

Índices: `motivos_nao_conversao_pkey`

Policies: `Allow all operations on motivos_nao_conversao` (ALL → {public})

## nct_expedicao

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | character varying | não |  |
| name | character varying | sim |  |
| status | character varying | sim |  |
| date_created | timestamp with time zone | sim |  |
| date_update | timestamp with time zone | sim |  |
| narrativas | text | sim |  |
| progresso | integer | sim |  |
| resultado | text | sim |  |
| id_tarefa | character varying | sim |  |

Constraints: `nct_expedicao_pkey` PRIMARY KEY (id)

Índices: `nct_expedicao_pkey`

Policies: `Allow public access` (SELECT → {anon}); `a` (ALL → {anon})

## nct_lv

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | character varying | não |  |
| name | character varying | sim |  |
| status | character varying | sim |  |
| date_created | timestamp with time zone | sim |  |
| date_update | timestamp with time zone | sim |  |
| narrativas | text | sim |  |
| progresso | integer | sim |  |
| resultado | text | sim |  |
| id_tarefa | character varying | sim |  |

Constraints: `nct_lv_pkey` PRIMARY KEY (id)

Índices: `nct_lv_pkey`

Policies: `a` (ALL → {public})

## nct_pcp

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | character varying | não |  |
| name | character varying | sim |  |
| status | character varying | sim |  |
| date_created | timestamp with time zone | sim |  |
| date_update | timestamp with time zone | sim |  |
| narrativas | text | sim |  |
| progresso | integer | sim |  |
| resultado | text | sim |  |
| id_tarefa | character varying | sim |  |

Constraints: `nct_pcp_pkey` PRIMARY KEY (id)

Índices: `nct_pcp_pkey`

Policies: `a` (ALL → {public})

## new_forecast_canais_extra

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| nome | text | não |  |
| qtd | boolean | não | `false` |
| criado_em | timestamp with time zone | sim | `now()` |

Constraints: `new_forecast_canais_extra_pkey` PRIMARY KEY (nome)

Índices: `new_forecast_canais_extra_pkey`

## new_forecast_config

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| period_key | text | não |  |
| datemin | date | não |  |
| datemax | date | não |  |
| semanas | jsonb | sim |  |
| metas | jsonb | não | `'{}'::jsonb` |
| manual | jsonb | não | `'{}'::jsonb` |
| overrides | jsonb | não | `'{}'::jsonb` |
| atualizado_em | timestamp with time zone | sim | `now()` |

Constraints: `new_forecast_config_pkey` PRIMARY KEY (period_key)

Índices: `new_forecast_config_pkey`

## new_forecast_semana_cache

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| periodo_key | text | não |  |
| datemin | date | não |  |
| datemax | date | não |  |
| canais | jsonb | não | `'{}'::jsonb` |
| salvo_em | timestamp with time zone | sim | `now()` |

Constraints: `new_forecast_semana_cache_pkey` PRIMARY KEY (periodo_key)

Índices: `new_forecast_semana_cache_datas_idx`, `new_forecast_semana_cache_pkey`

## nf_observacoes

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | bigint | não |  |
| ds_chaveacesso | text | não |  |
| observacao | text | não | `''::text` |
| created_at | timestamp with time zone | não | `now()` |
| updated_at | timestamp with time zone | não | `now()` |

Constraints: `nf_observacoes_pkey` PRIMARY KEY (id)

Índices: `idx_nf_observacoes_chave`, `nf_observacoes_pkey`

Policies: `Allow modify to authenticated` (ALL → {anon,authenticated}); `Allow select to authenticated` (SELECT → {anon,authenticated}); `\Allow modify to authenticated\` (ALL → {authenticated}); `\Allow select to authenticated\` (SELECT → {authenticated})

## notas_fiscais

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | bigint | não |  |
| branch_code | integer | sim |  |
| branch_cnpj | text | sim |  |
| transaction_code | integer | sim |  |
| transaction_branch_code | integer | sim |  |
| transaction_date | date | sim |  |
| invoice_code | text | sim |  |
| invoice_sequence | integer | sim |  |
| serial_code | text | sim |  |
| invoice_status | text | sim |  |
| issue_date | date | sim |  |
| invoice_date | date | sim |  |
| release_date | date | sim |  |
| exit_time | text | sim |  |
| last_change_date | text | sim |  |
| max_change_filter_date | text | sim |  |
| person_code | integer | sim |  |
| person_name | text | sim |  |
| person_cpf_cnpj | text | sim |  |
| person | jsonb | sim |  |
| dealer_code | integer | sim |  |
| origin | text | sim |  |
| document_type_code | integer | sim |  |
| operation_type | text | sim |  |
| operation_code | integer | sim |  |
| operation_name | text | sim |  |
| inclusion_component_code | text | sim |  |
| peripheral_pdv_code | text | sim |  |
| version_pdv | text | sim |  |
| mobile_version | text | sim |  |
| id_document_pdv | text | sim |  |
| user_code | integer | sim |  |
| terminal_code | integer | sim |  |
| payment_condition_code | integer | sim |  |
| payment_condition_name | text | sim |  |
| quantity | numeric | sim |  |
| product_value | numeric | sim |  |
| additional_value | numeric | sim |  |
| discount_value | numeric | sim |  |
| discount_percentage | numeric | sim |  |
| shipping_value | numeric | sim |  |
| freight_value | numeric | sim |  |
| insurance_value | numeric | sim |  |
| other_expenses | numeric | sim |  |
| ipi_value | numeric | sim |  |
| base_icms_value | numeric | sim |  |
| icms_value | numeric | sim |  |
| icms_st_value | numeric | sim |  |
| icms_sub_st_value | numeric | sim |  |
| pis_value | numeric | sim |  |
| cofins_value | numeric | sim |  |
| total_value | numeric | sim |  |
| seller_cpf | text | sim |  |
| eletronic_invoice_status | text | sim |  |
| eletronic | jsonb | sim |  |
| shipping_company_code | integer | sim |  |
| shipping_company_cpf_cnpj | text | sim |  |
| shipping_company | jsonb | sim |  |
| ecf | jsonb | sim |  |
| sat | jsonb | sim |  |
| production_order | jsonb | sim |  |
| sales_order | jsonb | sim |  |
| payments | jsonb | sim |  |
| observation_nf | text | sim |  |
| observation_nfe | text | sim |  |
| referenced_tax_invoice | jsonb | sim |  |
| items | jsonb | sim | `'[]'::jsonb` |
| raw_data | jsonb | sim |  |
| synced_at | timestamp with time zone | sim | `now()` |

Constraints: `notas_fiscais_pkey` PRIMARY KEY (id)

Índices: `idx_nf_dealer_op_date`, `notas_fiscais_branch_code_idx`, `notas_fiscais_invoice_status_idx`, `notas_fiscais_issue_date_idx`, `notas_fiscais_operation_code_idx`, `notas_fiscais_operation_type_idx`, `notas_fiscais_person_code_idx`, `notas_fiscais_pkey`, `notas_fiscais_upsert_key`

## notice_reads

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | uuid | não | `extensions.uuid_generate_v4()` |
| notice_id | uuid | sim |  |
| user_id | uuid | sim |  |
| read_at | timestamp with time zone | sim | `now()` |
| confirmed_at | timestamp with time zone | sim |  |

Constraints: `notice_reads_notice_id_fkey` FOREIGN KEY (notice_id) REFERENCES notices(id) ON DELETE CASCADE; `notice_reads_notice_id_user_id_key` UNIQUE (notice_id, user_id); `notice_reads_pkey` PRIMARY KEY (id); `notice_reads_user_id_fkey` FOREIGN KEY (user_id) REFERENCES auth.users(id)

Índices: `idx_notice_reads_notice_id`, `idx_notice_reads_user_id`, `notice_reads_notice_id_user_id_key`, `notice_reads_pkey`

Policies: `Usuários podem marcar seus avisos como lidos` (ALL → {authenticated}); `reads` (ALL → {public})

## notice_recipients

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | uuid | não | `extensions.uuid_generate_v4()` |
| notice_id | uuid | sim |  |
| user_id | uuid | sim |  |
| role | text | sim |  |
| created_at | timestamp with time zone | sim | `now()` |

Constraints: `notice_recipients_notice_id_fkey` FOREIGN KEY (notice_id) REFERENCES notices(id) ON DELETE CASCADE; `notice_recipients_notice_id_user_id_key` UNIQUE (notice_id, user_id); `notice_recipients_pkey` PRIMARY KEY (id); `notice_recipients_user_id_fkey` FOREIGN KEY (user_id) REFERENCES auth.users(id)

Índices: `idx_notice_recipients_notice_id`, `idx_notice_recipients_user_id`, `notice_recipients_notice_id_user_id_key`, `notice_recipients_pkey`

Policies: `recipients` (ALL → {public})

## notices

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | uuid | não | `extensions.uuid_generate_v4()` |
| title | text | não |  |
| content | text | não |  |
| styles | jsonb | sim | `'{}'::jsonb` |
| created_by | uuid | sim |  |
| created_at | timestamp with time zone | sim | `now()` |
| updated_at | timestamp with time zone | sim | `now()` |
| is_active | boolean | sim | `true` |

Constraints: `notices_created_by_fkey` FOREIGN KEY (created_by) REFERENCES auth.users(id); `notices_pkey` PRIMARY KEY (id)

Índices: `idx_notices_created_by`, `notices_pkey`

Policies: `Criadores podem ver seus avisos` (SELECT → {authenticated}); `Destinatários podem ver avisos direcionados a eles` (SELECT → {authenticated}); `Owners e admins podem criar avisos` (INSERT → {authenticated}); `notices` (ALL → {public})

## notificacoes_credito

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |
| solicitacao_id | uuid | sim |  |
| tipo | text | não |  |
| destinatario_tipo | text | não |  |
| destinatario_id | uuid | sim |  |
| titulo | text | não |  |
| mensagem | text | não |  |
| dados_adicionais | jsonb | sim |  |
| lida | boolean | sim | `false` |
| dt_criacao | timestamp without time zone | sim | `now()` |
| dt_leitura | timestamp without time zone | sim |  |

Constraints: `notificacoes_credito_destinatario_tipo_check` CHECK ((destinatario_tipo = ANY (ARRAY['FRANQUEADO'::text, 'FINANCEIRO'::text, 'ADMIN'::text]))); `notificacoes_credito_pkey` PRIMARY KEY (id); `notificacoes_credito_solicitacao_id_fkey` FOREIGN KEY (solicitacao_id) REFERENCES solicitacoes_credito(id) ON DELETE CASCADE; `notificacoes_credito_tipo_check` CHECK ((tipo = ANY (ARRAY['NOVA_SOLICITACAO'::text, 'CONTRAPROPOSTA_ENVIADA'::text, 'CONTRAPROPOSTA_ACEITA'::text, 'CONTRAPROPOSTA_RECUSADA'::text, 'APROVACAO'::text, 'REPROVACAO'::text])))

Índices: `idx_notificacoes_destinatario`, `idx_notificacoes_dt_criacao`, `idx_notificacoes_solicitacao`, `idx_notificacoes_tipo`, `notificacoes_credito_pkey`

Policies: `Usuários podem atualizar suas notificações` (UPDATE → {public}); `Usuários podem ver suas notificações` (SELECT → {public}); `notificacao` (ALL → {public})

## notificacoes_renegociacao

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |
| solicitacao_id | uuid | não |  |
| tipo | character varying | não |  |
| destinatario_tipo | character varying | não |  |
| destinatario_id | uuid | sim |  |
| titulo | text | não |  |
| mensagem | text | sim |  |
| dados_adicionais | jsonb | sim |  |
| lida | boolean | sim | `false` |
| dt_criacao | timestamp with time zone | sim | `now()` |
| dt_leitura | timestamp with time zone | sim |  |

Constraints: `notificacoes_renegociacao_destinatario_id_fkey` FOREIGN KEY (destinatario_id) REFERENCES auth.users(id) ON DELETE CASCADE; `notificacoes_renegociacao_destinatario_tipo_check` CHECK (((destinatario_tipo)::text = ANY ((ARRAY['FRANQUEADO'::character varying, 'FINANCEIRO'::character varying, 'ADMIN'::character varying])::text[]))); `notificacoes_renegociacao_pkey` PRIMARY KEY (id); `notificacoes_renegociacao_solicitacao_id_fkey` FOREIGN KEY (solicitacao_id) REFERENCES solicitacoes_renegociacoes(id) ON DELETE CASCADE; `notificacoes_renegociacao_tipo_check` CHECK (((tipo)::text = ANY ((ARRAY['NOVA_SOLICITACAO'::character varying, 'CONTRAPROPOSTA_ENVIADA'::character varying, 'CONTRAPROPOSTA_ACEITA'::character varying, 'CONTRAPROPOSTA_RECUSADA'::character varying, 'APROVACAO'::character varying, 'REPROVACAO'::character varying])::text[])))

Índices: `idx_notificacoes_renegociacao_destinatario`, `idx_notificacoes_renegociacao_dt_criacao`, `idx_notificacoes_renegociacao_solicitacao`, `idx_notificacoes_renegociacao_tipo`, `notificacoes_renegociacao_pkey`

Policies: `notifrenego` (ALL → {public}); `select_notificacoes_renegociacao` (SELECT → {public}); `update_notificacoes_renegociacao` (UPDATE → {public})

## notificacoes_sistema

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |
| tipo | text | não | `'SISTEMA'::text` |
| nivel | text | não | `'info'::text` |
| titulo | text | não |  |
| mensagem | text | sim |  |
| dados | jsonb | não | `'{}'::jsonb` |
| destinatario_roles | ARRAY | não | `'{}'::text[]` |
| destinatario_id | uuid | sim |  |
| lida_por | ARRAY | não | `'{}'::uuid[]` |
| dt_criacao | timestamp with time zone | não | `now()` |

Constraints: `notificacoes_sistema_pkey` PRIMARY KEY (id)

Índices: `idx_notif_sistema_dest_id`, `idx_notif_sistema_dt`, `idx_notif_sistema_roles`, `notificacoes_sistema_pkey`

Policies: `notif_sistema_insert` (INSERT → {service_role}); `notif_sistema_select` (SELECT → {authenticated})

## observacoes_despesas_manuais

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |
| cd_usuario | uuid | não |  |
| id_despesa_manual | uuid | não |  |
| observacao | text | não |  |
| is_active | boolean | não | `true` |
| created_at | timestamp with time zone | não | `timezone('utc'::text, now())` |
| updated_at | timestamp with time zone | não | `timezone('utc'::text, now())` |

Constraints: `observacoes_despesas_manuais_cd_usuario_fkey` FOREIGN KEY (cd_usuario) REFERENCES auth.users(id); `observacoes_despesas_manuais_id_despesa_manual_fkey` FOREIGN KEY (id_despesa_manual) REFERENCES despesas_manuais_dre(id) ON DELETE CASCADE; `observacoes_despesas_manuais_pkey` PRIMARY KEY (id)

Índices: `idx_obs_manuais_historico`, `idx_obs_manuais_usuario`, `observacoes_despesas_manuais_pkey`

Policies: `Usuários autenticados podem criar observações de despesas ma` (INSERT → {authenticated}); `Usuários autenticados podem ver observações de despesas manu` (SELECT → {authenticated}); `Usuários podem atualizar suas próprias observações` (UPDATE → {authenticated})

## observacoes_despesas_totvs

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |
| cd_empresa | integer | não |  |
| cd_despesaitem | integer | não |  |
| cd_fornecedor | integer | não |  |
| nr_duplicata | text | não |  |
| nr_parcela | integer | não | `0` |
| observacao | text | não |  |
| dt_inicio | date | não |  |
| dt_fim | date | não |  |
| cd_usuario | uuid | não |  |
| created_at | timestamp with time zone | sim | `now()` |
| updated_at | timestamp with time zone | sim | `now()` |
| is_active | boolean | sim | `true` |

Constraints: `observacoes_despesas_totvs_cd_usuario_fkey` FOREIGN KEY (cd_usuario) REFERENCES auth.users(id); `observacoes_despesas_totvs_pkey` PRIMARY KEY (id)

Índices: `idx_obs_totvs_duplicata`, `idx_obs_totvs_empresa_despesa`, `idx_obs_totvs_fornecedor`, `idx_obs_totvs_periodo`, `idx_observacoes_historico`, `observacoes_despesas_totvs_pkey`

Policies: `Usuários podem atualizar próprias observações` (UPDATE → {public}); `Usuários podem criar observações` (INSERT → {public}); `Usuários podem deletar próprias observações` (DELETE → {public}); `Usuários podem ver próprias observações` (SELECT → {public}); `obstotvs` (ALL → {public})

## observacoes_inadimplentes

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | integer | não | `nextval('observacoes_inadimplentes_id_seq'::regclass)` |
| cd_cliente | character varying | não |  |
| nm_cliente | character varying | sim |  |
| observacao | text | não |  |
| usuario | character varying | não |  |
| data_criacao | timestamp with time zone | sim | `now()` |

Constraints: `observacoes_inadimplentes_cd_cliente_idx` PRIMARY KEY (id)

Índices: `idx_observacoes_cd_cliente`, `idx_observacoes_data_criacao`, `observacoes_inadimplentes_cd_cliente_idx`

Policies: `headcoach_autenticado_tudo` (ALL → {authenticated})

## observacoes_inadimplentes_franquias

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | integer | não | `nextval('observacoes_inadimplentes_franquias_id_seq'::regclass)` |
| cd_cliente | character varying | não |  |
| nm_cliente | character varying | sim |  |
| observacao | text | não |  |
| usuario | character varying | não |  |
| data_criacao | timestamp with time zone | sim | `now()` |

Constraints: `observacoes_inadimplentes_franquias_cd_cliente_idx` PRIMARY KEY (id)

Índices: `idx_observacoes_franquias_cd_cliente`, `idx_observacoes_franquias_data_criacao`, `observacoes_inadimplentes_franquias_cd_cliente_idx`

Policies: `headcoach_autenticado_tudo` (ALL → {authenticated})

## orders

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |
| customer | jsonb | não |  |
| items | jsonb | não |  |
| total | numeric | não |  |
| status | text | sim | `'pending'::text` |
| created_at | timestamp with time zone | sim | `now()` |
| payment | jsonb | sim |  |
| pagarme_order_id | text | sim |  |
| user_id | uuid | sim |  |
| notified_at | timestamp with time zone | sim |  |
| notify_count | integer | sim | `0` |

Constraints: `orders_pkey` PRIMARY KEY (id); `orders_user_id_fkey` FOREIGN KEY (user_id) REFERENCES users(id)

Índices: `orders_pkey`

Policies: `public_insert_orders` (INSERT → {public})

## pagamentos_fabricas

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | bigint | não | `nextval('pagamentos_fabricas_id_seq'::regclass)` |
| empresa | text | não |  |
| transacao | text | sim |  |
| fornecedor | text | não |  |
| nfe | text | sim |  |
| valor | numeric | sim |  |
| data_lancamento | date | sim |  |
| status | text | sim | `'Aguardando Nota'::text` |
| data_pagamento | date | sim |  |
| forma | text | sim |  |
| cartao_conta | text | sim |  |
| parcelas | numeric | sim |  |
| valor_pago | numeric | sim |  |
| observacao | text | sim |  |
| tem_nota | boolean | sim | `true` |
| tem_transacao | boolean | sim | `true` |
| created_at | timestamp with time zone | sim | `now()` |
| updated_at | timestamp with time zone | sim | `now()` |
| cd_empresa | integer | sim |  |
| fornecedor_cnpj | text | sim |  |
| fornecedor_codigo | text | sim |  |
| tipo_pagamento | text | sim |  |
| info_pagamento | text | sim |  |
| pagamento_liberacao_id | uuid | sim |  |
| liberado_pagamento_em | timestamp with time zone | sim |  |
| liberado_pagamento_por | uuid | sim |  |
| liberado_pagamento_por_nome | text | sim |  |

Constraints: `pagamentos_fabricas_pkey` PRIMARY KEY (id)

Índices: `idx_pag_fabricas_pgto_lib`, `pagamentos_fabricas_pkey`

Policies: `headcoach_autenticado_tudo` (ALL → {authenticated}); `pagamentos_fabricas_delete` (DELETE → {public}); `pagamentos_fabricas_insert` (INSERT → {public}); `pagamentos_fabricas_select` (SELECT → {public}); `pagamentos_fabricas_update` (UPDATE → {public})

## pagamentos_liberacao

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |
| cd_empresa | integer | sim |  |
| nm_empresa | character varying | sim |  |
| nr_duplicata | character varying | sim |  |
| nr_parcela | character varying | sim |  |
| nr_portador | character varying | sim |  |
| cd_fornecedor | character varying | sim |  |
| nm_fornecedor | character varying | sim |  |
| cd_despesaitem | character varying | sim |  |
| ds_despesaitem | character varying | sim |  |
| cd_ccusto | character varying | sim |  |
| dt_emissao | date | sim |  |
| dt_vencimento | date | sim |  |
| vl_duplicata | numeric | não | `0` |
| status | character varying | não | `'PENDENTE'::character varying` |
| forma_pagamento | character varying | sim |  |
| codigo_barras | character varying | sim |  |
| chave_pix | text | sim |  |
| link_pagamento | character varying | sim |  |
| observacao | text | sim |  |
| enviado_por | character varying | sim |  |
| enviado_em | timestamp with time zone | sim | `now()` |
| pago_por | character varying | sim |  |
| pago_em | timestamp with time zone | sim |  |
| dados_completos | jsonb | sim |  |
| created_at | timestamp with time zone | sim | `now()` |
| updated_at | timestamp with time zone | sim | `now()` |
| banco_pagamento | character varying | sim |  |
| aprovado_por | character varying | sim |  |
| aprovado_em | timestamp with time zone | sim |  |
| cancelado_por | character varying | sim |  |
| cancelado_em | timestamp with time zone | sim |  |
| vl_real | numeric | sim |  |
| dt_pagamento | date | sim |  |
| baixado | boolean | não | `false` |
| baixado_por | character varying | sim |  |
| baixado_em | timestamp with time zone | sim |  |

Constraints: `pagamentos_liberacao_forma_pagamento_check` CHECK ((((forma_pagamento)::text = ANY ((ARRAY['PIX'::character varying, 'BOLETO'::character varying, 'DEBITO'::character varying, 'CREDITO'::character varying])::text[])) OR (forma_pagamento IS NULL))); `pagamentos_liberacao_pkey` PRIMARY KEY (id); `pagamentos_liberacao_status_check` CHECK (((status)::text = ANY ((ARRAY['PENDENTE'::character varying, 'PROVISAO'::character varying, 'APROVADO'::character varying, 'PAGO'::character varying, 'CANCELADO'::character varying, 'TRANSFERENCIA'::character varying])::text[])))

Índices: `idx_pagamentos_liberacao_baixado`, `idx_pagamentos_liberacao_dt_pagamento`, `idx_pagamentos_liberacao_dt_venc`, `idx_pagamentos_liberacao_forn`, `idx_pagamentos_liberacao_status`, `pagamentos_liberacao_pkey`

Policies: `Atualizacao autenticada` (UPDATE → {public}); `Exclusao autenticada` (DELETE → {public}); `Insercao autenticada` (INSERT → {public}); `Leitura autenticada` (SELECT → {public}); `headcoach_autenticado_tudo` (ALL → {authenticated})

## pagarme_boletos

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | bigint | não | `nextval('pagarme_boletos_id_seq'::regclass)` |
| remessa_id | text | não |  |
| cd_empresa | integer | não |  |
| cd_cliente | integer | não |  |
| nm_cliente | text | sim |  |
| nr_documento | text | sim |  |
| nr_fatura | bigint | não |  |
| nr_parcela | integer | não | `1` |
| dt_emissao | date | sim |  |
| dt_vencimento | date | sim |  |
| vl_fatura | numeric | não |  |
| cd_portador_totvs | integer | sim |  |
| nm_portador_totvs | text | sim |  |
| order_id | text | sim |  |
| charge_id | text | sim |  |
| order_code | text | sim |  |
| status | text | não | `'pending'::text` |
| boleto_url | text | sim |  |
| boleto_pdf | text | sim |  |
| linha_digitavel | text | sim |  |
| nosso_numero | text | sim |  |
| vl_pago | numeric | sim |  |
| dt_pagamento | timestamp with time zone | sim |  |
| erro | text | sim |  |
| carteira_ok | boolean | não | `false` |
| carteira_erro | text | sim |  |
| baixa_status | text | não | `'pendente'::text` |
| baixa_erro | text | sim |  |
| baixa_em | timestamp with time zone | sim |  |
| criado_por | text | sim |  |
| created_at | timestamp with time zone | não | `now()` |
| updated_at | timestamp with time zone | não | `now()` |

Constraints: `pagarme_boletos_pkey` PRIMARY KEY (id)

Índices: `idx_pagarme_boletos_status`, `idx_pagarme_boletos_vencimento`, `pagarme_boletos_pkey`, `ux_pagarme_boletos_order`, `ux_pagarme_boletos_titulo_ativo`

## pages

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | integer | não | `nextval('pages_id_seq'::regclass)` |
| module_id | integer | não |  |
| key | text | não |  |
| path | text | não |  |
| label | text | não |  |
| description | text | sim |  |
| sort_order | integer | não | `100` |
| is_public | boolean | não | `false` |
| created_at | timestamp with time zone | não | `now()` |
| updated_at | timestamp with time zone | não | `now()` |

Constraints: `pages_key_key` UNIQUE (key); `pages_module_id_fkey` FOREIGN KEY (module_id) REFERENCES modules(id) ON DELETE CASCADE; `pages_path_key` UNIQUE (path); `pages_pkey` PRIMARY KEY (id)

Índices: `idx_pages_module`, `idx_pages_public`, `pages_key_key`, `pages_path_key`, `pages_pkey`

Policies: `pages_all` (ALL → {authenticated}); `pages_select` (SELECT → {authenticated})

## patient

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |
| code | text | não |  |
| name | text | não |  |
| cpf | text | sim |  |
| service_id | smallint | não |  |
| status_id | smallint | não |  |
| insurance_id | smallint | não |  |
| email | text | sim |  |
| phone | text | sim |  |
| birth_date | date | sim |  |
| gender | USER-DEFINED | sim |  |
| insurance_number | text | sim |  |
| emergency_contact_name | text | sim |  |
| emergency_contact_phone | text | sim |  |
| created_at | timestamp with time zone | não | `now()` |
| updated_at | timestamp with time zone | não | `now()` |
| custom_fields | jsonb | sim |  |

Constraints: `patient_code_key` UNIQUE (code); `patient_insurance_id_fkey` FOREIGN KEY (insurance_id) REFERENCES insurance(id) ON UPDATE RESTRICT ON DELETE RESTRICT; `patient_pkey` PRIMARY KEY (id); `patient_service_id_fkey` FOREIGN KEY (service_id) REFERENCES patient_service(id) ON UPDATE RESTRICT ON DELETE RESTRICT; `patient_status_id_fkey` FOREIGN KEY (status_id) REFERENCES patient_status(id) ON UPDATE RESTRICT ON DELETE RESTRICT

Índices: `idx_patient_birth_date`, `idx_patient_cpf`, `idx_patient_custom_fields`, `idx_patient_insurance`, `idx_patient_name_lower`, `idx_patient_service`, `idx_patient_status`, `patient_code_key`, `patient_pkey`

Policies: `patient_all` (ALL → {authenticated})

## patient_address

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |
| patient_id | uuid | não |  |
| type | text | não |  |
| street | text | não |  |
| number | text | sim |  |
| complement | text | sim |  |
| neighborhood | text | sim |  |
| city | text | não |  |
| state | text | não |  |
| postal_code | text | sim |  |
| latitude | numeric | sim |  |
| longitude | numeric | sim |  |
| country | text | não | `'Brasil'::text` |
| is_primary | boolean | sim | `false` |
| created_at | timestamp with time zone | não | `now()` |
| updated_at | timestamp with time zone | não | `now()` |

Constraints: `patient_address_patient_id_fkey` FOREIGN KEY (patient_id) REFERENCES patient(id) ON UPDATE CASCADE ON DELETE CASCADE; `patient_address_pkey` PRIMARY KEY (id); `patient_address_type_check` CHECK ((type = ANY (ARRAY['residential'::text, 'commercial'::text, 'billing'::text, 'emergency'::text])))

Índices: `idx_patient_address_city`, `idx_patient_address_latitude`, `idx_patient_address_longitude`, `idx_patient_address_patient_id`, `idx_patient_address_primary`, `idx_patient_address_state`, `idx_patient_address_type`, `patient_address_pkey`

Policies: `patient_address_all` (ALL → {authenticated})

## patient_contact

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |
| patient_id | uuid | não |  |
| type | text | não |  |
| value | text | não |  |
| description | text | sim |  |
| is_primary | boolean | sim | `false` |
| created_at | timestamp with time zone | não | `now()` |
| updated_at | timestamp with time zone | não | `now()` |

Constraints: `patient_contact_pkey` PRIMARY KEY (id); `patient_contact_type_check` CHECK ((type = ANY (ARRAY['phone'::text, 'email'::text, 'whatsapp'::text, 'telegram'::text])))

Índices: `idx_patient_contact_patient_id`, `idx_patient_contact_primary`, `idx_patient_contact_type`, `idx_patient_contact_value`, `patient_contact_pkey`

Policies: `patient_contact_all` (ALL → {authenticated})

## patient_interaction

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |
| patient_id | uuid | não |  |
| occurred_at | timestamp with time zone | não |  |
| type | text | não |  |
| subject | text | sim |  |
| notes | text | sim |  |
| next_step | text | sim |  |
| appointment_date | timestamp with time zone | sim |  |
| provider | text | sim |  |
| cost | numeric | sim |  |
| created_at | timestamp with time zone | não | `now()` |
| updated_at | timestamp with time zone | não | `now()` |

Constraints: `patient_interaction_pkey` PRIMARY KEY (id); `patient_interaction_type_check` CHECK ((type = ANY (ARRAY['consultation'::text, 'exam'::text, 'procedure'::text, 'call'::text, 'email'::text, 'appointment'::text])))

Índices: `idx_patient_interaction_appointment_date`, `idx_patient_interaction_occurred_at`, `idx_patient_interaction_patient_id`, `idx_patient_interaction_type`, `patient_interaction_pkey`

Policies: `patient_interaction_all` (ALL → {authenticated})

## patient_note

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |
| patient_id | uuid | não |  |
| note | text | não |  |
| note_type | text | sim | `'general'::text` |
| is_private | boolean | sim | `false` |
| created_by | uuid | sim |  |
| created_at | timestamp with time zone | não | `now()` |
| updated_at | timestamp with time zone | não | `now()` |

Constraints: `patient_note_created_by_fkey` FOREIGN KEY (created_by) REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL; `patient_note_note_type_check` CHECK ((note_type = ANY (ARRAY['general'::text, 'medical'::text, 'administrative'::text, 'insurance'::text, 'emergency'::text]))); `patient_note_pkey` PRIMARY KEY (id)

Índices: `idx_patient_note_created_by`, `idx_patient_note_patient_id`, `idx_patient_note_private`, `idx_patient_note_type`, `patient_note_pkey`

Policies: `patient_note_all` (ALL → {authenticated})

## patient_service

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | smallint | não |  |
| code | text | não |  |
| name | text | não |  |
| color | text | não | `'#555555'::text` |
| order_index | smallint | não |  |
| created_at | timestamp with time zone | não | `now()` |
| updated_at | timestamp with time zone | não | `now()` |

Constraints: `patient_service_code_key` UNIQUE (code); `patient_service_order_index_key` UNIQUE (order_index); `patient_service_pkey` PRIMARY KEY (id)

Índices: `patient_service_code_key`, `patient_service_order_index_key`, `patient_service_pkey`, `ux_patient_service_name_lower`

Policies: `patient_service_all` (ALL → {authenticated})

## patient_status

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | smallint | não |  |
| code | text | não |  |
| name | text | não |  |
| color | text | não | `'#555555'::text` |
| order_index | smallint | não |  |
| created_at | timestamp with time zone | não | `now()` |
| updated_at | timestamp with time zone | não | `now()` |

Constraints: `patient_status_code_key` UNIQUE (code); `patient_status_order_index_key` UNIQUE (order_index); `patient_status_pkey` PRIMARY KEY (id)

Índices: `patient_status_code_key`, `patient_status_order_index_key`, `patient_status_pkey`, `ux_patient_status_name_lower`

Policies: `patient_status_all` (ALL → {authenticated})

## patient_tag

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |
| patient_id | uuid | não |  |
| tag_id | uuid | não |  |
| created_at | timestamp with time zone | não | `now()` |

Constraints: `patient_tag_pkey` PRIMARY KEY (id); `patient_tag_tag_id_fkey` FOREIGN KEY (tag_id) REFERENCES tag(id) ON UPDATE CASCADE ON DELETE CASCADE; `uq_patient_tag` UNIQUE (patient_id, tag_id)

Índices: `idx_patient_tag_patient_id`, `idx_patient_tag_tag_id`, `patient_tag_pkey`, `uq_patient_tag`

Policies: `patient_tag_all` (ALL → {authenticated})

## patient_type

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | smallint | não |  |
| code | text | não |  |
| name | text | não |  |
| order_index | smallint | não |  |
| created_at | timestamp with time zone | não | `now()` |
| updated_at | timestamp with time zone | não | `now()` |

Constraints: `patient_type_code_key` UNIQUE (code); `patient_type_order_index_key` UNIQUE (order_index); `patient_type_pkey` PRIMARY KEY (id)

Índices: `patient_type_code_key`, `patient_type_order_index_key`, `patient_type_pkey`, `ux_patient_type_name_lower`

Policies: `patient_type_all` (ALL → {authenticated})

## pdv_cupons_troca

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | bigint | não | `nextval('pdv_cupons_troca_id_seq'::regclass)` |
| codigo | text | não |  |
| empresa | integer | não |  |
| transacao_code | bigint | não |  |
| transacao_date | date | não |  |
| total | numeric | não | `0` |
| cliente_code | integer | sim |  |
| cliente_nome | text | sim |  |
| vendedor_code | integer | sim |  |
| vendedor_nome | text | sim |  |
| itens | jsonb | não | `'[]'::jsonb` |
| usos | jsonb | não | `'[]'::jsonb` |
| criado_por | text | sim |  |
| criado_em | timestamp with time zone | não | `now()` |

Constraints: `pdv_cupons_troca_codigo_key` UNIQUE (codigo); `pdv_cupons_troca_pkey` PRIMARY KEY (id)

Índices: `idx_pdv_cupom_data`, `pdv_cupons_troca_codigo_key`, `pdv_cupons_troca_pkey`, `uq_pdv_cupom_transacao`

## pdv_epc_movimentos

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | bigint | não | `nextval('pdv_epc_movimentos_id_seq'::regclass)` |
| epc | text | não |  |
| tipo | text | não | `'venda'::text` |
| empresa | integer | não |  |
| venda_id | bigint | sim |  |
| item_id | bigint | sim |  |
| product_code | integer | sim |  |
| sku | text | sim |  |
| produto_nome | text | sim |  |
| referencia | text | sim |  |
| valor_unit | numeric | sim |  |
| cliente_code | integer | sim |  |
| cliente_nome | text | sim |  |
| vendedor_code | integer | sim |  |
| vendedor_nome | text | sim |  |
| nota_id | bigint | sim |  |
| chave_nf | text | sim |  |
| ocorrido_em | timestamp with time zone | não | `now()` |
| criado_em | timestamp with time zone | não | `now()` |

Constraints: `pdv_epc_movimentos_item_id_fkey` FOREIGN KEY (item_id) REFERENCES pdv_venda_itens(id) ON DELETE CASCADE; `pdv_epc_movimentos_nota_id_fkey` FOREIGN KEY (nota_id) REFERENCES pdv_notas_fiscais(id) ON DELETE SET NULL; `pdv_epc_movimentos_pkey` PRIMARY KEY (id); `pdv_epc_movimentos_tipo_check` CHECK ((tipo = ANY (ARRAY['venda'::text, 'devolucao'::text, 'estorno'::text]))); `pdv_epc_movimentos_venda_id_fkey` FOREIGN KEY (venda_id) REFERENCES pdv_vendas(id) ON DELETE CASCADE

Índices: `idx_pdv_epc_mov_empresa_data`, `idx_pdv_epc_mov_epc`, `idx_pdv_epc_mov_produto`, `idx_pdv_epc_mov_venda`, `pdv_epc_movimentos_pkey`, `uq_pdv_epc_mov`

## pdv_epc_situacao

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| epc | text | sim |  |
| tipo | text | sim |  |
| empresa | integer | sim |  |
| venda_id | bigint | sim |  |
| product_code | integer | sim |  |
| produto_nome | text | sim |  |
| referencia | text | sim |  |
| valor_unit | numeric | sim |  |
| cliente_nome | text | sim |  |
| vendedor_nome | text | sim |  |
| chave_nf | text | sim |  |
| ocorrido_em | timestamp with time zone | sim |  |

## pdv_fiscal_config

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| empresa | integer | não |  |
| cnpj | text | sim |  |
| ativo | boolean | não | `true` |
| ambiente | smallint | não | `2` |
| serie_nfce | integer | não | `9` |
| serie_nfe | integer | não | `9` |
| prox_num_nfce | integer | não | `1` |
| prox_num_nfe | integer | não | `1` |
| csc_id_hom | text | sim |  |
| csc_token_hom | text | sim |  |
| csc_id_prod | text | sim |  |
| csc_token_prod | text | sim |  |
| aliq_icms | numeric | sim |  |
| info_complementar | text | sim |  |
| criado_em | timestamp with time zone | não | `now()` |
| atualizado_em | timestamp with time zone | não | `now()` |
| operacao_nfce | integer | sim |  |
| operacao_nfe | integer | sim |  |
| operacao_troca | integer | sim |  |
| empresa_nome | text | sim |  |

Constraints: `pdv_fiscal_config_ambiente_check` CHECK ((ambiente = ANY (ARRAY[1, 2]))); `pdv_fiscal_config_pkey` PRIMARY KEY (empresa)

Índices: `pdv_fiscal_config_pkey`

## pdv_notas_fiscais

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | bigint | não | `nextval('pdv_notas_fiscais_id_seq'::regclass)` |
| venda_id | bigint | não |  |
| empresa | integer | não |  |
| cnpj_emitente | text | sim |  |
| modelo | smallint | não |  |
| serie | integer | não |  |
| numero | integer | não |  |
| chave | text | sim |  |
| ambiente | smallint | não | `2` |
| status | text | não | `'gerada'::text` |
| cstat | text | sim |  |
| xmotivo | text | sim |  |
| protocolo | text | sim |  |
| dh_emissao | timestamp with time zone | sim |  |
| dh_autorizacao | timestamp with time zone | sim |  |
| xml_assinado | text | sim |  |
| xml_proc | text | sim |  |
| qr_code | text | sim |  |
| url_chave | text | sim |  |
| cancel_protocolo | text | sim |  |
| cancel_justificativa | text | sim |  |
| cancel_em | timestamp with time zone | sim |  |
| erro | text | sim |  |
| criado_em | timestamp with time zone | não | `now()` |
| atualizado_em | timestamp with time zone | não | `now()` |

Constraints: `pdv_notas_fiscais_modelo_check` CHECK ((modelo = ANY (ARRAY[55, 65]))); `pdv_notas_fiscais_pkey` PRIMARY KEY (id); `pdv_notas_fiscais_status_check` CHECK ((status = ANY (ARRAY['gerada'::text, 'enviada'::text, 'autorizada'::text, 'rejeitada'::text, 'cancelada'::text, 'erro'::text]))); `pdv_notas_fiscais_venda_id_fkey` FOREIGN KEY (venda_id) REFERENCES pdv_vendas(id) ON DELETE CASCADE

Índices: `idx_pdv_nf_chave`, `idx_pdv_nf_venda`, `pdv_notas_fiscais_pkey`, `uq_pdv_nf_numeracao`

## pdv_venda_itens

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | bigint | não | `nextval('pdv_venda_itens_id_seq'::regclass)` |
| venda_id | bigint | não |  |
| seq | integer | não |  |
| product_code | integer | não |  |
| sku | text | sim |  |
| nome | text | não |  |
| referencia | text | sim |  |
| ncm | text | sim |  |
| cest | text | sim |  |
| origem | text | sim | `'0'::text` |
| unidade | text | sim | `'UN'::text` |
| quantidade | numeric | não | `1` |
| valor_unit | numeric | não | `0` |
| desconto_unit | numeric | não | `0` |
| total | numeric | não | `0` |
| epcs | jsonb | sim | `'[]'::jsonb` |

Constraints: `pdv_venda_itens_pkey` PRIMARY KEY (id); `pdv_venda_itens_venda_id_fkey` FOREIGN KEY (venda_id) REFERENCES pdv_vendas(id) ON DELETE CASCADE

Índices: `idx_pdv_venda_itens_venda`, `pdv_venda_itens_pkey`

## pdv_venda_pagamentos

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | bigint | não | `nextval('pdv_venda_pagamentos_id_seq'::regclass)` |
| venda_id | bigint | não |  |
| forma | text | não |  |
| valor | numeric | não | `0` |
| parcelas | integer | não | `1` |
| bandeira | text | sim |  |
| nsu | text | sim |  |
| autorizacao | text | sim |  |
| adquirente_cnpj | text | sim |  |
| troco | numeric | não | `0` |

Constraints: `pdv_venda_pagamentos_forma_check` CHECK ((forma = ANY (ARRAY['dinheiro'::text, 'pix'::text, 'credito'::text, 'debito'::text, 'credito_loja'::text, 'vale_troca'::text]))); `pdv_venda_pagamentos_pkey` PRIMARY KEY (id); `pdv_venda_pagamentos_venda_id_fkey` FOREIGN KEY (venda_id) REFERENCES pdv_vendas(id) ON DELETE CASCADE

Índices: `idx_pdv_venda_pag_venda`, `pdv_venda_pagamentos_pkey`

## pdv_vendas

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | bigint | não | `nextval('pdv_vendas_id_seq'::regclass)` |
| empresa | integer | não |  |
| empresa_cnpj | text | sim |  |
| empresa_nome | text | sim |  |
| tipo_venda | text | não |  |
| operacao | integer | sim |  |
| cliente_code | integer | sim |  |
| cliente_nome | text | sim |  |
| cliente_cpf_cnpj | text | sim |  |
| vendedor_code | integer | sim |  |
| vendedor_nome | text | sim |  |
| qtd_pecas | integer | não | `0` |
| subtotal | numeric | não | `0` |
| desconto | numeric | não | `0` |
| cashback_usado | numeric | não | `0` |
| cashback_gerado | numeric | não | `0` |
| total | numeric | não | `0` |
| status | text | não | `'registrada'::text` |
| nf_referenciada | text | sim |  |
| observacao | text | sim |  |
| criado_por | text | sim |  |
| criado_em | timestamp with time zone | não | `now()` |
| atualizado_em | timestamp with time zone | não | `now()` |

Constraints: `pdv_vendas_pkey` PRIMARY KEY (id); `pdv_vendas_status_check` CHECK ((status = ANY (ARRAY['registrada'::text, 'emitindo'::text, 'autorizada'::text, 'rejeitada'::text, 'cancelada'::text]))); `pdv_vendas_tipo_venda_check` CHECK ((tipo_venda = ANY (ARRAY['nfce'::text, 'nfe'::text, 'troca'::text])))

Índices: `idx_pdv_vendas_empresa_data`, `idx_pdv_vendas_status`, `pdv_vendas_pkey`

## pes_pessoa

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| code | bigint | não |  |
| cd_empresacad | integer | não |  |
| nm_pessoa | character varying | sim |  |
| dt_nascimento | date | sim |  |
| cpf | character varying | sim |  |
| rg | character varying | sim |  |
| rg_federal_agency | character varying | sim |  |
| gender | character varying | sim |  |
| marital_status | character varying | sim |  |
| nationality | character varying | sim |  |
| mother_name | character varying | sim |  |
| father_name | character varying | sim |  |
| occupation | character varying | sim |  |
| monthly_income | numeric | sim |  |
| hire_date | date | sim |  |
| ctps | character varying | sim |  |
| ctps_serial | character varying | sim |  |
| is_inactive | boolean | sim | `false` |
| suframa_code | character varying | sim |  |
| created_at | timestamp with time zone | sim | `timezone('utc'::text, now())` |
| tipo_pessoa | character varying | sim |  |
| fantasy_name | character varying | sim |  |
| uf | character varying | sim |  |
| branch_insert_code | integer | sim |  |
| insert_date | timestamp with time zone | sim |  |
| max_change_filter_date | timestamp with time zone | sim |  |
| is_customer | boolean | sim |  |
| is_supplier | boolean | sim |  |
| is_representative | boolean | sim |  |
| is_purchasing_guide | boolean | sim |  |
| is_shipping_company | boolean | sim |  |
| customer_status | character varying | sim |  |
| person_status | character varying | sim |  |
| home_page | character varying | sim |  |
| code_activity | character varying | sim |  |
| code_activity_cnae | integer | sim |  |
| code_activity_cnae2 | integer | sim |  |
| number_employees | integer | sim |  |
| monthly_invoicing | numeric | sim |  |
| share_capital | numeric | sim |  |
| type_tax_regime | character varying | sim |  |
| type_sub_tributary | character varying | sim |  |
| type_description_suframa | character varying | sim |  |
| registration_municipal | character varying | sim |  |
| description_junta_cial | character varying | sim |  |
| date_reg_junta_cial | date | sim |  |
| code_main_related | integer | sim |  |
| cpf_cnpj_main_related | character varying | sim |  |
| name_main_related | character varying | sim |  |
| telefone | character varying | sim |  |
| email | character varying | sim |  |
| phones | jsonb | sim |  |
| emails | jsonb | sim |  |
| addresses | jsonb | sim |  |
| observations | jsonb | sim |  |
| customer_observations | jsonb | sim |  |
| additional_fields | jsonb | sim |  |
| classifications | jsonb | sim |  |
| person_references | jsonb | sim |  |
| relateds | jsonb | sim |  |
| partners | jsonb | sim |  |
| shipping_company | jsonb | sim |  |
| contacts | jsonb | sim |  |
| statistics | jsonb | sim |  |
| preferences | jsonb | sim |  |
| payment_methods | jsonb | sim |  |
| social_networks | jsonb | sim |  |
| representatives | jsonb | sim |  |
| updated_at | timestamp with time zone | sim | `now()` |

Constraints: `pes_pessoa_pkey` PRIMARY KEY (cd_empresacad, code)

Índices: `idx_aniversario`, `idx_pes_pessoa_cpf`, `idx_pes_pessoa_insert_date`, `idx_pes_pessoa_is_customer`, `idx_pes_pessoa_nome`, `idx_pes_pessoa_tipo`, `pes_pessoa_pkey`

Policies: `headcoach_autenticado_tudo` (ALL → {authenticated})

## pesquisa_de_satisfacao_rh

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | integer | não |  |
| Voltaria Trabalho | text | sim |  |
| Motivo | text | sim |  |

Constraints: `Pesquisa de Satisfação - RH_pkey` PRIMARY KEY (id)

Índices: `Pesquisa de Satisfação - RH_pkey`

Policies: `a` (ALL → {public})

## pessoas_bluecred

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | bigint | não | `nextval('pessoas_bluecred_id_seq'::regclass)` |
| person_code | integer | não |  |
| person_name | text | sim |  |
| cpf | text | sim |  |
| tipo_pessoa | text | sim |  |
| classified_at | timestamp with time zone | sim |  |
| synced_at | timestamp with time zone | não | `now()` |

Constraints: `pessoas_bluecred_pkey` PRIMARY KEY (id); `uq_pbc_person_code` UNIQUE (person_code)

Índices: `idx_pbc_classified_at`, `pessoas_bluecred_pkey`, `uq_pbc_person_code`

## prescription

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | bigint | não |  |
| patient_id | uuid | não |  |
| professional_id | uuid | não |  |
| user_id | uuid | não |  |
| type | USER-DEFINED | não |  |
| start_date | date | não |  |
| end_date | date | sim |  |
| observation | text | sim |  |
| created_at | timestamp with time zone | não | `now()` |
| updated_at | timestamp with time zone | não | `now()` |

Constraints: `prescription_patient_id_fkey` FOREIGN KEY (patient_id) REFERENCES patient(id) ON UPDATE CASCADE ON DELETE RESTRICT; `prescription_pkey` PRIMARY KEY (id); `prescription_professional_id_fkey` FOREIGN KEY (professional_id) REFERENCES professional(id) ON UPDATE CASCADE ON DELETE RESTRICT; `prescription_user_id_fkey` FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT

Índices: `idx_prescription_created_at`, `idx_prescription_patient_id`, `idx_prescription_professional_id`, `idx_prescription_start_date`, `idx_prescription_type`, `idx_prescription_user_id`, `prescription_pkey`

Policies: `prescription_all` (ALL → {authenticated})

## processo_seletivo

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | character varying | não |  |
| name | character varying | sim | `NULL::character varying` |
| Vaga | character varying | sim | `NULL::character varying` |
| Cidade | character varying | sim | `NULL::character varying` |
| Estado | character varying | sim | `NULL::character varying` |
| Gênero | character varying | sim | `NULL::character varying` |
| Status | character varying | sim | `NULL::character varying` |
| Passos | character varying | sim | `NULL::character varying` |
| parent | character varying | sim | `NULL::character varying` |
| setor | character varying | sim | `NULL::character varying` |

Constraints: `processo_seletivo_pkey` PRIMARY KEY (id)

Índices: `processo_seletivo_pkey`

Policies: `a` (ALL → {public})

## products

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |
| name | text | não |  |
| description | text | sim |  |
| price | numeric | não |  |
| category | text | não |  |
| subcategory | text | sim |  |
| image_url | text | sim |  |
| available | boolean | sim | `true` |
| created_at | timestamp with time zone | sim | `now()` |
| images | jsonb | sim |  |

Constraints: `products_pkey` PRIMARY KEY (id)

Índices: `products_pkey`

Policies: `public_read_products` (SELECT → {public})

## profession

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | smallint | não |  |
| name | text | não |  |
| description | text | sim |  |
| active | boolean | não | `true` |
| created_at | timestamp with time zone | não | `now()` |
| updated_at | timestamp with time zone | não | `now()` |

Constraints: `profession_name_key` UNIQUE (name); `profession_pkey` PRIMARY KEY (id)

Índices: `idx_profession_active`, `idx_profession_name`, `profession_name_key`, `profession_pkey`

Policies: `profession_all` (ALL → {authenticated})

## professional

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |
| user_id | uuid | não |  |
| profession_id | smallint | não |  |
| registration_number | text | não |  |
| registration_state | text | sim |  |
| specialization | text | sim |  |
| phone | text | sim |  |
| active | boolean | não | `true` |
| created_at | timestamp with time zone | não | `now()` |
| updated_at | timestamp with time zone | não | `now()` |

Constraints: `professional_pkey` PRIMARY KEY (id); `professional_profession_id_fkey` FOREIGN KEY (profession_id) REFERENCES profession(id) ON UPDATE CASCADE ON DELETE RESTRICT; `professional_user_id_fkey` FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT; `professional_user_id_profession_id_key` UNIQUE (user_id, profession_id)

Índices: `idx_professional_active`, `idx_professional_phone`, `idx_professional_profession_id`, `idx_professional_registration_number`, `idx_professional_user_id`, `professional_pkey`, `professional_user_id_profession_id_key`

Policies: `professional_all` (ALL → {authenticated})

## promocao_grupos

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | bigint | não | `nextval('promocao_grupos_id_seq'::regclass)` |
| nome | text | não |  |
| data_inicio | timestamp with time zone | não |  |
| data_fim | timestamp with time zone | não |  |
| desconto_tipo | character varying | não | `'valor'::character varying` |
| desconto_valor | numeric | não |  |
| compra_minima | numeric | não | `0` |
| prefix_code | text | não | `'PROMO'::text` |
| print_template_code | integer | não | `1` |
| branch_code_registration | integer | não | `90` |
| participant_branches | jsonb | não | `'[2, 5, 55, 65, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98]'::jsonb` |
| cancelado | boolean | não | `false` |
| criado_em | timestamp with time zone | não | `now()` |
| criado_por | text | sim |  |

Constraints: `promocao_grupos_desconto_tipo_chk` CHECK (((desconto_tipo)::text = ANY ((ARRAY['valor'::character varying, 'percentual'::character varying])::text[]))); `promocao_grupos_pkey` PRIMARY KEY (id)

Índices: `idx_promocao_grupos_periodo`, `promocao_grupos_pkey`

## promocao_vouchers

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | bigint | não | `nextval('promocao_vouchers_id_seq'::regclass)` |
| grupo_id | bigint | não |  |
| customer_code | bigint | não |  |
| customer_cpf_cnpj | text | sim |  |
| customer_name | text | sim |  |
| voucher_number | bigint | sim |  |
| voucher_code | text | sim |  |
| desconto_tipo | character varying | sim |  |
| valor | numeric | sim |  |
| start_date | timestamp with time zone | sim |  |
| end_date | timestamp with time zone | sim |  |
| criado_em | timestamp with time zone | não | `now()` |
| criado_por | text | sim |  |

Constraints: `promocao_vouchers_grupo_id_customer_code_key` UNIQUE (grupo_id, customer_code); `promocao_vouchers_grupo_id_fkey` FOREIGN KEY (grupo_id) REFERENCES promocao_grupos(id) ON DELETE CASCADE; `promocao_vouchers_pkey` PRIMARY KEY (id)

Índices: `idx_promocao_vouchers_grupo`, `promocao_vouchers_grupo_id_customer_code_key`, `promocao_vouchers_pkey`

## reach_instagram

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | bigint | não |  |
| reach | bigint | não |  |
| end_time | timestamp with time zone | não |  |

Constraints: `reach_instagram_pkey` PRIMARY KEY (id)

Índices: `reach_instagram_pkey`

Policies: `a` (ALL → {public})

## recuperacao_credito_anexos

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | bigint | não | `nextval('recuperacao_credito_anexos_id_seq'::regclass)` |
| cd_cliente | character varying | não |  |
| nome_arquivo | text | não |  |
| file_path | text | não |  |
| tipo | text | sim |  |
| uploaded_by | text | sim |  |
| created_at | timestamp with time zone | sim | `now()` |

Constraints: `recuperacao_credito_anexos_pkey` PRIMARY KEY (id)

Índices: `idx_rec_credito_anexos_cliente`, `recuperacao_credito_anexos_pkey`

Policies: `Allow all for recuperacao_credito_anexos` (ALL → {public}); `headcoach_autenticado_tudo` (ALL → {authenticated})

## recuperacao_credito_status

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | bigint | não | `nextval('recuperacao_credito_status_id_seq'::regclass)` |
| cd_cliente | character varying | não |  |
| nm_cliente | character varying | sim |  |
| status | character varying | não | `'PROTESTO'::character varying` |
| updated_at | timestamp with time zone | sim | `now()` |
| updated_by | text | sim |  |

Constraints: `recuperacao_credito_status_cd_cliente_key` UNIQUE (cd_cliente); `recuperacao_credito_status_pkey` PRIMARY KEY (id)

Índices: `idx_rec_credito_status_cliente`, `recuperacao_credito_status_cd_cliente_key`, `recuperacao_credito_status_pkey`

Policies: `Allow all for recuperacao_credito_status` (ALL → {public}); `headcoach_autenticado_tudo` (ALL → {authenticated})

## retorno_bancario

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | bigint | não | `nextval('retorno_bancario_id_seq'::regclass)` |
| nome_arquivo | character varying | não |  |
| data_upload | timestamp with time zone | não |  |
| valor | numeric | não |  |
| banco_nome | character varying | não |  |
| banco_codigo | character varying | não |  |
| banco_layout | character varying | não |  |
| agencia | character varying | não |  |
| conta | character varying | não |  |
| saldo_formatado | character varying | não |  |
| data_processamento | timestamp with time zone | não |  |
| created_at | timestamp with time zone | sim | `now()` |
| updated_at | timestamp with time zone | sim | `now()` |
| data_geracao | timestamp with time zone | sim |  |
| operacao_tipo | character varying | sim |  |
| operacao_descricao | character varying | sim |  |
| operacao_sinal | character varying | sim |  |
| operacao_is_positive | boolean | sim |  |
| operacao_valor_absoluto | numeric | sim |  |
| chq_especial | numeric | sim |  |
| usuario_inseriu | character varying | sim |  |

Constraints: `retorno_bancario_pkey` PRIMARY KEY (id)

Índices: `idx_retorno_bancario_banco_nome`, `idx_retorno_bancario_created_at`, `idx_retorno_bancario_data_upload`, `idx_retorno_bancario_nome_arquivo`, `idx_retorno_bancario_operacao_is_positive`, `idx_retorno_bancario_operacao_tipo`, `idx_retorno_bancario_unique_file`, `idx_retorno_bancario_valor`, `retorno_bancario_pkey`

Policies: `Permitir atualização de chq_especial` (UPDATE → {public}); `Permitir atualização de saldos manuais` (UPDATE → {public}); `Permitir exclusão de saldos manuais` (DELETE → {public}); `Permitir inserção/atualização de chq_especial` (INSERT → {public}); `Permitir leitura de chq_especial` (SELECT → {public})

## rh_documentos_admissao

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | bigint | não | `nextval('rh_documentos_admissao_id_seq'::regclass)` |
| nome | text | não |  |
| email_pessoal | text | sim |  |
| contato_pessoal | text | sim |  |
| contato_emergencia | text | sim |  |
| pis | text | sim |  |
| documentos | jsonb | não | `'{}'::jsonb` |
| origem | text | sim | `'lp_admissao'::text` |
| ip | text | sim |  |
| user_agent | text | sim |  |
| status | text | não | `'novo'::text` |
| observacao | text | sim |  |
| criado_em | timestamp with time zone | não | `now()` |
| atualizado_em | timestamp with time zone | não | `now()` |

Constraints: `rh_documentos_admissao_pkey` PRIMARY KEY (id)

Índices: `idx_rh_doc_adm_criado`, `idx_rh_doc_adm_nome`, `idx_rh_doc_adm_status`, `rh_documentos_admissao_pkey`

## rh_inscricoes

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | bigint | não | `nextval('rh_inscricoes_id_seq'::regclass)` |
| vaga_id | bigint | sim |  |
| vaga_slug | text | sim |  |
| nome | text | não |  |
| email | text | sim |  |
| telefone | text | sim |  |
| cargo | text | sim |  |
| cidade | text | sim |  |
| estado | text | sim |  |
| indicacao | text | sim |  |
| indicado_por | text | sim |  |
| curriculo_path | text | sim |  |
| curriculo_nome | text | sim |  |
| origem | text | sim | `'lp_vagas'::text` |
| ip | text | sim |  |
| user_agent | text | sim |  |
| status | text | não | `'novo'::text` |
| observacao | text | sim |  |
| criado_em | timestamp with time zone | não | `now()` |
| atualizado_em | timestamp with time zone | não | `now()` |

Constraints: `rh_inscricoes_pkey` PRIMARY KEY (id); `rh_inscricoes_vaga_id_fkey` FOREIGN KEY (vaga_id) REFERENCES rh_vagas(id) ON DELETE SET NULL

Índices: `idx_rh_inscricoes_criado`, `idx_rh_inscricoes_status`, `idx_rh_inscricoes_vaga`, `rh_inscricoes_pkey`

## rh_vagas

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | bigint | não | `nextval('rh_vagas_id_seq'::regclass)` |
| slug | text | não |  |
| titulo | text | não |  |
| cargo | text | sim |  |
| cidade | text | sim |  |
| estado | text | sim |  |
| tipo_contratacao | text | sim |  |
| descricao | text | sim |  |
| requisitos | text | sim |  |
| beneficios | text | sim |  |
| ativo | boolean | não | `true` |
| criado_em | timestamp with time zone | não | `now()` |
| atualizado_em | timestamp with time zone | não | `now()` |

Constraints: `rh_vagas_pkey` PRIMARY KEY (id); `rh_vagas_slug_key` UNIQUE (slug)

Índices: `idx_rh_vagas_ativo`, `idx_rh_vagas_criado`, `idx_rh_vagas_slug`, `rh_vagas_pkey`, `rh_vagas_slug_key`

## role_page_perms

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| profile_id | integer | não |  |
| page_id | integer | não |  |
| can_read | boolean | não | `false` |
| can_create | boolean | não | `false` |
| can_update | boolean | não | `false` |
| can_delete | boolean | não | `false` |
| created_at | timestamp with time zone | não | `now()` |
| updated_at | timestamp with time zone | não | `now()` |

Constraints: `role_page_perms_page_id_fkey` FOREIGN KEY (page_id) REFERENCES pages(id) ON DELETE CASCADE; `role_page_perms_pk` PRIMARY KEY (profile_id, page_id); `role_page_perms_profile_id_fkey` FOREIGN KEY (profile_id) REFERENCES user_profiles(id) ON DELETE CASCADE

Índices: `idx_role_page_perms_page`, `idx_role_page_perms_role_read`, `role_page_perms_pk`

Policies: `role_page_perms_all` (ALL → {authenticated}); `role_page_perms_select` (SELECT → {authenticated})

## sac_franquias

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| idLead | character varying | não |  |
| situação | character varying | sim |  |
| categoria | character varying | sim |  |
| setor | character varying | sim |  |
| status | character varying | não |  |
| dataDaSoliciticao | date | não |  |
| motivo | text | sim |  |
| dataDeValidade | character varying | sim |  |

Constraints: `SAC Franquias_pkey` PRIMARY KEY ("idLead")

Índices: `SAC Franquias_pkey`

Policies: `a` (ALL → {public})

## saldo_bancario

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| banco | text | não |  |
| valor | numeric | não | `0` |
| updated_at | timestamp with time zone | sim | `now()` |
| updated_by | text | sim |  |

Constraints: `saldo_bancario_pkey` PRIMARY KEY (banco)

Índices: `saldo_bancario_pkey`

Policies: `saldo_bancario_all` (ALL → {public}); `saldo_bancario_select` (SELECT → {public})

## sales_closing_records

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | bigint | não |  |
| mes | text | não |  |
| canal | text | não |  |
| s1 | numeric | não | `0` |
| s2 | numeric | não | `0` |
| s3 | numeric | não | `0` |
| s4 | numeric | não | `0` |
| s5 | numeric | não | `0` |
| total_mes | numeric | não | `0` |
| detalhe | jsonb | não | `'[]'::jsonb` |
| fechado | boolean | não | `false` |
| datemin | date | sim |  |
| datemax | date | sim |  |
| atualizado_em | timestamp with time zone | não | `now()` |

Constraints: `sales_closing_records_mes_canal_key` UNIQUE (mes, canal); `sales_closing_records_pkey` PRIMARY KEY (id)

Índices: `idx_sales_closing_mes`, `sales_closing_records_mes_canal_key`, `sales_closing_records_pkey`

## schema_migrations

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| name | text | não |  |
| checksum | text | sim |  |
| applied_at | timestamp with time zone | não | `now()` |

Constraints: `schema_migrations_pkey` PRIMARY KEY (name)

Índices: `schema_migrations_pkey`

## sefaz_dfe_controle

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| cnpj | text | não |  |
| descricao | text | sim |  |
| ult_nsu | bigint | sim | `0` |
| max_nsu | bigint | sim | `0` |
| ultima_consulta | timestamp with time zone | sim |  |
| ultimo_cstat | text | sim |  |
| ultimo_xmotivo | text | sim |  |
| bloqueado_ate | timestamp with time zone | sim |  |
| atualizado_em | timestamp with time zone | sim | `now()` |

Constraints: `sefaz_dfe_controle_pkey` PRIMARY KEY (cnpj)

Índices: `sefaz_dfe_controle_pkey`

## sefaz_dfe_notas

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | bigint | não |  |
| cnpj_destinatario | text | não |  |
| chave_acesso | text | não |  |
| nsu | bigint | sim |  |
| emitente_cnpj | text | sim |  |
| emitente_nome | text | sim |  |
| emitente_ie | text | sim |  |
| data_emissao | timestamp with time zone | sim |  |
| tipo_operacao | text | sim |  |
| valor_total | numeric | sim |  |
| situacao | text | sim |  |
| manifestacao | text | sim |  |
| manifestacao_descricao | text | sim |  |
| schema_origem | text | sim |  |
| xml_completo | boolean | sim | `false` |
| xml | text | sim |  |
| criado_em | timestamp with time zone | sim | `now()` |
| atualizado_em | timestamp with time zone | sim | `now()` |
| empresa_codigo | integer | sim |  |
| empresa_nome | text | sim |  |
| escriturada | boolean | sim | `false` |
| nr_fatura | text | sim |  |
| dt_fatura | date | sim |  |

Constraints: `sefaz_dfe_notas_cnpj_destinatario_chave_acesso_key` UNIQUE (cnpj_destinatario, chave_acesso); `sefaz_dfe_notas_pkey` PRIMARY KEY (id)

Índices: `idx_sefaz_dfe_notas_dt`, `idx_sefaz_dfe_notas_emp`, `idx_sefaz_dfe_notas_escr`, `sefaz_dfe_notas_cnpj_destinatario_chave_acesso_key`, `sefaz_dfe_notas_pkey`

## setor_usuarios

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |
| setor_id | uuid | não |  |
| user_id | uuid | não |  |
| created_at | timestamp with time zone | sim | `now()` |
| created_by | uuid | sim |  |

Constraints: `setor_usuarios_created_by_fkey` FOREIGN KEY (created_by) REFERENCES auth.users(id); `setor_usuarios_pkey` PRIMARY KEY (id); `setor_usuarios_setor_id_fkey` FOREIGN KEY (setor_id) REFERENCES setores(id) ON DELETE CASCADE; `setor_usuarios_user_id_fkey` FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE; `unique_setor_usuario` UNIQUE (setor_id, user_id)

Índices: `idx_setor_usuarios_setor_id`, `idx_setor_usuarios_user_id`, `setor_usuarios_pkey`, `unique_setor_usuario`

Policies: `Authenticated can view setor_usuarios` (SELECT → {authenticated}); `Only owners can modify setor_usuarios` (ALL → {public})

## setores

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |
| nome | text | não |  |
| ordem | integer | não | `0` |
| gestor_id | uuid | sim |  |
| created_at | timestamp with time zone | sim | `now()` |
| updated_at | timestamp with time zone | sim | `now()` |

Constraints: `setores_gestor_id_fkey` FOREIGN KEY (gestor_id) REFERENCES auth.users(id) ON DELETE SET NULL; `setores_nome_key` UNIQUE (nome); `setores_pkey` PRIMARY KEY (id)

Índices: `idx_setores_gestor_id`, `setores_nome_key`, `setores_pkey`

Policies: `Authenticated can view setores` (SELECT → {authenticated}); `Only owners can modify setores` (ALL → {public})

## sms_enviados

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | bigint | não | `nextval('sms_enviados_id_seq'::regclass)` |
| numero | character varying | não |  |
| cd_cliente | character varying | sim |  |
| prioridade | character varying | não | `'NORMAL'::character varying` |
| mensagem | text | sim |  |
| codigo_status | character varying | sim |  |
| enviado_em | timestamp with time zone | sim | `now()` |
| status | character varying | não | `'ACEITO'::character varying` |
| motivo | text | sim |  |
| nm_cliente | character varying | sim |  |

Constraints: `sms_enviados_pkey` PRIMARY KEY (id)

Índices: `idx_sms_enviados_numero_data`, `idx_sms_enviados_status`, `sms_enviados_pkey`

## solicitacoes_baixa

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |
| cd_empresa | integer | não |  |
| cd_cliente | integer | não |  |
| nm_cliente | text | sim |  |
| nr_fat | integer | não |  |
| nr_parcela | integer | não | `1` |
| vl_fatura | numeric | não |  |
| vl_juros | numeric | sim | `0` |
| dt_vencimento | date | sim |  |
| dt_emissao | date | sim |  |
| cd_portador | integer | sim |  |
| nm_portador | text | sim |  |
| comprovante_url | text | sim |  |
| comprovante_path | text | sim |  |
| status | text | não | `'pendente'::text` |
| user_id | uuid | sim |  |
| user_nome | text | sim |  |
| user_email | text | sim |  |
| observacao | text | sim |  |
| motivo_rejeicao | text | sim |  |
| processado_por | uuid | sim |  |
| processado_em | timestamp with time zone | sim |  |
| created_at | timestamp with time zone | sim | `now()` |
| updated_at | timestamp with time zone | sim | `now()` |
| dt_pagamento | date | sim |  |
| forma_pagamento | text | sim |  |
| dados_cartao | jsonb | sim |  |
| baixa_confirmada | boolean | sim | `false` |
| baixa_confirmada_em | timestamp with time zone | sim |  |
| baixa_confirmada_por | text | sim |  |
| anexo_url | text | sim |  |
| anexo_path | text | sim |  |
| anexo_nome | text | sim |  |
| origem | text | sim |  |
| ref_externa | text | sim |  |

Constraints: `solicitacoes_baixa_pkey` PRIMARY KEY (id); `solicitacoes_baixa_processado_por_fkey` FOREIGN KEY (processado_por) REFERENCES auth.users(id); `solicitacoes_baixa_status_check` CHECK ((status = ANY (ARRAY['pendente'::text, 'aprovada'::text, 'rejeitada'::text, 'processada'::text]))); `solicitacoes_baixa_user_id_fkey` FOREIGN KEY (user_id) REFERENCES auth.users(id)

Índices: `idx_solicitacoes_baixa_cd_cliente`, `idx_solicitacoes_baixa_cd_portador`, `idx_solicitacoes_baixa_created_at`, `idx_solicitacoes_baixa_origem`, `idx_solicitacoes_baixa_status`, `idx_solicitacoes_baixa_user_id`, `solicitacoes_baixa_pkey`, `ux_solicitacoes_baixa_ref_externa`

Policies: `Authenticated users can insert solicitacoes_baixa` (INSERT → {public}); `Authenticated users can update solicitacoes_baixa` (UPDATE → {public}); `Authenticated users can view all solicitacoes_baixa` (SELECT → {public}); `headcoach_autenticado_tudo` (ALL → {authenticated}); `liberado` (ALL → {public})

## solicitacoes_credito

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |
| cd_empresa | integer | não |  |
| nm_empresa | text | sim |  |
| cd_pessoa | integer | sim |  |
| vl_credito | numeric | não |  |
| forma_pagamento | text | não |  |
| nr_parcelas | integer | sim | `1` |
| motivo | text | não |  |
| titulos_vencidos | jsonb | sim | `'[]'::jsonb` |
| titulos_a_vencer | jsonb | sim | `'[]'::jsonb` |
| user_id | uuid | sim |  |
| user_email | text | sim |  |
| user_nome | text | sim |  |
| status | text | não | `'ANALISE'::text` |
| dt_solicitacao | timestamp with time zone | sim | `now()` |
| dt_aprovacao | timestamp with time zone | sim |  |
| aprovado_por | uuid | sim |  |
| motivo_reprovacao | text | sim |  |
| created_at | timestamp with time zone | sim | `now()` |
| updated_at | timestamp with time zone | sim | `now()` |
| user_aprovador | text | sim |  |
| contraproposta | jsonb | sim |  |
| historico_negociacao | ARRAY | sim | `ARRAY[]::jsonb[]` |

Constraints: `solicitacoes_credito_aprovado_por_fkey` FOREIGN KEY (aprovado_por) REFERENCES auth.users(id); `solicitacoes_credito_pkey` PRIMARY KEY (id); `solicitacoes_credito_status_check` CHECK ((status = ANY (ARRAY['ANALISE'::text, 'CONTRAPROPOSTA'::text, 'AGUARDANDO_ACEITE'::text, 'APROVADO'::text, 'REPROVADO'::text]))); `solicitacoes_credito_user_id_fkey` FOREIGN KEY (user_id) REFERENCES auth.users(id)

Índices: `idx_solicitacoes_credito_cd_empresa`, `idx_solicitacoes_credito_dt_solicitacao`, `idx_solicitacoes_credito_status`, `idx_solicitacoes_credito_user_id`, `solicitacoes_credito_pkey`

Policies: `Admins podem atualizar solicitações` (UPDATE → {public}); `Usuários podem criar solicitações` (INSERT → {public}); `Usuários podem ver solicitações` (SELECT → {public}); `headcoach_autenticado_tudo` (ALL → {authenticated}); `liberacao` (ALL → {public})

## solicitacoes_crosby

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |
| cd_empresa | integer | não |  |
| nm_empresa | text | sim |  |
| solicitante | text | não |  |
| tipo_solicitacao | text | não |  |
| nivel_urgencia | text | não |  |
| descricao | text | não |  |
| observacao | text | sim |  |
| status | text | não | `'pendente'::text` |
| data_solicitacao | timestamp with time zone | sim | `now()` |
| data_conclusao | timestamp with time zone | sim |  |
| concluido_por | uuid | sim |  |
| concluido_por_nome | text | sim |  |
| observacao_conclusao | text | sim |  |
| created_at | timestamp with time zone | sim | `now()` |
| updated_at | timestamp with time zone | sim | `now()` |
| solicitante_email | text | sim |  |
| branch_cnpj | text | sim |  |
| supplier_cpf_cnpj | text | sim |  |
| supplier_name | text | sim |  |
| duplicate_code | bigint | sim |  |
| valor_total | numeric | sim |  |
| dt_emissao | date | sim |  |
| dt_vencimento | date | sim |  |
| dt_chegada | date | sim |  |
| document_type | text | sim |  |
| prevision_type | text | sim |  |
| stage_type | text | sim |  |
| payload_totvs | jsonb | sim |  |
| aprovado_gestor_em | timestamp with time zone | sim |  |
| aprovado_gestor_por | uuid | sim |  |
| aprovado_gestor_por_nome | text | sim |  |
| aprovado_financeiro_em | timestamp with time zone | sim |  |
| aprovado_financeiro_por | uuid | sim |  |
| aprovado_financeiro_por_nome | text | sim |  |
| enviado_totvs_em | timestamp with time zone | sim |  |
| totvs_response | jsonb | sim |  |
| totvs_erro | text | sim |  |
| rejeitado_em | timestamp with time zone | sim |  |
| rejeitado_por | uuid | sim |  |
| rejeitado_por_nome | text | sim |  |
| motivo_rejeicao | text | sim |  |
| forma_pagamento | text | sim |  |
| comprovante_url | text | sim |  |
| link_exemplo | text | sim |  |
| imagens_exemplo_urls | jsonb | sim | `'[]'::jsonb` |
| contatos_prestadores | jsonb | sim | `'[]'::jsonb` |
| setor | text | sim |  |
| status_secundario | text | sim |  |
| comprovante_gestor_url | text | sim |  |
| comprovante_fabio_url | text | sim |  |
| despesa_code | integer | sim |  |
| marca_modelo | text | sim |  |
| recomendacao_fornecedores | text | sim |  |
| chave_pix | text | sim |  |
| codigo_barras | text | sim |  |
| cost_center_code | integer | sim |  |
| rateio_percentual | numeric | sim |  |
| liberado_pagamento_em | timestamp with time zone | sim |  |
| liberado_pagamento_por | uuid | sim |  |
| liberado_pagamento_por_nome | text | sim |  |
| pagamento_liberacao_id | uuid | sim |  |
| user_id | uuid | sim |  |
| pago_em | timestamp with time zone | sim |  |
| pago_por | uuid | sim |  |
| pago_por_nome | text | sim |  |
| tem_nota_fiscal | boolean | sim |  |
| nota_fiscal_url | text | sim |  |
| nota_fiscal_path | text | sim |  |

Constraints: `solicitacoes_crosby_concluido_por_fkey` FOREIGN KEY (concluido_por) REFERENCES auth.users(id); `solicitacoes_crosby_pagamento_liberacao_id_fkey` FOREIGN KEY (pagamento_liberacao_id) REFERENCES pagamentos_liberacao(id) ON DELETE SET NULL; `solicitacoes_crosby_pkey` PRIMARY KEY (id); `solicitacoes_crosby_status_check` CHECK ((status = ANY (ARRAY['pendente'::text, 'aprovado_gestor'::text, 'aprovado_financeiro'::text, 'enviado_totvs'::text, 'nota_fiscal'::text, 'erro_envio'::text, 'rejeitado'::text, 'cancelada'::text]))); `solicitacoes_crosby_status_secundario_check` CHECK (((status_secundario IS NULL) OR (status_secundario = ANY (ARRAY['em_processo'::text, 'orcado'::text, 'contratado'::text, 'finalizado'::text])))); `solicitacoes_crosby_tipo_solicitacao_check` CHECK ((tipo_solicitacao = ANY (ARRAY['pagamento'::text, 'reembolso'::text, 'compra'::text, 'manutencao'::text, 'rh'::text]))); `solicitacoes_crosby_user_id_fkey` FOREIGN KEY (user_id) REFERENCES auth.users(id)

Índices: `idx_solic_crosby_data`, `idx_solic_crosby_empresa`, `idx_solic_crosby_status`, `idx_solic_crosby_tipo`, `idx_solic_crosby_user_id`, `idx_solicitacoes_crosby_cd_empresa`, `idx_solicitacoes_crosby_data_solicitacao`, `idx_solicitacoes_crosby_pagamento_liberacao_id`, `idx_solicitacoes_crosby_status`, `idx_solicitacoes_crosby_tipo`, `solicitacoes_crosby_pkey`

Policies: `Authenticated can delete solicitacoes_crosby` (DELETE → {authenticated}); `Authenticated can update solicitacoes_crosby` (UPDATE → {authenticated}); `Authenticated can view solicitacoes_crosby` (SELECT → {authenticated}); `Public can insert solicitacoes_crosby` (INSERT → {anon,authenticated}); `headcoach_autenticado_tudo` (ALL → {authenticated})

## solicitacoes_remessa

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |
| nr_remessa | integer | não | `nextval('solicitacoes_remessa_nr_remessa_seq'::regclass)` |
| user_id | uuid | sim |  |
| user_nome | text | não |  |
| user_email | text | sim |  |
| vl_total | numeric | não | `0` |
| qt_titulos | integer | não | `0` |
| created_at | timestamp with time zone | sim | `now()` |
| updated_at | timestamp with time zone | sim | `now()` |
| status | text | não | `'EM ANALISE'::text` |

Constraints: `solicitacoes_remessa_pkey` PRIMARY KEY (id); `solicitacoes_remessa_status_check` CHECK ((status = ANY (ARRAY['EM ANALISE'::text, 'APROVADA'::text, 'REPROVADA'::text]))); `solicitacoes_remessa_user_id_fkey` FOREIGN KEY (user_id) REFERENCES auth.users(id)

Índices: `solicitacoes_remessa_pkey`

Policies: `Permitir atualização para todos autenticados` (UPDATE → {authenticated}); `Permitir inserção para todos autenticados` (INSERT → {authenticated}); `Permitir leitura para todos autenticados` (SELECT → {authenticated}); `Service role full access remessa` (ALL → {service_role}); `headcoach_autenticado_tudo` (ALL → {authenticated})

## solicitacoes_remessa_titulos

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |
| remessa_id | uuid | não |  |
| cd_empresa | integer | sim |  |
| cd_cliente | integer | sim |  |
| nm_cliente | text | sim |  |
| nr_cpfcnpj | text | sim |  |
| nr_fat | integer | sim |  |
| nr_parcela | integer | sim |  |
| cd_portador | integer | sim |  |
| nm_portador | text | sim |  |
| vl_fatura | numeric | não | `0` |
| dt_emissao | date | sim |  |
| dt_vencimento | date | sim |  |
| titulo_key | text | não |  |
| created_at | timestamp with time zone | sim | `now()` |

Constraints: `solicitacoes_remessa_titulos_pkey` PRIMARY KEY (id); `solicitacoes_remessa_titulos_remessa_id_fkey` FOREIGN KEY (remessa_id) REFERENCES solicitacoes_remessa(id) ON DELETE CASCADE

Índices: `idx_remessa_titulo_unique`, `idx_remessa_titulos_remessa_id`, `solicitacoes_remessa_titulos_pkey`

Policies: `Permitir inserção para todos autenticados` (INSERT → {authenticated}); `Permitir leitura para todos autenticados` (SELECT → {authenticated}); `Service role full access remessa_titulos` (ALL → {service_role}); `headcoach_autenticado_tudo` (ALL → {authenticated})

## solicitacoes_renegociacoes

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |
| cd_empresa | text | não |  |
| nm_empresa | text | não |  |
| cd_pessoa | integer | sim |  |
| faturas_selecionadas | jsonb | não |  |
| vl_total | numeric | não |  |
| forma_pagamento | text | não |  |
| nr_parcelas | integer | sim |  |
| vl_parcela | numeric | sim |  |
| motivo | text | não |  |
| user_id | uuid | não |  |
| user_email | text | não |  |
| user_nome | text | sim |  |
| status | text | não | `'ANALISE'::text` |
| dt_solicitacao | timestamp with time zone | sim | `now()` |
| dt_aprovacao | timestamp with time zone | sim |  |
| aprovado_por | uuid | sim |  |
| user_aprovador | text | sim |  |
| motivo_reprovacao | text | sim |  |
| contraproposta | jsonb | sim |  |
| historico_negociacao | ARRAY | sim | `'{}'::jsonb[]` |

Constraints: `fk_user` FOREIGN KEY (user_id) REFERENCES auth.users(id); `solicitacoes_renegociacoes_pkey` PRIMARY KEY (id); `solicitacoes_renegociacoes_status_check` CHECK ((status = ANY (ARRAY['ANALISE'::text, 'APROVADO'::text, 'REPROVADO'::text, 'CONTRAPROPOSTA'::text, 'AGUARDANDO_ACEITE'::text])))

Índices: `idx_renegociacoes_cd_empresa`, `idx_renegociacoes_dt_solicitacao`, `idx_renegociacoes_status`, `idx_renegociacoes_user_id`, `solicitacoes_renegociacoes_pkey`

Policies: `Permitir atualização para admins` (UPDATE → {authenticated}); `Permitir inserção para usuários autenticados` (INSERT → {authenticated}); `Permitir leitura para usuários autenticados` (SELECT → {authenticated}); `headcoach_autenticado_tudo` (ALL → {authenticated})

## tag

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |
| name | text | não |  |
| page | text | não |  |
| color | character varying | não | `'#6b7280'::character varying` |
| created_at | timestamp with time zone | não | `now()` |
| updated_at | timestamp with time zone | não | `now()` |

Constraints: `tag_color_chk` CHECK (((color)::text ~ '^#[0-9A-Fa-f]{6}$'::text)); `tag_page_chk` CHECK ((page = ANY (ARRAY['client'::text, 'hr'::text]))); `tag_pkey` PRIMARY KEY (id)

Índices: `idx_tag_page`, `tag_pkey`, `ux_tag_name_lower`

Policies: `tag_all` (ALL → {authenticated})

## tech_chips

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | integer | não | `nextval('tech_chips_id_seq'::regclass)` |
| numero | text | não |  |
| numero_clean | text | não |  |
| responsavel | text | sim |  |
| setor | text | sim |  |
| local_uso | text | sim |  |
| operadora | character varying | sim |  |
| plano | text | sim |  |
| iccid | text | sim |  |
| status | character varying | não | `'ativo'::character varying` |
| data_aquisicao | date | sim |  |
| data_cancelamento | date | sim |  |
| observacao | text | sim |  |
| criado_em | timestamp with time zone | não | `now()` |
| atualizado_em | timestamp with time zone | não | `now()` |
| criado_por | text | sim |  |
| atualizado_por | text | sim |  |
| valor_plano | numeric | sim |  |
| tem_api | boolean | não | `false` |
| tem_whatsapp | boolean | não | `false` |
| motivo_cancelamento | text | sim |  |
| whatsapp_nome | text | sim |  |
| whatsapp_foto | text | sim |  |

Constraints: `tech_chips_numero_clean_key` UNIQUE (numero_clean); `tech_chips_pkey` PRIMARY KEY (id)

Índices: `idx_tech_chips_operadora`, `idx_tech_chips_responsavel`, `idx_tech_chips_setor`, `idx_tech_chips_status`, `tech_chips_numero_clean_key`, `tech_chips_pkey`

## tech_chips_log

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | integer | não | `nextval('tech_chips_log_id_seq'::regclass)` |
| chip_id | integer | sim |  |
| acao | character varying | não |  |
| campo_alterado | text | sim |  |
| valor_anterior | text | sim |  |
| valor_novo | text | sim |  |
| alterado_em | timestamp with time zone | não | `now()` |
| alterado_por | text | sim |  |

Constraints: `tech_chips_log_chip_id_fkey` FOREIGN KEY (chip_id) REFERENCES tech_chips(id) ON DELETE CASCADE; `tech_chips_log_pkey` PRIMARY KEY (id)

Índices: `idx_tech_chips_log_chip`, `tech_chips_log_pkey`

## tech_cotacoes

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | bigint | não | `nextval('tech_cotacoes_id_seq'::regclass)` |
| titulo | text | não |  |
| descricao | text | sim |  |
| quantidade | numeric | não | `1` |
| unidade | text | sim | `'un'::text` |
| status | text | não | `'rascunho'::text` |
| fornecedor_escolhido_id | bigint | sim |  |
| solicitante | text | sim |  |
| urgencia | text | sim | `'normal'::text` |
| data_necessidade | date | sim |  |
| observacao | text | sim |  |
| criado_por | text | sim |  |
| criado_em | timestamp with time zone | não | `now()` |
| atualizado_em | timestamp with time zone | não | `now()` |
| categoria | text | não | `'compras'::text` |

Constraints: `fk_tech_cot_escolhido` FOREIGN KEY (fornecedor_escolhido_id) REFERENCES tech_cotacoes_fornecedores(id) ON DELETE SET NULL; `tech_cotacoes_categoria_check` CHECK ((categoria = ANY (ARRAY['compras'::text, 'patrimonio'::text, 'uso_consumo'::text, 'tecnologia'::text]))); `tech_cotacoes_pkey` PRIMARY KEY (id); `tech_cotacoes_status_check` CHECK ((status = ANY (ARRAY['rascunho'::text, 'cotando'::text, 'escolhido'::text, 'comprado'::text, 'cancelado'::text]))); `tech_cotacoes_urgencia_check` CHECK ((urgencia = ANY (ARRAY['baixa'::text, 'normal'::text, 'alta'::text])))

Índices: `idx_tech_cotacoes_categoria`, `idx_tech_cotacoes_criado_em`, `idx_tech_cotacoes_status`, `tech_cotacoes_pkey`

## tech_cotacoes_fornecedores

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | bigint | não | `nextval('tech_cotacoes_fornecedores_id_seq'::regclass)` |
| cotacao_id | bigint | não |  |
| fornecedor_nome | text | não |  |
| fornecedor_contato | text | sim |  |
| tipo_compra | text | não | `'online'::text` |
| link | text | sim |  |
| endereco | text | sim |  |
| valor_unitario | numeric | não | `0` |
| frete | numeric | sim | `0` |
| taxas | numeric | sim | `0` |
| prazo_entrega | text | sim |  |
| condicao_pagamento | text | sim |  |
| garantia | text | sim |  |
| anexo_path | text | sim |  |
| anexo_nome | text | sim |  |
| observacao | text | sim |  |
| criado_em | timestamp with time zone | não | `now()` |
| atualizado_em | timestamp with time zone | não | `now()` |

Constraints: `tech_cotacoes_fornecedores_cotacao_id_fkey` FOREIGN KEY (cotacao_id) REFERENCES tech_cotacoes(id) ON DELETE CASCADE; `tech_cotacoes_fornecedores_pkey` PRIMARY KEY (id); `tech_cotacoes_fornecedores_tipo_compra_check` CHECK ((tipo_compra = ANY (ARRAY['online'::text, 'presencial'::text])))

Índices: `idx_tech_cot_forn_cotacao_id`, `tech_cotacoes_fornecedores_pkey`

## tech_patrimonio

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | integer | não | `nextval('tech_patrimonio_id_seq'::regclass)` |
| codigo_patrimonio | text | não |  |
| tipo | character varying | não |  |
| descricao | text | sim |  |
| marca | text | sim |  |
| modelo | text | sim |  |
| numero_serie | text | sim |  |
| local | text | sim |  |
| setor | text | sim |  |
| responsavel | text | sim |  |
| responsavel_cpf | text | sim |  |
| responsavel_email | text | sim |  |
| data_aquisicao | date | sim |  |
| valor_aquisicao | numeric | sim |  |
| fornecedor | text | sim |  |
| nota_fiscal | text | sim |  |
| status | character varying | não | `'ativo'::character varying` |
| observacao | text | sim |  |
| criado_em | timestamp with time zone | não | `now()` |
| atualizado_em | timestamp with time zone | não | `now()` |
| criado_por | text | sim |  |
| atualizado_por | text | sim |  |
| filial | text | sim |  |

Constraints: `tech_patrimonio_codigo_patrimonio_key` UNIQUE (codigo_patrimonio); `tech_patrimonio_pkey` PRIMARY KEY (id)

Índices: `idx_tech_patrimonio_codigo`, `idx_tech_patrimonio_local`, `idx_tech_patrimonio_responsavel`, `idx_tech_patrimonio_setor`, `idx_tech_patrimonio_status`, `idx_tech_patrimonio_tipo`, `tech_patrimonio_codigo_patrimonio_key`, `tech_patrimonio_pkey`

## tech_patrimonio_log

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | integer | não | `nextval('tech_patrimonio_log_id_seq'::regclass)` |
| patrimonio_id | integer | sim |  |
| acao | character varying | não |  |
| campo_alterado | text | sim |  |
| valor_anterior | text | sim |  |
| valor_novo | text | sim |  |
| alterado_em | timestamp with time zone | não | `now()` |
| alterado_por | text | sim |  |

Constraints: `tech_patrimonio_log_patrimonio_id_fkey` FOREIGN KEY (patrimonio_id) REFERENCES tech_patrimonio(id) ON DELETE CASCADE; `tech_patrimonio_log_pkey` PRIMARY KEY (id)

Índices: `idx_tech_patrimonio_log_pat`, `tech_patrimonio_log_pkey`

## template_disparos

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | bigint | não | `nextval('template_disparos_id_seq'::regclass)` |
| campaign_id | uuid | não |  |
| campaign_name | text | sim |  |
| template_name | text | não |  |
| template_language | text | sim | `'pt_BR'::text` |
| template_category | text | sim |  |
| account_id | uuid | sim |  |
| waba_id | text | sim |  |
| person_code | bigint | sim |  |
| phone_number | text | não |  |
| contact_name | text | sim |  |
| cpf_cnpj | text | sim |  |
| origem | text | sim |  |
| template_variables | jsonb | sim | `'{}'::jsonb` |
| status | text | sim | `'queued'::text` |
| meta_message_id | text | sim |  |
| error_message | text | sim |  |
| scheduled_at | timestamp with time zone | sim |  |
| sent_at | timestamp with time zone | sim |  |
| created_at | timestamp with time zone | sim | `now()` |
| comprou | boolean | sim | `false` |
| data_compra | date | sim |  |
| valor_compra | numeric | sim | `0` |
| nfs_apos_disparo | integer | sim | `0` |

Constraints: `template_disparos_campaign_id_phone_number_key` UNIQUE (campaign_id, phone_number); `template_disparos_pkey` PRIMARY KEY (id)

Índices: `idx_disparos_campaign`, `idx_disparos_person_code`, `idx_disparos_phone`, `idx_disparos_sent_at`, `idx_disparos_template`, `template_disparos_campaign_id_phone_number_key`, `template_disparos_pkey`

## terminations

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |
| employee_id | uuid | sim |  |
| date | date | não |  |
| reason | text | sim |  |
| type | USER-DEFINED | sim |  |
| return_willingness | boolean | sim |  |
| main_exit_reason | text | sim |  |
| created_by | uuid | sim |  |
| created_at | timestamp with time zone | sim | `now()` |

Constraints: `terminations_employee_id_fkey` FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE; `terminations_pkey` PRIMARY KEY (id)

Índices: `terminations_pkey`

Policies: `HR and Admin can view all terminations` (SELECT → {public})

## totvs_operacoes

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |
| nome | character varying | não |  |
| codigos_operacao | text | não |  |
| classificacao_exigida | character varying | sim |  |
| created_at | timestamp with time zone | sim | `now()` |

Constraints: `totvs_operacoes_pkey` PRIMARY KEY (id)

Índices: `totvs_operacoes_pkey`

Policies: `Permitir leitura publica` (SELECT → {public})

## treinamento_franquias

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | integer | não |  |
| data_created | timestamp without time zone | sim |  |
| data | character varying | sim | `NULL::character varying` |
| nome | character varying | sim | `NULL::character varying` |
| duração reunião | character varying | sim | `NULL::character varying` |
| nome contato | character varying | sim | `NULL::character varying` |

Constraints: `Treinamento Franquias_pkey` PRIMARY KEY (id)

Índices: `Treinamento Franquias_pkey`

Policies: `a` (ALL → {public})

## user_companies

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |
| user_id | uuid | não |  |
| cd_empresa | text | não |  |
| created_at | timestamp with time zone | sim | `now()` |
| created_by | uuid | sim |  |
| updated_at | timestamp with time zone | sim | `now()` |

Constraints: `unique_user_company` UNIQUE (user_id, cd_empresa); `user_companies_created_by_fkey` FOREIGN KEY (created_by) REFERENCES auth.users(id); `user_companies_pkey` PRIMARY KEY (id); `user_companies_user_id_fkey` FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE

Índices: `idx_user_companies_cd_empresa`, `idx_user_companies_user_id`, `unique_user_company`, `user_companies_pkey`

Policies: `Only owners can delete user companies` (DELETE → {public}); `Only owners can insert user companies` (INSERT → {public}); `Only owners can update user companies` (UPDATE → {public}); `Users can view their own companies` (SELECT → {public}); `companies` (ALL → {public}); `headcoach_autenticado_tudo` (ALL → {authenticated})

## user_instance_permissions

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |
| user_id | uuid | não |  |
| instance_id | text | não |  |
| granted_by | uuid | sim |  |
| granted_at | timestamp with time zone | sim | `now()` |
| created_at | timestamp with time zone | sim | `now()` |
| updated_at | timestamp with time zone | sim | `now()` |

Constraints: `user_instance_permissions_granted_by_fkey` FOREIGN KEY (granted_by) REFERENCES auth.users(id); `user_instance_permissions_pkey` PRIMARY KEY (id); `user_instance_permissions_user_id_fkey` FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE

Índices: `idx_user_instance_permissions_instance_id`, `idx_user_instance_permissions_unique`, `idx_user_instance_permissions_user_id`, `user_instance_permissions_pkey`

Policies: `user_instance_permissions_delete` (DELETE → {public}); `user_instance_permissions_insert` (INSERT → {public}); `user_instance_permissions_select` (SELECT → {public}); `user_instance_permissions_update` (UPDATE → {public})

## user_page_permissions

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |
| user_id | uuid | não |  |
| page_path | text | não |  |
| created_at | timestamp with time zone | sim | `now()` |
| created_by | uuid | sim |  |
| updated_at | timestamp with time zone | sim | `now()` |

Constraints: `unique_user_page` UNIQUE (user_id, page_path); `user_page_permissions_created_by_fkey` FOREIGN KEY (created_by) REFERENCES auth.users(id); `user_page_permissions_pkey` PRIMARY KEY (id); `user_page_permissions_user_id_fkey` FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE

Índices: `idx_user_page_permissions_created_by`, `idx_user_page_permissions_page_path`, `idx_user_page_permissions_user_id`, `unique_user_page`, `user_page_permissions_pkey`

Policies: `Only owners can delete permissions` (DELETE → {public}); `Only owners can insert permissions` (INSERT → {public}); `Only owners can update permissions` (UPDATE → {public}); `Users can view their own permissions` (SELECT → {public}); `headcoach_autenticado_tudo` (ALL → {authenticated}); `permissions` (ALL → {public})

## user_profiles

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | integer | não | `nextval('user_profiles_id_seq'::regclass)` |
| name | text | não |  |
| label | text | não |  |
| color | text | não | `'#757575'::text` |
| description | text | sim |  |
| level | integer | não |  |
| created_at | timestamp with time zone | não | `now()` |
| updated_at | timestamp with time zone | não | `now()` |

Constraints: `chk_user_profiles_level` CHECK (((level >= 1) AND (level <= 99))); `user_profiles_name_key` UNIQUE (name); `user_profiles_pkey1` PRIMARY KEY (id)

Índices: `idx_user_profiles_level`, `idx_user_profiles_name`, `user_profiles_name_key`, `user_profiles_pkey1`

Policies: `headcoach_autenticado_tudo` (ALL → {authenticated}); `user_profiles_all` (ALL → {authenticated}); `user_profiles_select` (SELECT → {authenticated})

## user_profiles_antiga

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |
| name | text | não |  |
| email | text | não |  |
| password | text | não |  |
| role | text | não |  |
| active | boolean | sim | `true` |
| created_at | timestamp with time zone | sim | `now()` |
| updated_at | timestamp with time zone | sim | `now()` |

Constraints: `user_profiles_email_key` UNIQUE (email); `user_profiles_pkey` PRIMARY KEY (id); `user_profiles_role_check` CHECK ((role = ANY (ARRAY['ADM'::text, 'DIRETOR'::text, 'FINANCEIRO'::text, 'FRANQUIA'::text])))

Índices: `user_profiles_email_key`, `user_profiles_pkey`

Policies: `Permitir inserção de usuários` (INSERT → {public}); `Usuários podem atualizar seus próprios dados` (UPDATE → {public}); `Usuários podem deletar seus próprios dados` (DELETE → {public}); `Usuários podem ver seus próprios dados` (SELECT → {public}); `headcoach_autenticado_tudo` (ALL → {authenticated})

## users

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |
| user_id | uuid | sim |  |
| email | text | não |  |
| name | text | não |  |
| profile_id | integer | não | `3` |
| active | boolean | não | `true` |
| avatar_url | text | sim |  |
| phone | text | sim |  |
| theme | text | não | `'light'::text` |
| language | text | não | `'pt-BR'::text` |
| timezone | text | não | `'America/Sao_Paulo'::text` |
| notifications | jsonb | não | `'{"push": true, "email": true}'::jsonb` |
| preferences | jsonb | não | `'{}'::jsonb` |
| created_at | timestamp with time zone | não | `now()` |
| updated_at | timestamp with time zone | não | `now()` |
| last_login_at | timestamp with time zone | sim |  |

Constraints: `chk_users_notifications_json` CHECK ((jsonb_typeof(notifications) = 'object'::text)); `chk_users_preferences_json` CHECK ((jsonb_typeof(preferences) = 'object'::text)); `users_email_key` UNIQUE (email); `users_pkey` PRIMARY KEY (id); `users_profile_id_fkey` FOREIGN KEY (profile_id) REFERENCES user_profiles(id); `users_user_id_fkey` FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE; `users_user_id_key` UNIQUE (user_id)

Índices: `idx_users_active`, `idx_users_email`, `idx_users_profile_id`, `idx_users_user_id`, `users_email_key`, `users_pkey`, `users_user_id_key`

Policies: `users_all` (ALL → {authenticated}); `users_select` (SELECT → {authenticated})

## usuarios

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| usuario | text | não |  |
| senha_hash | text | não |  |
| nome | text | sim |  |
| ativo | boolean | sim | `true` |
| criado_em | timestamp with time zone | sim | `now()` |

Constraints: `usuarios_pkey` PRIMARY KEY (usuario)

Índices: `usuarios_pkey`

## usuarios_view

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | uuid | sim |  |
| email | character varying | sim |  |
| raw_user_meta_data | jsonb | sim |  |

## v_vendedores_integracao

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | uuid | sim |  |
| nome_vendedor | character varying | sim |  |
| totvs_id | character varying | sim |  |
| crm_id | character varying | sim |  |
| clickup_id | character varying | sim |  |
| evolution_id | character varying | sim |  |
| uazapi_id | character varying | sim |  |
| ativo | boolean | sim |  |
| criado_em | timestamp with time zone | sim |  |
| atualizado_em | timestamp with time zone | sim |  |
| modulo | text | sim |  |

## vacancies

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |
| department | text | não |  |
| branch | text | sim |  |
| status | USER-DEFINED | sim | `'screening'::vacancy_status` |
| created_at | timestamp with time zone | sim | `now()` |

Constraints: `vacancies_pkey` PRIMARY KEY (id)

Índices: `vacancies_pkey`

Policies: `HR and Admin can view all vacancies` (SELECT → {public})

## vendedores

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | integer | não | `nextval('vendedores_id_seq'::regclass)` |
| nome | text | não |  |
| foto_url | text | sim |  |
| ativo | boolean | sim | `true` |
| created_at | timestamp with time zone | sim | `now()` |
| updated_at | timestamp with time zone | sim | `now()` |
| loja_id | integer | sim |  |

Constraints: `vendedores_loja_id_fkey` FOREIGN KEY (loja_id) REFERENCES lojas(id); `vendedores_pkey` PRIMARY KEY (id)

Índices: `vendedores_pkey`

Policies: `Allow all operations on vendedores` (ALL → {public})

## voucher_batches

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | bigint | não | `nextval('voucher_batches_id_seq'::regclass)` |
| branch_code_registration | integer | não |  |
| voucher_type | integer | não | `1` |
| prefix_code | text | não |  |
| print_template_code | integer | não | `1` |
| start_date | date | não |  |
| end_date | date | não |  |
| percentage | numeric | não |  |
| voucher_branches | jsonb | sim |  |
| origem | text | não |  |
| total_clientes | integer | não | `0` |
| sucessos | integer | não | `0` |
| falhas | integer | não | `0` |
| resultados | jsonb | não |  |
| created_by | text | sim |  |
| created_at | timestamp with time zone | não | `now()` |

Constraints: `voucher_batches_pkey` PRIMARY KEY (id)

Índices: `idx_voucher_batches_created_at`, `voucher_batches_pkey`

## vw_aspect_groups_with_instances

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | smallint | sim |  |
| name | text | sim |  |
| description | text | sim |  |
| created_at | timestamp with time zone | sim |  |
| updated_at | timestamp with time zone | sim |  |
| instance_ids | ARRAY | sim |  |

## vw_case_value

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| month | text | sim |  |
| month_value | real | sim |  |
| cumulative_value | real | sim |  |

## vw_clients

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | uuid | sim |  |
| code | text | sim |  |
| name | text | sim |  |
| document | text | sim |  |
| document_clean | text | sim |  |
| type_id | smallint | sim |  |
| type_name | text | sim |  |
| status_id | smallint | sim |  |
| status_name | text | sim |  |
| email | text | sim |  |
| phone | text | sim |  |
| website | text | sim |  |
| avatar_url | text | sim |  |
| source | text | sim |  |
| owner_user_id | uuid | sim |  |
| custom_fields | jsonb | sim |  |
| created_at | timestamp with time zone | sim |  |
| updated_at | timestamp with time zone | sim |  |
| street | text | sim |  |
| number | text | sim |  |
| city | text | sim |  |
| state | character | sim |  |
| postal_code | character | sim |  |
| contact_name | text | sim |  |
| contact_email | text | sim |  |
| contact_phone | text | sim |  |
| tags | ARRAY | sim |  |
| contacts_count | bigint | sim |  |
| interactions_count | bigint | sim |  |
| notes_count | bigint | sim |  |
| tags_count | bigint | sim |  |
| last_interaction_at | timestamp with time zone | sim |  |
| last_interaction_channel | text | sim |  |
| last_interaction_subject | text | sim |  |

## vw_database_connections

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | uuid | sim |  |
| name | character varying | sim |  |
| description | text | sim |  |
| db_type | USER-DEFINED | sim |  |
| host | character varying | sim |  |
| port | integer | sim |  |
| database_name | character varying | sim |  |
| username | character varying | sim |  |
| password_masked | text | sim |  |
| ssl_enabled | boolean | sim |  |
| connection_timeout | integer | sim |  |
| max_pool_size | integer | sim |  |
| status | USER-DEFINED | sim |  |
| last_test_at | timestamp with time zone | sim |  |
| last_test_success | boolean | sim |  |
| last_test_error | text | sim |  |
| instance_id | uuid | sim |  |
| created_by | uuid | sim |  |
| created_by_name | text | sim |  |
| created_by_email | text | sim |  |
| created_at | timestamp with time zone | sim |  |
| updated_at | timestamp with time zone | sim |  |

## vw_employees

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | uuid | sim |  |
| code | text | sim |  |
| name | text | sim |  |
| cpf | character varying | sim |  |
| cpf_raw | text | sim |  |
| email | text | sim |  |
| phone | text | sim |  |
| phone_clean | text | sim |  |
| hire_date | date | sim |  |
| department | text | sim |  |
| position | text | sim |  |
| status | text | sim |  |
| avatar_url | text | sim |  |
| created_at | timestamp with time zone | sim |  |
| updated_at | timestamp with time zone | sim |  |
| birthday | date | sim |  |
| gender | USER-DEFINED | sim |  |
| nationality | text | sim |  |
| birth_city | text | sim |  |
| birth_uf | text | sim |  |
| education_level | USER-DEFINED | sim |  |
| race | USER-DEFINED | sim |  |
| mother_name | text | sim |  |
| father_name | text | sim |  |
| marital_status | text | sim |  |
| spouse_name | text | sim |  |
| address_street | text | sim |  |
| address_number | text | sim |  |
| address_complement | text | sim |  |
| address_district | text | sim |  |
| address_city | text | sim |  |
| address_state | text | sim |  |
| address_zip | text | sim |  |
| address_country | text | sim |  |
| ctps_number | text | sim |  |
| ctps_series | text | sim |  |
| pis_number | text | sim |  |
| voter_number | text | sim |  |
| voter_zone | text | sim |  |
| voter_section | text | sim |  |
| identity_number | text | sim |  |
| identity_expedition | date | sim |  |
| identity_agency | text | sim |  |
| identity_agency_uf | text | sim |  |
| driver_license_number | text | sim |  |
| driver_license_category | text | sim |  |
| driver_license_expiration | date | sim |  |
| cbo_code | text | sim |  |
| work_schedule_name | text | sim |  |
| contracting_party_name | text | sim |  |
| current_salary | numeric | sim |  |
| current_salary_date | date | sim |  |
| vacations_count | bigint | sim |  |
| last_vacation_start | date | sim |  |
| upcoming_vacation_days | bigint | sim |  |
| last_medical_start | date | sim |  |
| last_medical_end | date | sim |  |
| last_medical_reason | text | sim |  |

## vw_instance_user_access

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| instance_id | text | sim |  |
| user_id | uuid | sim |  |
| name | text | sim |  |
| email | text | sim |  |
| profile_id | integer | sim |  |
| profile_name | text | sim |  |
| granted_by | uuid | sim |  |
| granted_by_name | text | sim |  |
| granted_at | timestamp with time zone | sim |  |
| created_at | timestamp with time zone | sim |  |

## vw_kpi_evaluations

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| instance_id | text | sim |  |
| eval_date | date | sim |  |
| total_evaluations | bigint | sim |  |
| avg_score | numeric | sim |  |

## vw_meta_whatsapp_gastos

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| account_id | bigint | sim |  |
| conta | text | sim |  |
| waba_id | text | sim |  |
| data | date | sim |  |
| pricing_category | text | sim |  |
| pricing_type | text | sim |  |
| volume | integer | sim |  |
| cost_usd | numeric | sim |  |
| cotacao | numeric | sim |  |
| cost_brl | numeric | sim |  |

## vw_metas_mensais_resumo

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | bigint | sim |  |
| tipo | character varying | sim |  |
| nome | character varying | sim |  |
| mes | character varying | sim |  |
| bronze | numeric | sim |  |
| prata | numeric | sim |  |
| ouro | numeric | sim |  |
| diamante | numeric | sim |  |
| calculado_em | timestamp with time zone | sim |  |
| usuario | character varying | sim |  |
| total_semanas_configuradas | bigint | sim |  |
| status_configuracao | text | sim |  |

## vw_metas_semanais_detalhadas

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | bigint | sim |  |
| tipo | character varying | sim |  |
| nome | character varying | sim |  |
| semana_inicio | date | sim |  |
| semana_fim | date | sim |  |
| campo | character varying | sim |  |
| valor | numeric | sim |  |
| mes_referencia | character varying | sim |  |
| numero_semana | integer | sim |  |
| usuario | character varying | sim |  |
| data_alteracao | timestamp with time zone | sim |  |
| semana_ano | numeric | sim |  |
| inicio_formatado | text | sim |  |
| fim_formatado | text | sim |  |
| mes_nome_completo | text | sim |  |

## vw_patients

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | uuid | sim |  |
| code | text | sim |  |
| name | text | sim |  |
| cpf | text | sim |  |
| email | text | sim |  |
| phone | text | sim |  |
| birth_date | date | sim |  |
| gender | USER-DEFINED | sim |  |
| insurance_number | text | sim |  |
| emergency_contact_name | text | sim |  |
| emergency_contact_phone | text | sim |  |
| created_at | timestamp with time zone | sim |  |
| updated_at | timestamp with time zone | sim |  |
| service_name | text | sim |  |
| service_color | text | sim |  |
| status_name | text | sim |  |
| status_color | text | sim |  |
| insurance_name | text | sim |  |
| insurance_color | text | sim |  |

## vw_rh

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| date | text | sim |  |
| count | bigint | sim |  |
| meta | integer | sim |  |

## vw_role_page_perms

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| profile_id | integer | sim |  |
| page_key | text | sim |  |
| path | text | sim |  |
| label | text | sim |  |
| module_key | text | sim |  |
| module_active | boolean | sim |  |
| can_read | boolean | sim |  |
| can_create | boolean | sim |  |
| can_update | boolean | sim |  |
| can_delete | boolean | sim |  |

## vw_user_accessible_instances

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| user_id | uuid | sim |  |
| user_name | text | sim |  |
| email | text | sim |  |
| profile_id | integer | sim |  |
| profile_name | text | sim |  |
| accessible_instances | ARRAY | sim |  |

## vw_user_effective_pages

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| user_id | uuid | sim |  |
| app_user_id | uuid | sim |  |
| email | text | sim |  |
| profile_id | integer | sim |  |
| profile_name | text | sim |  |
| page_key | text | sim |  |
| path | text | sim |  |
| label | text | sim |  |
| module_key | text | sim |  |
| module_active | boolean | sim |  |
| can_read | boolean | sim |  |
| can_create | boolean | sim |  |
| can_update | boolean | sim |  |
| can_delete | boolean | sim |  |

## vw_users

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | uuid | sim |  |
| user_id | uuid | sim |  |
| email | text | sim |  |
| name | text | sim |  |
| profile_id | integer | sim |  |
| profile_name | text | sim |  |
| profile_label | text | sim |  |
| profile_color | text | sim |  |
| active | boolean | sim |  |
| avatar_url | text | sim |  |
| created_at | timestamp with time zone | sim |  |
| updated_at | timestamp with time zone | sim |  |
| last_login_at | timestamp with time zone | sim |  |

## warnings

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |
| employee_id | uuid | sim |  |
| date | date | não |  |
| reason | text | sim |  |
| type | text | sim |  |
| department | text | sim |  |
| branch | text | sim |  |
| created_by | uuid | sim |  |
| created_at | timestamp with time zone | sim | `now()` |

Constraints: `warnings_employee_id_fkey` FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE; `warnings_pkey` PRIMARY KEY (id)

Índices: `warnings_pkey`

Policies: `HR and Admin can view all warnings` (SELECT → {public})

## weekly_forecasts

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |
| channel_name | text | não |  |
| week_number | integer | não |  |
| year_reference | integer | não | `2024` |
| pessimistic_target | numeric | sim | `0` |
| realistic_target | numeric | sim | `0` |
| optimistic_target | numeric | sim | `0` |
| actual_realized | numeric | sim | `0` |
| created_at | timestamp with time zone | sim | `now()` |

Constraints: `unique_forecast_entry` UNIQUE (channel_name, week_number, year_reference); `weekly_forecasts_pkey` PRIMARY KEY (id)

Índices: `unique_forecast_entry`, `weekly_forecasts_pkey`

Policies: `Permitir tudo para autenticados` (ALL → {authenticated})

## whatsapp_accounts

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | bigint | não |  |
| name | text | não |  |
| waba_id | text | não |  |
| phone_id | text | sim |  |
| access_token | text | sim |  |
| created_at | timestamp with time zone | sim | `timezone('utc'::text, now())` |
| nr_telefone | character varying | sim |  |
| canal_venda | character varying | sim |  |
| app_id | character varying | sim |  |

Constraints: `whatsapp_accounts_pkey` PRIMARY KEY (id)

Índices: `whatsapp_accounts_pkey`

## whatsapp_logs_disparos

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | bigint | não |  |
| waba_id | character varying | não |  |
| template_name | character varying | não |  |
| telefone | character varying | não |  |
| status_envio | character varying | não |  |
| data_disparo | timestamp with time zone | sim | `now()` |
| message_id | text | sim |  |
| nome_cliente | text | sim |  |
| codigo_cliente | text | sim |  |

Constraints: `whatsapp_logs_disparos_pkey` PRIMARY KEY (id)

Índices: `idx_logs_template`, `idx_whatsapp_logs_message_id`, `whatsapp_logs_disparos_pkey`

## whatsapp_template_stats

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | bigint | não | `nextval('whatsapp_template_stats_id_seq'::regclass)` |
| waba_id | text | não |  |
| template_id | text | não |  |
| template_name | text | não |  |
| template_category | text | sim |  |
| template_language | text | sim |  |
| template_status | text | sim |  |
| period_start | timestamp with time zone | sim |  |
| period_end | timestamp with time zone | sim |  |
| sent | integer | sim | `0` |
| delivered | integer | sim | `0` |
| read | integer | sim | `0` |
| clicked | integer | sim | `0` |
| replied | integer | sim | `0` |
| cost_usd | numeric | sim | `0` |
| unit_cost_usd | numeric | sim | `0` |
| last_synced_at | timestamp with time zone | sim | `now()` |
| created_at | timestamp with time zone | sim | `now()` |
| grupo | text | sim |  |

Constraints: `uniq_wts_template` UNIQUE (waba_id, template_id); `whatsapp_template_stats_pkey` PRIMARY KEY (id)

Índices: `idx_wts_category`, `idx_wts_grupo`, `idx_wts_name`, `idx_wts_synced`, `idx_wts_waba`, `uniq_wts_template`, `whatsapp_template_stats_pkey`

## widgets

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |
| dashboard_id | uuid | não |  |
| nome | character varying | não |  |
| view_name | character varying | não |  |
| config | jsonb | não |  |
| created_by | uuid | não |  |
| created_at | timestamp with time zone | sim | `CURRENT_TIMESTAMP` |
| updated_at | timestamp with time zone | sim | `CURRENT_TIMESTAMP` |
| is_active | boolean | sim | `true` |

Constraints: `widgets_dashboard_id_fkey` FOREIGN KEY (dashboard_id) REFERENCES dashboards(id) ON DELETE CASCADE; `widgets_pkey` PRIMARY KEY (id)

Índices: `idx_widgets_created_by`, `idx_widgets_dashboard_id`, `widgets_pkey`

Policies: `Users can create widgets in their dashboards` (INSERT → {public}); `Users can delete their own widgets` (DELETE → {public}); `Users can update their own widgets` (UPDATE → {public}); `Users can view widgets from their dashboards` (SELECT → {public})

## wishlists

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| user_id | uuid | não |  |
| product_id | uuid | não |  |
| created_at | timestamp with time zone | sim | `now()` |

Constraints: `wishlists_pkey` PRIMARY KEY (user_id, product_id); `wishlists_product_id_fkey` FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE; `wishlists_user_id_fkey` FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE

Índices: `wishlists_pkey`

## wix_carrinhos_abandonados

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | bigint | não | `nextval('wix_carrinhos_abandonados_id_seq'::regclass)` |
| wix_checkout_id | text | sim |  |
| wix_cart_id | text | sim |  |
| cliente_email | text | sim |  |
| cliente_nome | text | sim |  |
| cliente_telefone | text | sim |  |
| total | numeric | sim | `0` |
| moeda | text | sim | `'BRL'::text` |
| itens_qty | integer | sim | `0` |
| itens | jsonb | sim | `'[]'::jsonb` |
| ultima_atividade | timestamp with time zone | sim |  |
| criado_em | timestamp with time zone | sim |  |
| recuperado | boolean | sim | `false` |
| pedido_id_relacionado | text | sim |  |
| raw | jsonb | sim |  |
| sincronizado_em | timestamp with time zone | não | `now()` |

Constraints: `wix_carrinhos_abandonados_pkey` PRIMARY KEY (id); `wix_carrinhos_abandonados_wix_checkout_id_key` UNIQUE (wix_checkout_id)

Índices: `idx_wix_cart_ab_criado`, `idx_wix_cart_ab_email`, `idx_wix_cart_ab_recuperado`, `wix_carrinhos_abandonados_pkey`, `wix_carrinhos_abandonados_wix_checkout_id_key`

## wix_pedido_items

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | bigint | não | `nextval('wix_pedido_items_id_seq'::regclass)` |
| pedido_id | text | não |  |
| line_item_id | text | sim |  |
| produto_id | text | sim |  |
| variant_id | text | sim |  |
| nome | text | sim |  |
| sku | text | sim |  |
| quantidade | integer | não | `1` |
| preco_unit | numeric | sim | `0` |
| preco_total | numeric | sim | `0` |
| imagem | text | sim |  |
| criado_em | timestamp with time zone | não | `now()` |
| cor | text | sim |  |
| cor_hex | text | sim |  |
| tamanho | text | sim |  |

Constraints: `wix_pedido_items_pedido_id_fkey` FOREIGN KEY (pedido_id) REFERENCES wix_pedidos(id) ON DELETE CASCADE; `wix_pedido_items_pkey` PRIMARY KEY (id)

Índices: `idx_wix_items_cor`, `idx_wix_items_tamanho`, `idx_wix_pedido_items_pedido`, `idx_wix_pedido_items_produto`, `idx_wix_pedido_items_sku`, `wix_pedido_items_pkey`

## wix_pedidos

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | text | não |  |
| numero | text | sim |  |
| status | text | sim |  |
| payment_status | text | sim |  |
| fulfillment_status | text | sim |  |
| buyer_email | text | sim |  |
| buyer_nome | text | sim |  |
| buyer_sobrenome | text | sim |  |
| buyer_telefone | text | sim |  |
| buyer_cpf | text | sim |  |
| total | numeric | sim | `0` |
| subtotal | numeric | sim | `0` |
| desconto | numeric | sim | `0` |
| frete | numeric | sim | `0` |
| imposto | numeric | sim | `0` |
| moeda | text | sim | `'BRL'::text` |
| ship_cidade | text | sim |  |
| ship_uf | text | sim |  |
| ship_cep | text | sim |  |
| ship_logradouro | text | sim |  |
| ship_numero | text | sim |  |
| ship_complemento | text | sim |  |
| criado_em | timestamp with time zone | sim |  |
| comprado_em | timestamp with time zone | sim |  |
| atualizado_em | timestamp with time zone | sim |  |
| canal | text | sim |  |
| origem | text | sim |  |
| raw | jsonb | sim |  |
| sincronizado_em | timestamp with time zone | não | `now()` |
| forma_pagamento | text | sim |  |
| data_pagamento | timestamp with time zone | sim |  |
| observacao_pagamento | text | sim |  |
| cliente_totvs_code | integer | sim |  |
| cliente_totvs_nome | text | sim |  |
| cliente_totvs_doc | text | sim |  |
| cliente_classificacao | text | sim |  |
| vendedor | text | sim |  |
| parcelas | integer | sim |  |

Constraints: `wix_pedidos_pkey` PRIMARY KEY (id)

Índices: `idx_wix_pedidos_classif`, `idx_wix_pedidos_cli_totvs`, `idx_wix_pedidos_cpf`, `idx_wix_pedidos_criado`, `idx_wix_pedidos_data_pag`, `idx_wix_pedidos_email`, `idx_wix_pedidos_forma_pag`, `idx_wix_pedidos_numero`, `idx_wix_pedidos_status`, `idx_wix_pedidos_vendedor`, `wix_pedidos_pkey`

## wix_produto_variantes

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | text | não |  |
| produto_id | text | não |  |
| cor | text | sim |  |
| cor_hex | text | sim |  |
| tamanho | text | sim |  |
| sku | text | sim |  |
| track_quantity | boolean | sim | `false` |
| quantidade | integer | sim |  |
| em_estoque | boolean | sim | `true` |
| preco | numeric | sim |  |
| preco_desconto | numeric | sim |  |
| sincronizado_em | timestamp with time zone | não | `now()` |

Constraints: `wix_produto_variantes_pkey` PRIMARY KEY (id); `wix_produto_variantes_produto_id_fkey` FOREIGN KEY (produto_id) REFERENCES wix_produtos(id) ON DELETE CASCADE

Índices: `idx_wix_var_produto`, `idx_wix_var_sem_estoque`, `idx_wix_var_sku`, `idx_wix_var_track`, `wix_produto_variantes_pkey`

## wix_produtos

| Coluna | Tipo | Nulo | Padrão |
|---|---|---|---|
| id | text | não |  |
| nome | text | não |  |
| slug | text | sim |  |
| sku | text | sim |  |
| product_type | text | sim |  |
| visivel | boolean | sim | `true` |
| descricao | text | sim |  |
| track_inventory | boolean | sim | `false` |
| quantidade_total | integer | sim |  |
| inventory_status | text | sim |  |
| preco | numeric | sim |  |
| preco_desconto | numeric | sim |  |
| moeda | text | sim | `'BRL'::text` |
| imagem_principal | text | sim |  |
| manage_variants | boolean | sim | `false` |
| total_variantes | integer | sim | `0` |
| product_options | jsonb | sim |  |
| collection_ids | ARRAY | sim |  |
| product_page_url | text | sim |  |
| criado_em | timestamp with time zone | sim |  |
| atualizado_em | timestamp with time zone | sim |  |
| sincronizado_em | timestamp with time zone | não | `now()` |

Constraints: `wix_produtos_pkey` PRIMARY KEY (id)

Índices: `idx_wix_produtos_nome`, `idx_wix_produtos_sku`, `idx_wix_produtos_status`, `idx_wix_produtos_track`, `wix_produtos_pkey`

## Funções

- `adicionar_historico_negociacao(p_solicitacao_id uuid, p_tipo text, p_vl_credito numeric, p_forma_pagamento text, p_nr_parcelas integer, p_user text, p_observacao text DEFAULT NULL::text)` → void (plpgsql)
- `aniversariantes_do_dia(target_month integer, target_day integer)` → TABLE(code bigint, nm_pessoa text, fantasy_name text, telefone text, dt_nascimento date, classifications jsonb, is_customer boolean) (sql)
- `ap_duplicates_expense_rows()` → trigger (plpgsql)
- `ap_duplicates_expense_sync()` → trigger (plpgsql)
- `ar_documents_before_update()` → trigger (plpgsql)
- `ar_documents_invoice_rows()` → trigger (plpgsql)
- `cash_dist(money, money)` → money (c)
- `check_user_instance_access(user_id_string text, user_profile_id integer, instance_id text)` → boolean (plpgsql)
- `company_exists(company_slug text)` → boolean (sql)
- `conceder_paginas_padrao_solicitacoes()` → trigger (plpgsql)
- `date_dist(date, date)` → integer (c)
- `decrypt_db_password(encrypted_password text, encryption_key text DEFAULT NULL::text)` → text (plpgsql)
- `devolucoes_touch_atualizado_em()` → trigger (plpgsql)
- `devolucoes_trx_touch()` → trigger (plpgsql)
- `encrypt_db_password(password text, encryption_key text DEFAULT NULL::text)` → text (plpgsql)
- `ensure_company_exists(company_name text, company_slug text, company_type text DEFAULT 'company'::text, company_schema text DEFAULT NULL::text, parent_company_slug text DEFAULT NULL::text)` → uuid (plpgsql)
- `ensure_user()` → users (plpgsql)
- `ensure_user_company_relation(user_email text, company_slug text, user_role text DEFAULT 'owner'::text, user_permissions text[] DEFAULT ARRAY['read'::text, 'write'::text, 'admin'::text])` → boolean (plpgsql)
- `erp_schema_snapshot()` → jsonb (sql)
- `erp_touch_atualizado_em()` → trigger (plpgsql)
- `exec_sql(query text)` → text (plpgsql)
- `fill_nm_instancia_from_clickup()` → trigger (plpgsql)
- `float4_dist(real, real)` → real (c)
- `float8_dist(double precision, double precision)` → double precision (c)
- `fn_calc_status_contato()` → trigger (plpgsql)
- `gbt_bit_compress(internal)` → internal (c)
- `gbt_bit_consistent(internal, bit, smallint, oid, internal)` → boolean (c)
- `gbt_bit_penalty(internal, internal, internal)` → internal (c)
- `gbt_bit_picksplit(internal, internal)` → internal (c)
- `gbt_bit_same(gbtreekey_var, gbtreekey_var, internal)` → internal (c)
- `gbt_bit_union(internal, internal)` → gbtreekey_var (c)
- `gbt_bool_compress(internal)` → internal (c)
- `gbt_bool_consistent(internal, boolean, smallint, oid, internal)` → boolean (c)
- `gbt_bool_fetch(internal)` → internal (c)
- `gbt_bool_penalty(internal, internal, internal)` → internal (c)
- `gbt_bool_picksplit(internal, internal)` → internal (c)
- `gbt_bool_same(gbtreekey2, gbtreekey2, internal)` → internal (c)
- `gbt_bool_union(internal, internal)` → gbtreekey2 (c)
- `gbt_bpchar_compress(internal)` → internal (c)
- `gbt_bpchar_consistent(internal, character, smallint, oid, internal)` → boolean (c)
- `gbt_bytea_compress(internal)` → internal (c)
- `gbt_bytea_consistent(internal, bytea, smallint, oid, internal)` → boolean (c)
- `gbt_bytea_penalty(internal, internal, internal)` → internal (c)
- `gbt_bytea_picksplit(internal, internal)` → internal (c)
- `gbt_bytea_same(gbtreekey_var, gbtreekey_var, internal)` → internal (c)
- `gbt_bytea_union(internal, internal)` → gbtreekey_var (c)
- `gbt_cash_compress(internal)` → internal (c)
- `gbt_cash_consistent(internal, money, smallint, oid, internal)` → boolean (c)
- `gbt_cash_distance(internal, money, smallint, oid, internal)` → double precision (c)
- `gbt_cash_fetch(internal)` → internal (c)
- `gbt_cash_penalty(internal, internal, internal)` → internal (c)
- `gbt_cash_picksplit(internal, internal)` → internal (c)
- `gbt_cash_same(gbtreekey16, gbtreekey16, internal)` → internal (c)
- `gbt_cash_union(internal, internal)` → gbtreekey16 (c)
- `gbt_date_compress(internal)` → internal (c)
- `gbt_date_consistent(internal, date, smallint, oid, internal)` → boolean (c)
- `gbt_date_distance(internal, date, smallint, oid, internal)` → double precision (c)
- `gbt_date_fetch(internal)` → internal (c)
- `gbt_date_penalty(internal, internal, internal)` → internal (c)
- `gbt_date_picksplit(internal, internal)` → internal (c)
- `gbt_date_same(gbtreekey8, gbtreekey8, internal)` → internal (c)
- `gbt_date_union(internal, internal)` → gbtreekey8 (c)
- `gbt_decompress(internal)` → internal (c)
- `gbt_enum_compress(internal)` → internal (c)
- `gbt_enum_consistent(internal, anyenum, smallint, oid, internal)` → boolean (c)
- `gbt_enum_fetch(internal)` → internal (c)
- `gbt_enum_penalty(internal, internal, internal)` → internal (c)
- `gbt_enum_picksplit(internal, internal)` → internal (c)
- `gbt_enum_same(gbtreekey8, gbtreekey8, internal)` → internal (c)
- `gbt_enum_union(internal, internal)` → gbtreekey8 (c)
- `gbt_float4_compress(internal)` → internal (c)
- `gbt_float4_consistent(internal, real, smallint, oid, internal)` → boolean (c)
- `gbt_float4_distance(internal, real, smallint, oid, internal)` → double precision (c)
- `gbt_float4_fetch(internal)` → internal (c)
- `gbt_float4_penalty(internal, internal, internal)` → internal (c)
- `gbt_float4_picksplit(internal, internal)` → internal (c)
- `gbt_float4_same(gbtreekey8, gbtreekey8, internal)` → internal (c)
- `gbt_float4_union(internal, internal)` → gbtreekey8 (c)
- `gbt_float8_compress(internal)` → internal (c)
- `gbt_float8_consistent(internal, double precision, smallint, oid, internal)` → boolean (c)
- `gbt_float8_distance(internal, double precision, smallint, oid, internal)` → double precision (c)
- `gbt_float8_fetch(internal)` → internal (c)
- `gbt_float8_penalty(internal, internal, internal)` → internal (c)
- `gbt_float8_picksplit(internal, internal)` → internal (c)
- `gbt_float8_same(gbtreekey16, gbtreekey16, internal)` → internal (c)
- `gbt_float8_union(internal, internal)` → gbtreekey16 (c)
- `gbt_inet_compress(internal)` → internal (c)
- `gbt_inet_consistent(internal, inet, smallint, oid, internal)` → boolean (c)
- `gbt_inet_penalty(internal, internal, internal)` → internal (c)
- `gbt_inet_picksplit(internal, internal)` → internal (c)
- `gbt_inet_same(gbtreekey16, gbtreekey16, internal)` → internal (c)
- `gbt_inet_union(internal, internal)` → gbtreekey16 (c)
- `gbt_int2_compress(internal)` → internal (c)
- `gbt_int2_consistent(internal, smallint, smallint, oid, internal)` → boolean (c)
- `gbt_int2_distance(internal, smallint, smallint, oid, internal)` → double precision (c)
- `gbt_int2_fetch(internal)` → internal (c)
- `gbt_int2_penalty(internal, internal, internal)` → internal (c)
- `gbt_int2_picksplit(internal, internal)` → internal (c)
- `gbt_int2_same(gbtreekey4, gbtreekey4, internal)` → internal (c)
- `gbt_int2_union(internal, internal)` → gbtreekey4 (c)
- `gbt_int4_compress(internal)` → internal (c)
- `gbt_int4_consistent(internal, integer, smallint, oid, internal)` → boolean (c)
- `gbt_int4_distance(internal, integer, smallint, oid, internal)` → double precision (c)
- `gbt_int4_fetch(internal)` → internal (c)
- `gbt_int4_penalty(internal, internal, internal)` → internal (c)
- `gbt_int4_picksplit(internal, internal)` → internal (c)
- `gbt_int4_same(gbtreekey8, gbtreekey8, internal)` → internal (c)
- `gbt_int4_union(internal, internal)` → gbtreekey8 (c)
- `gbt_int8_compress(internal)` → internal (c)
- `gbt_int8_consistent(internal, bigint, smallint, oid, internal)` → boolean (c)
- `gbt_int8_distance(internal, bigint, smallint, oid, internal)` → double precision (c)
- `gbt_int8_fetch(internal)` → internal (c)
- `gbt_int8_penalty(internal, internal, internal)` → internal (c)
- `gbt_int8_picksplit(internal, internal)` → internal (c)
- `gbt_int8_same(gbtreekey16, gbtreekey16, internal)` → internal (c)
- `gbt_int8_union(internal, internal)` → gbtreekey16 (c)
- `gbt_intv_compress(internal)` → internal (c)
- `gbt_intv_consistent(internal, interval, smallint, oid, internal)` → boolean (c)
- `gbt_intv_decompress(internal)` → internal (c)
- `gbt_intv_distance(internal, interval, smallint, oid, internal)` → double precision (c)
- `gbt_intv_fetch(internal)` → internal (c)
- `gbt_intv_penalty(internal, internal, internal)` → internal (c)
- `gbt_intv_picksplit(internal, internal)` → internal (c)
- `gbt_intv_same(gbtreekey32, gbtreekey32, internal)` → internal (c)
- `gbt_intv_union(internal, internal)` → gbtreekey32 (c)
- `gbt_macad8_compress(internal)` → internal (c)
- `gbt_macad8_consistent(internal, macaddr8, smallint, oid, internal)` → boolean (c)
- `gbt_macad8_fetch(internal)` → internal (c)
- `gbt_macad8_penalty(internal, internal, internal)` → internal (c)
- `gbt_macad8_picksplit(internal, internal)` → internal (c)
- `gbt_macad8_same(gbtreekey16, gbtreekey16, internal)` → internal (c)
- `gbt_macad8_union(internal, internal)` → gbtreekey16 (c)
- `gbt_macad_compress(internal)` → internal (c)
- `gbt_macad_consistent(internal, macaddr, smallint, oid, internal)` → boolean (c)
- `gbt_macad_fetch(internal)` → internal (c)
- `gbt_macad_penalty(internal, internal, internal)` → internal (c)
- `gbt_macad_picksplit(internal, internal)` → internal (c)
- `gbt_macad_same(gbtreekey16, gbtreekey16, internal)` → internal (c)
- `gbt_macad_union(internal, internal)` → gbtreekey16 (c)
- `gbt_numeric_compress(internal)` → internal (c)
- `gbt_numeric_consistent(internal, numeric, smallint, oid, internal)` → boolean (c)
- `gbt_numeric_penalty(internal, internal, internal)` → internal (c)
- `gbt_numeric_picksplit(internal, internal)` → internal (c)
- `gbt_numeric_same(gbtreekey_var, gbtreekey_var, internal)` → internal (c)
- `gbt_numeric_union(internal, internal)` → gbtreekey_var (c)
- `gbt_oid_compress(internal)` → internal (c)
- `gbt_oid_consistent(internal, oid, smallint, oid, internal)` → boolean (c)
- `gbt_oid_distance(internal, oid, smallint, oid, internal)` → double precision (c)
- `gbt_oid_fetch(internal)` → internal (c)
- `gbt_oid_penalty(internal, internal, internal)` → internal (c)
- `gbt_oid_picksplit(internal, internal)` → internal (c)
- `gbt_oid_same(gbtreekey8, gbtreekey8, internal)` → internal (c)
- `gbt_oid_union(internal, internal)` → gbtreekey8 (c)
- `gbt_text_compress(internal)` → internal (c)
- `gbt_text_consistent(internal, text, smallint, oid, internal)` → boolean (c)
- `gbt_text_penalty(internal, internal, internal)` → internal (c)
- `gbt_text_picksplit(internal, internal)` → internal (c)
- `gbt_text_same(gbtreekey_var, gbtreekey_var, internal)` → internal (c)
- `gbt_text_union(internal, internal)` → gbtreekey_var (c)
- `gbt_time_compress(internal)` → internal (c)
- `gbt_time_consistent(internal, time without time zone, smallint, oid, internal)` → boolean (c)
- `gbt_time_distance(internal, time without time zone, smallint, oid, internal)` → double precision (c)
- `gbt_time_fetch(internal)` → internal (c)
- `gbt_time_penalty(internal, internal, internal)` → internal (c)
- `gbt_time_picksplit(internal, internal)` → internal (c)
- `gbt_time_same(gbtreekey16, gbtreekey16, internal)` → internal (c)
- `gbt_time_union(internal, internal)` → gbtreekey16 (c)
- `gbt_timetz_compress(internal)` → internal (c)
- `gbt_timetz_consistent(internal, time with time zone, smallint, oid, internal)` → boolean (c)
- `gbt_ts_compress(internal)` → internal (c)
- `gbt_ts_consistent(internal, timestamp without time zone, smallint, oid, internal)` → boolean (c)
- `gbt_ts_distance(internal, timestamp without time zone, smallint, oid, internal)` → double precision (c)
- `gbt_ts_fetch(internal)` → internal (c)
- `gbt_ts_penalty(internal, internal, internal)` → internal (c)
- `gbt_ts_picksplit(internal, internal)` → internal (c)
- `gbt_ts_same(gbtreekey16, gbtreekey16, internal)` → internal (c)
- `gbt_ts_union(internal, internal)` → gbtreekey16 (c)
- `gbt_tstz_compress(internal)` → internal (c)
- `gbt_tstz_consistent(internal, timestamp with time zone, smallint, oid, internal)` → boolean (c)
- `gbt_tstz_distance(internal, timestamp with time zone, smallint, oid, internal)` → double precision (c)
- `gbt_uuid_compress(internal)` → internal (c)
- `gbt_uuid_consistent(internal, uuid, smallint, oid, internal)` → boolean (c)
- `gbt_uuid_fetch(internal)` → internal (c)
- `gbt_uuid_penalty(internal, internal, internal)` → internal (c)
- `gbt_uuid_picksplit(internal, internal)` → internal (c)
- `gbt_uuid_same(gbtreekey32, gbtreekey32, internal)` → internal (c)
- `gbt_uuid_union(internal, internal)` → gbtreekey32 (c)
- `gbt_var_decompress(internal)` → internal (c)
- `gbt_var_fetch(internal)` → internal (c)
- `gbtreekey16_in(cstring)` → gbtreekey16 (c)
- `gbtreekey16_out(gbtreekey16)` → cstring (c)
- `gbtreekey2_in(cstring)` → gbtreekey2 (c)
- `gbtreekey2_out(gbtreekey2)` → cstring (c)
- `gbtreekey32_in(cstring)` → gbtreekey32 (c)
- `gbtreekey32_out(gbtreekey32)` → cstring (c)
- `gbtreekey4_in(cstring)` → gbtreekey4 (c)
- `gbtreekey4_out(gbtreekey4)` → cstring (c)
- `gbtreekey8_in(cstring)` → gbtreekey8 (c)
- `gbtreekey8_out(gbtreekey8)` → cstring (c)
- `gbtreekey_var_in(cstring)` → gbtreekey_var (c)
- `gbtreekey_var_out(gbtreekey_var)` → cstring (c)
- `get_all_users()` → TABLE(id uuid, email text, name text, role text, created_at timestamp with time zone) (plpgsql)
- `get_connection_details(connection_id uuid, encryption_key text)` → TABLE(id uuid, name character varying, db_type database_type, host character varying, port integer, database_name character varying, username character varying, password text, ssl_enabled boolean, connection_timeout integer, max_pool_size integer) (plpgsql)
- `get_notice_stats(p_notice_id uuid)` → json (plpgsql)
- `get_public_tables()` → TABLE(table_name text, table_type text, table_schema text) (sql)
- `get_schemas_and_tables()` → jsonb (plpgsql)
- `get_unread_notices(p_user_id uuid)` → TABLE(id uuid, title text, content text, styles jsonb, created_at timestamp with time zone) (plpgsql)
- `get_user_branch(user_id uuid)` → text (sql)
- `get_user_companies(user_id uuid)` → TABLE(company_id uuid, company_name text, company_type text, schema_name text, parent_id uuid, role_name text, permissions text, active boolean) (plpgsql)
- `get_user_department(user_id uuid)` → text (sql)
- `get_user_role(user_id uuid)` → text (sql)
- `handle_new_user()` → trigger (plpgsql)
- `int2_dist(smallint, smallint)` → smallint (c)
- `int4_dist(integer, integer)` → integer (c)
- `int8_dist(bigint, bigint)` → bigint (c)
- `interval_dist(interval, interval)` → interval (c)
- `is_admin()` → boolean (sql)
- `is_owner()` → boolean (plpgsql)
- `marcar_notificacao_sistema_lida(p_id uuid, p_user uuid)` → void (sql)
- `migrate_single_to_multi_tenant()` → void (plpgsql)
- `movement_type_normalize(p_name text)` → text (plpgsql)
- `multi_tenant_status()` → TABLE(tipo text, total bigint, detalhes text) (sql)
- `nf_dominant_dealer(items jsonb)` → integer (sql)
- `notif_analise_credito_aprovada()` → trigger (plpgsql)
- `notif_analise_credito_nova()` → trigger (plpgsql)
- `notificar_aceite_recusa_renegociacao()` → trigger (plpgsql)
- `notificar_contraproposta()` → trigger (plpgsql)
- `notificar_contraproposta_renegociacao()` → trigger (plpgsql)
- `notificar_nova_solicitacao()` → trigger (plpgsql)
- `notificar_nova_solicitacao_renegociacao()` → trigger (plpgsql)
- `obter_fim_semana(data_input date)` → date (plpgsql)
- `obter_inicio_semana(data_input date)` → date (plpgsql)
- `obter_numero_semana_mes(data_input date)` → integer (plpgsql)
- `oid_dist(oid, oid)` → oid (c)
- `pdv_fiscal_proximo_numero(p_empresa integer, p_modelo integer)` → integer (plpgsql)
- `pdv_touch_atualizado_em()` → trigger (plpgsql)
- `pode_editar_despesa_filial()` → boolean (sql)
- `recalcular_meta_mensal()` → trigger (plpgsql)
- `recover_abandoned()` → void (plpgsql)
- `remover_saldo_manual(saldo_id bigint)` → json (plpgsql)
- `set_instance_access(p_instance_id text, p_access_type text, p_user_ids uuid[] DEFAULT NULL::uuid[], p_set_by uuid DEFAULT auth.uid())` → json (plpgsql)
- `set_message_queue_updated_at()` → trigger (plpgsql)
- `set_updated_at()` → trigger (plpgsql)
- `sync_auth_users_to_public()` → TABLE(synced_count integer, error_count integer, details jsonb) (plpgsql)
- `tg_set_updated_at()` → trigger (plpgsql)
- `time_dist(time without time zone, time without time zone)` → interval (c)
- `trg_bluecard_leads_touch()` → trigger (plpgsql)
- `trg_case_movement_set_type()` → trigger (plpgsql)
- `trg_expedicao_touch()` → trigger (plpgsql)
- `trg_rh_doc_adm_touch()` → trigger (plpgsql)
- `trg_rh_inscricoes_touch()` → trigger (plpgsql)
- `trg_rh_vagas_touch()` → trigger (plpgsql)
- `trg_tech_cotacoes_touch()` → trigger (plpgsql)
- `ts_dist(timestamp without time zone, timestamp without time zone)` → interval (c)
- `tstz_dist(timestamp with time zone, timestamp with time zone)` → interval (c)
- `update_analises_credito_updated_at()` → trigger (plpgsql)
- `update_antecipacoes_updated_at()` → trigger (plpgsql)
- `update_connection_test_result(connection_id uuid, success boolean, error_message text DEFAULT NULL::text)` → void (plpgsql)
- `update_data_alteracao()` → trigger (plpgsql)
- `update_observacoes_totvs_updated_at()` → trigger (plpgsql)
- `update_solicitacoes_remessa_updated_at()` → trigger (plpgsql)
- `update_tech_patrimonio_atualizado_em()` → trigger (plpgsql)
- `update_updated_at_column()` → trigger (plpgsql)
- `update_user_permissions_updated_at()` → trigger (plpgsql)
- `user_has_company_access(user_id uuid, company_id uuid)` → boolean (plpgsql)
- `user_has_permission(user_id uuid, company_id uuid, permission text)` → boolean (plpgsql)
- `user_has_whatsapp_instance_access(user_uuid uuid, instance_id text)` → boolean (plpgsql)
