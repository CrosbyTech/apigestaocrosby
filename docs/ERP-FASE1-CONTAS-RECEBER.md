# ERP HeadCoach — Fase 1: Contas a Receber

Implantado em 17/10/2026, o **marco 0**. É o segundo módulo da fase 1, depois do [contas a pagar](./ERP-FASE1-CONTAS-PAGAR.md). Segue a mesma regra: tabelas no formato da API v2 e cópia mantida a partir de hoje. O histórico entra depois, pela carga manual.

## Tabelas (migrations/erp/0005_accounts_receivable.sql)

| Tabela | Espelha | Linha |
|---|---|---|
| `accounts_receivable_documents` | `DocumentModel` de `POST accounts-receivable/v2/documents/search` (todos os 40 campos) | 1 por parcela |
| `accounts_receivable_document_invoices` | `invoice[]`, a NF vinculada ao título | 1 por NF, mantida por trigger |
| `accounts_receivable_commands` | `InvoicesPaymentCommand` (baixa), `change-charge-type` (tipo de cobrança) e `payment-link` (PIX) enviados pelo HeadCoach, com resposta e erro | 1 por envio |
| `accounts_receivable_documents_v` | view com nome do cliente, nome da empresa, `open_value` e `days_late` | — |

- **Colunas:** são os campos da API em snake_case. A única exceção é `check`, que vira `check_data`, porque CHECK é palavra reservada no Postgres.
- **Chave:** `(branch_code, customer_code, receivable_code, installment_code)`. O número do título se repete entre clientes. Numa amostra de 2.500 parcelas, sem o cliente sobravam só 1.712 chaves únicas.
- **status:** `1` normal e `3` cancelado. Os valores 2, 4, 5 e 6 não aparecem em 2026.
- **Valores preservados no update:** o trigger guarda o valor anterior de `max_change_filter_date`, `invoice` e `classifications` quando a busca os devolve vazios. O primeiro só vem preenchido no filtro de alteração; os outros dois só vêm com `expand`.
- **Controle e RLS:** iguais aos do contas a pagar.

## Como os dados chegam

**1. Job a cada 15 minutos** (`jobs/erp-sync.job.js`, nos minutos :10, :25, :40 e :55, entidade `contas_receber`). Diferente do pagar, aqui o filtro de alteração traz tudo. No dia do teste vieram nele 409 dos 409 títulos emitidos e 178 dos 178 pagos. As outras duas buscas são só margem de segurança.

| Busca | Filtro da API | Padrão |
|---|---|---|
| Alterações | `filter.change {startDate: cursor, endDate: agora, inReceivable: true}` | inclusões, baixas e cancelamentos |
| Janela de emissão | `startIssueDate` + `endIssueDate` | últimos `ERP_AR_JANELA_EMISSAO_DIAS` (3) |
| Janela de pagamento | `startPaymentDate` + `endPaymentDate` | últimos `ERP_AR_JANELA_PAGAMENTO_DIAS` (3) |

Todas as buscas usam `expand=invoice,classifications` e `pageSize=1000`. Não é preciso passar `branchCodeList`, então a busca cobre todas as empresas do TOTVS.

**2. Escritas feitas pelo HeadCoach**, registradas em `accounts_receivable_commands` e com o título relido no TOTVS em seguida:

| Onde | O que |
|---|---|
| `totvsrouter/fiscal.js` → `/invoices-settle` (SolicitacaoBaixa, BatidaCarteira) | cada baixa enviada, com sucesso ou erro, incluindo o fallback da empresa 1 |
| `services/bluecardLimite.js` → `postTotvs` (compartilhado) | baixa do retorno Pagar.me, carteira simples na emissão do boleto Pagar.me e PIX do BlueCard |

Tudo roda em segundo plano. Nenhuma resposta de rota mudou. `bank-slip` ficou de fora de propósito: ele só gera o PDF de um boleto já registrado, é chamado o dia todo pelo job de cobrança e não altera o título.

**3. Carga histórica (manual):**

```bash
node scripts/erp-carga-inicial.mjs contas_receber --desde 2023-01-01 --ate 2026-10-16
```

A carga vai por emissão, mês a mês, em todas as empresas. Ela é grande: 1,37 milhão de títulos no TOTVS inteiro, 193 mil só em 2023 contando as franquias e 68 mil nos últimos 120 dias. A 1.000 por página, conte algumas horas. Ela pode ser interrompida e repetida, porque o upsert é pela chave.

## Primeira execução (17/10/2026)

| Item | Valor |
|---|---|
| Títulos gravados | 1.866 |
| Vindos de cada busca | 421 alterações, 1.773 da janela de emissão, 805 da janela de pagamento, com sobreposição |
| NFs vinculadas (trigger) | 1.006 |
| Status | 1 = 1.858 · 3 = 8 |
| Tempo da rodada | 63 s, 4 páginas |
| Conferência 1:1 (emissão 16/10) | 575 de 575 títulos idênticos ao TOTVS em todos os campos |

## Onde ver

- A tela **Administração → Integração ERP** mostra a entidade `contas_receber` na aba Sincronização.
- Na aba Cadastros, as opções `contas_receber` e `contas_receber_comandos` permitem consultar as tabelas.
- API: `GET /api/erp/cadastros/contas_receber?q=&empresa=` busca por nome ou documento do cliente, portador, número do título e código do cliente.

## Pegadinhas da API descobertas

- **`startSettlementDate` é ignorado** e devolve os 1,37 milhão de títulos. Para pagamentos, use `startPaymentDate` e `endPaymentDate`.
- `startIssueDate` só filtra quando `endIssueDate` vem junto.
- Em `expand`, só `invoice` e `classifications` trazem dados. `calculateValue`, `commissions` e `check` vêm `null`.
- `receivableCodeList`, `customerCodeList` e `customerCpfCnpjList` funcionam como filtros.

## Limitações conhecidas

- **Título apagado no TOTVS:** continua na tabela, como no pagar. A reconciliação de períodos fechados é o próximo passo.
- **Telas existentes:** inadimplência, Call Center, Dash e Metas continuam lendo o TOTVS ao vivo. Repontar essas telas vem depois que o espelho estabilizar.
