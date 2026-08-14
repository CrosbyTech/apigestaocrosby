# Manual de implantação — Integração BlueCard (crediário)

*Atualizado em 14/08/2026. Público: quem opera o deploy (Yago) e quem der manutenção depois.*

Este manual cobre TUDO que foi construído desde 04/08 e o que falta apertar
para cada peça entrar em produção. O que já está no ar está marcado.

---

## 1. Mapa do que existe

| peça | arquivo | em produção? |
|---|---|---|
| HMAC 2 direções (verificar/assinar) | `utils/bluecardHmac.js` | ✅ desde 05/08 |
| Cliente da API BlueCard | `services/bluecardClient.js` | ✅ (base URL nova só local) |
| Webhook receiver (4 eventos) | `routes/bluecardIntegracao.routes.js` | ✅ (sem o gatilho de limite) |
| Reconciliação `GET /pagamentos` | idem | ✅ |
| Consulta `GET /faturas?cpf/cnpj` | idem | ⚠️ no ar COM o bug do `desde=` — versão corrigida só local |
| **PIX `GET /pix?externo_id=`** | idem | ❌ só local (novo, 14/08) |
| Gatilho de limite (liberar/zerar) | `services/bluecardLimite.js` | ❌ só local |
| Watchdog de limite (1 min) | `jobs/bluecard-limite.job.js` | ❌ só local |
| Job de pagamentos (15 min) | `jobs/bluecard-pagamentos-sync.job.js` | ✅ (sem o filtro de cancelados — corrigido só local) |
| Migration eventos+títulos | `migrations/bluecard_integracao.sql` | ✅ rodada em 05/08 |
| Migration liberações | `migrations/bluecard_liberacoes.sql` | ⚠️ conferir (ver §3) |

## 2. O que mudou em 14/08 (esta rodada)

**Novo:**
- `GET /api/bluecard/pix?externo_id=TOTVS-<título>-<parcela>` — gera Pix
  copia-e-cola sob demanda via `accounts-receivable/v2/payment-link` do TOTVS
  (hub Rendimento). Calcula encargo de atraso na régua do contrato BlueCard v3
  (multa 2% única + mora 1% a.m. pró-rata dia) e devolve
  `{ pix_copia_e_cola, valor_cents, dias_atraso }`.
- `GET /faturas` agora devolve `situacao`, `linha_digitavel`, `codigo_barras`
  e `pix_copia_e_cola` (do cadastro; hoje sempre null — o Pix real sai pela
  rota acima) e aceita `&incluir_cancelados=1`.

**Bugs corrigidos (nenhum tinha chegado a rodar em produção com dano):**
1. `desde=` ignorado na `GET /faturas` — `startIssueDate` do TOTVS só filtra
   em PAR com `endIssueDate`; sozinho devolve o histórico inteiro calado.
2. Títulos CANCELADOS apareciam na consulta e no espelho — o TOTVS mantém o
   título com status 3 e emite outro (a venda-teste tinha 3 títulos, 2
   cancelados; o BlueCard chegou a casar um cancelado). Agora `statusList [1]`
   em todas as buscas: consulta, watchdog, job de pagamentos e soma de abertos.
3. Watchdog zeraria o limite ANTES da venda (mesmo bug do `startIssueDate` +
   `issueDate` sem hora) — corrigido com snapshot `titulos_previos` gravado na
   liberação: só título novo conta como "venda fechou".
4. Liberação perdida para sempre se o processamento assíncrono do webhook
   falhasse (BlueCard recebe 200 e não reenvia) — o watchdog agora retenta
   eventos `compra.aprovada` com erro por até 24h.
5. Webhook atrasado não reabre limite de compra já consumida/cancelada
   (guarda de status na liberação).
6. Janela do watchdog: 5 min → **1 min** (pedido do BlueCard — antifraude).
7. Fallback do `BLUECARD_BASE_URL` no código apontava pro domínio antigo.

## 3. Roteiro de implantação (nesta ordem)

### 3.1 Migration no Supabase (SQL Editor do projeto `dorztqiunewggydvkjnf`)

Rodar `migrations/bluecard_liberacoes.sql`. É idempotente: se a tabela já
existe de uma rodada anterior, o `ALTER ... IF NOT EXISTS` só acrescenta a
coluna nova `titulos_previos`. (A `bluecard_integracao.sql` já foi rodada em
05/08 — não precisa repetir.)

### 3.2 Variáveis no Render (serviço apigestaocrosby)

| variável | valor | obs |
|---|---|---|
| `BLUECARD_BASE_URL` | `https://bluecard.crosbyoficial.com.br` | **trocar** (estava na Vercel) |
| `BLUECARD_LIMITE_AUTO_ENABLED` | `false` no deploy; `true` na ativação | o gatilho inteiro liga/desliga aqui |
| `BLUECARD_LIMITE_BRANCH_CODES` | (vazio) | vazio = regra FILIAL do ranking (64 lojas); "2,5,6" trava lista fixa |
| `BLUECARD_LIBERACAO_TIMEOUT_MIN` | `120` | minutos até zerar liberação sem venda |
| `BLUECARD_LIMITE_CRON` | (vazio) | default `* * * * *` (1 min) |
| `BLUECARD_API_KEY` / `BLUECARD_API_SECRET` / `BLUECARD_WEBHOOK_SECRET` | já configuradas | não mexer |

### 3.3 Deploy

Commit + push na `main` — o Render faz deploy automático (~90s). Com a flag
em `false`, o deploy é inerte: só entram as correções da consulta e a rota
de Pix.

### 3.4 Verificação pós-deploy (sem afetar ninguém)

1. `GET /faturas?cpf=06451367435&desde=2026-08-10` assinado → deve voltar
   **1 título** (`TOTVS-247122-1`, situacao normal). Se voltar 199, o deploy
   não subiu.
2. `GET /pix?externo_id=TOTVS-247122-1` assinado → deve voltar
   `pix_copia_e_cola` começando com `00020101...rendimento...`.
3. Sem assinatura, ambas devolvem 401.

### 3.5 Ativar o gatilho

Trocar `BLUECARD_LIMITE_AUTO_ENABLED=true` no Render (redeploy automático) e
rodar o teste ponta a ponta do §5 do doc enviado ao BlueCard em 12/08 — o
passo mais importante é o PDV **recusar** a venda antes da aprovação no app.

## 4. Pendência de configuração TOTVS: terminais de pagamento (PIX)

O `payment-link` só funciona em filial com **terminal de pagamento
configurado** (config por empresa no TOTVS; erro 51732 quando falta).
Estado em 14/08:

- filial **95** (Midway): ✅ tem terminal — Pix gerado com sucesso
- filial **551**: ❌ sem terminal (títulos de teste do Yago não geram)

**Ação:** configurar terminal nas filiais onde o crediário vai operar
(mesma lista FILIAL do ranking). Sem isso, cliente daquela loja não paga por
Pix — a rota devolve `409 estado_invalido` com mensagem clara e o app do
BlueCard mostra fallback.

## 5. Pendências que NÃO bloqueiam a ativação

| item | dono | status |
|---|---|---|
| Avisar o BlueCard do contrato do `/pix` (campos extras `valor_cents`, `dias_atraso`) | Yago | doc pronto |
| BlueCard trocar o registro `TOTVS-247118-1` (cancelado) → `247122-1` | Felipe | avisado em 14/08 |
| `POST /faturas` automático com linha digitável/PDF | HeadCoach | próxima entrega (o watchdog já loga a pendência a cada venda detectada) |
| Automação do `parcelamento.aceito` no TOTVS | HeadCoach | fase seguinte; parcelamento segue desligado no app |
| Conferir encargos da cobrança TOTVS (multa 2% + mora 1%) | financeiro | em aberto |
| Confirmar plano do Render (hibernação) | Yago | respondeu 0,7s em 14/08, mas conferir plano no painel |

## 6. Como diagnosticar (colinha de operação)

- **Vendedor travado no PDV** ("limite insuficiente" após aprovação no app):
  procurar `[bluecard-limite]` nos logs do Render. Se não houver "limite
  liberado", o webhook não chegou (ver painel BlueCard) ou falhou (evento
  fica `erro` em `bluecard_eventos` e o watchdog retenta por 24h).
- **Limite não zerou** após a venda: ver `bluecard_liberacoes` status
  `liberado` antigos; o watchdog zera por timeout em 120 min de qualquer jeito.
- **Cliente pagou e segue sem limite no app**: job `[bluecard-pagamentos]`
  roda a cada 15 min; conferir `bluecard_titulos.notificado_bluecard_em`.
  A reconciliação do BlueCard (2 min) cobre webhook perdido.
- **Pix não gera**: erro 51732 = filial sem terminal (§4). Outros erros
  aparecem com o JSON do TOTVS no log `[bluecard/pix]`.
- Toda chamada BlueCard→nós rejeitada por assinatura loga
  `[bluecard] chamada rejeitada` com o motivo (timestamp fora da janela =
  relógio; ver NTP).

## 7. Armadilhas do TOTVS (para quem mantiver este código)

1. `startIssueDate`/filtros de data **só funcionam em par** (start+end).
   Sozinhos são ignorados sem erro.
2. **Cancelamento não remove o título** — status 3 e um novo é emitido.
   TODA busca de título precisa de `statusList: [1]`.
3. `receivableCodeList` com código inexistente pode devolver outros títulos —
   sempre conferir `receivableCode` no resultado.
4. `issueDate` é data SEM hora — comparações de "depois de X" precisam de
   snapshot, não de timestamp.
5. `payment-link` exige `correctedValue` (senão `amount=null` no hub) e o
   `branchCode` do próprio título.
6. Limite de crédito: `disponível = limite − em aberto` → liberar limite
   exige somar os títulos em aberto do cliente.
