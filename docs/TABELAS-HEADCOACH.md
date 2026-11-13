# Tabelas do Supabase — partes que rodam só no HeadCoach

Levantado do código em 13/11/2026 (o que cada tela/serviço lê e grava de verdade).
Banco: Supabase principal do HeadCoach. As tabelas `hc_*` têm **RLS ligado e sem
política** (só a API, com a service role, lê e grava) e **não deixam apagar**
(trigger) — o que foi lançado errado é estornado/cancelado, nunca apagado.

## Resumo

| Parte | Tabelas |
|---|---|
| **TRANSAÇÕES** (HeadCoach › Transações) | `pdv_vendas`, `pdv_venda_itens`, `pdv_venda_pagamentos`, `pdv_notas_fiscais`, `pdv_epc_movimentos`, `devolucoes_transacoes`, `devolucoes_mercadoria`, `pedidos_venda_faturamentos` (+ `erp_empresas`, `erp_operacoes` para os nomes) |
| **CAIXA** (Abertura, Contagem, Fechamento e encerramento) | `hc_caixa_datas`, `hc_caixas`, `hc_caixa_movimentos`, `hc_caixa_contagens`, `hc_caixa_encerramentos` (+ `pdv_vendas.caixa_id`) |
| **CONTAS A RECEBER** (HeadCoach › Financeiro) | `hc_cr_titulos`, `hc_cr_baixas`, `hc_cr_conciliacoes`, `hc_cr_config` |
| **SALDO CLIENTE** (CREDEV e adiantamento) | `hc_cliente_saldos`, `hc_cliente_saldos_mov` (+ funções `hc_saldo_movimentar`, `hc_saldo_estornar_venda`) |
| **SALDO BÔNUS** (peça em falta no faturamento) | `faturamento_saldo_bonus` |
| **PDV CROSBY** | `pdv_vendas`, `pdv_venda_itens`, `pdv_venda_pagamentos`, `pdv_notas_fiscais`, `pdv_fiscal_config`, `pdv_epc_movimentos`, `pdv_cupons_troca`, `pdv_promocoes`, `pdv_promocao_itens` (+ função `pdv_fiscal_proximo_numero`) |
| **FATURAMENTO / FATURAMENTO BREJINHO** | `pdv_vendas` (origem `expedicao`) e filhas, `pedidos_venda_faturamentos`, `pedidos_venda_fila`, `pedidos_venda_dryland`, `pedidos_venda_dryland_itens`, `pedidos_venda_anexos`, `faturamento_duplicatas`, `fiscal_produto_tipo` + `hc_cr_titulos`, `hc_cliente_saldos`, `hc_caixas` |
| **TRANSFERÊNCIAS** | `transferencias_mercadoria`, `transferencias_transacoes` (+ `pdv_vendas` quando a transferência sai da 99 com NF-e) |
| **DEVOLUÇÕES** | `devolucoes_mercadoria`, `devolucoes_transacoes` |
| **RECEBIMENTO DE TRANSFERÊNCIA + ESTOQUE** | `hc_recebimentos_transferencia`, `hc_estoque_movimentos`, `hc_estoque_epcs` |
| **BALANÇO RFID** | `balanco_rfid_arquivos` |
| **ACESSO (quem vê qual empresa/página)** | `user_companies`, `setores`, `setor_usuarios`, `user_page_permissions` (+ `erp_empresas`) |

---

## TRANSAÇÕES

Tela **HeadCoach › Transações** (`/headcoach/transacoes`). Só leitura: junta tudo o
que o HeadCoach emite numa consulta estilo TRAFL016. Serviço `services/hcTransacoes.js`,
API `/api/hc/transacoes`.

| Tabela | O que é |
|---|---|
| `pdv_vendas` | Cabeçalho de toda venda/transação do HeadCoach: PDV Crosby, Faturamento (pedidos, Brejinho, avulso) e transferências da 99. O nº da transação é o `id`. Campos-chave: `empresa`, `origem` (`pdv` / `expedicao`), `canal`, `status`, `total`, `caixa_id`, `data_caixa`, `pedido_info` (JSON). |
| `pdv_venda_itens` | Peças da venda (produto, quantidade, preço, desconto, CFOP, EPCs). |
| `pdv_venda_pagamentos` | Formas de pagamento da venda (dinheiro, Pix, crédito, débito, boleto, credev, adiantamento, saldo bônus, vale-troca). |
| `pdv_notas_fiscais` | NF-e / NFC-e emitidas pelo HeadCoach (número, série, chave, status, XML). |
| `pdv_epc_movimentos` | Kardex das etiquetas RFID (que EPC saiu em qual venda). |
| `devolucoes_transacoes` | Devoluções recebidas (entram como transação "D" + id). |
| `devolucoes_mercadoria` | Solicitações de devolução (dados de apoio da devolução). |
| `pedidos_venda_faturamentos` | Registro de cada faturamento da expedição (aba Transações do Faturamento). |
| `erp_empresas`, `erp_operacoes` | Cópia local do cadastro do TOTVS, só para mostrar nomes de empresa e operação. |

Migrations: `pdv_crosby.sql`, `pdv_crosby_v2.sql`, `pdv_crosby_v3_doc_interno.sql`, `faturamento_expedicao_nf.sql`, `devolucoes_transacoes.sql`.

## CAIXA

Telas **HeadCoach › Caixa** (Abertura, Contagem, Fechamento e encerramento). Serviço
`services/hcCaixa.js`, API `/api/hc/caixa`. Migration `migrations/hc_caixa.sql`
(`node scripts/migrar-hc-caixa.mjs`).

| Tabela | O que é |
|---|---|
| `hc_caixa_datas` | Data de caixa atual de cada empresa (avança no encerramento do dia, volta no "Voltar data"). |
| `hc_caixas` | Cada caixa aberto/fechado: empresa, data de caixa, fundo inicial e final, quem abriu/fechou, diferença, resumo do fechamento. **Um caixa aberto por empresa** (a coluna `terminal` ficou, sempre 1). |
| `hc_caixa_movimentos` | Suprimento, retirada e retirada do fechamento (com estorno, nunca apagado). |
| `hc_caixa_contagens` | Cada contagem (valor em dinheiro + conferência das outras formas). Contagem salva fica travada; a reabertura fica registrada (`reaberta_em`, `reabertura_autorizada_por`). |
| `hc_caixa_encerramentos` | Encerramento diário (data → próxima data) e também o "Voltar data" (`proxima_data` menor que `data_caixa`). |
| `pdv_vendas.caixa_id` | Coluna que liga a venda (PDV e Faturamento) ao caixa em que entrou. |

## CONTAS A RECEBER

Tela **HeadCoach › Financeiro › Contas a Receber HeadCoach** (`/headcoach/contas-receber`).
Serviço `services/hcContasReceber.js`, API `/api/hc/contas-receber`, job
`jobs/hc-contas-receber.job.js` (a cada 5 min). Migration `migrations/hc_contas_receber.sql`
(`node scripts/migrar-hc-contas-receber.mjs [--gerar]`).

| Tabela | O que é |
|---|---|
| `hc_cr_titulos` | Os títulos. **Fatura = 9.000.000.000 + nº da transação**, uma parcela por forma de pagamento (boleto: uma por vencimento). Dinheiro, Pix, crédito e débito nascem pagos (liquidação D+1 para cartão e Pix); boleto nasce em aberto. Guarda cliente, NF, caixa, taxa, juros, multa, desconto, situação (`aberto` / `pago` / `cancelado`) e conciliação. |
| `hc_cr_baixas` | Baixa de título em aberto (data, juros, multa, desconto, valor recebido, forma, conta, quem baixou). Sem estorno. |
| `hc_cr_conciliacoes` | Conciliação D+1 de cartão e Pix (o que caiu × o que foi vendido; a diferença vira a taxa real). |
| `hc_cr_config` | Configuração única: juros ao mês, multa, taxas da maquininha e dias de liquidação. |

Lê também `pdv_vendas` (e filhas) para gerar os títulos e `hc_caixas` para a data de caixa.

## SALDO CLIENTE (CREDEV e adiantamento)

Tela **HeadCoach › Financeiro › Saldo Cliente** (`/headcoach/saldos-clientes`).
Serviço `services/hcSaldosClientes.js`, API `/api/hc/saldos-clientes` e
`/api/faturamento-expedicao/saldos-cliente/:cliente`, job `jobs/hc-saldos-clientes.job.js`
(devoluções, a cada 10 min). Migration `migrations/hc_saldos_clientes.sql`
(`node scripts/migrar-hc-saldos-clientes.mjs`).

| Tabela / função | O que é |
|---|---|
| `hc_cliente_saldos` | Saldo atual: uma linha por **empresa + cliente + tipo** (`credev` / `adiantamento`), com `valor_inicial` (o que veio do TOTVS) e `saldo` (nunca negativo). |
| `hc_cliente_saldos_mov` | Extrato: carga inicial, uso no faturamento, estorno, devolução, devolução cancelada, ajuste/crédito gerado à mão. |
| `hc_saldo_movimentar()` | Função SQL atômica que mexe no saldo e grava o extrato (recusa deixar negativo). |
| `hc_saldo_estornar_venda()` | Função SQL que devolve ao cliente o que uma venda usou (nota cancelada, pedido refaturado). |

Carga: relatório FCCR015 do TOTVS (`scripts/acertar-saldos-relatorio.mjs`). Lê
`devolucoes_transacoes` (devolução atendida soma ao CREDEV) e `pes_pessoa` (varredura).

## SALDO BÔNUS

| Tabela | O que é |
|---|---|
| `faturamento_saldo_bonus` | Livro-razão do saldo bônus do cliente gerado por peça em falta no faturamento (crédito, uso, estorno, cancelamento). Serviço `services/saldoBonus.js`. Migration `faturamento_saldo_bonus.sql`. |

## PDV CROSBY

Tela **HeadCoach › Varejo › PDV Crosby** (`/tecnologia/pdv-crosby`). API
`/api/pdv-crosby` (`routes/pdvCrosby.routes.js`), fiscal em `services/pdvFiscal.js`.

| Tabela / função | O que é |
|---|---|
| `pdv_vendas` | Cabeçalho da venda (ver Transações). |
| `pdv_venda_itens` | Peças vendidas. |
| `pdv_venda_pagamentos` | Pagamentos (cartão guarda NSU/autorização). |
| `pdv_notas_fiscais` | NFC-e / NF-e emitidas. |
| `pdv_fiscal_config` | Configuração fiscal por empresa (série, numeração, ambiente, operações, certificado). |
| `pdv_fiscal_proximo_numero()` | Função SQL que reserva o próximo número da nota. |
| `pdv_epc_movimentos` | Kardex das etiquetas RFID vendidas/estornadas. |
| `pdv_cupons_troca` | Cupons de troca emitidos e usados. |
| `pdv_promocoes`, `pdv_promocao_itens` | Promoções "GERAR NO PDV CROSBY". |

Migrations: `pdv_crosby.sql`, `pdv_crosby_v2.sql`, `pdv_crosby_v3_doc_interno.sql`, `pdv_cupons_troca.sql`, `pdv_promocoes.sql`.

## FATURAMENTO e FATURAMENTO BREJINHO

Telas **HeadCoach › Expedição** (Pedido de Venda, Faturamento) e **Expedição Brejinho**.
Serviço `services/faturamentoExpedicao.js`, API `/api/faturamento-expedicao`. Desde
13/11/2026 a transação e o contas a receber ficam **só no HeadCoach**.

| Tabela | O que é |
|---|---|
| `pdv_vendas` (+ itens, pagamentos, notas) | A venda do faturamento (`origem = 'expedicao'`, empresa 99), com `cobranca` (parcelas do boleto) e `pedido_info`. |
| `pedidos_venda_faturamentos` | Registro de cada faturamento (aba Transações do Faturamento). |
| `pedidos_venda_fila` | Fila de pedidos (cards do Dryland) que vão para faturar. |
| `pedidos_venda_dryland`, `pedidos_venda_dryland_itens` | Cópia dos pedidos de venda do Dryland (a cada 5 min). |
| `pedidos_venda_anexos` | Comprovantes anexados aos pedidos. |
| `faturamento_duplicatas` | Duplicatas enviadas para assinatura (boleto). |
| `fiscal_produto_tipo` | Produção própria × adquirido de terceiros por produto (define o CFOP). |
| `hc_cr_titulos` | Contas a receber gerado na emissão (ver Contas a Receber). |
| `hc_cliente_saldos` / `_mov` | CREDEV e adiantamento consumidos no faturamento. |
| `hc_caixas` | Caixa do HeadCoach da empresa 99 (tem que estar aberto para faturar). |
| `faturamento_saldo_bonus` | Saldo bônus (peça em falta). |

Migrations: `faturamento_expedicao_nf.sql`, `pedidos_venda_faturamentos.sql`, `pedidos_venda_fila.sql`, `pedidos_venda_dryland.sql`, `pedidos_venda_dryland_pagamento.sql`, `faturamento_duplicatas.sql`.

## TRANSFERÊNCIAS

Tela **HeadCoach › Expedição › Transferências** (`/transferencias-mercadoria`). API
`/api/transferencias`.

| Tabela | O que é |
|---|---|
| `transferencias_mercadoria` | Solicitações de transferência (incluindo as que vêm do Dryland). |
| `transferencias_transacoes` | Cada transferência feita (peças, EPCs, NF, situação). Saindo da 99, a NF-e é emitida pelo HeadCoach e a venda fica em `pdv_vendas` (`canal = 'transferencia'`, sem contas a receber). |

Migration: `transferencias_mercadoria.sql`.

## DEVOLUÇÕES

Tela **Devoluções de Mercadoria**. API `/api/devolucoes`.

| Tabela | O que é |
|---|---|
| `devolucoes_mercadoria` | Solicitações de devolução (link público, chamado no Dryland). |
| `devolucoes_transacoes` | Devoluções recebidas/conferidas. Status 4 (atendida) soma o valor ao CREDEV do cliente em `hc_cliente_saldos`. |

Migrations: `devolucoes_mercadoria.sql`, `devolucoes_mercadoria_local.sql`, `devolucoes_transacoes.sql`, `devolucoes_transacoes_fisfp082.sql`.

## RECEBIMENTO DE TRANSFERÊNCIA + ESTOQUE

Telas **HeadCoach › Estoque** (Recebimento de Transferência, Estoque). Serviço
`services/recebimentoTransferencia.js`, API `/api/recebimento-mercadoria`. Migration
`hc_estoque_recebimento.sql` (`node scripts/migrar-hc-estoque-recebimento.mjs`).

| Tabela | O que é |
|---|---|
| `hc_recebimentos_transferencia` | Um recebimento por transferência (o que veio, faltou e chegou de fora). |
| `hc_estoque_movimentos` | Entradas no estoque da loja (uma linha por etiqueta; sem etiqueta, pela quantidade). Saldo da loja = soma por empresa + produto. |
| `hc_estoque_epcs` | Onde está cada etiqueta RFID. |

Lê `transferencias_mercadoria` e `transferencias_transacoes` (o que foi enviado para a loja).

## BALANÇO RFID

Tela **HeadCoach › Estoque › Balanço RFID** (`/balanco-rfid/arquivos`) e o app Android.
API `/api/balanco-rfid`.

| Tabela | O que é |
|---|---|
| `balanco_rfid_arquivos` | Cada contagem enviada pelo app (EPCs lidos, loja, setor, quem contou, resumo por produto, downloads). |

Migrations: `balanco_rfid.sql`, `balanco_rfid_v2.sql`.

## ACESSO (quem vê qual empresa e qual página)

Regra única em `utils/empresasUsuario.js`, usada por todas as páginas do HeadCoach.

| Tabela | O que é |
|---|---|
| `user_companies` | Empresas vinculadas a cada usuário (Painel Admin). Vendedor da loja = a loja dele. |
| `setores`, `setor_usuarios` | Setores e membros. REVENDA, MULTIMARCAS e EXPEDIÇÃO veem as empresas fixas 99 e 990. |
| `user_page_permissions` | Páginas liberadas para cada usuário (Gerenciador de Acessos; modelos por perfil em `gestaocrosby/src/config/modelosAcesso.js`). |
| `erp_empresas` | Lista das empresas próprias (cópia do TOTVS) de onde sai o seletor de empresa. |

Owner e admin veem todas as empresas.
