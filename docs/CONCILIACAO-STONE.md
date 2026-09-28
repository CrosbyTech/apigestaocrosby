# Conciliação Stone × TOTVS

Página **Financeiro › Conciliação** do HeadCoach (`/conciliacao-stone`). Puxa o extrato
diário da API de Conciliação da Stone e bate cada venda de cartão com o título
correspondente no TOTVS.

## Arquivos

| Onde | O quê |
|---|---|
| `config/stoneConciliacao.js` | 13 lojas (StoneCode, CNPJ, filial TOTVS, chave `sk_`) |
| `services/stoneConciliacao.js` | download, parse do XML 2.2, cache (memória + Supabase) |
| `services/totvsCartoesStone.js` | títulos de cartão do TOTVS com portador STONE |
| `services/stoneBatimento.js` | motor de batimento 1:1 em níveis |
| `routes/conciliacaoStone.routes.js` | `/api/conciliacao-stone/*` |
| `migrations/stone_conciliacao.sql` | tabelas `stone_conciliacao_arquivos` e `stone_conciliacao_vinculos` |
| `scripts/add-stone-conciliacao.mjs` | aplica a migration (precisa de `SUPABASE_DB_*` no .env) |
| frontend `src/pages/ConciliacaoStone.jsx` | a página |

## API da Stone (fluxo "cliente Stone")

```
GET https://conciliation.stone.com.br/v2/merchant/{stonecode}/conciliation-file/{AAAAMMDD}?layout=XML2_2
Authorization: Basic base64("sk_xxx:")     (senha vazia)
x-user-type: client                        (obrigatório)
→ 307 Location = blob Azure com SAS (baixar SEM Authorization); XML às vezes gzipado
```

- **Chave `sk_`**: gerada no Portal Stone de **cada CNPJ** (Perfil › Chaves de
  Autenticação › Criar Chave › API de Conciliação). Testado: a chave de uma filial
  devolve **403** para o StoneCode de outra, mesmo com a mesma raiz de CNPJ.
  Cadastrar como env `STONE_KEY_<stonecode>` no Render.
- **AffiliationKey** (enviada pela Stone no WhatsApp) é do fluxo de *parceiro
  conciliador* (ClientId/ClientSecret + consentimento por CNPJ). Não serve como
  credencial aqui; fica só como referência no config.
- **Arquivo diário** por StoneCode, disponível a partir das 5h do dia seguinte
  (503 antes). Dia sem venda volta com seções vazias.
- **Rate limit: 7 requisições por hora por StoneCode + dia** (429). Por isso
  todo arquivo baixado vai para `stone_conciliacao_arquivos` e nunca é pedido de
  novo, salvo `POST /atualizar`. Sem a tabela, o cache fica só em memória do
  processo (funciona, mas cada deploy do Render zera).
- Só vendas de **maquininha**; PIX e link de pagamento ficam em outro arquivo.

### Seções do XML 2.2 e o que fazemos com elas

| Seção | Uso |
|---|---|
| `FinancialTransactions` | vendas **capturadas** no dia → lado Stone do batimento (`transacoes`) |
| `FinancialTransactionsAccounts` | parcelas **liquidadas** no dia (`liquidacoes`) |
| `Payments` | depósitos ao lojista (`pagamentos`, aba "Depósitos Stone") |
| `FinancialEvents` | eventos (aluguel, ajustes) — exposto em `/dia` |
| `Trailer` | contadores |

Códigos confirmados contra o TOTVS: `BrandId` 1 = Visa, 2 = Mastercard;
`AccountType` 1 = Débito, 2 = Crédito, 3 = pré-pago (o TOTVS lança como débito).

## Ligação loja Stone ↔ empresa TOTVS

`GET /lojas` e `/batimento` consultam `person/v2/branchesList` (a mesma fonte do
FiltroEmpresa) e ligam cada StoneCode à(s) empresa(s) do TOTVS **pelo CNPJ**.
O campo `filiais` do config é só fallback (TOTVS fora) e lugar para extras,
como o StoneCode compartilhado Guararapes/Tacaruna (88 + 89).
Resposta de `/lojas`: `{ lojas: [...], totvsOk: bool }`, cada loja com
`filiais`, `filialTotvs { code, nome, encontrada }` e `temChave`.

A AffiliationKey foi testada como credencial (Basic e Bearer) em 24/09/2026:
**401** em todos os casos.

## Lado TOTVS

`POST accounts-receivable/v2/documents/search` com `documentTypeList [4,5]`
(4 = cartão crédito, 5 = débito), `startIssueDate/endIssueDate`, `expand: invoice`.
Uma linha por **parcela**; agrupamos por `branchCode + receivableCode` = 1 venda.
Filtramos portador `STONE - <BANDEIRA> (C|D)` (bearerCode 6000–6099). Outros
adquirentes vistos: `REDE - ...` (70xx), `PAGARME CREDITO/DEBITO` (990x), `CREDISHOP`.
A paginação do TOTVS repete linhas entre páginas: sempre deduplicar por
`branch|receivable|installment`.

O título **não tem NSU**, então o batimento é por
**filial + data de emissão + valor + nº parcelas + bandeira/tipo**.

## Batimento (`services/stoneBatimento.js`)

| Nível | Regra |
|---|---|
| manual | vínculo salvo em `stone_conciliacao_vinculos` |
| exato | mesma data, valor, parcelas, bandeira e crédito/débito |
| bandeira | mesma data, valor e parcelas; bandeira/tipo divergem |
| data | data ±1 dia, valor e parcelas |
| valor | mesma data e valor; nº de parcelas diverge |

Sobras: **só na Stone** (venda não lançada no TOTVS) e **só no TOTVS**
(título sem captura). O TOTVS é consultado com 1 dia de folga de cada lado,
mas títulos fora do período que não casaram não entram em "só no TOTVS".

Validação em 24/09/2026 (Guararapes, 15–22/09): 19 de 19 transações Stone
casaram (17 exatas + 2 pré-pago→débito).

## Endpoints

```
GET  /api/conciliacao-stone/lojas
GET  /api/conciliacao-stone/batimento?stonecode=all|<sc>[,<sc>]&inicio=YYYY-MM-DD&fim=YYYY-MM-DD[&force=1]
GET  /api/conciliacao-stone/conciliacao?stonecode=<sc>&inicio=&fim=     (só Stone)
GET  /api/conciliacao-stone/dia?stonecode=<sc>&data=YYYY-MM-DD           (arquivo completo)
POST /api/conciliacao-stone/atualizar {stonecode, data}                  (força novo download)
GET  /api/conciliacao-stone/vinculos?stonecode=
POST /api/conciliacao-stone/vinculos {stonecode, nsu, filial, titulo, observacao, usuario}
DELETE /api/conciliacao-stone/vinculos/:id
```

## Pendências

- Chaves `sk_` das 8 lojas sem chave (Matriz, João Pessoa, Nova Cruz, Loja Virtual,
  Ayrton Senna, Imperatriz, Patos, Teresina) — gerar no Portal Stone de cada CNPJ.
- A Stone informou o **mesmo StoneCode 177781981** para Guararapes (0010-06) e
  Tacaruna (0011-97). Enquanto não vier um StoneCode próprio, o batimento dessa
  maquininha considera as filiais 88 e 89. Confirmar com a Stone.
- Rodar `migrations/stone_conciliacao.sql` no Supabase (cache persistente + vínculo manual).

## Extrato Stone: PDF/OFX → CNAB 240 (página `/extrato-stone`)

A Stone não dá extrato bancário por API a clientes (só via Stone Banking, com
onboarding comercial). O caminho adotado: exportar o **OFX** no app da Stone,
subir na página e gerar o **CNAB 240 FEBRABAN de extrato para conciliação**
(lote serviço 04, segmento E, versão arquivo 087 / lote 032), que é o mesmo
arquivo que o Sicredi entrega e o TOTVS importa.

| Onde | O quê |
|---|---|
| `utils/extratoStonePdf.js` | `parseExtratoPdfStone` (pdfjs, colunas por coordenada x), `interpretarPaginas`, `montarMemo` |
| `utils/ofxParaCnab240.js` | `parseOfx`, `classificarLancamento`, `gerarCnab240`, `decodificarOfx` |
| `routes/extratoStone.routes.js` | `GET /empresas`, `POST /ler`, `POST /converter[?download=1]` (multipart `arquivo`) |
| `scripts/ofx-para-cnab240.mjs` | CLI: `node scripts/ofx-para-cnab240.mjs in.ofx out.txt --cnpj … --empresa "…"` |
| `__tests__/ofxParaCnab240.test.js` | posições de cada campo conferidas contra o arquivo real do Sicredi |
| frontend `src/pages/ExtratoStone.jsx` | upload, extrato classificado, por dia, prévia e download do CNAB |

**Use o PDF ("Comprovante de Extrato") sempre que possível: é o único arquivo da
Stone que traz o titular** (nome, CNPJ, agência, conta). Com ~10 contas Stone, é
ele que diz de quem é o extrato. O OFX não traz o titular (empresa escolhida na tela).

Pegadinhas do PDF da Stone (validado com 28 páginas / 420 lançamentos em 25/09/2026):
- Tabela DATA | TIPO | DESCRIÇÃO | VALOR | SALDO | CONTRAPARTE; cada lançamento é um
  bloco centrado na linha da data, com nome/contraparte em várias linhas acima e
  abaixo. O parser segmenta por coordenada y (meio-termo entre datas vizinhas) e
  classifica cada item pela coluna x (75/120/280/355/425 pt).
- Hífens somem no texto extraído: CNPJ vem "17.177.680/0010" + "07"; conta
  "71938990" + "0" (último dígito = DV). "Agência" e "Conta" dividem a mesma linha.
- Ordem: do mais recente para o mais antigo; SALDO = saldo após o lançamento.
  Em pares casados (Depósito por boleto + Tarifa do boleto) a Stone repete o
  mesmo saldo nos dois — a conferência de saldo corrente só valida no último de
  uma sequência de saldos iguais.
- "Período: de X a Y": Y é exclusivo (dia da emissão + 1).
- Sem hora nos lançamentos; sem FITID (gerado `PDF-<data>-<seq>`).
- Descrições vistas: `NOME / Transferência | Pix`, `NOME / Devolução | Pix`,
  `Recebimento vendas / Antecipação [| Crédito]`, `Depósito por boleto`,
  `Tarifa do boleto`, `NOME / Recebimento | Boleto`, `NOME / Pagamento`,
  `Mensalidade / Maquininha Stone`, `NOME / Pix | Maquininha`. `montarMemo` remonta
  no formato do OFX para reaproveitar `classificarLancamento`.

Pegadinhas do OFX da Stone:
- Declara `CHARSET:1252` mas grava **UTF-8** (`decodificarOfx` detecta).
- SGML sem tag de fechamento nos campos; lançamentos do mais recente ao mais antigo.
- Não traz CNPJ do titular: a empresa é escolhida na tela (lista do TOTVS por CNPJ).
- Só `LEDGERBAL` (saldo final); o saldo inicial do header de lote é calculado.
- `DTEND`/`DTASOF` são o dia seguinte 00:00 → fim do período = dia anterior.

Mapeamento do MEMO → categoria FEBRABAN (pos 170-172) / código histórico (173-176):

| MEMO Stone | Categoria | Hist. | Descrição (177-201) |
|---|---|---|---|
| `Recebimento vendas - <bandeira> \| Crédito/Débito` | 205 | 0CR1 / 0CD1 | `VENDAS <BANDEIRA> CRED/DEB` |
| `Recebimento vendas - Antecipação \| Crédito` | 205 | 0AN1 | `VENDAS ANTECIPACAO CRED` |
| `<nome> - Transferência \| Pix` (crédito / débito) | 209 / 120 | 0CX1 / 0DX1 | `RECEBIMENTO PIX` / `PAGAMENTO PIX` |
| `<nome> - Devolução \| Pix` | 209 / 120 | 0DV1 / 0DV2 | `DEVOLUCAO PIX RECEBIDA/ENVIADA` |
| `<nome> - Pix \| Maquininha` | 209 | 0CX2 | `PIX MAQUININHA` |
| `<nome> - Pagamento` | 112 | 0PG1 | `PAGAMENTO` |
| `Mensalidade - Maquininha Stone` | 105 | 0TF1 | `TARIFA MAQUININHA STONE` |
| `Tarifa do boleto` (PDF) | 105 | 0TB1 | `TARIFA BOLETO STONE` |
| `Depósito por boleto` (PDF) | 202 | 0BL1 | `DEPOSITO POR BOLETO` |
| `<nome> - Recebimento \| Boleto` (PDF) | 202 | 0BL2 | `LIQ BOLETO STONE` |
| `<nome> - Transferência \| TED/DOC` | 209 / 120 | 0TC1 / 0TD1 | `TED RECEBIDA/ENVIADA` |

Número do documento (202-240): `PIX_CRED  <nome>` / `PIX_DEB   <nome>` no padrão
Sicredi, `STONE <BANDEIRA> CRED/DEB` para cartão. Os códigos de histórico são
nossos (o banco 197 não tem tabela própria) — cadastrar no TOTVS se a
conciliação usar histórico.
