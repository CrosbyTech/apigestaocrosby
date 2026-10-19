# ERP HeadCoach — Conferência TOTVS × HeadCoach

Tela **Administração → Conferência ERP** (`/admin/conferencia-erp`), criada em 19/10/2026. Compara, registro a registro, o que o TOTVS devolve ao vivo num período com o que o HeadCoach guardou nas tabelas da fase 1.

| Módulo | TOTVS (ao vivo) | HeadCoach | Chave | Período máximo |
|---|---|---|---|---|
| Contas a pagar | `accounts-payable/v2/duplicates/search` por emissão | `accounts_payable_duplicates` | empresa + fornecedor + duplicata + parcela | 62 dias |
| Contas a receber | `accounts-receivable/v2/documents/search` por emissão | `accounts_receivable_documents` | empresa + cliente + título + parcela | 62 dias |
| Transações | `general/v2/transactions/search` por data da transação, **1 empresa × 1 dia por consulta** | `general_transactions` | empresa + transação | 31 dias, até 600 consultas (empresas × dias) |

## O que a tela mostra

- **Cards:** quantidade e valor no TOTVS e no HeadCoach; iguais, diferentes, só no TOTVS e só no HeadCoach. Clicar num card filtra a lista.
- **Barra de aderência** e **gráfico por dia** (TOTVS × HeadCoach × divergências).
- **Campos que mais divergem** nos registros em comum.
- **Por empresa:** quantidade, valor e divergências de cada empresa.
- **Divergências:** uma linha por registro, com chave, pessoa, data, valor e status dos dois lados. Nos "diferentes", a linha abre e mostra campo a campo o valor do TOTVS e o do HeadCoach.
- **Corrigir pelo TOTVS** (admin): regrava no HeadCoach tudo que o TOTVS devolveu no período. O TOTVS vence. Nada é apagado: o que só existe no HeadCoach continua lá e segue aparecendo como "só no HeadCoach".

## Como ler os tipos

| Tipo | Significa | Causa comum |
|---|---|---|
| Só no TOTVS | existe no TOTVS e falta no HeadCoach | o job não rodou nesse intervalo (backend fora do ar ou ainda sem este código em produção) |
| Só no HeadCoach | está no HeadCoach e o TOTVS não devolve mais | registro apagado ou cancelado no TOTVS, ou criado pelo HeadCoach (`origem = headcoach`) |
| Diferente | mesma chave, campo diferente | baixa, cancelamento ou edição no TOTVS depois da última sincronização |

A regra de igualdade tolera meio centavo nos valores e ignora a ordem das chaves nos JSON, porque o Postgres reordena o jsonb.

## API

- `GET /api/erp/comparacao/modulos` → módulos, limites e lista de empresas.
- `GET /api/erp/comparacao/:modulo?de=AAAA-MM-DD&ate=AAAA-MM-DD&empresas=todas|proprias|95,99&limite=500`
- `POST /api/erp/comparacao/:modulo/corrigir` `{ de, ate, empresas }` (admin).

Serviço em `services/erp/comparacao.js`; campos comparados por módulo em `MODULOS[...].campos`.

## Primeira rodada (19/10/2026)

| Módulo | Período | Resultado |
|---|---|---|
| Contas a pagar | 13 a 19/10, todas as empresas | 155 de 155 iguais; 2 só no HeadCoach (canceladas que o TOTVS deixou de devolver) |
| Contas a receber | 16 a 19/10, 20 próprias | 1.009 de 1.041 iguais; 32 só no TOTVS, emitidos em 16/10 enquanto o backend novo estava fora do ar |
| Transações | 18 a 19/10, empresas 95, 90 e 2 | 44 de 57 iguais; 11 só no TOTVS e 2 com status diferente (4 no TOTVS, 1 no HeadCoach), pelo mesmo motivo |

Os três casos são corrigidos pelo botão. A causa de fundo é que os jobs só rodam com o backend com este código no ar, e o Render ainda está com a versão antiga.
