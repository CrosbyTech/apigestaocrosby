# ERP HeadCoach — Fase 1: Vendas

Implantado em 19/10/2026. O marco 0 continua sendo 17/10/2026. Este é o terceiro módulo da fase 1, depois do [contas a pagar](./ERP-FASE1-CONTAS-PAGAR.md) e do [contas a receber](./ERP-FASE1-CONTAS-RECEBER.md). Ele cobre as transações de **todas as 290 empresas** e **todas as operações**, o **saldo atual de bônus/cashback** e os **vouchers**. A nota fiscal fica para o módulo fiscal.

## Tabelas (migrations/erp/0006_sales.sql)

| Tabela | Espelha | Linha |
|---|---|---|
| `general_transactions` | `GET general/v2/transactions/search`, com todos os campos e todos os `Expand` | 1 por transação |
| `general_transaction_items` | `items[]` | 1 por item, mantida por trigger |
| `general_transaction_installments` | `installment[]`, o plano de pagamento | 1 por parcela, mantida por trigger |
| `general_transaction_commands` | `POST general/v2/transactions` e `transaction-receiving` enviados pelo HeadCoach | 1 por envio |
| `person_balance_bonus` | `POST person/v2/list-balance-bonus` | 1 por CPF × empresa **com saldo ≠ 0** |
| `person_balance_bonus_checks` | cada consulta de saldo: CPF, total, quando e por quê | 1 por CPF |
| `person_bonus_commands` | `bonus-consume` e `bonus-due-date` enviados pelo HeadCoach | 1 por envio |
| `vouchers` | `GET voucher/v2/search` | 1 por voucher |
| `voucher_commands` | `voucher/v2/create`, `update` e `customer/create` enviados pelo HeadCoach | 1 por envio |

Views:

| View | O que mostra |
|---|---|
| `general_transactions_v` | transação com nome do cliente, da empresa, da operação e do vendedor |
| `vendas_v` | lista única de vendas: transações do TOTVS mais as vendas do PDV no modo HeadCoach (`pdv_vendas`) |
| `person_balance_bonus_v` | saldo com nome da pessoa e da empresa |

- **Chaves:**
  - Transação: `(branch_code, transaction_code)`. Testado sem repetição em 282 transações.
  - Voucher: `voucher_number`.
  - Saldo: `(person_cpf, branch_code)`.
- **Status da transação:** 1 em andamento, 4 atendida, 6 cancelada. O 5 aparece raramente.
- **Operações:** as transações de troca, transferência e entrada também entram. O tipo de cada uma sai de `erp_operacoes`, nas colunas `operation_name` e `operation_type` (E ou S) das views. As mesmas tabelas servem de base para o módulo de estoque.

## Como os dados chegam

| Entidade | Cron (`jobs/erp-sync.job.js`) | Como |
|---|---|---|
| `transacoes` | :00, :15, :30, :45 | Para cada uma das 290 empresas, busca as transações com data de alteração entre o cursor e agora. Uma passada leva cerca de 2 minutos. |
| `bonus_saldo` | logo depois de `transacoes` | Reconsulta o CPF de quem teve transação alterada desde o cursor e de quem teve bônus consumido ou concedido pelo HeadCoach. Também revalida um lote de quem tem saldo, porque o bônus vence sem movimento. Os limites são `ERP_BONUS_REVALIDAR_LOTE` (500) e `ERP_BONUS_REVALIDAR_HORAS` (24). |
| `vouchers` | :50 | Baixa a lista inteira, cerca de 51 mil, em 51 páginas de 1.000. O que deixa de vir ganha `removido_em`. |

**Escritas do HeadCoach.** Todas são registradas na tabela de comandos do módulo e, quando dão certo, o registro é relido no TOTVS. Isso roda em segundo plano, e nenhuma resposta de rota mudou.

- `totvsrouter/pdv.js`, no `callTotvs`, cobre quatro operações:
  - criação de transação, no PDV e no fechamento da pré-venda do Orçamento RFID;
  - recebimento;
  - consumo de cashback;
  - concessão de cashback.
- Vouchers: `totvsrouter/voucher.js` (lote, varejo e promoções) e `routes/tech.routes.js` (criar vouchers em lote). O voucher novo aparece na tabela no snapshot da hora seguinte.

## Saldo de bônus/cashback: como a carga funciona

A API só consulta **um CPF por vez**, mas cada consulta cobre as 290 empresas e leva cerca de 1,4 segundo. Não existe consulta em lote nem lista de movimentos. Por isso a carga do saldo atual é feita por CPF, com 3 consultas em paralelo (`ERP_BONUS_CONCORRENCIA`).

- **Quem entra:** os clientes das notas espelhadas desde 08/2025 e os das transações, cerca de 46 mil códigos de cliente, dos quais só os PF.
  - As notas espelhadas não trazem o CPF preenchido, então o CPF sai do cadastro: primeiro `erp_pessoas`, depois `pes_pessoa` e, por último, o TOTVS.
  - Com `opcoes.todos`, a carga inclui todo PF cadastrado, cerca de 121 mil.
- **Retomável:** se cair, a próxima execução pula quem já foi consultado desde o início da carga, usando `erp_sync_controle.checkpoint`.

```bash
node scripts/erp-carga-inicial.mjs bonus_saldo        # saldo atual de quem comprou
```

## Histórico (manual, quando decidir)

```bash
node scripts/erp-carga-inicial.mjs transacoes --desde 2023-01-01 --ate 2026-10-16
```

A busca histórica vai por data de **alteração**, em janelas de 30 dias, porque a API não aceita mais de 31 dias por consulta. Cada transação aparece uma vez, na janela da última alteração dela. São 290 empresas vezes cerca de 46 janelas, umas 13 mil chamadas, o que dá algumas horas. A carga pode ser repetida, porque o upsert é pela chave.

## Primeira execução (19/10/2026)

| Item | Valor |
|---|---|
| Transações desde o marco 0 | 600, em 51 empresas com movimento e nenhuma empresa pulada, em 118 s |
| Itens / parcelas (trigger) | 1.737 / 497 |
| Status | 4 atendida: 496 · 6 cancelada: 90 · 1 em andamento: 14 |
| Conferência 1:1 (filial 95, alteradas em 18/10) | 34 de 34 transações idênticas ao TOTVS em todos os campos |
| Vouchers | 50.965 de 50.965, sendo 48.331 em andamento e 547 encerrados, em 375 s |
| Teste do saldo de bônus | cliente 38: R$ 291,69 em 3 empresas, incluindo a franquia 6156 · cliente 31385: R$ 211,99 em 4 empresas |

## Pegadinhas da API

- A busca de transações é **GET** e aceita **uma empresa por chamada**. Uma lista do tipo `1,95,99` dá erro.
- Com empresa informada, é obrigatório mandar `TransactionDate` ou `StartChangeDate` com `EndChangeDate`. A janela é de no máximo 31 dias e o PageSize de no máximo 500.
- O filtro por alteração traz as transações novas: 34 de 34 na filial 95 e 5 de 5 na 90.
- Em `Expand`, só `installment`, `originDestination` e `additionalInformation` acrescentam dados. `relatedFiscalDocument` veio sempre `null`.
- `list-balance-bonus` exige `personCpf` e `branchList`. Não aceita lista de CPFs nem código de pessoa.
- `voucher/v2/search` ignora `StartChangeDate`, que devolve os 51 mil. O PageSize chega a 1.000.
- O pedido de venda (`sales-order`) não é usado pelo TOTVS da Crosby: a busca veio vazia em 2023 e em 2026.

## Correções feitas junto

- **Leituras no TOTVS:** agora são repetidas até 3 vezes em 5xx, timeout ou falha de rede. Escritas nunca são repetidas.
- **Cadastro inválido:** um registro com dado impossível no TOTVS (a pessoa 67791 tem data inválida) derrubava a página inteira, e foi isso que travou a carga de PF da fase 0 em 61 mil. A paginação agora relê a página em pedaços menores e pula só o registro ruim.
- **Delta de preços:** passou a mandar `change.priceCodeList`, que o TOTVS exige.

## Limitações

- **Transação apagada no TOTVS:** continua na tabela. Transação cancelada vem com status 6.
- **Movimentos de bônus:** a API não expõe extrato, só o saldo atual. O histórico de movimentos fica só para o que o HeadCoach envia (`person_bonus_commands`).
- **Saldo fora da lista de compradores:** pode existir saldo de quem não aparece nas notas desde 08/2025 nem nas transações. Para cobrir esses casos, rode a carga com `todos`.
