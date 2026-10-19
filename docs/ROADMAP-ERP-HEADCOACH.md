# Roadmap — HeadCoach como ERP (saída do TOTVS)

Data do levantamento: 17/10/2026. Base: apigestaocrosby (backend, 878 commits) + gestaocrosby (HeadCoach, 141 páginas, ~181 mil linhas).

> **Status:** Fase 0 implantada em 17/10/2026 — ver [ERP-FASE0.md](./ERP-FASE0.md) (migrations, sync dos cadastros, outbox, modos, tela Integração ERP, segurança e pendências).
>
> **Fase 1 — marco 0 = 17/10/2026.** Decisão: tabelas no formato da API TOTVS v2 (nomes dos campos em snake_case), um módulo por vez. Implantados: contas a pagar ([ERP-FASE1-CONTAS-PAGAR.md](./ERP-FASE1-CONTAS-PAGAR.md)), contas a receber ([ERP-FASE1-CONTAS-RECEBER.md](./ERP-FASE1-CONTAS-RECEBER.md)) e vendas — transações, saldo de bônus/cashback e vouchers ([ERP-FASE1-VENDAS.md](./ERP-FASE1-VENDAS.md)). Próximos: estoque, fiscal. Tela de conferência registro a registro em Administração → Conferência ERP ([ERP-CONFERENCIA.md](./ERP-CONFERENCIA.md)).

## 1. Onde estamos hoje

**Como o TOTVS é acessado.** Só via REST (`www30.bhan.com.br:9443/api/totvsmoda`), token OAuth em `utils/totvsTokenManager.js`. Não existe acesso direto ao banco do TOTVS; a réplica Postgres antiga (`fatvarejo`, `fatbazar`…) foi desligada em 03/2026. Isso importa porque **toda migração de histórico terá de sair pela API**, com os limites dela (janela de 6 meses em NFs, paginação de 100, listas grandes derrubam o servidor).

**O que já é nosso (Supabase `dorztqiunewggydvkjnf`).**
- Venda varejo + fiscal: `pdv_vendas`, `pdv_venda_itens`, `pdv_venda_pagamentos`, `pdv_notas_fiscais`, `pdv_fiscal_config`, `pdv_epc_movimentos`, `pdv_cupons_troca`. Emissão NFC-e/NF-e direta na SEFAZ (`services/pdvFiscal.js`). O toggle TOTVS | HEADCOACH do PDV Crosby já existe.
- Contas a pagar (aprovação): `pagamentos_liberacao`, `pagamentos_fabricas`, `solicitacoes_crosby` (já guarda `payload_totvs` + `enviado_totvs_em`), `despesas_fixas_filial`, `despesas_industria_pagamentos`, `saldo_bancario`.
- Contas a receber (cobrança): `solicitacoes_baixa`, `pagarme_boletos`, `automacao_boleto_envios`, `esteira_protesto`, `antecipacoes_faturas`, `bluecard_titulos`, timelines de inadimplência, call center.
- Caixa/bancos: `fluxo_caixa_*` (extratos PDF), `stone_conciliacao_*`, OFX→CNAB.
- Fiscal entrada: `sefaz_dfe_notas` (XML das NF-e emitidas contra nossos CNPJs).
- Devoluções: `devolucoes_mercadoria`, `devolucoes_transacoes`.
- Espelhos do TOTVS: `notas_fiscais` (NF de saída, 69 usos no código), `pes_pessoa` (pessoas), `forecast_painel_vendas`, `faturamento_*`, `canal_totals_cache`.

**O que NÃO existe nativo (os buracos do ERP).**
- Cadastro de produtos / SKU / cor / grade / código de barras / EPC. Hoje até o EPC é resolvido pelo TOTVS.
- Tabela de preço e custo.
- Saldo de estoque e movimentação (kardex). Só existe rastro por EPC das vendas HEADCOACH.
- Razão de contas a receber (títulos/parcelas/baixas) — lido ao vivo do TOTVS por ~12 páginas.
- Razão de contas a pagar (duplicatas) — lido ao vivo por ~10 páginas.
- Pedido de venda B2B (revenda, multimarcas, franquia) — hoje é 100 % TOTVS.
- Entrada de NF de compra (escrituração + estoque + título a pagar).
- Transferência entre lojas, inventário de estoque, ajuste.
- Cashback/bônus e limite de crédito (vivem em `person/v2` do TOTVS).
- Cadastro de fornecedor, plano de despesas, centro de custo, portadores.

**Escritas no TOTVS hoje (18 pontos, todos precisam de dupla gravação na fase 1).**
- Vendas: `general/v2/transactions` (PDV, Orçamento RFID), `transaction-receiving` (quebrado no bhan — serviço TOMAS), `bonus-consume`, `bonus-due-date`.
- Receber: `invoices-payment` (SolicitacaoBaixa, BatidaCarteira, retorno Pagar.me), `change-charge-type`, `bank-slip`, `payment-link` (PIX BlueCard).
- Pagar: `accounts-payable/v2/duplicates` e `group-duplicates` (SolicitacoesCrosby).
- Pessoas: `individual-customers`/`legal-customers` (CadastrarCliente, modal PDV, fornecedor, limite, inativar, BlueCard, Autentique, Remessa).
- Vouchers: `voucher/v2/create|update|customer/create`.

**Dívidas técnicas que viram risco quando o HeadCoach vira ERP.**
- `supabaseAdmin` (service_role) usado no navegador em 17 arquivos; chave hardcoded em `src/lib/supabase.js` e `config/supabase.js`.
- `GET /api/totvs/token` sem autenticação; credenciais TOTVS hardcoded em `utils/totvsTokenManager.js`; senha Evolution em `config/evolution.js`.
- ~20 tabelas usadas no código sem SQL no git (`pes_pessoa` base, `metas_*`, `whatsapp_accounts`…). Não há ferramenta de migration; DDL roda via `exec_sql`.
- Regras duplicadas front/back (inadimplência, protesto) e páginas gêmeas (Revenda/MTM ~97 % iguais).
- Endpoints mortos ainda chamados pelo front (`/api/sales/*`, `/api/faturamento/fatbazar`): DRE, DashboardVarejo, CredevVarejo, ExtratosBancos.

**Dependência escondida: obrigações fiscais/contábeis.** O TOTVS hoje gera SPED Fiscal (EFD ICMS/IPI), EFD-Contribuições, livros, apuração de ICMS/PIS/COFINS e integração contábil. Nada disso existe no HeadCoach. Precisa decidir cedo: HeadCoach gera os SPEDs, ou o escritório contábil gera a partir dos XMLs + relatórios que o HeadCoach exporta. Sem essa decisão não dá para desligar o TOTVS.

## 2. Princípios de arquitetura para a transição

1. **Manter os códigos do TOTVS como chave natural** (`cd_empresa`, `person_code`, `product_code`/`sku`, `nr_fat`/`nr_parcela`, `nr_duplicata`, `seller_code`). As 140 páginas continuam funcionando; o que muda é de onde o dado vem. Ids próprios ficam em paralelo e a numeração nova continua a sequência do TOTVS após o corte.
2. **Coluna `origem` em toda tabela de movimento** (`totvs` | `headcoach`) e `totvs_ref` (jsonb com os códigos do ERP). Permite saber o que nasceu onde e reconciliar.
3. **Dupla gravação assíncrona, nunca síncrona.** HeadCoach grava primeiro em transação própria, depois um worker envia ao TOTVS via tabela `integracao_outbox` (destino, payload, status, tentativas, erro, resposta). O TOTVS cai, demora 90 s e devolve 503 — a venda não pode depender dele.
4. **Dois sentidos na fase 1.** HeadCoach→TOTVS (outbox) para o que nasce no HeadCoach; TOTVS→HeadCoach (sync incremental) para o que ainda nasce no TOTVS (compras lançadas pelo financeiro, encerramento no TRAFP005, FISFP082, ajustes de estoque). Tudo converge nas tabelas próprias.
5. **Modo por módulo e por empresa**: tabela `erp_config(empresa, modulo, modo)` com `totvs` | `dual` | `headcoach`. O corte é virar flag, loja a loja.
6. **Reconciliação diária com tela de divergências** (vendas por NF, títulos a receber, duplicatas a pagar, saldo por SKU/filial). É o que dá segurança para apertar o botão de bloquear o TOTVS.
7. **Uma camada de acesso a dados no backend** (repositório por domínio: vendas, receber, pagar, estoque, pessoas, produtos). As páginas param de montar query TOTVS; chamam `/api/erp/...` que resolve a origem pelo modo.

## 3. Fases

### Fase 0 — Fundação (pré-requisito de tudo)

**Segurança e base de dados**
- Tirar `supabaseAdmin` do navegador; RLS por tabela; rotacionar as chaves hardcoded; autenticar `/api/totvs/token` e `/api/sms`.
- `pg_dump --schema-only` do Supabase para o git; adotar migrations versionadas (pasta `migrations/` com runner único, ou Supabase CLI).
- Limpar os endpoints mortos e as páginas órfãs (FaturamentoCanal 6.9k linhas, DashboardVendas, AjustesCredev, pmr…).

**Cadastros mestres (schema + importação inicial do TOTVS + sync incremental)**
- `erp_empresas` (filiais: CNPJ, IE, UF, regime, certificado, séries) — já existe meio caminho em `pdv_fiscal_config` + `config/sefazFiliais.js`.
- `erp_pessoas` (evoluir `pes_pessoa`: PF/PJ, cliente/fornecedor/vendedor/representante, classificações, endereços, limites) — fonte `person/v2`.
- `erp_produtos`, `erp_skus` (cor/tamanho), `erp_codigos_barras` (EAN + EPC/RFID), tributação por NCM/CEST — fonte `product/v2/products/search` + `product-codes/search` + `colors`/`grid`.
- `erp_tabelas_preco`, `erp_precos`, `erp_custos` — fonte `prices/search`, `price-tables/search`, `costs/search`.
- `erp_operacoes` (CFOP, natureza, gera estoque?, gera financeiro?), `erp_condicoes_pagamento`, `erp_portadores`, `erp_despesas_itens`, `erp_centros_custo`, `erp_vendedores`.
- Cashback: `erp_bonus_saldo` + `erp_bonus_movimentos` (hoje só no TOTVS `list-balance-bonus`).

**Infra de integração**
- `integracao_outbox` + worker com retry/backoff e idempotência (chave natural por operação).
- `erp_config` (modo por módulo/empresa) e middleware que resolve a origem.
- Páginas: Divergências TOTVS × HeadCoach; Fila de integração (outbox).

Resultado da fase 0: o HeadCoach tem todos os cadastros em casa, sincronizados; nenhuma página mudou ainda.

### Fase 1 — Dupla gravação (vendas, receber, pagar, estoque)

**1A. Estoque** (o maior buraco; começar por ele porque venda, devolução e entrada dependem dele)
- `est_movimentos` (empresa, sku, tipo, qtd, documento, origem) + view/materialização `est_saldos(empresa, sku)`.
- Carga inicial de saldos por filial via `product/v2/balances/search`; a partir daí sync incremental via `omni-changed-balances` (saldos alterados desde data) e `kardex-movement` para o que o TOTVS ainda movimenta.
- Movimentos próprios: venda PDV (já tem o EPC em `pdv_epc_movimentos`; gerar o movimento por SKU), devolução (`devolucoes_transacoes`), entrada por NF, transferência, ajuste/inventário.
- Telas: consulta de saldo por SKU/filial, transferência entre lojas (saída+entrada com NF-e de transferência), entrada de mercadoria a partir do XML em `sefaz_dfe_notas`, inventário (portal UR4 + leitor RFID já existem), ajuste.
- Dual: transferência/ajuste feitos no HeadCoach também geram `general/v2/transactions` no TOTVS (outbox); o que for feito no TOTVS entra pelo sync.
- Reconciliação: saldo HeadCoach × saldo TOTVS por SKU/filial, diariamente.

**1B. Vendas**
- Varejo: no modo TOTVS do PDV Crosby, gravar também `pdv_vendas/itens/pagamentos` com `origem=totvs` e vincular a NF quando a transação vira ATENDIDA (já existe `transaction-invoice`). Assim toda venda varejo passa a existir no HeadCoach independente do modo. Gerar `est_movimentos` e títulos a receber (1C) de ambas as origens.
- Não vale a pena mandar a venda HEADCOACH para o TOTVS: o `transaction-receiving` está quebrado e o TOTVS emitiria uma segunda NF. Dual, para varejo, significa: TOTVS emite (modo TOTVS) e o HeadCoach espelha. O corte é trocar o toggle, loja a loja.
- Pré-requisitos do modo HEADCOACH em todas as lojas: série ≠ 3 e CSC por empresa (FiscalPDV), certificado por raiz de CNPJ (5 já carregam), contingência offline/EPEC, inutilização de numeração, DIFAL para NF-e interestadual, DANFE completo.
- B2B (revenda/MTM/franquia): fase 1 = espelhar pedidos via `sales-order/v2/orders/search` em `ven_pedidos` + itens, e as NFs já em `notas_fiscais`. Pedido de venda nativo (com faturamento NF-e, IPI, ST, DIFAL, condições de pagamento, comissão de representante) fica para a fase 2 porque é um módulo inteiro.
- Painéis e forecast: trocar a fonte de `sale-panel/*` por consultas sobre `pdv_vendas` + `notas_fiscais` + `ven_pedidos`. `notas_fiscais` passa a receber também as NFs emitidas pelo HeadCoach (`pdv_notas_fiscais`), para que CRM/forecast/mix não quebrem.

**1C. Contas a receber**
- `fin_titulos_receber` (empresa, cliente, nr_fat, parcela, tipo documento, portador, emissão, vencimento, valor, situação, origem) + `fin_baixas_receber` (data, valor, juros, desconto, forma, comprovante).
- Carga e sync incremental de `accounts-receivable/v2/documents/search` (lembrar: `startIssueDate` só filtra com `endIssueDate`; filtrar `statusList`; usar data de alteração).
- Geração nativa: venda PDV gera parcelas (cartão com NSU, PIX, dinheiro, crediário/BlueCard) — hoje só o TOTVS gera.
- Dual na baixa: SolicitacaoBaixa, BatidaCarteira e retorno Pagar.me gravam `fin_baixas_receber` e enfileiram `invoices-payment` no outbox. O `pagarme_boletos.baixa_status` já é o protótipo disso.
- Boletos: hoje `bank-slip` do TOTVS registra no Sicredi (portador 748). Precisa de emissão própria (Pagar.me já existe; ou API Sicredi/remessa CNAB + retorno). Sem isso não dá para bloquear o TOTVS no receber.
- Repontar as 7 páginas de inadimplência, Call Center, Dash/Metas, BlueCard (`bluecard-limite.job`, `bluecard-pagamentos-sync`), cobrança WhatsApp e `/api/cobranca/inadimplentes` para `fin_titulos_receber`. Vale unificar Revenda/MTM/Franquias numa página só nessa passagem.
- Reconciliação: títulos abertos e baixas do dia, HeadCoach × TOTVS.

**1D. Contas a pagar**
- `fin_titulos_pagar` (empresa, fornecedor, nr_duplicata, parcela, despesa item, centro de custo, portador, emissão, vencimento, valor, situação, origem, dados de pagamento) + `fin_baixas_pagar`.
- Carga e sync incremental de `accounts-payable/v2/duplicates/search`.
- Geração nativa: SolicitacoesCrosby grava em `fin_titulos_pagar` primeiro e o outbox manda `duplicates` ao TOTVS (hoje já guarda `payload_totvs`). Entrada de NF de compra (1A) gera as parcelas a pagar a partir do XML (`dup` da NF-e).
- Baixa: `pagamentos_liberacao` status PAGO vira `fin_baixas_pagar`. A API do TOTVS não tem baixa de AP usada hoje — o financeiro continua baixando no TOTVS na fase 1 e a reconciliação aponta o que ficou aberto num lado só.
- Repontar ContasAPagar, DashContasAPagar, CTO, Renegociacoes, DespesasGerais/DRE, Despesas* para `fin_titulos_pagar`. DRE já está quebrada (endpoints mortos): reconstruir sobre as tabelas novas.
- Reconciliação: duplicatas abertas e pagas do dia.

**Pessoas e cashback (correm junto com 1B/1C)**
- Cadastro de cliente/fornecedor grava `erp_pessoas` primeiro e enfileira `individual-customers`/`legal-customers`. Limite de crédito, inativação e classificação idem. BlueCard passa a ler limite/títulos do HeadCoach.
- Cashback: PDV grava `erp_bonus_movimentos` e enfileira `bonus-consume`/`bonus-due-date`.
- Vouchers: gerar e validar nativamente (`promocao_vouchers` já existe); manter outbox para `voucher/v2` enquanto o PDV TOTVS os usa.

### Fase 2 — Corte (bloquear o TOTVS)

Critério por módulo e por empresa: N dias consecutivos sem divergência na reconciliação e todas as telas já lendo das tabelas próprias.

1. Virar `erp_config` para `headcoach` loja a loja: PDV em modo HEADCOACH, estoque/receber/pagar sem outbox.
2. Importar o histórico que ainda falta pela API antes de perder o acesso (NFs além dos espelhos, títulos liquidados, kardex) e guardar o XML de tudo.
3. Pedido de venda B2B nativo + faturamento NF-e (módulo novo, grande). Até ele existir, o B2B é o último a sair do TOTVS.
4. Fiscal/contábil: SPED Fiscal, EFD-Contribuições, apuração de impostos, livros, exportação para a contabilidade. Decidir se o HeadCoach gera ou se exporta para o contador. É o item que mais costuma segurar a saída de um ERP.
5. Desligar jobs de sync TOTVS→HeadCoach, remover `totvsrouter/*` das rotas vivas e manter o TOTVS em leitura só para auditoria pelo tempo contratual.

### Fase 3 — O que fica fora dos 4 módulos e ainda depende do TOTVS
Pedido de compra de mercadoria, produção (Dryland é separado), comissão de representante, crediário próprio (hoje BlueCard), conciliação bancária com baixa automática, relatórios gerenciais (ranking, top clientes, compras de franquias) — todos viram consultas sobre as tabelas próprias.

## 4. Ordem sugerida e dependências

```
Fase 0: segurança/migrations → cadastros mestres (empresas, pessoas, produtos, preços, operações) → outbox + erp_config + tela de divergências
Fase 1: 1A estoque (carga + movimentos + reconciliação)
        → 1B vendas (espelho do modo TOTVS + notas_fiscais unificada)
        → 1C receber (razão + baixa dual + boleto próprio)
        → 1D pagar (razão + entrada por XML + liberação)
        → pessoas/cashback/vouchers dual
        → repontar páginas (inadimplência, financeiro, painéis, DRE)
Fase 2: corte loja a loja → histórico → B2B nativo → SPED/contábil → desligar TOTVS
```

## 5. Primeiros passos concretos

1. Decidir o destino do fiscal/contábil (SPED) — conversar com o contador.
2. Tirar o service_role do navegador e versionar o schema (fase 0, sem risco).
3. Escrever o schema dos cadastros mestres + estoque + receber + pagar e rodar a carga inicial do TOTVS numa tabela com `origem=totvs`.
4. Construir `integracao_outbox` + worker e migrar a primeira escrita (SolicitacoesCrosby → duplicatas) para passar por ele.
5. Fazer o PDV modo TOTVS espelhar em `pdv_vendas` e gerar `est_movimentos`/títulos; ligar a reconciliação de vendas e estoque.
