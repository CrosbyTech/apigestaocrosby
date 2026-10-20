# WhatsApp Contas a Pagar (uazapi)

O HeadCoach controla **uma única instância** do servidor uazapi `techcrosby.uazapi.com`:
a instância **CONTAS A PAGAR** (número 558496220140, id `rb42e2c1ab212b3`).
Nenhuma outra instância do servidor é tocada por este módulo.

- Backend: `services/whatsappContasPagar.js` (cliente) + `routes/whatsappContasPagar.routes.js` (montado em `/api/whatsapp-cp`)
- Frontend: `gestaocrosby/src/pages/WhatsAppContasPagar.jsx` → `/financeiro/whatsapp-contas-pagar` (menu Financeiro → Contas a Pagar → WhatsApp Contas a Pagar)
- Doc da uazapi: https://docs.uazapi.com (OpenAPI em `/openapi-bundled.json`)

## Variáveis de ambiente

| Variável | Uso |
|---|---|
| `WHATSAPP_CP_BASE_URL` | `https://techcrosby.uazapi.com` (default) |
| `WHATSAPP_CP_TOKEN` | **token da instância** CONTAS A PAGAR (preferido — o HeadCoach só enxerga essa instância) |
| `WHATSAPP_CP_INSTANCE` | nome da instância (default `CONTAS A PAGAR`), usado só com o admintoken |
| `WHATSAPP_CP_ADMIN_TOKEN` | opcional: admintoken do servidor para resolver o token da instância pelo nome (cache 10 min, re-resolve em 401) |
| `WHATSAPP_CP_WEBHOOK_SECRET` | opcional: segredo exigido em `?s=` no receptor público de eventos |

O token da instância aparece em `GET /instance/all` (admintoken) ou no painel da uazapi. O admintoken
do servidor **não** deve ir para o frontend nem ser usado para envio.

## Rotas (`/api/whatsapp-cp`, sessão do HeadCoach obrigatória)

| Método | Rota | Perfil | O que faz |
|---|---|---|---|
| GET | `/status` | logado | estado da instância (conectado, número, perfil, QR/paircode se conectando) |
| POST | `/conectar` `{phone?}` | admin/owner | sem `phone` gera QR code; com `phone` gera código de pareamento |
| POST | `/desconectar` | admin/owner | encerra a sessão no WhatsApp |
| POST | `/enviar/texto` `{number, text, replyid?, delay?, linkPreview?}` | owner/admin/manager/user | `number` aceita telefone (normaliza DDI 55) ou id de grupo `…@g.us` |
| POST | `/enviar/midia` `{number, type, file, text?, docName?, mimetype?}` | owner/admin/manager/user | `file` = URL, data URL ou base64; `type` = image/video/document/audio/ptt… |
| POST | `/verificar` `{numbers[]}` | logado | quais números têm WhatsApp (`/chat/check`) |
| GET | `/chats?limit&offset&naoLidas&grupos&nome` | logado | conversas ordenadas pela última mensagem (`/chat/find` compact) |
| GET | `/chat/:number` | logado | detalhes/foto de contato ou grupo |
| GET | `/mensagens?chatid\|number&limit&offset&trackSource` | logado | histórico (`/message/find`); mais recente primeiro |
| POST | `/mensagens/download` `{id, base64?}` | logado | URL (ou base64) do arquivo de uma mensagem |
| POST | `/mensagens/lidas` `{ids[]}` | owner/admin/manager/user | marca como lidas |
| GET/POST | `/webhooks` | admin/owner | lista / cadastra (`action: add\|update\|delete`) webhooks da instância |
| POST | `/webhook/receber?s=SECRET` | público | receptor de eventos da uazapi (buffer em memória, 300 últimos) |
| GET | `/eventos?limit` | logado | últimos eventos recebidos |

Todo envio feito pelo HeadCoach vai com `track_source=headcoach` e `track_id=<email do usuário>`;
dá para filtrar no histórico (`/mensagens?trackSource=headcoach`) e aparece como "via HeadCoach" na tela.

## Pegadinhas da uazapi

- `GET /instance/status` responde `{ instance, status: { connected, loggedIn, jid } }`; o campo `instance.token` é removido antes de ir ao front.
- `POST /instance/connect` com corpo `{}` gera QR (`instance.qrcode`, base64); com `{ phone }` gera `instance.paircode`.
- `/chat/find` com `compact: true` limita a 200 por página; `sort: '-wa_lastMsgTimestamp'`; `wa_unreadCount: '>0'` filtra não lidas.
- `/message/find` retorna do mais recente para o mais antigo; `offset` 0 = mais recentes. Timestamps em ms.
- `/chat/check` devolve `isInWhatsapp` mesmo para números inexistentes em alguns casos — não é prova de entrega.
- Header de auth é `token` (instância); `admintoken` só em `/instance/all` e criação/remoção de instâncias.
- Já existe outro módulo uazapi no projeto (`config/uazapi.js`, `services/uazapiSync.js`, `uazapiMonitor.js`) que usa o admintoken para o CRM/cobrança em `UAZAPI_BASE_URL`; este módulo é independente e não compartilha env.

## Agentes de grupo: JOJO (fiscal) e BRUCE (contas a receber)

Núcleo compartilhado em `services/agenteWhatsapp.js` (`criarAgente`). Cada agente é um arquivo fino com nome, grupo, regex de chamada e prompt:

| Agente | Arquivo | Grupo (chatid default) | Chamado por | Env |
|---|---|---|---|---|
| JOJO — assistente fiscal | `services/jojoBot.js` | `120363414933413909@g.us` ("JOJO - FISCAL HEADCOACH") | "jojo" | `JOJO_*` |
| BRUCE — assistente do Contas a Receber (auxilia o João) | `services/bruceBot.js` | `120363411253432671@g.us` ("BRUCE - CAR HEADCOACH") | "bruce" | `BRUCE_*` |

Os dois usam a mesma instância CONTAS A PAGAR, o mesmo autorizador e as mesmas regras abaixo (descritas para a JOJO; valem igual para o BRUCE trocando o prefixo das variáveis). Iniciados em `index.js` (`iniciarJojoBot`, `iniciarBruceBot`). O webhook `POST /webhook/receber` repassa cada evento aos dois; cada um só reage ao próprio grupo. Saudação do BRUCE enviada no grupo em 20/10/2026.

### Regras (JOJO; BRUCE idêntico)

Opera **só** no grupo `JOJO_GRUPO_CHATID` pela instância CONTAS A PAGAR.

- **Entrada**: evento `messages` da uazapi no receptor `POST /api/whatsapp-cp/webhook/receber` (cadastre o webhook pela aba Webhook da página, evento `messages`). Sem URL pública, `JOJO_POLL_SEGUNDOS>0` consulta o grupo periodicamente.
- **Quando responde**: mensagem contém "jojo" ou é resposta (quote) a uma mensagem dela. Ignora `fromMe`, outros chats e ids repetidos. Contexto = últimas `JOJO_CONTEXTO_MENSAGENS` do grupo.
- **IA**: com `ANTHROPIC_API_KEY` usa Claude (`JOJO_MODEL`, default `claude-opus-5-5`, structured output JSON, pago por uso). Sem ela, usa o provedor do chat em `utils/aiProvider.js` (Groq grátis → OpenAI → xAI) com `response_format json_object`. A saída sempre vira `{resposta, pedido_alteracao, resumo_pedido}`.
- **Autorização**: pedidos de alteração no HeadCoach (`pedido_alteracao=true`) ficam pendentes. Só o número `JOJO_NUMERO_AUTORIZADOR` (default 5584987187425) autoriza, respondendo "ok"/"autorizo" (ou "não"/"nega") à mensagem do pedido ou à resposta da JOJO. Em grupo o remetente pode vir como `@lid`; por isso o bot resolve o `lid` do autorizador via `/chat/check` na inicialização e também aceita `sender_pn`.
- **Execução**: `executarAcao(pedido)` é o ponto de extensão — na v1 só registra e avisa que a execução automática ainda não está ligada. Nada no HeadCoach é alterado.
- **Rotas**: `GET /api/whatsapp-cp/jojo/status` e `GET /api/whatsapp-cp/bruce/status` (provedor, stats, pedidos, histórico); `POST /api/whatsapp-cp/jojo/simular` e `POST /api/whatsapp-cp/bruce/simular {text, senderName?, sender_pn?, quoted?, chatid?}` (admin) injetam uma mensagem como se viesse do grupo e **respondem de verdade no grupo**.
- Envios vão com `track_id=jojo` / `track_id=bruce`. Para enviar um aviso avulso no grupo pelo código: `bruce.enviarNoGrupo(texto)`.
