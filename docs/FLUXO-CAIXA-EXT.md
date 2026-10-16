# Fluxo de Caixa Ext — extratos bancários (Stone, Sicredi, Caixa, Mêntore)

Página do HeadCoach `/fluxo-caixa-ext` (Financeiro) + API `/api/fluxo-caixa-ext`.

Importa os PDFs de extrato dos bancos usados pelo grupo e consolida, de forma
gerencial, **tudo que entrou** (por forma de pagamento), **tudo que saiu** (por
fornecedor) e **o que foi transferido entre as próprias contas** (saiu da conta
A e entrou na conta B).

| Peça | Onde |
| --- | --- |
| Parser dos PDFs | `utils/extratosBancariosPdf.js` (Stone reaproveita `utils/extratoStonePdf.js`) |
| Serviço (importação, casamento de transferências, painel) | `services/fluxoCaixaExt.js` |
| Rotas | `routes/fluxoCaixaExt.routes.js` |
| Banco | `migrations/fluxo_caixa_ext.sql` — `fluxo_caixa_contas`, `fluxo_caixa_importacoes`, `fluxo_caixa_lancamentos`, `fluxo_caixa_transferencias` |
| Carga em lote | `node scripts/importar-extratos-fluxo-caixa.mjs <pasta-ou-pdf> [--so-ler]` |
| Página | `gestaocrosby/src/pages/FluxoCaixaExt.jsx` |

## Formatos aceitos (reconhecidos pelo próprio PDF)

| Banco | Arquivo | Como é lido |
| --- | --- | --- |
| Stone | "Extrato de conta corrente" ou "Comprovante de Extrato" do app | pdfjs por coordenada; colunas vêm do cabeçalho de cada página (os dois modelos têm posições diferentes) |
| Sicredi | extrato do internet banking (Associado / Cooperativa / Conta) | tabela Data \| Descrição \| Documento \| Valor \| Saldo, N páginas, termina em "Saldo da conta"; "Lançamentos Futuros" é ignorado. **Não traz o CNPJ do associado** — informe na aba Contas |
| Caixa | extrato impresso (paisagem) | Data / Data Efetiva \| Documento \| Histórico (várias linhas) \| Valor \| Saldo com sufixo C/D; "SALDO DIA" não é lançamento |
| Mêntore | extrato da conta de folha | ordem decrescente; "dd/mm/aaaa Saldo final do dia" abre o dia, "hh:mm:ss histórico crédito/débito" é o lançamento; saldo corrente é calculado |

Todo extrato passa por conferência de saldo corrente (ou saldo inicial + créditos
− débitos = saldo final, na Mêntore). Inconsistências viram aviso na importação.

## Classificação (forma de pagamento)

`PIX`, `TED/DOC`, `BOLETO`, `CARTÃO CRÉDITO`, `CARTÃO DÉBITO`, `ANTECIPAÇÃO CARTÃO`,
`DÉBITO AUTOMÁTICO`, `TARIFA/ENCARGO`, `FOLHA/SALÁRIO`, `FATURA CARTÃO`,
`COMPRA CARTÃO`, `APLICAÇÃO/RESGATE`, `EMPRÉSTIMO/LIMITE`, `DINHEIRO`,
`TRANSFERÊNCIA`, `OUTROS` (constante `FORMAS` do parser).

Regras por banco ficam em `classificarSicredi / classificarCaixa /
classificarMentore / classificarStoneNormalizado`. O Sicredi é o único que
imprime o CNPJ/CPF da contraparte no histórico (`RECEBIMENTO PIX <doc> <nome>`,
`PAGAMENTO PIX`, `TED`, `LIQUIDACAO BOLETO`, `DEBITO CONVENIOS`); `REDE DEBITO
VISA |0009-73` é venda de cartão da loja cujo CNPJ termina em 0009-73.

## Transferências entre contas

`casarTransferencias({de, ate})` roda após cada importação (e em
`POST /transferencias/recasar`). Casa uma **saída** (PIX/TED) de uma conta com
uma **entrada** de mesmo valor em outra conta importada, no mesmo dia ou no dia
seguinte, exigindo pontuação ≥ 2:

| Evidência | Pontos |
| --- | --- |
| CNPJ da contraparte = CNPJ do titular da outra conta | 3 (mesma raiz: 1) |
| nome da contraparte bate com o titular da outra conta | 2 |
| banco da contraparte (Stone informa) = banco da outra conta | 1 |
| mesmo dia | 1 |

≥ 3 = confiança `alta`, 2 = `media`. Pares automáticos do período são refeitos a
cada casamento; valores < R$ 1,00 e categorias que não sejam pix/transferência
não entram. Os dois lançamentos ficam com `tipo = TRANSFERENCIA` e saem dos
totais de "Recebido" e "Pago".

Contrapartes cujo CNPJ tem a mesma raiz de alguma conta importada aparecem com a
marca **empresa do grupo** (pagamento para conta do grupo não importada ou sem par).

## Reimportação

O PDF é a fonte da verdade do período que cobre: reimportar apaga os
lançamentos da conta entre `periodo_inicio` e `periodo_fim` (e as importações
anteriores totalmente cobertas) e grava os novos. A conta é identificada por
`banco + agência + conta`; apelido e CNPJ ajustados na tela são preservados.

## Endpoints

```
GET    /api/fluxo-caixa-ext/contas
PATCH  /api/fluxo-caixa-ext/contas/:id            { apelido, titular_cnpj, titular_nome, ativo }
GET    /api/fluxo-caixa-ext/importacoes
DELETE /api/fluxo-caixa-ext/importacoes/:id
POST   /api/fluxo-caixa-ext/ler        multipart arquivos[]   (só lê)
POST   /api/fluxo-caixa-ext/importar   multipart arquivos[]   (grava + recasa)
GET    /api/fluxo-caixa-ext/painel?de&ate[&contas&bancos&tipo&formas&categoria&contraparte&busca]
POST   /api/fluxo-caixa-ext/transferencias/recasar?de&ate
PATCH  /api/fluxo-caixa-ext/lancamentos/:id       { fornecedor, observacao, forma, categoria, tipo }
GET    /api/fluxo-caixa-ext/formas
```

`busca` procura em histórico, memo, contraparte, documento, conta; só dígitos
(≥ 3) também bate no CNPJ/CPF da contraparte e da conta; `1234,56` bate no valor.
`contraparte` aceita o nome ou o CNPJ/CPF (só dígitos). Sem as tabelas a API
responde `503 MIGRATION_PENDING`.

## Histórico

- 16/10/2026 — criação. Migration aplicada no projeto principal via RPC
  `exec_sql(query)` (existe no Supabase principal). Carga inicial: 18 PDFs de
  01–16/10/2026 (12 contas Stone, Sicredi CR + Sicredi FB, Caixa, Mêntore A01/A02/A03),
  688 lançamentos, 41 transferências casadas.
