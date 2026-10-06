# HeadCoach → BlueCard: `GET /api/bluecard/vendas` (venda extra)

Vendas do cliente no PDV desde uma data, **com ou sem BlueCard**, cada uma com as
formas de pagamento e o título BlueCard que gerou. É a fonte para medir a
*venda extra*: o que o cliente comprou além do limite do cartão e pagou em Pix,
cartão ou dinheiro.

## Chamada

```
GET https://apigestaocrosby-bw2v.onrender.com/api/bluecard/vendas?cpf=06537964474&desde=2026-01-01
```

| Parâmetro | Obrigatório | Descrição |
|---|---|---|
| `cpf` | sim | 11 dígitos |
| `desde` | sim | `AAAA-MM-DD`, data de emissão inicial (até hoje) |
| `formato=lista` | não | devolve só o array de vendas (sem `cliente`/`resumo`) |
| `refresh=1` | não | ignora o cache de 5 minutos |

Autenticação: a mesma HMAC das outras rotas (`X-Cc-Key`, `X-Cc-Timestamp`,
`X-Cc-Signature` sobre `"<timestamp>.<corpo>"`; no GET o corpo é vazio).

## Resposta (200)

Valores em **centavos**, datas `AAAA-MM-DD`, hora local da loja `HH:MM:SS`.

```json
{
  "cliente": { "codigo_totvs": 31385, "nome": "YAGO MATIAS", "cpf": "06537964474" },
  "desde": "2026-01-01",
  "resumo": {
    "vendas": 8,
    "vendas_com_bluecard": 2,
    "total_cents": 221648,
    "bluecard_cents": 60000,
    "extra_cents": 161648,
    "extra_em_vendas_bluecard_cents": 31833
  },
  "vendas": [
    {
      "documento": "3776",
      "sequencia": 691713,
      "data": "2026-05-30",
      "hora": "21:31:33",
      "filial": 95,
      "operacao": 1101,
      "condicao_pagamento": "A VISTA",
      "valor_total_cents": 91833,
      "pagamentos": [
        { "forma": "BLUECARD", "valor_cents": 60000, "parcelas": 3, "titulo": "251283",
          "portador": "TITULO EM CARTEIRA", "bandeira": null },
        { "forma": "CARTAO_CREDITO", "valor_cents": 31833, "parcelas": 6, "titulo": "182003",
          "portador": "STONE - MASTERCARD (C)", "bandeira": "MASTERCARD MAESTRO" }
      ],
      "titulo_bluecard": "251283",
      "titulos_bluecard": ["251283"],
      "valor_bluecard_cents": 60000,
      "valor_extra_cents": 31833,
      "usou_bluecard": true
    }
  ]
}
```

Com `?formato=lista` a resposta é só o array `vendas`, no espírito do exemplo
do pedido.

### Campos

- `documento`: número da nota no PDV (`invoiceCode`). `sequencia` é o identificador
  interno do TOTVS, único na base.
- `pagamentos[]`: uma linha por **forma + título**. As parcelas de um cartão viram
  uma linha com `parcelas` = quantidade (6x no crédito = 1 linha, `parcelas: 6`).
  - `forma`: `BLUECARD` (fatura/crediário, o cartão), `PIX`, `DINHEIRO`,
    `CARTAO_CREDITO`, `CARTAO_DEBITO`, `CHEQUE`, `CREDEV`, `ADIANTAMENTO`.
  - `titulo`: número do título que esse pagamento gerou no contas a receber. Para
    `BLUECARD` é o mesmo documento que aparece em `/faturas` como `TOTVS-<titulo>-<parcela>`.
- `titulo_bluecard`: o primeiro título BlueCard da venda (`null` se a venda não usou o
  cartão). `titulos_bluecard` traz todos, para o caso raro de mais de um.
- `valor_extra_cents`: tudo que não foi no BlueCard naquela venda. É o número da
  *venda extra*.
- `resumo.extra_em_vendas_bluecard_cents`: a venda extra **só nas vendas em que o
  BlueCard entrou** (compra além do limite). `resumo.extra_cents` inclui também
  vendas 100% fora do cartão.

### Erros

| HTTP | `erro.codigo` | Quando |
|---|---|---|
| 200 `[]` / `vendas: []` | — | CPF existe no TOTVS e não tem venda desde a data |
| 400 | `campo_invalido` | cpf sem 11 dígitos ou `desde` fora do formato |
| 401 | `nao_autorizado` | assinatura HMAC inválida ou fora da janela de 5 min |
| 404 | `cliente_nao_encontrado` | CPF sem cadastro no TOTVS |
| 502 | `erro_totvs` | TOTVS fora do ar ou recusou a consulta (`detalhe` traz a mensagem) |

## O que a rota faz por baixo (para não surpreender)

- Fonte: notas fiscais de saída do cliente nas **filiais próprias da Crosby** (as
  mesmas da integração; franquia não entra), com as formas de pagamento.
- Só nota **com pagamento** é venda. Notas de operação interna (transferência,
  ajuste) saem do resultado.
- O TOTVS limita cada consulta a 6 meses: `desde` antigo vira várias janelas em
  paralelo. Um ano leva ~6 s na primeira chamada; depois fica 5 min em cache.
- Devolução não aparece aqui (é nota de entrada). Se precisar, é outra rota.

## Sugestão de uso no app

- Cartão "Venda extra" no Financeiro: `resumo.extra_em_vendas_bluecard_cents` do
  período.
- Ficha do cliente: `vendas` com `usou_bluecard: true` e `valor_extra_cents > 0` como
  sinal para aumento de limite; `resumo.extra_cents / resumo.total_cents` dá a
  proporção do que o cliente paga fora do cartão.
