# PDV Crosby — venda no HeadCoach + emissão fiscal direta

Três telas:

| Tela | Rota | Menu |
|---|---|---|
| PDV Crosby (frente de caixa) | `/tecnologia/pdv-crosby` | Comercial → Varejo e Tecnologia |
| Vendas PDV (vendas do dia + etiquetas RFID) | `/varejo/vendas-pdv` | Comercial → Varejo |
| Fiscal PDV (configuração por empresa) | `/admin/fiscal-pdv` | Administração |

Frontend: `gestaocrosby/src/pages/{PDVCrosby,VendasPDV,FiscalPDV}.jsx` (+ `src/components/pdv/*`, `src/utils/documentoFiscalHtml.js`, `src/utils/fetchSefaz.js`)
Backend: `apigestaocrosby/routes/pdvCrosby.routes.js`, `services/pdvFiscal.js`, `migrations/pdv_crosby.sql`, `migrations/pdv_crosby_v2.sql`

## 1. Dois destinos para a venda

| Destino | O que acontece |
|---|---|
| **TOTVS** | Fluxo original do PDV Varejo: gera a transação "em andamento" no ERP e o caixa finaliza no TRAFP005. A tela acompanha o status e gera o cashback quando vira ATENDIDA. |
| **HEADCOACH** | A venda inteira é registrada no Supabase (`pdv_vendas`, `pdv_venda_itens`, `pdv_venda_pagamentos`) e a nota fiscal é emitida direto na SEFAZ pelo backend, sem passar pelo TOTVS. |

O tipo de venda (NFCE / NFE / TROCA) define a operação TOTVS e o documento fiscal:

| Botão | Padrão (empresas 1–99) | Padrão (95 e 98) | Documento no modo HEADCOACH |
|---|---|---|---|
| NFCE | 510 | 545 | NFC-e modelo 65, CFOP 5102 |
| NFE | 521 | 548 | NF-e modelo 55, CFOP 5102 |
| TROCA | 1 | 555 | NF-e modelo 55 de **entrada**, CFOP 1202, finNFe 4 (devolução) |

Esses números são apenas o **padrão**. A operação usada de fato vem de
`pdv_fiscal_config.operacao_nfce / operacao_nfe / operacao_troca`, editável em
Administração → Fiscal PDV. O PDV lê a configuração ao escolher a empresa e o
backend resolve de novo na gravação da venda.

## 2. Regras fiscais aplicadas (regras 5102 / 1202 do TOTVS)

Conferidas contra XMLs autorizados da filial 95 (set/2026) — os valores batem centavo a centavo.

| Imposto | Venda (5102) | Troca / devolução (1202) |
|---|---|---|
| ICMS | CST 00, modBC 3, alíquota interna da UF (RN = 20%) | igual |
| PIS | CST 01, 0,65% sobre (líquido do item − ICMS) | CST 50, isento (PISOutr zerado) |
| COFINS | CST 01, 3,00% sobre a mesma base | CST 50, isento |
| IPI (só NF-e) | cEnq 999, IPINT CST 53 | cEnq 999, IPINT CST 03 |
| IBS/CBS | CST 000, cClassTrib 000001, IBS UF 0,10%, IBS Mun 0%, CBS 0,90% | igual |
| Pagamento | `detPag` por forma (01 dinheiro, 17 PIX, 03 crédito, 04 débito, 05 crédito loja); cartão leva `card` com tpIntegra 2, bandeira e **cAut = autorização** | tPag 90, vPag 0,00 |

Emitente: CRT 3 (regime normal). Dados do emitente (razão social, IE, endereço) vêm do cadastro PJ da filial no TOTVS.
Produto: NCM / CEST / origem vêm de `product/v2/products/search` (option.branchInfoCode).
Cliente: CPF/CNPJ e endereço vêm de `person/v2/individuals|legal-entities/search`.

A alíquota de ICMS por UF está em `ICMS_ALIQ_UF` (`services/pdvFiscal.js`) e pode ser sobrescrita por empresa em `pdv_fiscal_config.aliq_icms`. **Confira a alíquota antes de ir a produção em qualquer UF que não seja RN.**

## 3. Certificado digital

O backend escolhe o certificado A1 cuja **raiz de CNPJ (8 primeiros dígitos)** é igual à da filial — ou seja, o certificado da matriz assina as notas das filiais. Os certificados são os mesmos já usados pela Manifestação do Destinatário (`config/sefazCerts.js`: `certs/certificados.json` local ou `SEFAZ_CERTIFICADOS` + `SEFAZ_PFX_*` no Render).

Requisito de sistema: a biblioteca `node-sped-nfe` lê o .pfx com o binário `openssl`. No Render (Linux) ele já existe. No Windows, aponte para o do Git: `NFE_OPENSSL_PATH=C:\Program Files\Git\mingw64\bin\openssl.exe`.

## 4. Implantação

1. **Migrations**: rodar no SQL Editor do Supabase (projeto `dorztqiunewggydvkjnf`), nesta ordem e ambas idempotentes:
   - `migrations/pdv_crosby.sql` (vendas, itens, pagamentos, notas, numeração)
   - `migrations/pdv_crosby_v2.sql` (operações por empresa e `pdv_epc_movimentos`)
   Com `SUPABASE_DB_*` no `.env`, dá para usar `node scripts/add-pdv-crosby.mjs` e
   `node scripts/add-pdv-crosby-v2.mjs`. Enquanto a v2 não roda, a aba de etiquetas
   e o salvamento das operações respondem `MIGRATION_PENDING` explicando o que falta.
2. **Configuração fiscal por empresa** (botão *Fiscal ⚙* da tela, modo HEADCOACH), para cada loja que vai emitir:
   - Ambiente: começar em **2 – Homologação**.
   - Série NFC-e e NF-e: usar uma série **diferente da 3** (que o TOTVS usa). Padrão: 9.
   - Próximo número: 1 na primeira vez (a numeração é atômica por empresa/modelo).
   - CSC id + token de homologação e de produção (cadastrados no portal da SEFAZ da UF; o TOTVS usa id 1).
   - Alíquota ICMS (opcional; se vazio usa a tabela por UF).
   - Informação complementar (ex.: texto PROCON exigido em Natal).
3. Clicar **Testar SEFAZ** no modal para validar certificado + comunicação.
4. Emitir vendas em homologação até validar os cupons. Só então mudar o ambiente para 1 e preencher o CSC de produção.

## 5. Fluxo na tela (modo HEADCOACH)

1. Selecione empresa, vendedor, tipo de venda e (para NFE/TROCA) o cliente.
2. Bipe as peças / adicione por código; aplique descontos; use cashback se houver.
3. **FINALIZAR VENDA** → modal de pagamento (várias formas; cartão exige NSU e/ou autorização, parcelas e bandeira; troco calculado no dinheiro). TROCA pede só a chave da NF de origem (opcional).
4. O backend registra a venda, consome o cashback usado (TOTVS PESFC054) e emite a nota.
5. Modal de resultado: número/série, chave, protocolo, QR Code; **Imprimir cupom** (NFC-e 80 mm) ou **DANFE** (NF-e A4 simplificado), **Baixar XML**, **Consultar SEFAZ**, **Cancelar nota** (justificativa ≥ 15 caracteres, evento 110111).
6. Nota autorizada gera o cashback de 20% para o cliente.
7. **Vendas do dia**: lista por empresa/data com reimpressão, XML, situação e cancelamento de venda sem nota.

Se a SEFAZ rejeitar, a venda fica como *rejeitada* e o botão **Tentar emitir de novo** reaproveita o mesmo número. Rejeições por cadastro (NCM ausente, cliente sem endereço para NF-e, CSC faltando) aparecem antes de ir à SEFAZ.

## 6. Endpoints

```
GET  /api/pdv-crosby/config                 GET/PUT /config/:empresa
GET  /api/pdv-crosby/status-sefaz?empresa=&modelo=
POST /api/pdv-crosby/vendas                 GET /vendas?empresa=&data=   GET /vendas/:id
POST /api/pdv-crosby/vendas/:id/emitir      POST /vendas/:id/cancelar
GET  /api/pdv-crosby/notas/:id              GET /notas/:id/xml
POST /api/pdv-crosby/notas/:id/consultar    POST /notas/:id/cancelar
GET  /api/pdv-crosby/produto-fiscal/:code?branch=
GET  /api/pdv-crosby/admin/empresas          empresas + config + certificado
PUT  /api/pdv-crosby/config-lote             aplica a mesma config a várias empresas
GET  /api/pdv-crosby/epcs?empresa=&de=&ate=&epc=&produto=&venda=
```

`GET /vendas` aceita `?de=&ate=` (período), `?empresa=` opcional, `?tipo=`,
`?status=`, `?detalhes=1` (traz os itens) e `?limite=`.

## 7. Comunicação com a SEFAZ (por que não usamos os métodos prontos da lib)

A `node-sped-nfe` valida o XML com o binário externo **`xmllint`** antes de enviar
em `sefazEvento` (cancelamento), `consultarNFe`, `sefazStatus` e `sefazDistDFe` —
mas **não** em `sefazEnviaLote` (emissão). Como o `xmllint` não existe no Windows
nem em boa parte das imagens Linux, tudo menos a emissão falhava. Pior: a lib
rejeita com uma **string**, e o `asyncHandler` tentava anexar propriedades nela,
o que em ESM (strict mode) lança `TypeError` dentro do próprio `catch` — o
`next(err)` nunca era chamado e **a requisição ficava pendurada para sempre**
(sintoma: botão girando sem fim, sem erro).

Duas correções:

1. `utils/errorHandler.js` — o `asyncHandler` agora normaliza rejeições que não
   são `Error` antes de anexar contexto. Isso vale para **todas** as rotas do
   sistema, não só o PDV.
2. `services/pdvFiscal.js` — cancelamento, consulta e status montam e enviam o
   SOAP direto (`postSoap`), com timeout próprio (`SEFAZ_TIMEOUT_MS`, padrão 45s)
   e sem depender do `xmllint`. A tabela oficial de URLs da lib é reaproveitada,
   carregada por caminho de arquivo porque o `package.json` dela não exporta
   subcaminhos. A emissão continua usando `sefazEnviaLote`.

No frontend, `src/utils/fetchSefaz.js` aborta qualquer chamada dependente da
SEFAZ em 90s e orienta a usar **Consultar SEFAZ** antes de repetir a operação.

Validado em produção (empresa 1, certificado `ferreira-comercio.pfx`):
status do serviço `107 Servico em Operacao` e consulta de chave
`100 Autorizado o uso da NF-e`.

### Cancelamento

- Exige nota **autorizada** com protocolo; a justificativa tem no mínimo 15 caracteres.
- `135` (ou `155`, fora de prazo) = cancelamento homologado.
- `573` (duplicidade de evento) é tratado: o backend consulta a chave e, se a nota
  já constar cancelada na SEFAZ, sincroniza o status em vez de repetir o erro.
- Há trava por nota contra duplo clique.
- **O cancelamento é irreversível** e tem prazo legal (NFC-e costuma ser 30 minutos;
  NF-e, 24 horas). Fora do prazo a SEFAZ recusa e o caminho passa a ser a NF-e de
  devolução (botão TROCA).

## 8. Vendas PDV (Comercial → Varejo)

Lista as vendas fechadas no HeadCoach, com filtro por empresa (ou todas),
período, tipo e situação. Mostra faturamento, ticket médio, peças, trocas,
pendentes e o total por forma de pagamento. Cada linha abre os itens com os
**EPCs bipados**, os pagamentos com NSU e autorização, e os dados da nota, além
de reimprimir o cupom/DANFE e baixar o XML.

A aba **Etiquetas RFID** mostra a movimentação de cada etiqueta gravada em
`pdv_epc_movimentos`:

| Movimento | Quando acontece |
|---|---|
| `venda` | venda NFC-e ou NF-e registrada, uma linha por EPC bipado |
| `devolucao` | venda do tipo TROCA, a peça volta para a loja |
| `estorno` | venda cancelada ou nota cancelada na SEFAZ |

O índice único `(epc, venda_id, tipo)` impede duplicar o movimento quando a
mesma venda é reemitida. Falha ao gravar EPC nunca derruba a venda: fica só um
aviso no log.

## 9. Fiscal PDV (Administração)

Tabela com **todas** as empresas do TOTVS cruzadas com a configuração fiscal e o
certificado A1 resolvido pela raiz do CNPJ. Por linha dá para editar ambiente,
emissão ativa, série e próximo número de NFC-e e NF-e, as três operações e a
alíquota de ICMS, salvando direto. Também mostra se há CSC cadastrado, testa o
status da SEFAZ e avisa quando a série escolhida é a 3, que é a do TOTVS.

Selecionando várias empresas, o botão de configuração em lote aplica os mesmos
valores de uma vez (`PUT /config-lote`), com a opção de preencher as operações
com o padrão de cada empresa. Campos em branco não alteram nada. O CSC costuma
ser por CNPJ, então só aplique em lote para empresas do mesmo CNPJ.

## 10. Limitações conhecidas

- O TOTVS **não fica sabendo** da venda HEADCOACH: estoque, financeiro e faturamento do ERP não são atualizados. É o comportamento pedido ("sem passar pelo TOTVS"); se depois for necessário, dá para gerar a transação no ERP a partir de `pdv_vendas`.
- NF-e (modelo 55) para cliente de **outra UF** é bloqueada (exigiria DIFAL). Use NFC-e.
- Sem contingência (EPEC/offline) e sem inutilização de numeração pela tela.
- O DANFE da NF-e é simplificado (sem código de barras); o XML autorizado é o documento oficial.
- Prazo de cancelamento segue a regra da UF (NFC-e costuma ser 30 min; NF-e 24 h).
- O NSU não tem campo próprio no layout 4.00; vai gravado na venda e impresso no cupom. A autorização vai em `card/cAut`.
