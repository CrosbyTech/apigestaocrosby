# ERP HeadCoach — Fase 1: Contas a Pagar

Implantado em 17/10/2026, que é o **marco 0**. A partir dele, o HeadCoach mantém uma cópia fiel do contas a pagar do TOTVS, no mesmo formato da API v2. O histórico anterior entra depois, pela carga manual descrita abaixo. Este é o primeiro dos cinco módulos da fase 1. Os outros são receber, vendas, estoque e fiscal.

## Tabelas (migrations/erp/0004_accounts_payable.sql)

Os nomes das colunas são os nomes dos campos da API em snake_case: `branchCode` vira `branch_code`, `duplicateValue` vira `duplicate_value`, e assim por diante.

| Tabela | Espelha | Linha |
|---|---|---|
| `accounts_payable_duplicates` | `DuplicateOutModel` (`POST accounts-payable/v2/duplicates/search`) + campos do `CreatedDuplicateCommand` (`branch_cnpj`, `document_type`, `prevision_type`, `stage_type`, `observation`) | 1 por parcela |
| `accounts_payable_duplicate_expenses` | `expense[]` da parcela (rateio despesa × centro de custo) | 1 por item de rateio, mantida por trigger a partir da coluna `expense` |
| `accounts_payable_commands` | `CreatedDuplicateCommand` / `GroupDuplicatesCommand` enviados pelo HeadCoach, com resposta e erro | 1 por envio |
| `accounts_payable_duplicates_v` | view com nome do fornecedor, nome da empresa e `open_value` | — |

- **Chave da duplicata:** `(branch_code, supplier_code, duplicate_code, installment_code)`. É a mesma chave da API. Sem o fornecedor, o número da duplicata se repete entre fornecedores (sondado em 1.000 parcelas).
- **status:** `N` normal, `C` cancelada, `A` agrupada, `D` devolvida, `L` comissão liquidada, `Q` quebrada.
- **Controle:**
  - `origem` vale `totvs` ou `headcoach`. O sync nunca sobrescreve essa coluna.
  - `dados` guarda o item bruto devolvido pelo TOTVS.
  - `comando` guarda o payload enviado quando a duplicata nasceu no HeadCoach.
  - Também há `primeira_vez_em`, `sincronizado_em` e `atualizado_em`.
- **RLS:** leitura para usuários logados. Escrita só pelo backend.

## Como os dados chegam

**1. Job a cada 30 minutos** (`jobs/erp-sync.job.js`, nos minutos :05 e :35, entidade `contas_pagar`). Cada rodada faz três buscas nas 290 empresas do TOTVS:

| Busca | Filtro da API | Por quê |
|---|---|---|
| Alterações | `filter.change {startDate: cursor, endDate: agora, inDuplicate: true}` | traz baixas, cancelamentos e edições |
| Janela de emissão | `startIssueDate` até `endIssueDate`, últimos `ERP_AP_JANELA_EMISSAO_DIAS` (padrão 120) | o filtro de alteração **não traz todas as inclusões**: das 244 duplicatas lançadas entre 13 e 16/10, só 141 apareceram nele. Não existe filtro por data de entrada (`startEntryDate` é ignorado) |
| Janela de liquidação | `startSettlementDate` até `endSettlementDate`, últimos `ERP_AP_JANELA_LIQUIDACAO_DIAS` (padrão 10) | pagamentos lançados com data retroativa |

O cursor começa no marco 0 (`erp_sync_controle.cursor_ate = 2026-10-17 00:00 BRT`). Cada rodada volta 15 minutos de sobreposição. Cada execução fica em `erp_sync_log`, com o detalhe das três buscas.

**2. Duplicatas criadas e agrupadas pelo HeadCoach** (`totvsrouter/financeiro.js`, rotas `/accounts-payable/duplicates/create` e `/group`):
- Todo envio, com sucesso ou falha, é gravado em `accounts_payable_commands`.
- Quando o TOTVS aceita, o backend relê a duplicata no próprio TOTVS por `duplicateCodeList`, para obter o `supplierCode` oficial. Grava com `origem='headcoach'` e o comando junto.
- Se a busca ainda não refletir a inclusão, tenta de novo em 1 minuto. O job também pega na rodada seguinte.
- No agrupamento, as parcelas de origem também são relidas e passam a status `A`.
- Tudo isso roda em segundo plano. A resposta da rota não mudou.

**3. Carga histórica (manual, quando você decidir):**

```bash
node scripts/erp-carga-inicial.mjs contas_pagar --desde 2023-01-01 --ate 2026-10-16
```

Percorre a emissão mês a mês e registra o total do TOTVS e o total gravado de cada mês em `erp_sync_log.detalhes`. Pelo volume medido (21 mil parcelas em 2023, 26 mil em 2024, 23 mil em 2026), são em torno de 75 mil parcelas, a 100 por página. A carga pode ser repetida, porque o upsert é pela chave.

## Primeira execução (17/10/2026)

| Item | Valor |
|---|---|
| Parcelas gravadas | 8.358 (janela de 120 dias + liquidações dos últimos 10 dias) |
| Linhas de rateio | 9.946 |
| Status | N 7.043 · C 664 · A 651 |
| Empresas próprias / franquias | 8.313 / 45 |
| Em aberto | 1.109, sendo 997 com vencimento até 31/10 |
| Tempo da rodada | 173 s, 88 páginas |
| Conferência 1:1 de um dia (06/10) | 51 de 51 parcelas idênticas ao TOTVS em todos os campos e no rateio |

## Onde ver

- A tela **Administração → Integração ERP** mostra o estado da entidade `contas_pagar` na aba Sincronização.
- Na aba Cadastros, as opções `contas_pagar` e `contas_pagar_comandos` permitem consultar as tabelas.
- API: `GET /api/erp/cadastros/contas_pagar?q=&empresa=` busca por nome ou documento do fornecedor e por número da duplicata ou do fornecedor.

## Limitações conhecidas

- **Duplicata apagada no TOTVS:** ela some da busca e continua na tabela. A busca só devolve o que existe; não há evento de exclusão. A reconciliação periódica de períodos fechados detecta esses casos (próximo passo).
- **Campos que a API não devolve:** `Document`, `Prevision`, `Stage`, `observation`, código de barras e forma de pagamento não vêm na busca. O parâmetro `expand` é ignorado. Esses campos só ficam preenchidos nas duplicatas criadas pelo HeadCoach, a partir do comando.
- **Data de alteração vazia:** `maxChangeFilterDate` só vem preenchido quando a busca usa o filtro de alteração. Nas buscas por emissão ou liquidação ele vem `null`, e o upsert grava esse `null`.
- **Telas existentes:** continuam lendo o TOTVS ao vivo. Repontar Contas a Pagar, DRE e Liberação para estas tabelas é o passo seguinte do módulo, quando o espelho estiver estável.
