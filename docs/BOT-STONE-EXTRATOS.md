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
`Authorization` que o próprio front da Stone manda e chama a mesma API
(`/api/v1/accounts`, `/accounts/:id/balance`, `/accounts/:id/statement`,
contrato público em docs.openbank.stone.com.br — valores em centavos, cursor
`after`). O PDF oficial sai pelo roteiro de cliques (`pdf.passos`), ajustável
sem código; se falhar, os lançamentos chegam pela API e a importação fica
marcada `origem = bot-stone-api`.

Chave da conta no Extrato Bancário é `banco + agência + conta`. O PDF da Stone
traz agência `0001` e conta `21774800` + DV `3`; a API traz `branch_code "1"` e
`account_code` com DV junto → `extratoStoneApi.js` normaliza (agência com 4
dígitos, último dígito vira DV quando há 9+) para cair na MESMA conta.

## Saldo na Liberação de Pagamento

`saldo_bancario` tem uma linha por banco (`STONE`, `SICREDI CROSBY`, …) e a
tela soma as linhas. O bot grava `STONE = soma dos saldos disponíveis de todas
as contas Stone` (`updated_by = bot-stone`) e o histórico por conta em
`stone_bot_saldos` (UNIQUE data+conta). A tela Liberação continua deduzindo do
saldo quando marca um título como pago; a próxima execução do bot sobrescreve
com o saldo real.

## Status (26/10/2026)

- Backend, migration e bucket aplicados; rotas testadas localmente (token do
  agente, bloqueio sem login, claim/log/finalizar).
- Bot testado ponta a ponta até o Chrome; o roteiro de PDF e a captura da API
  **ainda não foram validados com login real** (precisa do login do Yago no PC
  do bot). Primeiro uso: `login.bat` → `agora.bat` → conferir log; se o PDF
  não sair, `mapear.bat` e ajustar `pdf.passos`.
- Pendente no Render: variável `STONE_BOT_TOKEN` (mesmo valor do `.env` local
  e do `config.json` do bot).
