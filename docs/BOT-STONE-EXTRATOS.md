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

## Antecipação (valor disponível para antecipar, por conta)

Vem de dois serviços que o portal usa na tela Antecipação, com o mesmo token:
`customer-api.stone.com.br/v0/portal/users/<email>` (lista de maquininhas,
`affiliationCodes`) → `customer-api…/v0/merchants/summary?affiliationCodes=`
(cada maquininha com `affiliationKey` e `document` = CNPJ) →
`prepayment-v2.stone.com.br/customer/<cnpj>/financial-position?customerExternalKey=<affiliationKey>`
(`netReceivablesAmount` / `grossReceivablesAmount` em centavos). O bot soma por
CNPJ e grava `stone_bot_saldos.saldo_antecipavel` (+ `antecipavel_detalhe` por
maquininha). O e-mail do usuário é capturado da própria chamada que a home faz.
Em 26/10/2026: 0002-05 = R$ 1.276,74, 0011-98 = R$ 1.980,30, 0014-30 = R$ 802,07,
0012-79 = R$ 390,40.

## Comprovantes de saída → Conciliação → Solicitação Crosby

Para cada saída do período (Pix, pagamento de boleto/conta, TED, Conta Stone;
ignora tarifa, cartão pré-pago, mensalidade, estorno, bloqueio, investimento) o
bot chama a mesma rota do botão "Baixar comprovante":
`GET /api/v1/fma/accounts/:id/statement/:entryId` (detalhe) e
`POST …/statement/:entryId/receipt {resource_id, resource_type}` → PDF.

| Tipo do lançamento | resource_type | resource_id | validado |
| --- | --- | --- | --- |
| `outbound_pix_payment` | `outbound_pix_payment` | `pix_id` do detalhe | sim (26/10) |
| `payment` (boleto/conta) | `payment` | `operation_id` | sim (26/10) |
| `internal` / `external` (saída) | `internal_transfer` / `external_transfer` + transfer_id/operation_id/id | — | sem exemplo em out/2026 |

PEGADINHA: `internal_transfer` + id do lançamento devolve PDF para QUALQUER
tipo, mas é um comprovante genérico ("Entre Contas Stone", destino "Não
informado"). O backend lê o texto do PDF e rejeita esse caso.

Backend (`services/comprovantesStone.js`): `POST /agente/execucoes/:id/comprovante`
(multipart + meta) guarda o PDF em `extratos-bancarios/comprovantes/…` e a linha
em `fluxo_caixa_comprovantes`, ligada ao lançamento pela chave estável
(conta|data|valor|hash(memo)|n, igual às conciliações; memo da API = memo do PDF
"title - subtitle"). `painel` e `detalheConciliacao` devolvem `comprovante`;
`GET /api/fluxo-caixa-ext/comprovantes/:id/arquivo` dá o link temporário.

Ao gravar uma conciliação (`gravarConciliacaoRow`) cuja origem envolve
Solicitação Crosby (SOLICITACAO, itens de MULTIPLO, ou LIBERACAO nascida de
solicitação / apontada por `pagamento_liberacao_id`): copia o PDF para o bucket
público `solicitacoes-crosby/comprovantes/<solId>/…`, grava
`solicitacoes_crosby.comprovante_url` (se vazio), `pago_em` + `pago_por_nome`
(se não paga), põe o título da Liberação em PAGO (se existir e não estiver) e
registra o anexo na conciliação. Desfazer a conciliação NÃO desfaz isso.

## Keep-alive da sessão (27/10/2026)

A sessão do portal expirava em poucas horas de inatividade. O agente agora
roda `manterSessao()` (stone.mjs) a cada `sessao.keepAliveMin` minutos (20):
abre o Chrome escondido, carrega a home (o portal faz `POST
/api/v2/identity/refresh-token` a cada carga), passa pelo Extrato e fecha;
manda o ping com `sessao_ok`. Depois de uma execução o contador reinicia.
`parar.bat` encerra o agente (inclusive o escondido) e o Chrome do perfil.

## Horários e relatório no WhatsApp (27/10/2026)

- Bot Stone no PC: `config.json → horarios: ["09:30","14:00","18:00"]`
  (substitui `horarioDiario`; o agente precisa ser reiniciado para ler).
- Pagar.me no servidor 10 min antes: `PAGARME_SALDO_CRON="20 9 * * *;50 13 * * *;50 17 * * *"`.
- `services/relatorioSaldosWhatsapp.js`: ao fim de cada execução AGENDADA do
  bot (`finalizarExecucao`) manda no grupo **CONTAS A PAGAR CROSBY OFC** (pela
  instância CONTAS A PAGAR, chatid achado pelo nome via `GET /group/list`) uma
  imagem do card "Saldo Bancário" (HTML → puppeteer → PNG: total, chips por
  banco, Stone por final de CNPJ com antecipável, Pagar.me disponível/a receber,
  total da programação) com legenda marcando o Fábio (`mentions=558487820986`),
  e um texto com a programação da semana (seg–dom) = títulos em PROVISÃO na
  Liberação (fornecedor · valor · vencimento). Fallback por cron 09:50/14:20/18:20
  se o PC não rodou. Manual: `POST /api/stone-bot/relatorio-whatsapp`.
- `services/vevetoBot.js`: agente **VEVETO** no mesmo grupo (chamado por "veveto"
  ou em resposta a ele). Autorizadores: Fábio (558487820986) e Yago. Recebe os
  dados vivos (saldos, antecipação, Pagar.me, programação) em cada resposta.
  Pedido "adiciona <fornecedor> <valor> vence <data>" → extração estruturada →
  INSERT em `pagamentos_liberacao` status PROVISAO (`nr_duplicata WA-…`,
  `dados_completos.origem = whatsapp_ceo`); "remove …" cancela só itens
  incluídos pelo WhatsApp. Toda mensagem dele (e os relatórios) terminam com "— Veveto". Rotas
  `/api/whatsapp-cp/veveto/status` e `/veveto/simular`. O núcleo (`agenteWhatsapp.js`) ganhou vários autorizadores,
  grupo por nome e `contextoExtra`.

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
| `GET /transfers?…` → fallbacks `GET /settlements?payment_date_start/end`, `GET /recipients/:id/withdrawals` | saques/transferências para a conta bancária (saídas) |

A `/balance/operations` (extrato antigo) está em descontinuação, por isso o
extrato é montado por payables + transfers (`utils/extratoPagarmeApi.js`, mesmas
formas/categorias da planilha `.xlsx`, conta `PAGARME CROSBY` / `PAGARME FABIO`).
Paginação dos payables: `paging.forward_cursor`; o cursor codificado às vezes
repete a página, então `listarTudo` tenta cursor codificado → cursor cru →
`page=N` até vir item novo (FA MODA: 277 recebíveis em 3 páginas, 26/10/2026).

**Pendência (26/10/2026):** `GET /transfers` responde `401 IP de origem não
autorizado` — a conta Pagar.me tem lista de IPs permitidos e o IP de saída do
Render não está nela. `settlements` e `withdrawals` voltam vazios, então as
SAÍDAS (a transferência diária para a Stone) ainda não entram no extrato
Pagar.me; só as entradas. Para liberar: Dashboard Pagar.me → configurações da
conta → IPs autorizados → incluir os "Outbound IP addresses" do serviço
apigestaocrosby no Render (Settings do serviço). O log da execução mostra o
erro enquanto isso.
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
