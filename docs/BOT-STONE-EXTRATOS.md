# Bot Stone Extratos — extratos e saldo das contas Stone todo dia

Criado em 26/10/2026. Pedido: baixar os extratos das contas Stone (acesso só
financeiro, sem poder de transferência), importar no HeadCoach todo dia de
manhã para bater o saldo do dia e conciliar os dias anteriores, com um botão
para disparar na hora e um log do que deu certo e do que não deu.

| Peça | Onde |
| --- | --- |
| Agente local (puppeteer) | `bots/stone-extratos/` — `bot.mjs` (loop/modos), `stone.mjs` (portal), `headcoach.mjs` (HTTP), `config.example.json`, `.bat` |
| Fila, log, saldos, importação | `services/stoneBot.js` |
| Rotas | `routes/stoneBot.routes.js` → `/api/stone-bot` |
| Extrato via API do portal → formato do parser | `utils/extratoStoneApi.js` (usa `montarExtrato` de `utils/extratosBancariosPdf.js`) |
| Importação (PDF ou objeto) + arquivo no Storage | `services/fluxoCaixaExt.js` (`importarExtratoObjeto`, `guardarArquivoExtrato`, `urlArquivoImportacao`) |
| Banco | `migrations/stone_bot.sql` — `stone_bot_execucoes`, `stone_bot_saldos`, `stone_bot_agentes`; `fluxo_caixa_importacoes.arquivo_path/origem`; bucket privado `extratos-bancarios` |
| Tela | `gestaocrosby/src/components/BotStoneExtratos.jsx` (aba **Bot Stone** em `/fluxo-caixa-ext`) |
| Env | `STONE_BOT_TOKEN` (Render + `config.json` do bot) |

## Por que um agente no PC, e não um job no Render

O login da Stone (`conta.stone.com.br/login`) carrega reCAPTCHA Enterprise e
FaceTec (biometria) e pede token. Automatizar o login no servidor seria frágil
e exigiria guardar a senha. O bot roda no PC do financeiro com um perfil do
Chrome em que a pessoa logou **uma vez** à mão; depois só reaproveita a
sessão. Quando ela expira, o log avisa e a aba mostra “sessão expirada”.

## Fluxo

```
tela (Bot Stone) ──POST /api/stone-bot/execucoes──▶ stone_bot_execucoes (pendente)
                                                          ▲
agente (a cada 15 s) ──GET /agente/proxima──────────────── claim → rodando
agente ──POST /agente/execucoes/:id/log ─────────────────▶ log JSONB (tela faz polling)
agente ──POST /agente/execucoes/:id/pdf (multipart) ─────▶ parser PDF + Storage + importação
agente ──POST /agente/execucoes/:id/extrato-json ────────▶ extratoStoneDaApi → importação (fallback)
agente ──POST /agente/execucoes/:id/saldos ──────────────▶ stone_bot_saldos + saldo_bancario.STONE
agente ──POST /agente/execucoes/:id/finalizar ───────────▶ concluido | erro + resumo
agente ──POST /agente/ping (1 min) ──────────────────────▶ stone_bot_agentes (Online/Offline na tela)
```

O horário diário fica no `config.json` do agente (`horarioDiario`): ele mesmo
enfileira a execução (`origem = agendado`) e a executa.

## Dados vindos do portal

O bot não digita nada no portal para ler os dados: captura o header
`Authorization` que o próprio front da Stone manda e chama a mesma API, do
Node (de dentro da página o CORS barra):

| Chamada | Uso |
| --- | --- |
| `GET /api/v1/accounts?paginate=false` | contas acessíveis (15 em 26/10/2026) |
| `GET /api/v1/accounts/:id/balance` | saldo (centavos) |
| `GET /api/v1/fma/accounts/:id/statement?start_datetime&end_datetime&limit` | lançamentos com `title`/`subtitle` no formato do extrato (“NOME - Transferência \| Pix”); páginas se sobrepõem → dedupe por id+type+amount+balance_after; depósito de boleto e a tarifa dele compartilham o id |
| `POST /api/v1/fma/accounts/:id/statement/export` `{resource_type:'statement', resource_id, start_date, end_date (UTC), operation_type:[]}` | **PDF oficial** (bytes), a mesma chamada do botão “Baixar” |

O token vence em ~15 min; o portal renova sozinho e o bot acompanha o header
mais recente (e recarrega a página em caso de 401). 403 numa conta = usuário
sem permissão nela (pulada, não é falha). Se a exportação do PDF falhar, os
lançamentos vão em JSON e a importação fica marcada `origem = bot-stone-api`.

`utils/extratoStoneApi.js` converte o JSON no objeto do parser: reordena pela
cadeia `balance_before → balance_after` (a API devolve lançamentos do mesmo
segundo fora de ordem), trata o par depósito+tarifa como uma unidade, usa o
bruto (`operation_amount`) quando há tarifa separada e pega o saldo inicial de
`balance_before`. Validado: 0 inconsistências e saldo final igual ao real em
duas contas (122 e 32 lançamentos).

Chave da conta no Extrato Bancário é `banco + agência + conta`. O PDF da Stone
traz agência `0001` e conta `21774800` + DV `3`; a API traz `branch_code "1"` e
`account_code` sempre com o DV junto (`217748003`, `83579664`) →
`extratoStoneApi.js` normaliza (agência com 4 dígitos, último dígito vira DV)
para cair na MESMA conta. Reimportar preserva `fornecedor`/`observacao`
editados à mão (chave data|valor|memo).

## Pagar.me (adquirente / subconta da Stone)

Boletos e vendas online caem na Pagar.me e o financeiro transfere todo dia para
a Stone. Não precisa de bot: a API core/v5 responde com as chaves que o
HeadCoach já tem (`PAGARME_SECRET_KEY` = FERREIRA, `PAGARME_SECRET_KEY_FABIO` =
FA MODA, as duas só no Render; a do `.env` local está vencida). Tudo em
`services/pagarmeConta.js`, só leitura:

| Chamada | Uso |
| --- | --- |
| `GET /recipients?size=10` | recebedor da conta (id `re_…`, nome, CNPJ) |
| `GET /recipients/:id/balance` | `available_amount` (disponível), `waiting_funds_amount` (a receber), `transferred_amount` — centavos |
| `GET /payables?payment_date_since&payment_date_until&size=100&cursor` | recebíveis creditados (`status = paid`): entradas, estornos, chargebacks, com `fee`/`anticipation_fee` |
| `GET /transfers?…` → fallback `GET /recipients/:id/withdrawals` | saques para a conta bancária (saídas) |

A `/balance/operations` (extrato antigo) está em descontinuação, por isso o
extrato é montado por payables + transfers (`utils/extratoPagarmeApi.js`, mesmas
formas/categorias da planilha `.xlsx`, conta `PAGARME CROSBY` / `PAGARME FABIO`).
O saque entra como saída TED com contraparte = a própria empresa (CNPJ do
recebedor) para o casamento automático com a entrada na conta Stone.

Grava `stone_bot_saldos` (banco `PAGARME`, colunas `saldo` = disponível e
`saldo_a_receber`) e duas linhas em `saldo_bancario`: `PAGARME` (disponível) e
`PAGARME A RECEBER` — as duas somam no saldo do dia da Liberação (lista
`BANCOS_SALDO` do front). Dispara: fim da execução do bot (`POST
/agente/execucoes/:id/pagarme`, log junto), botão "Atualizar Pagar.me agora" na
aba Bot Stone (`POST /api/stone-bot/pagarme/executar`) e cron 07:20 no servidor
(`jobs/pagarme-saldo.job.js`, `PAGARME_SALDO_CRON`, `PAGARME_SALDO_JOB_ENABLED`).

## Saldo na Liberação de Pagamento

`saldo_bancario` tem uma linha por banco (`STONE`, `SICREDI CROSBY`, …) e a
tela soma as linhas. O bot grava `STONE = soma dos saldos disponíveis de todas
as contas Stone` (`updated_by = bot-stone`) e o histórico por conta em
`stone_bot_saldos` (UNIQUE data+conta). A tela Liberação continua deduzindo do
saldo quando marca um título como pago; a próxima execução do bot sobrescreve
com o saldo real.

## Status (26/10/2026)

- Backend, migration, bucket e deploy no Render feitos; `STONE_BOT_TOKEN`
  configurado. Primeira execução real: 15 contas, 14 saldos (R$ 27.552,14 na
  Liberação), 1 conta sem permissão (Crosby Recife Mall).
- PDF: o roteiro de cliques inicial não bateu (lista de contas/período); trocado
  pela exportação via API (`pdf.modo: api`), que devolve o PDF oficial por conta
  e período sem clique. Roteiro mantido só como reserva.
