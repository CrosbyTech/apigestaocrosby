# BlueCard ↔ HeadCoach: gatilho de limite no TOTVS (compra aprovada no app)

**Para o Felipe.** Este documento fecha o contrato do mecanismo de segurança do
crediário: o cliente BlueCard vive com **limite zero no TOTVS**. O limite só sobe
no momento em que ele aprova uma compra no app, no valor exato daquela compra, e
volta a zero assim que a venda é registrada no caixa. Ninguém da loja consegue
vender no crediário sem o cliente ter aprovado no app. O HeadCoach continua
podendo ajustar o limite manualmente a qualquer momento, por fora.

## O fluxo, passo a passo

```
Cliente aprova a compra no app (ex.: R$ 235, limite do cartão R$ 600)
        │
        ▼
BlueCard → POST /api/bluecard/webhook  evento compra.aprovada   (já existe hoje)
        │   HeadCoach responde 200 na hora e processa em segundo plano
        ▼
HeadCoach sobe o limite no TOTVS = R$ 235 + títulos em aberto do cliente,
        em TODAS as filiais próprias (63). Registra a janela: status "liberado".
        │
        ▼
BlueCard → GET /api/bluecard/liberacoes/{compra_id}  até status = "liberado"   (NOVO)
        │   → o app diz ao cliente: "pode passar no caixa"
        ▼
Vendedor fecha a venda no PDV como FATURA - BLUECARD (TOTVS aceita: há limite)
        │
        ▼
HeadCoach (watchdog, a cada 1 min) vê o título novo do cliente no contas a
        receber → limite volta ao valor anterior (0) → status "consumido".
        Sem venda em 120 min → limite volta a 0 → status "zerado_expirado".
        Compra recusada/cancelada com a janela aberta → 0 → status "cancelada".
```

Em números: limite 0 → aprova R$ 235 → TOTVS fica com R$ 235 (+ o que já deve) →
venda de R$ 235 fecha → TOTVS volta a 0. O limite de R$ 600 do cartão mora só no
app; o TOTVS nunca vê R$ 600.

## O que o BlueCard já faz (não mudar)

O evento `compra.aprovada` que o app manda hoje é exatamente o que o gatilho
precisa. Confirmado nos logs do HeadCoach: 249 eventos recebidos até 14/10/2026,
o último às 10:10 de hoje, todos processados. Payload atual:

```json
{
  "evento": "compra.aprovada",
  "em": "2026-10-14T13:10:33.664Z",
  "compra": {
    "id": "59a43c37-…",
    "cpf": "08800000000",
    "documento": null,
    "valor_cents": 26700,
    "parcelas": 3,
    "aprovada_em": "2026-10-14T13:10:33.573Z",
    "vencimentos": [ { "numero": 1, "vencimento": "2026-11-07", "valor_cents": 8900 }, … ]
  }
}
```

Campos que o gatilho usa: `compra.id` (chave da janela), `compra.cpf` (localiza
o cliente no TOTVS) e `compra.valor_cents` (quanto o limite sobe). `documento`
pode vir `null`: a venda ainda não existe no TOTVS nesse momento, e o HeadCoach
detecta o título depois. Os outros campos são ignorados por este mecanismo.

Regras que continuam valendo do lado do app:

- `compra.aprovada` sai **antes** de o vendedor fechar no PDV. Se sair depois, o
  PDV recusa a venda por falta de limite.
- `compra.recusada` / `compra.cancelada` continuam saindo como hoje. Se chegarem
  com a janela ainda aberta, o HeadCoach zera o limite na hora.
- A fila (outbox) com retry fica como está. Se o HeadCoach estiver fora, o
  evento chega depois e o limite sobe depois.

## O que é novo para o app: o "okay"

O webhook responde `200 { recebido: true }` assim que grava o evento. Subir o
limite leva alguns segundos (busca do cliente, títulos em aberto, escrita em 63
filiais). Para o app só liberar o cliente para o caixa quando o TOTVS já estiver
pronto, consulte:

```
GET https://apigestaocrosby-bw2v.onrender.com/api/bluecard/liberacoes/{compra_id}
```

Mesma HMAC das outras rotas (`X-Cc-Key`, `X-Cc-Timestamp`, `X-Cc-Signature`
sobre `"<timestamp>."`, corpo vazio).

Resposta:

```json
{
  "compra_id": "59a43c37-…",
  "gatilho_ativo": true,
  "status": "liberado",
  "valor_cents": 26700,
  "abertos_cents": 25000,
  "limite_totvs_cents": 51700,
  "liberado_em": "2026-10-14T13:10:41.000Z",
  "venda_detectada_em": null,
  "fechado_em": null,
  "expira_em": "2026-10-14T15:10:41.000Z"
}
```

| `status` | Significado | O que o app mostra |
|---|---|---|
| `pendente` | evento recebido, limite ainda não subiu | "Liberando no caixa…" e consulta de novo em 2 s |
| `liberado` | limite no TOTVS pronto | "Pode passar no caixa" (até `expira_em`) |
| `consumido` | venda detectada, limite voltou a 0 | compra concluída |
| `zerado_expirado` | 120 min sem venda, limite voltou a 0 | "A liberação venceu; aprove de novo no app" |
| `cancelada` | compra recusada/cancelada, limite voltou a 0 | compra cancelada |
| `erro` | HeadCoach não conseguiu subir o limite (`erro` traz o motivo); retenta por 24 h | "Não consegui liberar; fale com a loja" |

Quando `gatilho_ativo` vier `false`, o HeadCoach está com o mecanismo desligado:
o evento é recebido e guardado, mas o TOTVS não é alterado. Nesse caso o app não
deve prometer "pode passar no caixa".

`404 compra_nao_encontrada`: o HeadCoach ainda não recebeu `compra.aprovada`
dessa compra (fila atrasada). Trate como `pendente` e consulte de novo.

Sugestão de uso: após `approvePurchase`, consultar a cada 2 s por até 60 s. Se
não chegar a `liberado`, mostrar "a loja vai liberar no caixa em instantes" e
seguir, sem travar o cliente.

## Erros que o HeadCoach devolve no status `erro`

- `CPF … não encontrado no TOTVS`: cliente aprovou no app mas não tem cadastro
  no ERP. Precisa cadastrar no TOTVS antes de vender.
- `TOTVS recusou o limite …`: parâmetro de filial recusou o campo. O HeadCoach
  retenta por 24 h e o Yago recebe no log.

## O que fica do lado do HeadCoach (já pronto no código)

- Receber o evento, subir o limite, registrar a janela, watchdog de 1 min, timeout
  de 120 min, fechamento por cancelamento, retry de eventos com erro por 24 h,
  rota de status.
- O limite volta ao **valor anterior** à liberação, não a um zero cego. Para o
  cliente crediário o anterior é 0. Se alguém do HeadCoach tiver fixado um limite
  manual, ele é preservado.
- Ativação: variável `BLUECARD_LIMITE_AUTO_ENABLED=true` no Render e migration
  `bluecard_liberacoes.sql` no Supabase do HeadCoach. Enquanto a variável estiver
  `false`, `gatilho_ativo` vem `false` na rota de status.

## Checklist de implantação

**HeadCoach (Yago)**
1. Rodar `migrations/bluecard_liberacoes.sql` (coluna `titulos_previos`).
2. Render: `BLUECARD_LIMITE_AUTO_ENABLED=true`. Opcional:
   `BLUECARD_LIBERACAO_TIMEOUT_MIN` (default 120).
3. Teste com o CPF do Yago: aprovar compra no app, conferir
   `GET /liberacoes/{id}` → `liberado`, fechar no PDV, ver `consumido` em até 1 min.

**BlueCard (Felipe)**
1. Nada a mudar no `compra.aprovada`.
2. Chamar `GET /api/bluecard/liberacoes/{compra_id}` depois da aprovação e mostrar
   o estado ao cliente conforme a tabela acima.
3. Não exibir "pode passar no caixa" enquanto o status não for `liberado`.

---

# Resposta aos 6 ajustes (issue #2 · 14/10/2026) — já no HeadCoach

| # | Pedido | Como ficou |
|---|---|---|
| 1 | Zerar todos os BlueCard no dia de ligar; novo nasce com zero; qual campo o PDV usa; não mexer em quem não é BlueCard | Script `scripts/bluecard-zerar-limites.mjs` (lista = contratos assinados + compradores do app + arquivo de CPFs que o Felipe exportar; filiais participantes; dry-run por padrão). O PDV usa o **comercial** (`saleLimitValue`, parâmetro `IN_USA_LIMITE_COMERCIAL=1`); o HeadCoach grava **os dois** (`limitValue` e `saleLimitValue`) sempre juntos, porque o POST substitui o registro inteiro. Só CPFs da lista são tocados. "Cliente novo nasce com zero": no TOTVS o cadastro já nasce sem limite; quem der limite manual no HeadCoach a um cliente BlueCard tira a trava dele — regra operacional, não técnica. |
| 2 | Subir só na filial da compra; sem ela, nas 12 | Feito. Ordem: `compra.filial` → `compra.filiais_bluecard` → `BLUECARD_LIMITE_BRANCH_CODES` → regra FILIAL. A janela guarda em quais filiais abriu e o fechar restaura só essas. |
| 3 | Duas compras seguidas somam | Feito. Limite por filial = títulos em aberto + soma das janelas abertas do CPF que cobrem a filial. Fechar uma janela recalcula as outras; a última a fechar devolve o valor anterior (0). O vigia casa cada documento novo do TOTVS com a janela de mesmo valor (±R$ 0,05); quando só há uma janela, qualquer documento novo serve. |
| 4 | Ao detectar a venda, `POST /api/v1/vendas/{compra_id}/registrada` | Feito, com `{ recebivel, registrada_em }` e `Idempotency-Key`. Se o app recusar (409 já registrada etc.), fica no log e a varredura de vocês casa depois. |
| 5 | Janela expirada/cancelada → POST | Feito, na hora: `POST /api/v1/liberacoes/{compra_id}` (contrato abaixo). Enquanto a rota não existir no app, o HeadCoach registra o 404 e segue; a rota de status continua valendo. |
| 6 | Render sempre ligado; liberar loja a loja | O serviço do HeadCoach já roda em plano sem hibernação (jobs de minuto em minuto). Piloto: `BLUECARD_LIMITE_BRANCH_CODES=95` (lista) — compra de outra filial responde `erro` com `fora_do_piloto` na rota de status e **não** sobe limite. Para as 12: apagar a variável (o payload já manda as participantes). |

## Contrato novo: `POST /api/v1/liberacoes/{compra_id}` (HeadCoach → BlueCard)

Assinado com a chave do HeadCoach (`X-Cc-Key`, `X-Cc-Timestamp`, `X-Cc-Signature`,
`Idempotency-Key` = `<evento>:<compra_id>`). Corpo:

```json
{
  "evento": "liberacao.expirada",          // ou "liberacao.cancelada"
  "compra_id": "59a43c37-…",
  "status": "zerado_expirado",             // ou "cancelada"
  "em": "2026-10-14T18:10:41.000Z",
  "valor_cents": 26700,
  "liberado_em": "2026-10-14T16:10:41.000Z"
}
```

Resposta esperada: `200 { ok: true }`. O app desfaz a compra (limite e parcelas) como
já faz pela consulta de 15 min. O HeadCoach não reenvia em caso de erro: a rota de
status (`GET /liberacoes/{id}`) é a fonte da verdade, este POST só adianta.

## Campos do `compra.aprovada` que o gatilho lê agora

`compra.id`, `compra.cpf`, `compra.valor_cents`, `compra.filial` (opcional),
`compra.filiais_bluecard` (opcional). `documento` e `vencimentos` continuam
ignorados por este mecanismo.

## Novo estado de erro na rota de status

`erro` com mensagem `filial X fora do piloto (...)`: a compra é de uma loja que ainda
não entrou no piloto. O app deve mostrar que o cartão ainda não vale naquela loja.

## Baixa dos Pix Pagar.me (correção de 14/10/2026)

Nenhum dos 58 avisos `pagamento.pix` recebidos entre 15/09 e 14/10 tinha virado
solicitação de baixa: a tabela do HeadCoach exigia um arquivo de comprovante e o
insert era rejeitado em silêncio (só o status `erro` no evento denunciava). Corrigido
e reprocessado em 14/10: 47 solicitações abertas para o financeiro, 14 títulos já
tinham sido baixados à mão (não duplicados), 1 sem título localizado (aberta com aviso).
A partir de agora um aviso que falhar é retentado a cada 15 min por 60 dias.

**Marinalva (cobrança `527e8a6b`, R$ 248,64):** nada havia sido baixado no TOTVS. A
solicitação foi aberta já apontando para o título de **outubro** (1270-1, venc.
07/10/2026, R$ 248,62), não para janeiro. Se o app reenviar o `pagamento.pix`
corrigido, ele é ignorado como repetido (mesma cobrança).

## Variáveis (Render)

| Variável | Uso |
|---|---|
| `BLUECARD_LIMITE_AUTO_ENABLED` | `true` liga o gatilho (webhook + vigia) |
| `BLUECARD_LIMITE_BRANCH_CODES` | piloto: lista de filiais permitidas (ex.: `95`); vazia = sem restrição |
| `BLUECARD_LIBERACAO_TIMEOUT_MIN` | minutos até expirar a janela (default 120) |
| `BLUECARD_LIMITE_CRON` | cadência do vigia (default a cada minuto) |

Migration desta rodada: `migrations/bluecard_gatilho_limite_v2.sql`.
