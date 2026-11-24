# API HeadCoach — consultas (somente leitura)

<!-- Arquivo GERADO por scripts/gerar-docs-api-headcoach.mjs — não edite à mão. -->

Servidor de produção: `https://apigestaocrosby-bw2v.onrender.com`

Página interativa (Swagger): `https://apigestaocrosby-bw2v.onrender.com/api/headcoach/docs` · OpenAPI: `https://apigestaocrosby-bw2v.onrender.com/api/headcoach/openapi.json`

Exemplo:

```
curl -H "X-API-Key: <chave>" "https://apigestaocrosby-bw2v.onrender.com/api/headcoach/transaction/v1/transactions?branchCodeList=95&startDate=2026-11-17&endDate=2026-11-17&expand=items,payments"
```

Base: `/api/headcoach/<módulo>/v1/<recurso>` · só `GET` · chave em `X-API-Key`.

Lista: `{ items, count, totalItems, totalPages, hasNext, page, pageSize }`. Paginação: `page` (1…) e `pageSize` (padrão 100, máx. 1000).
Datas `AAAA-MM-DD` (fuso de Recife). Listas separadas por vírgula. Parâmetro desconhecido = erro 400. Erro: `{ code, message, detailedMessage }`.

## General — `general`

Cadastros de base: empresas, operações e formas de pagamento. Os códigos daqui aparecem nos outros módulos (branchCode, operationCode, paymentMethod).

### GET /api/headcoach/general/v1/branches

Empresas (lojas e matriz) — Todas as empresas do grupo, com CNPJ e a pessoa correspondente. `isOwn` separa as empresas próprias das franquias.

Parâmetros:
- `branchCodeList` (string) — Códigos das empresas, separados por vírgula.
- `isOwn` (boolean) — Só empresas próprias (true) ou só franquias (false).
- `isActive` (boolean) — Só ativas (true) ou só inativas (false).
- `state` (string) — UF (ex.: RN).
- `cnpj` (string) — CNPJ exato, só dígitos.
- `name` (string) — Trecho da descrição.
- `page` (integer) — Página (começa em 1).
- `pageSize` (integer) — Itens por página (até 1000).

Resposta: página de `Branch`

### GET /api/headcoach/general/v1/branches/{branchCode}

Empresas (lojas e matriz) — um registro — Todas as empresas do grupo, com CNPJ e a pessoa correspondente. `isOwn` separa as empresas próprias das franquias.

Parâmetros:
- `branchCode` (caminho, obrigatório) — Código da empresa.

Resposta:  `Branch`

### GET /api/headcoach/general/v1/operations

Operações — Operações (natureza da transação). `operationType` diz se é entrada ou saída.

Parâmetros:
- `operationCodeList` (string) — Códigos das operações, separados por vírgula.
- `operationType` (string) — Entrada ou saída. Valores: Output, Input.
- `isInactive` (boolean) — Só inativas (true) ou só ativas (false).
- `description` (string) — Trecho da descrição.
- `page` (integer) — Página (começa em 1).
- `pageSize` (integer) — Itens por página (até 1000).

Resposta: página de `Operation`

### GET /api/headcoach/general/v1/operations/{operationCode}

Operações — um registro — Operações (natureza da transação). `operationType` diz se é entrada ou saída.

Parâmetros:
- `operationCode` (caminho, obrigatório) — Código da operação.

Resposta:  `Operation`

### GET /api/headcoach/general/v1/payment-methods

Formas de pagamento — Lista fixa das formas de pagamento do HeadCoach: o código que aparece em `paymentMethod`, como vai na nota (tPag) e o que acontece no contas a receber.

Parâmetros:
- `page` (integer) — Página (começa em 1).
- `pageSize` (integer) — Itens por página (até 1000).

Resposta: página de `PaymentMethod`

Esquemas:

**Branch** — Todas as empresas do grupo, com CNPJ e a pessoa correspondente. `isOwn` separa as empresas próprias das franquias.

- `branchCode` (integer) — Código da empresa (o mesmo do TOTVS).
- `description` (string) — Descrição da empresa.
- `fantasyName` (string) — Nome fantasia.
- `cnpj` (string) — CNPJ, só dígitos.
- `personCode` (integer) — Código da pessoa (cadastro) da empresa. É por ele que uma venda da matriz para a loja é reconhecida.
- `personName` (string) — Razão social.
- `group` (string) — Grupo de empresas (CROSBY, FABIO, IRMAOS VAREJO, IRMAOS CROSBY…).
- `stateRegistration` (string) — Inscrição estadual.
- `state` (string) — UF.
- `city` (string) — Cidade.
- `isActive` (boolean) — Empresa ativa.
- `isOwn` (boolean) — Empresa própria (não franquia).
- `lastChangeDate` (date-time) — Última alteração do cadastro.

**Operation** — Operações (natureza da transação). `operationType` diz se é entrada ou saída.

- `operationCode` (integer) — Código da operação (o mesmo do TOTVS).
- `description` (string) — Descrição.
- `operationType` (string) — Entrada ou saída. Valores: Output, Input.
- `isFinancial` (boolean) — Gera financeiro.
- `isInactive` (boolean) — Operação inativa.
- `documentModel` (integer) — Modelo do documento fiscal (55 NF-e, 65 NFC-e).
- `movesStock` (boolean) — Movimenta estoque.

**PaymentMethod** — Forma de pagamento.

- `code` (string) — Código usado em `paymentMethod` nos outros módulos. Valores: Cash, Pix, CreditCard, DebitCard, BankSlip, BlueCard, Credev, Advance, BonusBalance, ExchangeVoucher.
- `name` (string) — Nome em português, como aparece nas telas.
- `nfePaymentType` (string) — Código da forma na nota fiscal (tPag).
- `documentTypeCode` (integer) — Tipo de documento do título no contas a receber (mesmos códigos do TOTVS).
- `receivable` (string) — Como o título nasce: Paid (pago), PaidToReconcile (pago, a conciliar), Open (em aberto) ou None (não gera título). Valores: Paid, PaidToReconcile, Open, None.
- `description` (string) — 

## Transaction — `transaction`

Transações do HeadCoach: venda do PDV, troca, faturamento da expedição, faturamento Brejinho, transferência e devolução. É a mesma lista da tela Transações.

### GET /api/headcoach/transaction/v1/transactions

Transações — Uma linha por transação. `status` segue o TOTVS: InProgress (registrada, nota ainda não autorizada), Attended (nota autorizada) e Canceled. `origin` diz de onde veio: Pos = Venda do PDV Crosby; Exchange = Troca no PDV Crosby (devolução do cliente, gera Credev); Billing = Faturamento de pedido da expedição; BrejinhoBilling = Faturamento Brejinho; DirectBilling = Faturamento avulso (sem pedido); Transfer = Transferência entre empresas; Return = Devolução de mercadoria. Use expand=items,payments,invoices,rfidMovements para trazer os detalhes junto.

Parâmetros:
- `branchCodeList` (string) — Empresas, separadas por vírgula.
- `startDate` (string) — Registradas a partir de (AAAA-MM-DD).
- `endDate` (string) — Registradas até (AAAA-MM-DD).
- `status` (string) — Situação (aceita lista). Valores: InProgress, Attended, Canceled.
- `origin` (string) — De onde veio. Valores: Pos, Exchange, Billing, BrejinhoBilling, DirectBilling, Transfer, Return.
- `saleType` (string) — Tipo de documento. Valores: NFCe, NFe, Exchange.
- `channel` (string) — Canal de venda (faturamento). Valores: Reseller, Franchise, Retail, Multibrand, Transfer, Return, General, Bonification.
- `customerCode` (integer) — Código do cliente.
- `customerCpfCnpj` (string) — CPF ou CNPJ do cliente.
- `sellerCode` (integer) — Código do vendedor.
- `operationCodeList` (string) — Operações, separadas por vírgula.
- `orderNumber` (string) — Número do pedido (exato).
- `orderKey` (string) — Chave do pedido no Dryland (exata).
- `cashierCode` (integer) — Transações de um caixa.
- `transactionCodeList` (string) — Números das transações, separados por vírgula.
- `startChangeDate` (string) — Alteradas a partir de (AAAA-MM-DD) — para sincronização.
- `page` (integer) — Página (começa em 1).
- `pageSize` (integer) — Itens por página (até 1000).
- `expand` (string) — Listas extras para trazer junto, separadas por vírgula: items, payments, invoices, rfidMovements.

Resposta: página de `Transaction`

### GET /api/headcoach/transaction/v1/transactions/{transactionCode}

Transações — um registro — Uma linha por transação. `status` segue o TOTVS: InProgress (registrada, nota ainda não autorizada), Attended (nota autorizada) e Canceled. `origin` diz de onde veio: Pos = Venda do PDV Crosby; Exchange = Troca no PDV Crosby (devolução do cliente, gera Credev); Billing = Faturamento de pedido da expedição; BrejinhoBilling = Faturamento Brejinho; DirectBilling = Faturamento avulso (sem pedido); Transfer = Transferência entre empresas; Return = Devolução de mercadoria. Use expand=items,payments,invoices,rfidMovements para trazer os detalhes junto.

Parâmetros:
- `transactionCode` (caminho, obrigatório) — Número da transação no HeadCoach.
- `expand` (string) — Listas extras para trazer junto, separadas por vírgula: items, payments, invoices, rfidMovements.

Resposta:  `Transaction`

### GET /api/headcoach/transaction/v1/transactions/{transactionCode}/items

Peças de uma transação — Uma linha por produto da transação, com a quantidade, o valor e as etiquetas RFID lidas.

Parâmetros:
- `transactionCode` (caminho, obrigatório) — Número da transação no HeadCoach.
- `productCode` (integer) — Só este produto.
- `page` (integer) — Página (começa em 1).
- `pageSize` (integer) — Itens por página (até 1000).

Resposta: página de `TransactionItem`

### GET /api/headcoach/transaction/v1/transactions/{transactionCode}/payments

Pagamentos de uma transação — Uma linha por forma de pagamento. Os títulos gerados ficam em accounts-receivable/documents.

Parâmetros:
- `transactionCode` (caminho, obrigatório) — Número da transação no HeadCoach.
- `paymentMethod` (string) — Forma de pagamento (aceita lista). Valores: Cash, Pix, CreditCard, DebitCard, BankSlip, BlueCard, Credev, Advance, BonusBalance, ExchangeVoucher.
- `page` (integer) — Página (começa em 1).
- `pageSize` (integer) — Itens por página (até 1000).

Resposta: página de `TransactionPayment`

### GET /api/headcoach/transaction/v1/transactions/{transactionCode}/invoices

Notas fiscais de uma transação — Uma linha por nota emitida (autorizada, rejeitada, cancelada ou com erro). Uma transação pode ter mais de uma tentativa de nota; só uma fica autorizada. O XML fica em /xml-contents/{accessKey}.

Parâmetros:
- `transactionCode` (caminho, obrigatório) — Número da transação no HeadCoach.
- `branchCodeList` (string) — Empresas emitentes, separadas por vírgula.
- `startIssueDate` (string) — Emitidas a partir de (AAAA-MM-DD).
- `endIssueDate` (string) — Emitidas até (AAAA-MM-DD).
- `invoiceStatus` (string) — Situação da nota (aceita lista). Valores: Authorized, Canceled, Rejected, Error, Pending, Issuing, Denied.
- `invoiceType` (string) — NF-e ou NFC-e. Valores: NFe, NFCe.
- `serialCode` (integer) — Série.
- `invoiceCode` (integer) — Número da nota.
- `accessKey` (string) — Chave de acesso exata.
- `transactionCode` (integer) — Notas de uma transação.
- `startChangeDate` (string) — Alteradas a partir de (AAAA-MM-DD) — para sincronização.
- `page` (integer) — Página (começa em 1).
- `pageSize` (integer) — Itens por página (até 1000).

Resposta: página de `Invoice`

### GET /api/headcoach/transaction/v1/transactions/{transactionCode}/rfid-movements

Etiquetas RFID de uma transação — Movimento de cada etiqueta (EPC) na transação: saída na venda, volta na devolução, estorno no cancelamento.

Parâmetros:
- `transactionCode` (caminho, obrigatório) — Número da transação no HeadCoach.
- `movementType` (string) — Tipo do movimento. Valores: Sale, Return, Reversal.
- `page` (integer) — Página (começa em 1).
- `pageSize` (integer) — Itens por página (até 1000).

Resposta: página de `TransactionRfidMovement`

### GET /api/headcoach/transaction/v1/seller-changes

Trocas de vendedor das transações — Histórico de quando o vendedor de uma transação foi trocado pela tela de Transações (só o owner troca). A troca vale para o ranking, o New Forecast e o contas a receber: `sellerCode` de transaction/transactions e de accounts-receivable/documents já vem com o vendedor NOVO. `source` diz onde está a transação: Sale = transaction/transactions (`transactionCode`); Return = return/returns (`transactionCode` é o `returnId`). Para sincronizar, leia por `startDate` (data da troca): a transação cancelada e a devolução não mudam de `lastChangeDate` quando o vendedor é trocado.

Parâmetros:
- `source` (string) — Sale ou Return. Valores: Sale, Return.
- `transactionCode` (integer) — Trocas de uma transação (use junto com source).
- `branchCodeList` (string) — Empresas, separadas por vírgula.
- `sellerCode` (integer) — Trocas que passaram a venda PARA este vendedor.
- `previousSellerCode` (integer) — Trocas que tiraram a venda DESTE vendedor.
- `startDate` (string) — Trocadas a partir de (AAAA-MM-DD).
- `endDate` (string) — Trocadas até (AAAA-MM-DD).
- `page` (integer) — Página (começa em 1).
- `pageSize` (integer) — Itens por página (até 1000).

Resposta: página de `TransactionSellerChange`

### GET /api/headcoach/transaction/v1/seller-changes/{changeId}

Trocas de vendedor das transações — um registro — Histórico de quando o vendedor de uma transação foi trocado pela tela de Transações (só o owner troca). A troca vale para o ranking, o New Forecast e o contas a receber: `sellerCode` de transaction/transactions e de accounts-receivable/documents já vem com o vendedor NOVO. `source` diz onde está a transação: Sale = transaction/transactions (`transactionCode`); Return = return/returns (`transactionCode` é o `returnId`). Para sincronizar, leia por `startDate` (data da troca): a transação cancelada e a devolução não mudam de `lastChangeDate` quando o vendedor é trocado.

Parâmetros:
- `changeId` (caminho, obrigatório) — Identificador da troca.

Resposta:  `TransactionSellerChange`

Esquemas:

**TransactionItem** — Uma linha por produto da transação, com a quantidade, o valor e as etiquetas RFID lidas.

- `itemId` (integer) — Identificador interno do item.
- `transactionCode` (integer) — Transação.
- `sequence` (integer) — Ordem do item na nota.
- `productCode` (integer) — Código do produto (o mesmo do TOTVS).
- `productSku` (string) — Código de barras (EAN).
- `productName` (string) — Nome do produto.
- `referenceName` (string) — Referência (modelo).
- `ncm` (string) — NCM.
- `cfop` (integer) — CFOP do item na nota.
- `measureUnit` (string) — Unidade.
- `quantity` (number) — Quantidade.
- `unitValue` (number) — Valor unitário cheio.
- `unitDiscountValue` (number) — Desconto por unidade.
- `totalValue` (number) — Total do item (quantidade × (unitário − desconto)).
- `rfidTags` (array) — Etiquetas RFID (EPC) das peças lidas.

**TransactionPayment** — Uma linha por forma de pagamento. Os títulos gerados ficam em accounts-receivable/documents.

- `paymentId` (integer) — Identificador interno do pagamento.
- `transactionCode` (integer) — Transação.
- `paymentMethod` (string) — Forma de pagamento (general/payment-methods). Valores: Cash, Pix, CreditCard, DebitCard, BankSlip, BlueCard, Credev, Advance, BonusBalance, ExchangeVoucher.
- `value` (number) — Valor pago nesta forma.
- `changeValue` (number) — Troco devolvido (dinheiro).
- `installmentQuantity` (integer) — Número de parcelas (cartão de crédito, BlueCard, boleto).
- `cardBrand` (string) — Bandeira do cartão.
- `nsu` (string) — NSU da maquininha.
- `authorizationCode` (string) — Código de autorização.
- `acquirerCnpj` (string) — CNPJ da credenciadora.

**Invoice** — Uma linha por nota emitida (autorizada, rejeitada, cancelada ou com erro). Uma transação pode ter mais de uma tentativa de nota; só uma fica autorizada. O XML fica em /xml-contents/{accessKey}.

- `invoiceId` (integer) — Identificador interno da nota.
- `transactionCode` (integer) — Transação do HeadCoach que gerou a nota (transaction/transactions).
- `branchCode` (integer) — Empresa emitente.
- `issuerCnpj` (string) — CNPJ do emitente.
- `invoiceType` (string) — NF-e ou NFC-e. Valores: NFe, NFCe.
- `documentModel` (integer) — Modelo do documento: 55 (NF-e) ou 65 (NFC-e).
- `serialCode` (integer) — Série.
- `invoiceCode` (integer) — Número da nota.
- `accessKey` (string) — Chave de acesso (44 dígitos).
- `environment` (string) — Ambiente da SEFAZ. Valores: Production, Homologation.
- `invoiceStatus` (string) — Situação da nota. Valores: Authorized, Canceled, Rejected, Error, Pending, Issuing, Denied.
- `sefazStatusCode` (string) — Código de retorno da SEFAZ (100 = autorizada, 135 = evento registrado…).
- `sefazMessage` (string) — Mensagem de retorno da SEFAZ.
- `protocol` (string) — Protocolo de autorização.
- `issueDate` (date-time) — Data e hora de emissão.
- `authorizationDate` (date-time) — Data e hora da autorização.
- `cancelDate` (date-time) — Data e hora do cancelamento.
- `cancelProtocol` (string) — Protocolo do evento de cancelamento.
- `cancelReason` (string) — Justificativa do cancelamento enviada à SEFAZ.
- `consultUrl` (string) — Endereço de consulta da NFC-e pela chave.
- `errorMessage` (string) — Erro ao emitir, quando houve.
- `customerCode` (integer) — Código do cliente da transação.
- `customerName` (string) — Nome do cliente.
- `customerCpfCnpj` (string) — CPF ou CNPJ do cliente, só dígitos.
- `sellerCode` (integer) — Código do vendedor.
- `operationCode` (integer) — Operação da transação.
- `saleType` (string) — Tipo da transação. Valores: NFCe, NFe, Exchange.
- `totalValue` (number) — Valor total da transação.
- `lastChangeDate` (date-time) — Última alteração do registro.

**TransactionRfidMovement** — Movimento de cada etiqueta (EPC) na transação: saída na venda, volta na devolução, estorno no cancelamento.

- `movementId` (integer) — Identificador interno.
- `rfidTag` (string) — Etiqueta RFID (EPC).
- `movementType` (string) — Tipo do movimento. Valores: Sale, Return, Reversal.
- `branchCode` (integer) — Empresa.
- `transactionCode` (integer) — Transação.
- `productCode` (integer) — Produto.
- `productName` (string) — Nome do produto.
- `unitValue` (number) — Valor unitário.
- `movementDate` (date-time) — Quando aconteceu.

**Transaction** — Uma linha por transação. `status` segue o TOTVS: InProgress (registrada, nota ainda não autorizada), Attended (nota autorizada) e Canceled. `origin` diz de onde veio: Pos = Venda do PDV Crosby; Exchange = Troca no PDV Crosby (devolução do cliente, gera Credev); Billing = Faturamento de pedido da expedição; BrejinhoBilling = Faturamento Brejinho; DirectBilling = Faturamento avulso (sem pedido); Transfer = Transferência entre empresas; Return = Devolução de mercadoria. Use expand=items,payments,invoices,rfidMovements para trazer os detalhes junto.

- `transactionCode` (integer) — Número da transação no HeadCoach.
- `branchCode` (integer) — Empresa.
- `branchCnpj` (string) — CNPJ da empresa.
- `branchName` (string) — Nome da empresa.
- `status` (string) — Situação da transação. Valores: InProgress, Attended, Canceled.
- `internalStatus` (string) — Situação detalhada (inclui nota rejeitada). Valores: Registered, Issuing, InvoiceRejected, InvoiceAuthorized, Canceled.
- `origin` (string) — De onde veio a transação. Valores: Pos, Exchange, Billing, BrejinhoBilling, DirectBilling, Transfer, Return.
- `saleType` (string) — Tipo de documento: NFC-e, NF-e ou troca (NF-e de devolução). Valores: NFCe, NFe, Exchange.
- `operationType` (string) — Entrada (troca, devolução) ou saída. Valores: Input, Output.
- `operationCode` (integer) — Operação (general/operations).
- `channel` (string) — Canal de venda do pedido (só faturamento). `Bonification` = bonificação: peças dadas ao cliente, sem pagamento (ver `bonification`). Valores: Reseller, Franchise, Retail, Multibrand, Transfer, Return, General, Bonification.
- `bonification` (object) — Bonificação (operação 5910 do faturamento avulso): peças dadas ao cliente, sem custo para ele. A nota sai com cada peça no custo `costName`, sem pagamento e sem contas a receber; `totalValue` é o valor da nota, não uma venda. `reason` é a justificativa obrigatória de quem fez. Nulo nas demais transações.
- `transactionDate` (date-time) — Data e hora do registro.
- `cashierCode` (integer) — Caixa em que a transação entrou (cashier/cashiers).
- `cashierDate` (date) — Data do caixa, quando gravada na transação.
- `customerCode` (integer) — Código do cliente (o mesmo do TOTVS). Nulo em NFC-e sem cliente.
- `customerName` (string) — Nome do cliente.
- `customerCpfCnpj` (string) — CPF ou CNPJ do cliente, só dígitos.
- `sellerCode` (integer) — Código do vendedor. O owner pode trocar o vendedor depois (histórico em transaction/seller-changes); aqui vem sempre o atual.
- `sellerName` (string) — Nome do vendedor.
- `itemQuantity` (number) — Quantidade de peças.
- `grossValue` (number) — Valor bruto (antes dos descontos).
- `discountValue` (number) — Descontos (inclui o cashback usado).
- `cashbackUsedValue` (number) — Cashback usado na venda.
- `freightValue` (number) — Frete.
- `totalValue` (number) — Valor total da transação.
- `orderKey` (string) — Chave do pedido no Dryland (faturamento). BRJ:… = Brejinho; AVULSO:… = sem pedido.
- `orderNumber` (string) — Número do pedido (RV…, MT…, FR…, VJ…, PE…, BRJ …).
- `referencedInvoiceKeys` (array) — Chaves das notas de origem (troca e devolução).
- `linkedExchangeTransactionCode` (integer) — Troca feita no mesmo atendimento desta venda (VENDA | TROCA).
- `cancellation` (object) — Quem cancelou e por quê (só transação cancelada pela tela de cancelamento).
- `usedCashbackWriteOff` (object) — Baixa do cashback usado na venda: quanto saiu de fato do saldo bônus do TOTVS e de que lojas (`branches`). `value` zero com `error` preenchido = o desconto ficou na venda mas a baixa não aconteceu. Nulo nas vendas anteriores a 19/11/2026, que não têm esse registro.
- `usedCashbackRefund` (object) — Cashback que a venda tinha usado e voltou para o cliente quando ela foi cancelada (nulo se não houve devolução). O valor volta no saldo bônus do TOTVS, nas lojas de onde tinha saído (`branches`), valendo até `validUntil`. `branchCode` é a loja da venda.
- `paymentSchedule` (array) — Parcelas combinadas no pedido para o boleto (faturamento).
- `shipping` (object) — Dados de transporte da nota (faturamento), com as chaves em português como gravado na tela (transportadora, volumes, peso…).
- `paymentReceipts` (array) — Comprovantes de pagamento anexados (endereços dos arquivos).
- `observation` (string) — Observação.
- `createdBy` (string) — Usuário que registrou.
- `totvsTransactionCode` (integer) — Transação espelhada no TOTVS, quando houve espelho.
- `lastChangeDate` (date-time) — Última alteração.
- `items` (array de TransactionItem) — Peças da transação (só vem com expand=items)
- `payments` (array de TransactionPayment) — Pagamentos da transação (só vem com expand=payments)
- `invoices` (array de Invoice) — Notas fiscais da transação (só vem com expand=invoices)
- `rfidMovements` (array de TransactionRfidMovement) — Etiquetas RFID movimentadas (só vem com expand=rfidMovements)

**TransactionSellerChange** — Histórico de quando o vendedor de uma transação foi trocado pela tela de Transações (só o owner troca). A troca vale para o ranking, o New Forecast e o contas a receber: `sellerCode` de transaction/transactions e de accounts-receivable/documents já vem com o vendedor NOVO. `source` diz onde está a transação: Sale = transaction/transactions (`transactionCode`); Return = return/returns (`transactionCode` é o `returnId`). Para sincronizar, leia por `startDate` (data da troca): a transação cancelada e a devolução não mudam de `lastChangeDate` quando o vendedor é trocado.

- `changeId` (integer) — Identificador da troca.
- `source` (string) — Onde está a transação. Valores: Sale, Return.
- `transactionCode` (integer) — Número da transação (Sale) ou da devolução (Return).
- `transactionReference` (string) — Como a tela de Transações mostra: V + número (venda, faturamento, transferência) ou D + número (devolução).
- `branchCode` (integer) — Empresa da transação.
- `previousSellerCode` (integer) — Vendedor anterior.
- `previousSellerName` (string) — Nome do vendedor anterior.
- `sellerCode` (integer) — Vendedor novo.
- `sellerName` (string) — Nome do vendedor novo.
- `reason` (string) — Motivo informado por quem trocou.
- `changedBy` (string) — Quem trocou.
- `changeDate` (date-time) — Quando foi trocado.

## Fiscal — `fiscal`

Notas fiscais emitidas pelo HeadCoach direto na SEFAZ (NF-e modelo 55 e NFC-e modelo 65): situação, chave, protocolo, cancelamento e o XML.

### GET /api/headcoach/fiscal/v1/invoices

Notas fiscais — Uma linha por nota emitida (autorizada, rejeitada, cancelada ou com erro). Uma transação pode ter mais de uma tentativa de nota; só uma fica autorizada. O XML fica em /xml-contents/{accessKey}.

Parâmetros:
- `branchCodeList` (string) — Empresas emitentes, separadas por vírgula.
- `startIssueDate` (string) — Emitidas a partir de (AAAA-MM-DD).
- `endIssueDate` (string) — Emitidas até (AAAA-MM-DD).
- `invoiceStatus` (string) — Situação da nota (aceita lista). Valores: Authorized, Canceled, Rejected, Error, Pending, Issuing, Denied.
- `invoiceType` (string) — NF-e ou NFC-e. Valores: NFe, NFCe.
- `serialCode` (integer) — Série.
- `invoiceCode` (integer) — Número da nota.
- `accessKey` (string) — Chave de acesso exata.
- `transactionCode` (integer) — Notas de uma transação.
- `startChangeDate` (string) — Alteradas a partir de (AAAA-MM-DD) — para sincronização.
- `page` (integer) — Página (começa em 1).
- `pageSize` (integer) — Itens por página (até 1000).

Resposta: página de `Invoice`

### GET /api/headcoach/fiscal/v1/invoices/{invoiceId}

Notas fiscais — um registro — Uma linha por nota emitida (autorizada, rejeitada, cancelada ou com erro). Uma transação pode ter mais de uma tentativa de nota; só uma fica autorizada. O XML fica em /xml-contents/{accessKey}.

Parâmetros:
- `invoiceId` (caminho, obrigatório) — Identificador interno da nota no HeadCoach.

Resposta:  `Invoice`

### GET /api/headcoach/fiscal/v1/xml-contents/{accessKey}

XML da nota fiscal — XML da nota pela chave de acesso. Por padrão vem em JSON com o XML em base64 (`mainInvoiceXml`, como no TOTVS); com `format=xml` vem o XML puro. Para nota autorizada é o XML com o protocolo; para as demais, o XML assinado.

Parâmetros:
- `accessKey` (caminho, obrigatório) — Chave de acesso (44 dígitos).
- `format` (string) — Use `xml` para receber o XML puro (application/xml).

Resposta:  `InvoiceXml`

### GET /api/headcoach/fiscal/v1/series

Séries e numeração por empresa — Empresas habilitadas a emitir nota pelo HeadCoach, com a série e o próximo número de NFC-e e de NF-e. Não traz certificado nem CSC.

Parâmetros:
- `branchCodeList` (string) — Empresas, separadas por vírgula.
- `isActive` (boolean) — Só as com emissão ligada (true) ou desligada (false).
- `page` (integer) — Página (começa em 1).
- `pageSize` (integer) — Itens por página (até 1000).

Resposta: página de `InvoiceSeries`

Esquemas:

**Invoice** — Uma linha por nota emitida (autorizada, rejeitada, cancelada ou com erro). Uma transação pode ter mais de uma tentativa de nota; só uma fica autorizada. O XML fica em /xml-contents/{accessKey}.

- `invoiceId` (integer) — Identificador interno da nota.
- `transactionCode` (integer) — Transação do HeadCoach que gerou a nota (transaction/transactions).
- `branchCode` (integer) — Empresa emitente.
- `issuerCnpj` (string) — CNPJ do emitente.
- `invoiceType` (string) — NF-e ou NFC-e. Valores: NFe, NFCe.
- `documentModel` (integer) — Modelo do documento: 55 (NF-e) ou 65 (NFC-e).
- `serialCode` (integer) — Série.
- `invoiceCode` (integer) — Número da nota.
- `accessKey` (string) — Chave de acesso (44 dígitos).
- `environment` (string) — Ambiente da SEFAZ. Valores: Production, Homologation.
- `invoiceStatus` (string) — Situação da nota. Valores: Authorized, Canceled, Rejected, Error, Pending, Issuing, Denied.
- `sefazStatusCode` (string) — Código de retorno da SEFAZ (100 = autorizada, 135 = evento registrado…).
- `sefazMessage` (string) — Mensagem de retorno da SEFAZ.
- `protocol` (string) — Protocolo de autorização.
- `issueDate` (date-time) — Data e hora de emissão.
- `authorizationDate` (date-time) — Data e hora da autorização.
- `cancelDate` (date-time) — Data e hora do cancelamento.
- `cancelProtocol` (string) — Protocolo do evento de cancelamento.
- `cancelReason` (string) — Justificativa do cancelamento enviada à SEFAZ.
- `consultUrl` (string) — Endereço de consulta da NFC-e pela chave.
- `errorMessage` (string) — Erro ao emitir, quando houve.
- `customerCode` (integer) — Código do cliente da transação.
- `customerName` (string) — Nome do cliente.
- `customerCpfCnpj` (string) — CPF ou CNPJ do cliente, só dígitos.
- `sellerCode` (integer) — Código do vendedor.
- `operationCode` (integer) — Operação da transação.
- `saleType` (string) — Tipo da transação. Valores: NFCe, NFe, Exchange.
- `totalValue` (number) — Valor total da transação.
- `lastChangeDate` (date-time) — Última alteração do registro.

**InvoiceXml** — XML da nota.

- `accessKey` (string) — 
- `invoiceStatus` (string) —  Valores: Authorized, Canceled, Rejected, Error, Pending, Issuing, Denied.
- `branchCode` (integer) — 
- `invoiceCode` (integer) — 
- `serialCode` (integer) — 
- `hasProtocol` (boolean) — true quando o XML já traz o protocolo de autorização.
- `mainInvoiceXml` (string) — XML em base64.

**InvoiceSeries** — Empresas habilitadas a emitir nota pelo HeadCoach, com a série e o próximo número de NFC-e e de NF-e. Não traz certificado nem CSC.

- `branchCode` (integer) — Empresa.
- `cnpj` (string) — CNPJ da empresa.
- `isActive` (boolean) — Emissão ligada para a empresa.
- `environment` (string) — Ambiente em uso. Valores: Production, Homologation.
- `nfceSerialCode` (integer) — Série da NFC-e.
- `nextNfceCode` (integer) — Próximo número de NFC-e.
- `nfeSerialCode` (integer) — Série da NF-e.
- `nextNfeCode` (integer) — Próximo número de NF-e.
- `lastChangeDate` (date-time) — Última alteração.

## AccountsReceivable — `accounts-receivable`

Contas a receber do HeadCoach: um título por forma de pagamento da transação (boleto e BlueCard, um por parcela). Fatura = 9.000.000.000 + número da transação.

### GET /api/headcoach/accounts-receivable/v1/documents

Títulos a receber — Um título por forma de pagamento da transação. Dinheiro, Credev e adiantamento nascem pagos; Pix e cartão nascem pagos com liquidação em D+1 e ficam a conciliar (`needsReconciliation`); boleto / fatura (e BlueCard, com `bearerName` = BLUECARD) fica em aberto até a baixa. Transação cancelada cancela os títulos.

Parâmetros:
- `branchCodeList` (string) — Empresas, separadas por vírgula.
- `status` (string) — Situação (aceita lista). Valores: Open, Paid, Canceled.
- `customerCode` (integer) — Código do cliente.
- `customerCpfCnpj` (string) — CPF ou CNPJ do cliente.
- `receivableCodeList` (string) — Faturas, separadas por vírgula.
- `transactionCode` (integer) — Títulos de uma transação.
- `paymentMethod` (string) — Forma do título (aceita lista). Valores: Cash, Pix, CreditCard, DebitCard, BankSlip, BlueCard, Credev, Advance, BonusBalance, ExchangeVoucher.
- `bearerName` (string) — Portador exato (ex.: BLUECARD).
- `origin` (string) — Sistema de origem. Valores: Pos, Billing.
- `startIssueDate` (string) — Emitidos a partir de (AAAA-MM-DD).
- `endIssueDate` (string) — Emitidos até (AAAA-MM-DD).
- `startDueDate` (string) — Vencimento a partir de (AAAA-MM-DD).
- `endDueDate` (string) — Vencimento até (AAAA-MM-DD).
- `startPaymentDate` (string) — Pagos a partir de (AAAA-MM-DD).
- `endPaymentDate` (string) — Pagos até (AAAA-MM-DD).
- `needsReconciliation` (boolean) — Só os que entram na conciliação (true).
- `startChangeDate` (string) — Alterados a partir de (AAAA-MM-DD) — para sincronização.
- `page` (integer) — Página (começa em 1).
- `pageSize` (integer) — Itens por página (até 1000).
- `expand` (string) — Listas extras para trazer junto, separadas por vírgula: settlements.

Resposta: página de `ReceivableDocument`

### GET /api/headcoach/accounts-receivable/v1/documents/{receivableCode}/{installmentCode}

Títulos a receber — um registro — Um título por forma de pagamento da transação. Dinheiro, Credev e adiantamento nascem pagos; Pix e cartão nascem pagos com liquidação em D+1 e ficam a conciliar (`needsReconciliation`); boleto / fatura (e BlueCard, com `bearerName` = BLUECARD) fica em aberto até a baixa. Transação cancelada cancela os títulos.

Parâmetros:
- `receivableCode` (caminho, obrigatório) — Número da fatura (9.000.000.000 + transação).
- `installmentCode` (caminho, obrigatório) — Parcela.
- `expand` (string) — Listas extras para trazer junto, separadas por vírgula: settlements.

Resposta:  `ReceivableDocument`

### GET /api/headcoach/accounts-receivable/v1/settlements

Baixas (recebimentos) — Recebimento de título que estava em aberto (boleto / fatura), com juros, multa e desconto. Não há estorno de baixa.

Parâmetros:
- `documentId` (integer) — Baixas de um título.
- `startPaymentDate` (string) — Pagas a partir de (AAAA-MM-DD).
- `endPaymentDate` (string) — Pagas até (AAAA-MM-DD).
- `page` (integer) — Página (começa em 1).
- `pageSize` (integer) — Itens por página (até 1000).

Resposta: página de `ReceivableSettlement`

### GET /api/headcoach/accounts-receivable/v1/reconciliations

Conciliações D+1 — Fechamento do que caiu de cartão e Pix: um lançamento por empresa + data de liquidação + forma + portador. A diferença entre o bruto e o recebido é a taxa real.

Parâmetros:
- `branchCodeList` (string) — Empresas, separadas por vírgula.
- `startSettlementDate` (string) — Liquidação a partir de (AAAA-MM-DD).
- `endSettlementDate` (string) — Liquidação até (AAAA-MM-DD).
- `paymentMethod` (string) — Forma. Valores: Cash, Pix, CreditCard, DebitCard, BankSlip, BlueCard, Credev, Advance, BonusBalance, ExchangeVoucher.
- `page` (integer) — Página (começa em 1).
- `pageSize` (integer) — Itens por página (até 1000).

Resposta: página de `ReceivableReconciliation`

### GET /api/headcoach/accounts-receivable/v1/reconciliations/{reconciliationId}

Conciliações D+1 — um registro — Fechamento do que caiu de cartão e Pix: um lançamento por empresa + data de liquidação + forma + portador. A diferença entre o bruto e o recebido é a taxa real.

Parâmetros:
- `reconciliationId` (caminho, obrigatório) — Identificador da conciliação.

Resposta:  `ReceivableReconciliation`

Esquemas:

**ReceivableSettlement** — Recebimento de título que estava em aberto (boleto / fatura), com juros, multa e desconto. Não há estorno de baixa.

- `settlementId` (integer) — Identificador da baixa.
- `documentId` (integer) — Título baixado (documentId em /documents).
- `paymentDate` (date) — Data do pagamento.
- `documentValue` (number) — Valor original do título.
- `interestValue` (number) — Juros cobrados.
- `fineValue` (number) — Multa cobrada.
- `discountValue` (number) — Desconto concedido.
- `receivedValue` (number) — Valor recebido.
- `receivingMethod` (string) — Como foi recebido (pix, boleto, transferencia, dinheiro, cartao…), texto livre da tela.
- `account` (string) — Banco / conta em que entrou.
- `observation` (string) — Observação.
- `settledBy` (string) — Usuário que baixou.
- `settlementDate` (date-time) — Quando a baixa foi lançada.

**ReceivableDocument** — Um título por forma de pagamento da transação. Dinheiro, Credev e adiantamento nascem pagos; Pix e cartão nascem pagos com liquidação em D+1 e ficam a conciliar (`needsReconciliation`); boleto / fatura (e BlueCard, com `bearerName` = BLUECARD) fica em aberto até a baixa. Transação cancelada cancela os títulos.

- `documentId` (integer) — Identificador interno do título.
- `branchCode` (integer) — Empresa.
- `receivableCode` (integer) — Número da fatura.
- `installmentCode` (integer) — Parcela.
- `transactionCode` (integer) — Transação de origem (transaction/transactions).
- `origin` (string) — Sistema de origem: PDV ou faturamento da expedição. Valores: Pos, Billing.
- `channel` (string) — Canal de venda (faturamento). Valores: Reseller, Franchise, Retail, Multibrand, Transfer, Return, General, Bonification.
- `operationCode` (integer) — Operação da transação.
- `customerCode` (integer) — Código do cliente.
- `customerName` (string) — Nome do cliente.
- `customerCpfCnpj` (string) — CPF ou CNPJ do cliente, só dígitos.
- `sellerCode` (integer) — Código do vendedor.
- `sellerName` (string) — Nome do vendedor.
- `paymentMethod` (string) — Forma do título. BlueCard aparece como BankSlip com bearerName = BLUECARD. Valores: Cash, Pix, CreditCard, DebitCard, BankSlip, BlueCard, Credev, Advance, BonusBalance, ExchangeVoucher.
- `documentTypeCode` (integer) — Tipo de documento (códigos do TOTVS: 1 fatura, 3 dinheiro, 4 crédito, 5 débito, 10 adiantamento, 20 Credev, 26 Pix).
- `bearerName` (string) — Portador (PIX, CARTEIRA, BLUECARD, a operadora do cartão…).
- `cardBrand` (string) — Bandeira do cartão.
- `nsu` (string) — NSU.
- `authorizationCode` (string) — Código de autorização.
- `cardInstallmentQuantity` (integer) — Parcelas no cartão de crédito.
- `invoiceType` (string) — NF-e ou NFC-e. Valores: NFe, NFCe.
- `invoiceSerialCode` (integer) — Série da nota.
- `invoiceCode` (integer) — Número da nota.
- `invoiceAccessKey` (string) — Chave da nota.
- `cashierCode` (integer) — Caixa da transação.
- `cashierDate` (date) — Data do caixa.
- `issueDate` (date) — Emissão.
- `dueDate` (date) — Vencimento.
- `documentValue` (number) — Valor do título.
- `feePercentage` (number) — Taxa da maquininha (%).
- `feeValue` (number) — Taxa da maquininha (R$).
- `netValue` (number) — Valor líquido (título − taxa).
- `status` (string) — Situação do título. Valores: Open, Paid, Canceled.
- `paymentDate` (date) — Data do pagamento.
- `settlementDate` (date) — Data em que o dinheiro cai (cartão e Pix: D+1).
- `paidValue` (number) — Valor pago.
- `interestValue` (number) — Juros recebidos na baixa.
- `fineValue` (number) — Multa recebida na baixa.
- `discountValue` (number) — Desconto dado na baixa.
- `needsReconciliation` (boolean) — Título de cartão ou Pix que entra na conciliação D+1.
- `reconciliationDate` (date-time) — Quando foi conciliado.
- `reconciliationId` (integer) — Conciliação que fechou o título (/reconciliations).
- `settledBy` (string) — Quem baixou ("automático (na emissão)" para os que nascem pagos).
- `settledDate` (date-time) — Quando foi baixado.
- `cancelDate` (date-time) — Quando foi cancelado.
- `cancelReason` (string) — Motivo do cancelamento.
- `observation` (string) — Observação (ex.: BlueCard).
- `lastChangeDate` (date-time) — Última alteração.
- `settlements` (array de ReceivableSettlement) — Baixas do título (só vem com expand=settlements)

**ReceivableReconciliation** — Fechamento do que caiu de cartão e Pix: um lançamento por empresa + data de liquidação + forma + portador. A diferença entre o bruto e o recebido é a taxa real.

- `reconciliationId` (integer) — Identificador da conciliação.
- `branchCode` (integer) — Empresa.
- `settlementDate` (date) — Data de liquidação conciliada.
- `paymentMethod` (string) — Forma (Pix, cartão de crédito ou débito). Valores: Cash, Pix, CreditCard, DebitCard, BankSlip, BlueCard, Credev, Advance, BonusBalance, ExchangeVoucher.
- `bearerName` (string) — Portador.
- `documentQuantity` (integer) — Quantidade de títulos conciliados.
- `grossValue` (number) — Soma dos títulos.
- `receivedValue` (number) — Valor que caiu na conta.
- `feeValue` (number) — Taxa real (bruto − recebido).
- `observation` (string) — Observação.
- `reconciledBy` (string) — Quem conciliou.
- `reconciliationDate` (date-time) — Quando foi conciliado.

## AccountsPayable — `accounts-payable`

Contas a pagar do HeadCoach: duplicatas de fornecedor com documento fiscal, portador, despesa e rateio por centro de custo. A duplicata é um número por empresa + fornecedor e cada lançamento é uma parcela dela: 1/11 e 1/12 são a duplicata 1, parcelas 11 e 12 (em conta mensal, a parcela é o mês do vencimento).

### GET /api/headcoach/accounts-payable/v1/documents

Duplicatas a pagar — Uma linha por parcela. `duplicateCode` é o número da duplicata da empresa com aquele fornecedor (1, 2, 3…), `installmentCode` é a parcela dentro dela e `duplicateLabel` é como aparecem na tela ("1/12" = duplicata 1, parcela 12). Conta que vem todo mês (energia, aluguel) fica na mesma duplicata, com o mês do vencimento como parcela. `fiscalDocument` é a nota / fatura do fornecedor, muda a cada parcela e pode vir vazio (aluguel, recibo). Quando a despesa é rateada, `apportionment` traz as linhas, e `expenseCode` / `costCenterCode` são os da linha de maior percentual. Baixa parcial: a duplicata paga em parte continua `Open`, com `paidValue` = o que já saiu, `remainingValue` = o que falta e uma linha em /settlements por pagamento; para somar o que foi PAGO use `paidValue` (das Paid e das pagas em parte) e para o que está EM ABERTO use `remainingValue`. As duplicatas com `origin` = totvs vieram do contas a pagar do TOTVS já pagas (baixa de lá, conciliação do extrato ou Liberação de Pagamento): `fiscalDocument` guarda o número da duplicata no TOTVS e `settledBy` diz por onde foi paga.

Parâmetros:
- `branchCodeList` (string) — Empresas, separadas por vírgula.
- `status` (string) — Situação (aceita lista). Valores: Open, Paid, Canceled.
- `supplierCode` (integer) — Código do fornecedor.
- `supplierCpfCnpj` (string) — CPF ou CNPJ do fornecedor.
- `duplicateCode` (integer) — Número da duplicata (use junto com empresa e fornecedor): traz todas as parcelas dela.
- `installmentCode` (integer) — Parcela.
- `fiscalDocument` (string) — Documento fiscal exato.
- `batchId` (string) — Parcelas incluídas na mesma vez.
- `isPartiallyPaid` (string) — true = só as pagas em parte (em aberto com pagamento lançado); false = todas as outras.
- `origin` (string) — Origem exata (ex.: totvs = só as importadas do TOTVS; manual = só as incluídas na tela).
- `expenseCode` (string) — Despesa, em qualquer linha do rateio.
- `costCenterCode` (string) — Centro de custo, em qualquer linha do rateio.
- `bearerCode` (integer) — Código do portador.
- `paymentMethod` (string) — Forma de pagamento (aceita lista). Valores: Pix, BankSlip, Transfer, DirectDebit, Card, Cash, Other.
- `forecastType` (string) — Conta real ou previsão. Valores: Real, Forecast.
- `startIssueDate` (string) — Emitidas a partir de (AAAA-MM-DD).
- `endIssueDate` (string) — Emitidas até (AAAA-MM-DD).
- `startDueDate` (string) — Vencimento a partir de (AAAA-MM-DD).
- `endDueDate` (string) — Vencimento até (AAAA-MM-DD).
- `startPaymentDate` (string) — Pagas a partir de (AAAA-MM-DD).
- `endPaymentDate` (string) — Pagas até (AAAA-MM-DD).
- `startChangeDate` (string) — Alteradas a partir de (AAAA-MM-DD) — para sincronização.
- `page` (integer) — Página (começa em 1).
- `pageSize` (integer) — Itens por página (até 1000).
- `expand` (string) — Listas extras para trazer junto, separadas por vírgula: settlements.

Resposta: página de `PayableDocument`

### GET /api/headcoach/accounts-payable/v1/documents/{documentId}

Duplicatas a pagar — um registro — Uma linha por parcela. `duplicateCode` é o número da duplicata da empresa com aquele fornecedor (1, 2, 3…), `installmentCode` é a parcela dentro dela e `duplicateLabel` é como aparecem na tela ("1/12" = duplicata 1, parcela 12). Conta que vem todo mês (energia, aluguel) fica na mesma duplicata, com o mês do vencimento como parcela. `fiscalDocument` é a nota / fatura do fornecedor, muda a cada parcela e pode vir vazio (aluguel, recibo). Quando a despesa é rateada, `apportionment` traz as linhas, e `expenseCode` / `costCenterCode` são os da linha de maior percentual. Baixa parcial: a duplicata paga em parte continua `Open`, com `paidValue` = o que já saiu, `remainingValue` = o que falta e uma linha em /settlements por pagamento; para somar o que foi PAGO use `paidValue` (das Paid e das pagas em parte) e para o que está EM ABERTO use `remainingValue`. As duplicatas com `origin` = totvs vieram do contas a pagar do TOTVS já pagas (baixa de lá, conciliação do extrato ou Liberação de Pagamento): `fiscalDocument` guarda o número da duplicata no TOTVS e `settledBy` diz por onde foi paga.

Parâmetros:
- `documentId` (caminho, obrigatório) — Identificador da parcela.
- `expand` (string) — Listas extras para trazer junto, separadas por vírgula: settlements.

Resposta:  `PayableDocument`

### GET /api/headcoach/accounts-payable/v1/settlements

Baixas (pagamentos) — Pagamentos das duplicatas, com juros, multa e desconto. Uma linha por pagamento: a duplicata paga em parte tem várias, e `documentValue` − (`paidValue` − juros − multa + desconto) é o que ficou em aberto depois de cada uma. Não há estorno de baixa.

Parâmetros:
- `documentId` (integer) — Baixas de uma duplicata.
- `startPaymentDate` (string) — Pagas a partir de (AAAA-MM-DD).
- `endPaymentDate` (string) — Pagas até (AAAA-MM-DD).
- `page` (integer) — Página (começa em 1).
- `pageSize` (integer) — Itens por página (até 1000).

Resposta: página de `PayableSettlement`

### GET /api/headcoach/accounts-payable/v1/payment-releases

Liberação de pagamento — Duplicatas que o financeiro liberou para pagamento, no fluxo Pending (pendente) → Scheduled (previsão) → Approved (aprovado) → Included (incluído no banco) → Paid (pago). Returned = devolvida ao contas a pagar sem pagar. Uma duplicata tem no máximo uma liberação em andamento; `value` é quanto vai ser pago nela (menor que o que falta = pagamento parcial). Ao pagar, `settlementId` aponta a baixa em /settlements.

Parâmetros:
- `documentId` (integer) — Liberações de uma duplicata.
- `status` (string) — Etapa (aceita lista). Valores: Pending, Scheduled, Approved, Included, Paid, Returned.
- `bankAccount` (string) — Banco / conta exata.
- `paymentMethod` (string) — Forma de pagamento (aceita lista). Valores: Pix, BankSlip, Transfer, DirectDebit, Card, Cash, Other.
- `startScheduledDate` (string) — Previstas a partir de (AAAA-MM-DD).
- `endScheduledDate` (string) — Previstas até (AAAA-MM-DD).
- `startPaymentDate` (string) — Pagas a partir de (AAAA-MM-DD).
- `endPaymentDate` (string) — Pagas até (AAAA-MM-DD).
- `startChangeDate` (string) — Alteradas a partir de (AAAA-MM-DD) — para sincronização.
- `page` (integer) — Página (começa em 1).
- `pageSize` (integer) — Itens por página (até 1000).

Resposta: página de `PayablePaymentRelease`

### GET /api/headcoach/accounts-payable/v1/payment-releases/{releaseId}

Liberação de pagamento — um registro — Duplicatas que o financeiro liberou para pagamento, no fluxo Pending (pendente) → Scheduled (previsão) → Approved (aprovado) → Included (incluído no banco) → Paid (pago). Returned = devolvida ao contas a pagar sem pagar. Uma duplicata tem no máximo uma liberação em andamento; `value` é quanto vai ser pago nela (menor que o que falta = pagamento parcial). Ao pagar, `settlementId` aponta a baixa em /settlements.

Parâmetros:
- `releaseId` (caminho, obrigatório) — Identificador da liberação.

Resposta:  `PayablePaymentRelease`

### GET /api/headcoach/accounts-payable/v1/expenses

Despesas — Plano de despesas usado nas duplicatas.

Parâmetros:
- `expenseName` (string) — Parte do nome.
- `isActive` (boolean) — Só as em uso (true).
- `page` (integer) — Página (começa em 1).
- `pageSize` (integer) — Itens por página (até 1000).

Resposta: página de `PayableExpense`

### GET /api/headcoach/accounts-payable/v1/expenses/{expenseCode}

Despesas — um registro — Plano de despesas usado nas duplicatas.

Parâmetros:
- `expenseCode` (caminho, obrigatório) — Código da despesa.

Resposta:  `PayableExpense`

### GET /api/headcoach/accounts-payable/v1/cost-centers

Centros de custo — Centros de custo do rateio: por empresa (loja, matriz) ou por setor.

Parâmetros:
- `costCenterType` (string) — Tipo (aceita lista). Valores: Branch, Department, Other.
- `isActive` (boolean) — Só os em uso (true).
- `page` (integer) — Página (começa em 1).
- `pageSize` (integer) — Itens por página (até 1000).

Resposta: página de `PayableCostCenter`

### GET /api/headcoach/accounts-payable/v1/cost-centers/{costCenterCode}

Centros de custo — um registro — Centros de custo do rateio: por empresa (loja, matriz) ou por setor.

Parâmetros:
- `costCenterCode` (caminho, obrigatório) — Código do centro de custo.

Resposta:  `PayableCostCenter`

Esquemas:

**PayableSettlement** — Pagamentos das duplicatas, com juros, multa e desconto. Uma linha por pagamento: a duplicata paga em parte tem várias, e `documentValue` − (`paidValue` − juros − multa + desconto) é o que ficou em aberto depois de cada uma. Não há estorno de baixa.

- `settlementId` (integer) — Identificador da baixa.
- `documentId` (integer) — Duplicata baixada (documentId em /documents).
- `paymentDate` (date) — Data do pagamento.
- `documentValue` (number) — Quanto estava em aberto antes deste pagamento (na primeira baixa, o valor da duplicata).
- `interestValue` (number) — Juros pagos.
- `fineValue` (number) — Multa paga.
- `discountValue` (number) — Desconto obtido.
- `paidValue` (number) — Valor pago neste pagamento.
- `paymentMethod` (string) — Como foi pago. Valores: Pix, BankSlip, Transfer, DirectDebit, Card, Cash, Other.
- `account` (string) — Banco / conta de onde saiu.
- `observation` (string) — Observação.
- `settledBy` (string) — Usuário que baixou.
- `settlementDate` (date-time) — Quando a baixa foi lançada.

**PayableDocument** — Uma linha por parcela. `duplicateCode` é o número da duplicata da empresa com aquele fornecedor (1, 2, 3…), `installmentCode` é a parcela dentro dela e `duplicateLabel` é como aparecem na tela ("1/12" = duplicata 1, parcela 12). Conta que vem todo mês (energia, aluguel) fica na mesma duplicata, com o mês do vencimento como parcela. `fiscalDocument` é a nota / fatura do fornecedor, muda a cada parcela e pode vir vazio (aluguel, recibo). Quando a despesa é rateada, `apportionment` traz as linhas, e `expenseCode` / `costCenterCode` são os da linha de maior percentual. Baixa parcial: a duplicata paga em parte continua `Open`, com `paidValue` = o que já saiu, `remainingValue` = o que falta e uma linha em /settlements por pagamento; para somar o que foi PAGO use `paidValue` (das Paid e das pagas em parte) e para o que está EM ABERTO use `remainingValue`. As duplicatas com `origin` = totvs vieram do contas a pagar do TOTVS já pagas (baixa de lá, conciliação do extrato ou Liberação de Pagamento): `fiscalDocument` guarda o número da duplicata no TOTVS e `settledBy` diz por onde foi paga.

- `documentId` (integer) — Identificador interno da parcela.
- `branchCode` (integer) — Empresa.
- `supplierCode` (integer) — Código do fornecedor (pessoa).
- `supplierName` (string) — Nome do fornecedor.
- `supplierCpfCnpj` (string) — CPF ou CNPJ do fornecedor.
- `duplicateCode` (integer) — Número da duplicata, por empresa + fornecedor.
- `installmentCode` (integer) — Parcela dentro da duplicata (conta mensal: o mês do vencimento).
- `duplicateLabel` (string) — Duplicata / parcela, como aparece na tela.
- `fiscalDocument` (string) — Documento fiscal: número da nota / fatura do fornecedor.
- `batchId` (string) — Lote: parcelas incluídas na mesma vez.
- `documentType` (string) — Tipo de documento. Valores: Duplicate, Invoice, BankSlip, Receipt, Other.
- `bearerCode` (integer) — Código do portador.
- `bearerName` (string) — Portador.
- `paymentMethod` (string) — Forma de pagamento prevista. Valores: Pix, BankSlip, Transfer, DirectDebit, Card, Cash, Other.
- `pixKey` (string) — Chave Pix ou Pix copia e cola.
- `barcode` (string) — Linha digitável do boleto.
- `expenseCode` (integer) — Despesa (a da linha principal do rateio).
- `expenseName` (string) — Nome da despesa.
- `costCenterCode` (integer) — Centro de custo (o da linha principal do rateio).
- `costCenterName` (string) — Nome do centro de custo.
- `apportionment` (array) — Rateio por despesa e centro de custo.
- `forecastType` (string) — Conta real ou previsão. Valores: Real, Forecast.
- `issueDate` (date) — Emissão.
- `entryDate` (date) — Entrada (quando foi lançada).
- `dueDate` (date) — Vencimento.
- `reference` (string) — Competência (ex.: 10/2026).
- `value` (number) — Valor da duplicata.
- `status` (string) — Situação. Vencida = Open com dueDate anterior a hoje. A duplicata paga em parte continua Open até zerar (veja isPartiallyPaid). Valores: Open, Paid, Canceled.
- `paymentDate` (date) — Data do pagamento (do último, quando houve mais de um).
- `interestValue` (number) — Juros pagos na baixa.
- `fineValue` (number) — Multa paga na baixa.
- `discountValue` (number) — Desconto obtido na baixa.
- `paidValue` (number) — Valor pago até agora (soma das baixas; na duplicata paga em parte é o que já saiu).
- `remainingValue` (number) — Quanto falta pagar: valor − (pago − juros − multa + desconto). Zero na paga e na cancelada.
- `isPartiallyPaid` (boolean) — Paga em parte: continua Open, com `paidValue` já pago e `remainingValue` em aberto.
- `paymentAccount` (string) — Banco / conta de onde saiu o pagamento.
- `observation` (string) — Observação.
- `origin` (string) — De onde veio: manual (tela), o robô que capturou a conta (ex.: bot-cosern-whatsapp), solicitacao-crosby (Solicitação Crosby aprovada pelo financeiro; originReference = id da solicitação) ou totvs (duplicata já paga importada do contas a pagar do TOTVS — a marca TOTVS da tela).
- `originReference` (string) — Identificador na origem. Nas importadas do TOTVS: empresa|fornecedor|duplicata|parcela de lá.
- `createdBy` (string) — Quem incluiu.
- `createDate` (date-time) — Quando foi incluída.
- `settledBy` (string) — Quem baixou.
- `settledDate` (date-time) — Quando foi baixada.
- `cancelDate` (date-time) — Quando foi cancelada.
- `cancelReason` (string) — Motivo do cancelamento.
- `lastChangeDate` (date-time) — Última alteração.
- `settlements` (array de PayableSettlement) — Baixas da duplicata (só vem com expand=settlements)

**PayablePaymentRelease** — Duplicatas que o financeiro liberou para pagamento, no fluxo Pending (pendente) → Scheduled (previsão) → Approved (aprovado) → Included (incluído no banco) → Paid (pago). Returned = devolvida ao contas a pagar sem pagar. Uma duplicata tem no máximo uma liberação em andamento; `value` é quanto vai ser pago nela (menor que o que falta = pagamento parcial). Ao pagar, `settlementId` aponta a baixa em /settlements.

- `releaseId` (integer) — Identificador da liberação.
- `documentId` (integer) — Duplicata liberada (documentId em /documents).
- `status` (string) — Etapa da liberação. Valores: Pending, Scheduled, Approved, Included, Paid, Returned.
- `value` (number) — Quanto vai ser (ou foi) pago nesta liberação.
- `scheduledDate` (date) — Dia previsto para pagar.
- `bankAccount` (string) — Banco / conta de onde o pagamento sai.
- `paymentMethod` (string) — Forma de pagamento. Valores: Pix, BankSlip, Transfer, DirectDebit, Card, Cash, Other.
- `observation` (string) — Observação.
- `releasedBy` (string) — Quem liberou para pagamento.
- `releaseDate` (date-time) — Quando foi liberada.
- `approvedBy` (string) — Quem aprovou.
- `approvalDate` (date-time) — Quando foi aprovada.
- `includedBy` (string) — Quem incluiu o pagamento no banco.
- `inclusionDate` (date-time) — Quando foi incluída no banco.
- `paidBy` (string) — Quem marcou como paga.
- `paymentDate` (date) — Data do pagamento.
- `settlementId` (integer) — Baixa gravada na duplicata (settlementId em /settlements).
- `returnedBy` (string) — Quem devolveu ao contas a pagar.
- `returnDate` (date-time) — Quando foi devolvida.
- `returnReason` (string) — Motivo da devolução.
- `lastChangeDate` (date-time) — Última alteração.

**PayableExpense** — Plano de despesas usado nas duplicatas.

- `expenseCode` (integer) — Código da despesa.
- `expenseName` (string) — Nome da despesa.
- `isActive` (boolean) — Em uso.

**PayableCostCenter** — Centros de custo do rateio: por empresa (loja, matriz) ou por setor.

- `costCenterCode` (integer) — Código do centro de custo.
- `costCenterName` (string) — Nome do centro de custo.
- `costCenterType` (string) — Empresa, setor ou outro. Valores: Branch, Department, Other.
- `isActive` (boolean) — Em uso.

## CustomerBalance — `customer-balance`

Saldos dos clientes no HeadCoach, por empresa: Credev (crédito de devolução e troca), adiantamento e cashback, com o extrato de cada movimento. O saldo vale só na empresa em que foi gerado.

### GET /api/headcoach/customer-balance/v1/balances

Saldos por cliente — Uma linha por cliente + empresa + tipo de saldo. Por padrão vêm também os saldos zerados; use `onlyPositive=true` para trazer só quem tem saldo.

Parâmetros:
- `branchCodeList` (string) — Empresas, separadas por vírgula.
- `customerCode` (integer) — Código do cliente.
- `customerCpfCnpj` (string) — CPF ou CNPJ do cliente.
- `balanceType` (string) — Tipo de saldo (aceita lista). Valores: Credev, Advance, Cashback.
- `onlyPositive` (string) — true = só saldos maiores que zero.
- `startChangeDate` (string) — Alterados a partir de (AAAA-MM-DD) — para sincronização.
- `page` (integer) — Página (começa em 1).
- `pageSize` (integer) — Itens por página (até 1000).

Resposta: página de `CustomerBalance`

### GET /api/headcoach/customer-balance/v1/movements

Extrato dos saldos — Cada entrada e saída do saldo: carga inicial vinda do TOTVS, crédito de devolução ou troca, uso como pagamento, estorno por cancelamento, ajuste manual e acerto diário do cashback. `value` positivo entra, negativo sai.

Parâmetros:
- `branchCodeList` (string) — Empresas, separadas por vírgula.
- `customerCode` (integer) — Código do cliente.
- `balanceType` (string) — Tipo de saldo (aceita lista). Valores: Credev, Advance, Cashback.
- `movementType` (string) — Tipo do movimento (aceita lista). Valores: InitialLoad, Return, ReturnCanceled, Use, Reversal, Adjustment, TotvsSync.
- `transactionCode` (integer) — Movimentos de uma transação.
- `startDate` (string) — A partir de (AAAA-MM-DD).
- `endDate` (string) — Até (AAAA-MM-DD).
- `page` (integer) — Página (começa em 1).
- `pageSize` (integer) — Itens por página (até 1000).

Resposta: página de `BalanceMovement`

### GET /api/headcoach/customer-balance/v1/billing-bonus

Saldo bônus do faturamento — Crédito gerado no faturamento quando faltou peça do pedido (o cliente pagou e a peça não foi): fica como saldo bônus para a próxima compra. Cada linha é um crédito ou um uso.

Parâmetros:
- `customerCode` (integer) — Código do cliente.
- `entryType` (string) — Crédito ou uso. Valores: Credit, Use, Reversal, Cancellation.
- `transactionCode` (integer) — Lançamentos de uma transação.
- `startDate` (string) — A partir de (AAAA-MM-DD).
- `endDate` (string) — Até (AAAA-MM-DD).
- `page` (integer) — Página (começa em 1).
- `pageSize` (integer) — Itens por página (até 1000).

Resposta: página de `BillingBonus`

Esquemas:

**CustomerBalance** — Uma linha por cliente + empresa + tipo de saldo. Por padrão vêm também os saldos zerados; use `onlyPositive=true` para trazer só quem tem saldo.

- `branchCode` (integer) — Empresa em que o saldo vale.
- `customerCode` (integer) — Código do cliente (o mesmo do TOTVS).
- `customerName` (string) — Nome do cliente.
- `customerCpfCnpj` (string) — CPF ou CNPJ, só dígitos.
- `balanceType` (string) — Tipo de saldo. Valores: Credev, Advance, Cashback.
- `initialValue` (number) — Valor da carga inicial (vinda do TOTVS).
- `balanceValue` (number) — Saldo atual.
- `createdDate` (date-time) — Quando o saldo foi criado.
- `lastChangeDate` (date-time) — Última alteração.

**BalanceMovement** — Cada entrada e saída do saldo: carga inicial vinda do TOTVS, crédito de devolução ou troca, uso como pagamento, estorno por cancelamento, ajuste manual e acerto diário do cashback. `value` positivo entra, negativo sai.

- `movementId` (integer) — Identificador do movimento.
- `branchCode` (integer) — Empresa do saldo.
- `customerCode` (integer) — Código do cliente.
- `balanceType` (string) — Tipo de saldo. Valores: Credev, Advance, Cashback.
- `movementType` (string) — Tipo do movimento. Valores: InitialLoad, Return, ReturnCanceled, Use, Reversal, Adjustment, TotvsSync.
- `value` (number) — Valor do movimento (positivo entra, negativo sai).
- `balanceAfterValue` (number) — Saldo depois do movimento.
- `transactionCode` (integer) — Transação ligada (venda que usou, ou troca que gerou).
- `returnId` (integer) — Devolução que gerou o crédito (return/returns).
- `reference` (string) — Referência curta (ex.: troca 242).
- `observation` (string) — Descrição do movimento.
- `createdBy` (string) — Quem fez.
- `movementDate` (date-time) — Quando aconteceu.

**BillingBonus** — Crédito gerado no faturamento quando faltou peça do pedido (o cliente pagou e a peça não foi): fica como saldo bônus para a próxima compra. Cada linha é um crédito ou um uso.

- `bonusId` (integer) — Identificador do lançamento.
- `customerCode` (integer) — Código do cliente.
- `customerName` (string) — Nome do cliente.
- `customerCpfCnpj` (string) — CPF ou CNPJ, só dígitos.
- `entryType` (string) — Crédito ou uso. Valores: Credit, Use, Reversal, Cancellation.
- `value` (number) — Valor.
- `creditId` (integer) — No uso: o crédito consumido.
- `transactionCode` (integer) — Transação ligada.
- `orderNumber` (string) — Número do pedido.
- `reason` (string) — Motivo.
- `createdBy` (string) — Quem lançou.
- `createdDate` (date-time) — Quando foi lançado.

## Cashier — `cashier`

Caixa do HeadCoach: um por empresa e dia. Abertura com o fundo, suprimentos e retiradas, contagem, fechamento e o encerramento do dia. O PDV só vende com o caixa aberto.

### GET /api/headcoach/cashier/v1/cashiers

Caixas — Um caixa por empresa e dia. `summary` é o resumo gravado no fechamento (vendas por forma, devoluções, faturamento do caixa), com as chaves em português como na tela.

Parâmetros:
- `branchCodeList` (string) — Empresas, separadas por vírgula.
- `status` (string) — Aberto ou fechado. Valores: Open, Closed.
- `startCashierDate` (string) — Data do caixa a partir de (AAAA-MM-DD).
- `endCashierDate` (string) — Data do caixa até (AAAA-MM-DD).
- `page` (integer) — Página (começa em 1).
- `pageSize` (integer) — Itens por página (até 1000).
- `expand` (string) — Listas extras para trazer junto, separadas por vírgula: movements, counts.

Resposta: página de `Cashier`

### GET /api/headcoach/cashier/v1/cashiers/{cashierCode}

Caixas — um registro — Um caixa por empresa e dia. `summary` é o resumo gravado no fechamento (vendas por forma, devoluções, faturamento do caixa), com as chaves em português como na tela.

Parâmetros:
- `cashierCode` (caminho, obrigatório) — Número do caixa.
- `expand` (string) — Listas extras para trazer junto, separadas por vírgula: movements, counts.

Resposta:  `Cashier`

### GET /api/headcoach/cashier/v1/movements

Suprimentos e retiradas — Entradas e saídas de dinheiro do caixa fora das vendas: suprimento, retirada (sangria) e a retirada do fechamento.

Parâmetros:
- `branchCodeList` (string) — Empresas, separadas por vírgula.
- `cashierCode` (integer) — Movimentos de um caixa.
- `movementType` (string) — Tipo do movimento (aceita lista). Valores: Supply, Withdrawal, ClosingWithdrawal.
- `startCashierDate` (string) — Data do caixa a partir de (AAAA-MM-DD).
- `endCashierDate` (string) — Data do caixa até (AAAA-MM-DD).
- `page` (integer) — Página (começa em 1).
- `pageSize` (integer) — Itens por página (até 1000).

Resposta: página de `CashierMovement`

### GET /api/headcoach/cashier/v1/counts

Contagens do caixa — Contagem feita no fechamento: o dinheiro contado contra o esperado e o valor de cada forma de pagamento.

Parâmetros:
- `cashierCode` (integer) — Contagens de um caixa.
- `startDate` (string) — A partir de (AAAA-MM-DD).
- `endDate` (string) — Até (AAAA-MM-DD).
- `page` (integer) — Página (começa em 1).
- `pageSize` (integer) — Itens por página (até 1000).

Resposta: página de `CashierCount`

### GET /api/headcoach/cashier/v1/day-closings

Encerramentos do dia — Encerramento diário da empresa: confere que tudo do dia está fechado e avança a data do caixa para o próximo dia.

Parâmetros:
- `branchCodeList` (string) — Empresas, separadas por vírgula.
- `startCashierDate` (string) — Dia encerrado a partir de (AAAA-MM-DD).
- `endCashierDate` (string) — Dia encerrado até (AAAA-MM-DD).
- `page` (integer) — Página (começa em 1).
- `pageSize` (integer) — Itens por página (até 1000).

Resposta: página de `CashierDayClosing`

Esquemas:

**CashierMovement** — Entradas e saídas de dinheiro do caixa fora das vendas: suprimento, retirada (sangria) e a retirada do fechamento.

- `movementId` (integer) — Identificador do movimento.
- `cashierCode` (integer) — Caixa.
- `branchCode` (integer) — Empresa.
- `cashierDate` (date) — Data do caixa.
- `movementType` (string) — Tipo do movimento. Valores: Supply, Withdrawal, ClosingWithdrawal.
- `value` (number) — Valor.
- `reason` (string) — Motivo informado.
- `createdBy` (string) — Quem lançou.
- `movementDate` (date-time) — Quando foi lançado.
- `reversalDate` (date-time) — Quando foi estornado (movimento estornado não conta).
- `reversedBy` (string) — Quem estornou.
- `reversalReason` (string) — Motivo do estorno.

**CashierCount** — Contagem feita no fechamento: o dinheiro contado contra o esperado e o valor de cada forma de pagamento.

- `countId` (integer) — Identificador da contagem.
- `cashierCode` (integer) — Caixa.
- `countedCashValue` (number) — Dinheiro contado.
- `expectedCashValue` (number) — Dinheiro esperado pelo sistema.
- `cashDifferenceValue` (number) — Diferença no dinheiro (contado − esperado).
- `totalDifferenceValue` (number) — Diferença somando todas as formas.
- `banknotes` (object) — Cédulas e moedas contadas, quando detalhadas (valor → quantidade).
- `paymentMethods` (object) — Valor informado por forma de pagamento, com as chaves em português como na tela (pix, credito, debito…).
- `observation` (string) — Observação.
- `countedBy` (string) — Quem contou.
- `countDate` (date-time) — Quando foi contado.
- `reopenedDate` (date-time) — Quando a contagem foi reaberta.
- `reopenedBy` (string) — Quem reabriu.
- `reopenAuthorizedBy` (string) — Quem autorizou a reabertura.
- `reopenReason` (string) — Motivo da reabertura.

**Cashier** — Um caixa por empresa e dia. `summary` é o resumo gravado no fechamento (vendas por forma, devoluções, faturamento do caixa), com as chaves em português como na tela.

- `cashierCode` (integer) — Número do caixa.
- `branchCode` (integer) — Empresa.
- `terminalCode` (integer) — Terminal.
- `cashierDate` (date) — Data do caixa (a data em que as vendas contam).
- `status` (string) — Aberto ou fechado. Valores: Open, Closed.
- `openingFloatValue` (number) — Fundo de troco na abertura.
- `suggestedFloatValue` (number) — Fundo sugerido pelo sistema (o que ficou no fechamento anterior).
- `openingObservation` (string) — Observação da abertura.
- `openedDate` (date-time) — Quando foi aberto.
- `openedBy` (string) — Quem abriu.
- `closedDate` (date-time) — Quando foi fechado.
- `closedBy` (string) — Quem fechou.
- `closingFloatValue` (number) — Fundo que ficou para o dia seguinte.
- `closingWithdrawalValue` (number) — Retirada feita no fechamento.
- `differenceValue` (number) — Diferença total do fechamento.
- `cashDifferenceValue` (number) — Diferença no dinheiro.
- `summary` (object) — Resumo do caixa gravado no fechamento.
- `closingObservation` (string) — Observação do fechamento.
- `reopenedDate` (date-time) — Quando foi reaberto.
- `reopenedBy` (string) — Quem reabriu.
- `reopenReason` (string) — Motivo da reabertura.
- `lastChangeDate` (date-time) — Última alteração.
- `movements` (array de CashierMovement) — Suprimentos e retiradas do caixa (só vem com expand=movements)
- `counts` (array de CashierCount) — Contagens do caixa (só vem com expand=counts)

**CashierDayClosing** — Encerramento diário da empresa: confere que tudo do dia está fechado e avança a data do caixa para o próximo dia.

- `closingId` (integer) — Identificador do encerramento.
- `branchCode` (integer) — Empresa.
- `cashierDate` (date) — Dia encerrado.
- `nextCashierDate` (date) — Data do caixa depois do encerramento.
- `verification` (object) — O que foi conferido no encerramento (chaves em português, como na tela).
- `authorizedBy` (string) — Quem autorizou, quando precisou de senha.
- `closedBy` (string) — Quem encerrou.
- `closingDate` (date-time) — Quando foi encerrado.

## Billing — `billing`

Faturamento da expedição (empresa 99): cada pedido faturado, o que foi conferido, a nota emitida e a duplicata enviada ao cliente. Vale para o Faturamento de pedidos do Dryland, o Faturamento Brejinho e o faturamento avulso.

### GET /api/headcoach/billing/v1/billings

Faturamentos — Uma linha por faturamento de pedido. `orderKey` é a chave do pedido no Dryland (BRJ:… = Brejinho, AVULSO:… = sem pedido) e `orderNumber` o número (RV…, MT…, FR…, VJ…, PE…). `transactionCode` é a transação do HeadCoach; os campos `totvs…` só existem nos faturamentos de 10 a 12/11/2026, que ainda foram espelhados no TOTVS. Um pedido refaturado tem mais de uma linha: a nota cancelada e a nova.

Parâmetros:
- `origin` (string) — Pedido do Dryland (Order), Brejinho ou avulso (Direct).
- `orderKey` (string) — Chave do pedido no Dryland (exata).
- `orderNumber` (string) — Número do pedido (exato).
- `customerCode` (integer) — Código do cliente.
- `sellerCode` (integer) — Código do vendedor.
- `invoiceCode` (integer) — Número da nota.
- `invoiceStatus` (string) — Situação da nota (aceita lista). Valores: Authorized, Canceled, Rejected, Error, Pending, Issuing, Denied.
- `transactionCode` (integer) — Faturamento de uma transação.
- `startDate` (string) — Faturados a partir de (AAAA-MM-DD).
- `endDate` (string) — Faturados até (AAAA-MM-DD).
- `startChangeDate` (string) — Alterados a partir de (AAAA-MM-DD) — para sincronização.
- `page` (integer) — Página (começa em 1).
- `pageSize` (integer) — Itens por página (até 1000).
- `expand` (string) — Listas extras para trazer junto, separadas por vírgula: duplicates.

Resposta: página de `Billing`

### GET /api/headcoach/billing/v1/billings/{billingId}

Faturamentos — um registro — Uma linha por faturamento de pedido. `orderKey` é a chave do pedido no Dryland (BRJ:… = Brejinho, AVULSO:… = sem pedido) e `orderNumber` o número (RV…, MT…, FR…, VJ…, PE…). `transactionCode` é a transação do HeadCoach; os campos `totvs…` só existem nos faturamentos de 10 a 12/11/2026, que ainda foram espelhados no TOTVS. Um pedido refaturado tem mais de uma linha: a nota cancelada e a nova.

Parâmetros:
- `billingId` (caminho, obrigatório) — Identificador do faturamento.
- `expand` (string) — Listas extras para trazer junto, separadas por vírgula: duplicates.

Resposta:  `Billing`

### GET /api/headcoach/billing/v1/duplicates

Duplicatas — Duplicata (confirmação de compra a prazo) enviada ao cliente das vendas com boleto: o documento vai para assinatura no Autentique e o link segue pelo WhatsApp. Uma por transação.

Parâmetros:
- `status` (string) — Situação (aceita lista). Valores: Sending, Sent, Signed, Error, Canceled.
- `transactionCode` (integer) — Duplicata de uma transação.
- `invoiceCode` (integer) — Número da nota.
- `orderKey` (string) — Chave do pedido.
- `startDate` (string) — Criadas a partir de (AAAA-MM-DD).
- `endDate` (string) — Criadas até (AAAA-MM-DD).
- `startChangeDate` (string) — Alteradas a partir de (AAAA-MM-DD) — para sincronização.
- `page` (integer) — Página (começa em 1).
- `pageSize` (integer) — Itens por página (até 1000).

Resposta: página de `BillingDuplicate`

### GET /api/headcoach/billing/v1/settings

Configurações do faturamento — O que o admin ou o owner liga pela tela do Faturamento. Hoje: a troca de produtos na conferência (a peça que falta pode ser substituída por outra, pelo mesmo valor), que vale enquanto `allowed` for true e hoje não passar de `allowedUntil`.

Resposta:  `BillingSettings`

Esquemas:

**BillingDuplicate** — Duplicata (confirmação de compra a prazo) enviada ao cliente das vendas com boleto: o documento vai para assinatura no Autentique e o link segue pelo WhatsApp. Uma por transação.

- `transactionCode` (integer) — Transação da venda.
- `billingId` (integer) — Faturamento (/billings).
- `orderKey` (string) — Chave do pedido.
- `invoiceCode` (integer) — Número da nota.
- `customerName` (string) — Nome do cliente.
- `phone` (string) — WhatsApp para onde a duplicata foi.
- `status` (string) — Situação da duplicata. Valores: Sending, Sent, Signed, Error, Canceled.
- `errorMessage` (string) — Erro do envio, quando houve.
- `signatureDocumentId` (string) — Documento no Autentique.
- `signatureLink` (string) — Link de assinatura enviado ao cliente.
- `sentDate` (date-time) — Quando foi enviada.
- `signedDate` (date-time) — Quando foi assinada.
- `signedDocumentUrl` (string) — Documento assinado.
- `senderName` (string) — Número de WhatsApp que enviou.
- `createdBy` (string) — Quem disparou.
- `createdDate` (date-time) — Criação do registro.
- `lastChangeDate` (date-time) — Última alteração.

**Billing** — Uma linha por faturamento de pedido. `orderKey` é a chave do pedido no Dryland (BRJ:… = Brejinho, AVULSO:… = sem pedido) e `orderNumber` o número (RV…, MT…, FR…, VJ…, PE…). `transactionCode` é a transação do HeadCoach; os campos `totvs…` só existem nos faturamentos de 10 a 12/11/2026, que ainda foram espelhados no TOTVS. Um pedido refaturado tem mais de uma linha: a nota cancelada e a nova.

- `billingId` (integer) — Identificador do faturamento.
- `origin` (string) — Pedido do Dryland, Brejinho ou avulso. Valores: Order, Brejinho, Direct.
- `orderKey` (string) — Chave do pedido no Dryland.
- `orderNumber` (string) — Número do pedido.
- `branchCode` (integer) — Empresa que faturou.
- `transactionCode` (integer) — Transação do HeadCoach (transaction/transactions).
- `operationCode` (integer) — Operação.
- `cfop` (integer) — CFOP principal.
- `customerCode` (integer) — Código do cliente.
- `customerName` (string) — Nome do cliente.
- `sellerCode` (integer) — Código do vendedor.
- `totalValue` (number) — Valor faturado.
- `freightValue` (number) — Frete.
- `paymentMethods` (string) — Formas de pagamento, em texto, com os nomes em português (ex.: "pix + credito_loja").
- `orderQuantity` (number) — Peças do pedido.
- `checkedQuantity` (number) — Peças conferidas (lidas no portal RFID).
- `missingQuantity` (number) — Peças do pedido que não foram.
- `surplusQuantity` (number) — Peças lidas que não eram do pedido.
- `checkedItems` (array) — Peças conferidas.
- `missingItems` (array) — Peças que faltaram.
- `surplusItems` (array) — Peças que sobraram.
- `invoiceCode` (integer) — Número da nota.
- `invoiceSerialCode` (integer) — Série da nota.
- `invoiceAccessKey` (string) — Chave da nota.
- `invoiceStatus` (string) — Situação da nota. Valores: Authorized, Canceled, Rejected, Error, Pending, Issuing, Denied.
- `totvsTransactionCode` (integer) — Transação no TOTVS (só nos faturamentos espelhados).
- `totvsTransactionStatus` (string) — Situação da transação no padrão do TOTVS. Valores: InProgress, Closed, ExternalProcess, Attended, Canceled.
- `totvsError` (string) — Erro do espelho no TOTVS, quando houve.
- `attendedDate` (date-time) — Quando foi atendida.
- `createdBy` (string) — Quem faturou.
- `billingDate` (date-time) — Data e hora do faturamento.
- `lastChangeDate` (date-time) — Última alteração.
- `duplicates` (array de BillingDuplicate) — Duplicata do faturamento (só vem com expand=duplicates)

**BillingSettings** — Configurações do faturamento.

- `productExchange` (object) — Troca de produtos na conferência.

## Return — `return`

Devoluções de mercadoria: a solicitação feita pelo cliente (link público) e a devolução recebida e conferida na matriz, com a nota do cliente e o que faltou ou sobrou.

### GET /api/headcoach/return/v1/requests

Solicitações de devolução — Pedido de devolução aberto pelo cliente no link público. Devolução por defeito abre um chamado na Produção (Dryland) e espera a avaliação. Quando a mercadoria chega e é conferida, aparece em /returns.

Parâmetros:
- `status` (string) — Situação (aceita lista). Valores: AwaitingEvaluation, AwaitingReturn, InReturn, Completed, Canceled.
- `returnType` (string) — Comum ou por defeito. Valores: Regular, Defect.
- `location` (string) — Onde a mercadoria está. Valores: InTransit, Headquarters, Local.
- `customerCode` (integer) — Código do cliente.
- `customerCpfCnpj` (string) — CPF ou CNPJ do cliente.
- `sellerCode` (integer) — Código do vendedor.
- `startDate` (string) — Solicitadas a partir de (AAAA-MM-DD).
- `endDate` (string) — Solicitadas até (AAAA-MM-DD).
- `startChangeDate` (string) — Alteradas a partir de (AAAA-MM-DD) — para sincronização.
- `page` (integer) — Página (começa em 1).
- `pageSize` (integer) — Itens por página (até 1000).
- `expand` (string) — Listas extras para trazer junto, separadas por vírgula: returns.

Resposta: página de `ReturnRequest`

### GET /api/headcoach/return/v1/requests/{requestId}

Solicitações de devolução — um registro — Pedido de devolução aberto pelo cliente no link público. Devolução por defeito abre um chamado na Produção (Dryland) e espera a avaliação. Quando a mercadoria chega e é conferida, aparece em /returns.

Parâmetros:
- `requestId` (caminho, obrigatório) — Identificador da solicitação.
- `expand` (string) — Listas extras para trazer junto, separadas por vírgula: returns.

Resposta:  `ReturnRequest`

### GET /api/headcoach/return/v1/returns

Devoluções recebidas — Devolução conferida na matriz. Até 16/11/2026 a transação de entrada era lançada no TOTVS (`transactionCode` é do TOTVS, `source` = Totvs); desde 17/11/2026 a devolução é encerrada no HeadCoach, com NF-e de devolução e Credev para o cliente. `transactionStatus` segue o TOTVS (InProgress, Attended, Canceled).

Parâmetros:
- `branchCodeList` (string) — Empresas, separadas por vírgula.
- `transactionStatus` (string) — Situação da transação (aceita lista). Valores: InProgress, Closed, ExternalProcess, Attended, Canceled.
- `customerCode` (integer) — Código do cliente.
- `requestId` (integer) — Devoluções de uma solicitação.
- `transactionCode` (integer) — Número da transação.
- `source` (string) — Onde foi lançada (valor exato, como gravado).
- `startDate` (string) — Data da transação a partir de (AAAA-MM-DD).
- `endDate` (string) — Data da transação até (AAAA-MM-DD).
- `startChangeDate` (string) — Alteradas a partir de (AAAA-MM-DD) — para sincronização.
- `page` (integer) — Página (começa em 1).
- `pageSize` (integer) — Itens por página (até 1000).

Resposta: página de `Return`

### GET /api/headcoach/return/v1/returns/{returnId}

Devoluções recebidas — um registro — Devolução conferida na matriz. Até 16/11/2026 a transação de entrada era lançada no TOTVS (`transactionCode` é do TOTVS, `source` = Totvs); desde 17/11/2026 a devolução é encerrada no HeadCoach, com NF-e de devolução e Credev para o cliente. `transactionStatus` segue o TOTVS (InProgress, Attended, Canceled).

Parâmetros:
- `returnId` (caminho, obrigatório) — Identificador da devolução.

Resposta:  `Return`

Esquemas:

**Return** — Devolução conferida na matriz. Até 16/11/2026 a transação de entrada era lançada no TOTVS (`transactionCode` é do TOTVS, `source` = Totvs); desde 17/11/2026 a devolução é encerrada no HeadCoach, com NF-e de devolução e Credev para o cliente. `transactionStatus` segue o TOTVS (InProgress, Attended, Canceled).

- `returnId` (integer) — Identificador da devolução.
- `requestId` (integer) — Solicitação que originou (/requests), quando houve.
- `source` (string) — Onde a devolução foi lançada (totvs, fisfp082, headcoach…), como gravado.
- `branchCode` (integer) — Empresa que recebeu.
- `transactionCode` (integer) — Número da transação de entrada.
- `transactionDate` (date) — Data da transação.
- `transactionStatus` (string) — Situação da transação. Valores: InProgress, Closed, ExternalProcess, Attended, Canceled.
- `operationCode` (integer) — Operação de entrada.
- `cfop` (integer) — CFOP.
- `totalValue` (number) — Valor da devolução.
- `attendedDate` (date-time) — Quando foi atendida (é quando o Credev é gerado).
- `customerCode` (integer) — Código do cliente.
- `customerName` (string) — Nome do cliente.
- `sellerCode` (integer) — Código do vendedor.
- `sellerName` (string) — Nome do vendedor.
- `customerInvoiceCode` (integer) — Número da nota do cliente (ou da venda de origem).
- `customerInvoiceSerialCode` (string) — Série dessa nota.
- `customerInvoiceDate` (date) — Data dessa nota.
- `customerInvoiceBranchCode` (integer) — Empresa dessa nota.
- `customerInvoiceAccessKey` (string) — Chave dessa nota.
- `customerInvoiceValue` (number) — Valor dessa nota.
- `customerInvoiceQuantity` (number) — Peças dessa nota.
- `receivedQuantity` (number) — Peças recebidas.
- `missingQuantity` (number) — Peças da nota que não vieram.
- `surplusQuantity` (number) — Peças que vieram a mais.
- `missingValue` (number) — Valor das peças que faltaram.
- `receivedItems` (array) — Peças recebidas.
- `missingItems` (array) — Peças que faltaram.
- `surplusItems` (array) — Peças que sobraram.
- `createdBy` (string) — Quem lançou.
- `createdDate` (date-time) — Quando foi lançada.
- `lastChangeDate` (date-time) — Última alteração.

**ReturnRequest** — Pedido de devolução aberto pelo cliente no link público. Devolução por defeito abre um chamado na Produção (Dryland) e espera a avaliação. Quando a mercadoria chega e é conferida, aparece em /returns.

- `requestId` (integer) — Identificador da solicitação.
- `status` (string) — Situação da solicitação. Valores: AwaitingEvaluation, AwaitingReturn, InReturn, Completed, Canceled.
- `returnType` (string) — Devolução comum ou por defeito. Valores: Regular, Defect.
- `location` (string) — Onde a mercadoria está. Valores: InTransit, Headquarters, Local.
- `source` (string) — Por onde entrou (publico = link público).
- `customerCode` (integer) — Código do cliente.
- `customerName` (string) — Nome do cliente.
- `customerCpfCnpj` (string) — CPF ou CNPJ, só dígitos.
- `customerType` (string) — PF ou PJ.
- `customerBranchCode` (integer) — Empresa do cliente, quando ele é uma loja do grupo.
- `customerBranchName` (string) — Nome dessa empresa.
- `customerPhone` (string) — Telefone informado.
- `customerEmail` (string) — E-mail informado.
- `sellerCode` (integer) — Código do vendedor.
- `sellerName` (string) — Nome do vendedor.
- `itemQuantity` (number) — Peças informadas.
- `observation` (string) — Observação do cliente.
- `internalObservation` (string) — Observação interna.
- `photos` (array) — Fotos enviadas (endereços).
- `cancelReason` (string) — Motivo do cancelamento.
- `ticketId` (integer) — Chamado aberto no Dryland (devolução por defeito).
- `ticketNumber` (integer) — Número do chamado.
- `ticketStatus` (string) — Situação do chamado, como gravada.
- `ticketOpenedDate` (date-time) — Quando o chamado foi aberto.
- `ticketClosedDate` (date-time) — Quando o chamado foi concluído.
- `productionEvaluation` (string) — Avaliação da Produção.
- `transactionBranchCode` (integer) — Empresa da transação de entrada.
- `transactionCode` (integer) — Transação de entrada.
- `transactionDate` (date) — Data da transação.
- `transactionValue` (number) — Valor da transação.
- `transactionStatus` (string) — Situação da transação. Valores: InProgress, Closed, ExternalProcess, Attended, Canceled.
- `transactionAttendedDate` (date-time) — Quando a transação foi atendida.
- `createdDate` (date-time) — Quando a solicitação foi feita.
- `lastChangeDate` (date-time) — Última alteração.
- `returns` (array de Return) — Devoluções recebidas desta solicitação (só vem com expand=returns)

## Transfer — `transfer`

Transferências de mercadoria entre empresas do grupo: a solicitação (os pedidos de transferência do Dryland entram aqui sozinhos) e a transferência efetivada, com a nota emitida pelo HeadCoach.

### GET /api/headcoach/transfer/v1/requests

Solicitações de transferência — Pedido de transferência entre empresas. Os pedidos de transferência do varejo no Dryland entram aqui sozinhos (`source` = dryland, `sourceKey` = chave do pedido lá). Quando a mercadoria sai, a solicitação ganha a transação e a nota e aparece em /transfers.

Parâmetros:
- `status` (string) — Situação (aceita lista). Valores: AwaitingTransfer, InTransfer, Completed, Canceled.
- `location` (string) — Onde a mercadoria está. Valores: Origin, InTransit, Destination.
- `originBranchCodeList` (string) — Empresas de origem, separadas por vírgula.
- `destinationBranchCodeList` (string) — Empresas de destino, separadas por vírgula.
- `source` (string) — De onde veio (valor exato, como gravado).
- `sourceKey` (string) — Chave do pedido no sistema de origem.
- `sourceReference` (string) — Número do pedido no sistema de origem.
- `startDate` (string) — Solicitadas a partir de (AAAA-MM-DD).
- `endDate` (string) — Solicitadas até (AAAA-MM-DD).
- `startChangeDate` (string) — Alteradas a partir de (AAAA-MM-DD) — para sincronização.
- `page` (integer) — Página (começa em 1).
- `pageSize` (integer) — Itens por página (até 1000).
- `expand` (string) — Listas extras para trazer junto, separadas por vírgula: transfers.

Resposta: página de `TransferRequest`

### GET /api/headcoach/transfer/v1/requests/{requestId}

Solicitações de transferência — um registro — Pedido de transferência entre empresas. Os pedidos de transferência do varejo no Dryland entram aqui sozinhos (`source` = dryland, `sourceKey` = chave do pedido lá). Quando a mercadoria sai, a solicitação ganha a transação e a nota e aparece em /transfers.

Parâmetros:
- `requestId` (caminho, obrigatório) — Identificador da solicitação.
- `expand` (string) — Listas extras para trazer junto, separadas por vírgula: transfers.

Resposta:  `TransferRequest`

### GET /api/headcoach/transfer/v1/transfers

Transferências efetivadas — Saída de mercadoria de uma empresa para outra, com a nota emitida pelo HeadCoach. `nature` diz se saiu como transferência ou como venda da matriz para a loja (lojas de outro CNPJ recebem por venda). `destinationBranchCode` 0 significa destino fora do cadastro de empresas: nesse caso o destino é achado pelo `customerCode` (a pessoa da loja). Desde 19/11/2026 a origem (`branchCode`) também pode ser uma LOJA do varejo (tela Transferência entre Lojas): a nota sai pela loja de origem e `operationCode` traz a operação do POP (7272 transferência no mesmo grupo de CNPJ; 7273 e 7280 venda entre empresas; nulo quando o destino está fora dos grupos do POP). Nas saídas da matriz (99) `operationCode` é 8400 (transferência) ou 8405 (venda).

Parâmetros:
- `branchCodeList` (string) — Empresas de origem, separadas por vírgula.
- `destinationBranchCodeList` (string) — Empresas de destino, separadas por vírgula.
- `nature` (string) — Transferência ou venda. Valores: Sale, Transfer.
- `invoiceStatus` (string) — Situação da nota (aceita lista). Valores: Authorized, Canceled, Rejected, Error, Pending, Issuing, Denied.
- `invoiceCode` (integer) — Número da nota.
- `requestId` (integer) — Transferências de uma solicitação.
- `transactionCode` (integer) — Transferência de uma transação.
- `customerCode` (integer) — Pessoa de destino.
- `startDate` (string) — Feitas a partir de (AAAA-MM-DD).
- `endDate` (string) — Feitas até (AAAA-MM-DD).
- `startChangeDate` (string) — Alteradas a partir de (AAAA-MM-DD) — para sincronização.
- `page` (integer) — Página (começa em 1).
- `pageSize` (integer) — Itens por página (até 1000).
- `expand` (string) — Listas extras para trazer junto, separadas por vírgula: receipts.

Resposta: página de `Transfer`

### GET /api/headcoach/transfer/v1/transfers/{transferId}

Transferências efetivadas — um registro — Saída de mercadoria de uma empresa para outra, com a nota emitida pelo HeadCoach. `nature` diz se saiu como transferência ou como venda da matriz para a loja (lojas de outro CNPJ recebem por venda). `destinationBranchCode` 0 significa destino fora do cadastro de empresas: nesse caso o destino é achado pelo `customerCode` (a pessoa da loja). Desde 19/11/2026 a origem (`branchCode`) também pode ser uma LOJA do varejo (tela Transferência entre Lojas): a nota sai pela loja de origem e `operationCode` traz a operação do POP (7272 transferência no mesmo grupo de CNPJ; 7273 e 7280 venda entre empresas; nulo quando o destino está fora dos grupos do POP). Nas saídas da matriz (99) `operationCode` é 8400 (transferência) ou 8405 (venda).

Parâmetros:
- `transferId` (caminho, obrigatório) — Identificador da transferência.
- `expand` (string) — Listas extras para trazer junto, separadas por vírgula: receipts.

Resposta:  `Transfer`

Esquemas:

**GoodsReceipt** — Conferência feita pela loja de destino. `missingQuantity` é o que a nota trazia e não chegou; `unexpectedQuantity` é o que chegou sem estar na nota. Cada recebimento gera os movimentos de estoque em stock/movements. Recebimento cancelado continua na lista, com `canceledDate` preenchido: o estoque dele é estornado (stock/movements, `ReceiptReversal`), as etiquetas saem da loja e a transferência volta a ficar a receber — por isso uma transferência pode ter mais de um recebimento, e só vale o que tem `canceledDate` nulo (`isCanceled=false`).

- `receiptId` (integer) — Identificador do recebimento.
- `transferId` (integer) — Transferência recebida (transfer/transfers).
- `requestId` (integer) — Solicitação de transferência, quando houve.
- `branchCode` (integer) — Loja que recebeu.
- `originBranchCode` (integer) — Empresa que enviou.
- `transactionCode` (integer) — Transação do HeadCoach da saída (transaction/transactions).
- `invoiceCode` (integer) — Número da nota recebida.
- `expectedQuantity` (number) — Peças da nota.
- `receivedQuantity` (number) — Peças conferidas.
- `missingQuantity` (number) — Peças da nota que não chegaram.
- `unexpectedQuantity` (number) — Peças que chegaram fora da nota.
- `items` (array) — Peças da nota com o que foi conferido.
- `unexpectedItems` (array) — Peças que chegaram fora da nota.
- `observation` (string) — Observação.
- `receivedBy` (string) — Quem recebeu.
- `receiptDate` (date-time) — Quando foi recebido.
- `canceledDate` (date-time) — Quando o recebimento foi cancelado. Nulo = recebimento valendo.
- `canceledBy` (string) — Quem cancelou o recebimento.
- `cancellationReason` (string) — Motivo do cancelamento do recebimento.

**Transfer** — Saída de mercadoria de uma empresa para outra, com a nota emitida pelo HeadCoach. `nature` diz se saiu como transferência ou como venda da matriz para a loja (lojas de outro CNPJ recebem por venda). `destinationBranchCode` 0 significa destino fora do cadastro de empresas: nesse caso o destino é achado pelo `customerCode` (a pessoa da loja). Desde 19/11/2026 a origem (`branchCode`) também pode ser uma LOJA do varejo (tela Transferência entre Lojas): a nota sai pela loja de origem e `operationCode` traz a operação do POP (7272 transferência no mesmo grupo de CNPJ; 7273 e 7280 venda entre empresas; nulo quando o destino está fora dos grupos do POP). Nas saídas da matriz (99) `operationCode` é 8400 (transferência) ou 8405 (venda).

- `transferId` (integer) — Identificador da transferência.
- `requestId` (integer) — Solicitação de origem (/requests).
- `branchCode` (integer) — Empresa de origem.
- `destinationBranchCode` (integer) — Empresa de destino.
- `nature` (string) — Transferência ou venda da matriz para a loja. Valores: Sale, Transfer.
- `transactionCode` (integer) — Transação do HeadCoach (transaction/transactions).
- `operationCode` (integer) — Operação.
- `cfop` (integer) — CFOP.
- `totalValue` (number) — Valor da nota.
- `itemQuantity` (number) — Peças.
- `rfidTagQuantity` (number) — Etiquetas RFID lidas.
- `missingQuantity` (number) — Peças pedidas que não foram.
- `surplusQuantity` (number) — Peças lidas a mais.
- `customerCode` (integer) — Pessoa (cadastro) da empresa de destino.
- `customerName` (string) — Nome do destino.
- `sellerCode` (integer) — Código do vendedor.
- `sellerName` (string) — Nome do vendedor.
- `items` (array) — Peças transferidas.
- `invoiceId` (integer) — Nota no HeadCoach (fiscal/invoices).
- `invoiceCode` (integer) — Número da nota.
- `invoiceSerialCode` (string) — Série da nota.
- `invoiceAccessKey` (string) — Chave da nota.
- `invoiceStatus` (string) — Situação da nota. Valores: Authorized, Canceled, Rejected, Error, Pending, Issuing, Denied.
- `transactionStatus` (string) — Situação no padrão do TOTVS. Valores: InProgress, Closed, ExternalProcess, Attended, Canceled.
- `attendedDate` (date-time) — Quando foi atendida.
- `createdBy` (string) — Quem fez.
- `transferDate` (date-time) — Data e hora da transferência.
- `lastChangeDate` (date-time) — Última alteração.
- `receipts` (array de GoodsReceipt) — Recebimentos na loja de destino (o cancelado vem com canceledDate preenchido; vale o que tem canceledDate nulo) (só vem com expand=receipts)

**TransferRequest** — Pedido de transferência entre empresas. Os pedidos de transferência do varejo no Dryland entram aqui sozinhos (`source` = dryland, `sourceKey` = chave do pedido lá). Quando a mercadoria sai, a solicitação ganha a transação e a nota e aparece em /transfers.

- `requestId` (integer) — Identificador da solicitação.
- `status` (string) — Situação da solicitação. Valores: AwaitingTransfer, InTransfer, Completed, Canceled.
- `location` (string) — Onde a mercadoria está. Valores: Origin, InTransit, Destination.
- `originBranchCode` (integer) — Empresa de origem.
- `originBranchName` (string) — Nome da origem.
- `destinationBranchCode` (integer) — Empresa de destino.
- `destinationBranchName` (string) — Nome do destino.
- `customerCode` (integer) — Pessoa (cadastro) da empresa de destino.
- `operationCode` (integer) — Operação definida pela regra (par de empresas).
- `requesterName` (string) — Quem solicitou.
- `requesterEmail` (string) — E-mail de quem solicitou.
- `itemQuantity` (number) — Peças pedidas.
- `value` (number) — Valor do pedido.
- `items` (array) — Peças pedidas.
- `observation` (string) — Observação.
- `internalObservation` (string) — Observação interna.
- `cancelReason` (string) — Motivo do cancelamento.
- `source` (string) — De onde veio a solicitação (dryland, manual…), como gravado.
- `sourceKey` (string) — Chave do pedido no sistema de origem (no Dryland).
- `sourceReference` (string) — Número do pedido no sistema de origem (TR…, TRU…).
- `transactionCode` (integer) — Transação do HeadCoach da saída.
- `invoiceCode` (integer) — Número da nota de saída.
- `invoiceAccessKey` (string) — Chave da nota de saída.
- `totvsTransactionCode` (integer) — Transação no TOTVS (transferências antigas, feitas lá).
- `totvsTransactionStatus` (string) — Situação dessa transação. Valores: InProgress, Closed, ExternalProcess, Attended, Canceled.
- `createdDate` (date-time) — Quando foi solicitada.
- `lastChangeDate` (date-time) — Última alteração.
- `transfers` (array de Transfer) — Transferências efetivadas desta solicitação (só vem com expand=transfers)

## GoodsReceipt — `goods-receipt`

Entrada de mercadoria nas lojas: a loja confere o que chegou (por etiqueta RFID ou por quantidade) contra a nota de transferência — ou de venda da matriz, no caso das lojas que recebem por venda — e o que foi conferido entra no estoque da loja.

### GET /api/headcoach/goods-receipt/v1/receipts

Recebimentos de mercadoria — Conferência feita pela loja de destino. `missingQuantity` é o que a nota trazia e não chegou; `unexpectedQuantity` é o que chegou sem estar na nota. Cada recebimento gera os movimentos de estoque em stock/movements. Recebimento cancelado continua na lista, com `canceledDate` preenchido: o estoque dele é estornado (stock/movements, `ReceiptReversal`), as etiquetas saem da loja e a transferência volta a ficar a receber — por isso uma transferência pode ter mais de um recebimento, e só vale o que tem `canceledDate` nulo (`isCanceled=false`).

Parâmetros:
- `branchCodeList` (string) — Lojas que receberam, separadas por vírgula.
- `originBranchCode` (integer) — Empresa que enviou.
- `transferId` (integer) — Recebimento de uma transferência.
- `invoiceCode` (integer) — Número da nota.
- `startDate` (string) — Recebidos a partir de (AAAA-MM-DD).
- `endDate` (string) — Recebidos até (AAAA-MM-DD).
- `isCanceled` (string) — false = só os recebimentos valendo; true = só os cancelados. Sem o filtro vêm os dois.
- `page` (integer) — Página (começa em 1).
- `pageSize` (integer) — Itens por página (até 1000).

Resposta: página de `GoodsReceipt`

### GET /api/headcoach/goods-receipt/v1/receipts/{receiptId}

Recebimentos de mercadoria — um registro — Conferência feita pela loja de destino. `missingQuantity` é o que a nota trazia e não chegou; `unexpectedQuantity` é o que chegou sem estar na nota. Cada recebimento gera os movimentos de estoque em stock/movements. Recebimento cancelado continua na lista, com `canceledDate` preenchido: o estoque dele é estornado (stock/movements, `ReceiptReversal`), as etiquetas saem da loja e a transferência volta a ficar a receber — por isso uma transferência pode ter mais de um recebimento, e só vale o que tem `canceledDate` nulo (`isCanceled=false`).

Parâmetros:
- `receiptId` (caminho, obrigatório) — Identificador do recebimento.

Resposta:  `GoodsReceipt`

Esquemas:

**GoodsReceipt** — Conferência feita pela loja de destino. `missingQuantity` é o que a nota trazia e não chegou; `unexpectedQuantity` é o que chegou sem estar na nota. Cada recebimento gera os movimentos de estoque em stock/movements. Recebimento cancelado continua na lista, com `canceledDate` preenchido: o estoque dele é estornado (stock/movements, `ReceiptReversal`), as etiquetas saem da loja e a transferência volta a ficar a receber — por isso uma transferência pode ter mais de um recebimento, e só vale o que tem `canceledDate` nulo (`isCanceled=false`).

- `receiptId` (integer) — Identificador do recebimento.
- `transferId` (integer) — Transferência recebida (transfer/transfers).
- `requestId` (integer) — Solicitação de transferência, quando houve.
- `branchCode` (integer) — Loja que recebeu.
- `originBranchCode` (integer) — Empresa que enviou.
- `transactionCode` (integer) — Transação do HeadCoach da saída (transaction/transactions).
- `invoiceCode` (integer) — Número da nota recebida.
- `expectedQuantity` (number) — Peças da nota.
- `receivedQuantity` (number) — Peças conferidas.
- `missingQuantity` (number) — Peças da nota que não chegaram.
- `unexpectedQuantity` (number) — Peças que chegaram fora da nota.
- `items` (array) — Peças da nota com o que foi conferido.
- `unexpectedItems` (array) — Peças que chegaram fora da nota.
- `observation` (string) — Observação.
- `receivedBy` (string) — Quem recebeu.
- `receiptDate` (date-time) — Quando foi recebido.
- `canceledDate` (date-time) — Quando o recebimento foi cancelado. Nulo = recebimento valendo.
- `canceledBy` (string) — Quem cancelou o recebimento.
- `cancellationReason` (string) — Motivo do cancelamento do recebimento.

## Stock — `stock`

Estoque das lojas no HeadCoach. Hoje o estoque é formado só pelas entradas conferidas no Recebimento de Mercadoria (as vendas ainda não baixam este saldo). Inclui as etiquetas RFID que entraram, o movimento das etiquetas nas vendas e os balanços feitos com o coletor.

### GET /api/headcoach/stock/v1/balances

Saldo por loja e produto — Soma dos movimentos de estoque por empresa e produto. Atenção: por enquanto só as entradas do Recebimento de Mercadoria movimentam este saldo; ele não é o estoque completo da loja.

Parâmetros:
- `branchCodeList` (string) — Empresas, separadas por vírgula.
- `productCodeList` (string) — Produtos, separados por vírgula.
- `page` (integer) — Página (começa em 1).
- `pageSize` (integer) — Itens por página (até 1000).

Resposta: página de `StockBalance`

### GET /api/headcoach/stock/v1/movements

Movimentos de estoque — Cada movimento no estoque da loja: `TransferReceipt` é a entrada pelo Recebimento de Mercadoria; `ReceiptReversal` é o estorno, com quantidade negativa, quando esse recebimento é cancelado (goods-receipt/receipts com `canceledDate`).

Parâmetros:
- `branchCodeList` (string) — Empresas, separadas por vírgula.
- `productCode` (integer) — Produto.
- `receiptId` (integer) — Movimentos de um recebimento.
- `movementType` (string) — Tipo do movimento. Valores: TransferReceipt, ReceiptReversal.
- `startDate` (string) — A partir de (AAAA-MM-DD).
- `endDate` (string) — Até (AAAA-MM-DD).
- `page` (integer) — Página (começa em 1).
- `pageSize` (integer) — Itens por página (até 1000).

Resposta: página de `StockMovement`

### GET /api/headcoach/stock/v1/rfid-tags

Etiquetas RFID no estoque das lojas — Etiquetas (EPC) que entraram no estoque de uma loja pelo Recebimento de Mercadoria, com o produto de cada uma.

Parâmetros:
- `branchCodeList` (string) — Empresas, separadas por vírgula.
- `productCode` (integer) — Produto.
- `rfidTag` (string) — Etiqueta exata.
- `receiptId` (integer) — Etiquetas de um recebimento.
- `page` (integer) — Página (começa em 1).
- `pageSize` (integer) — Itens por página (até 1000).

Resposta: página de `StockRfidTag`

### GET /api/headcoach/stock/v1/rfid-movements

Movimento das etiquetas RFID nas transações — Histórico de cada etiqueta nas transações: saiu numa venda, voltou numa devolução ou troca, ou foi estornada por cancelamento. Serve para rastrear uma peça pela etiqueta.

Parâmetros:
- `rfidTag` (string) — Etiqueta exata.
- `branchCodeList` (string) — Empresas, separadas por vírgula.
- `movementType` (string) — Tipo do movimento (aceita lista). Valores: Sale, Return, Reversal.
- `productCode` (integer) — Produto.
- `transactionCode` (integer) — Etiquetas de uma transação.
- `customerCode` (integer) — Cliente.
- `startDate` (string) — A partir de (AAAA-MM-DD).
- `endDate` (string) — Até (AAAA-MM-DD).
- `page` (integer) — Página (começa em 1).
- `pageSize` (integer) — Itens por página (até 1000).

Resposta: página de `RfidMovement`

### GET /api/headcoach/stock/v1/inventories

Balanços RFID — Contagens feitas com o coletor RFID (app Android). A lista traz o resumo por produto; as etiquetas lidas ficam em /inventories/{inventoryId}/rfid-tags.

Parâmetros:
- `branchCodeList` (string) — Empresas, separadas por vírgula.
- `startDate` (string) — Finalizados a partir de (AAAA-MM-DD).
- `endDate` (string) — Finalizados até (AAAA-MM-DD).
- `page` (integer) — Página (começa em 1).
- `pageSize` (integer) — Itens por página (até 1000).

Resposta: página de `RfidInventory`

### GET /api/headcoach/stock/v1/inventories/{inventoryId}

Balanços RFID — um registro — Contagens feitas com o coletor RFID (app Android). A lista traz o resumo por produto; as etiquetas lidas ficam em /inventories/{inventoryId}/rfid-tags.

Parâmetros:
- `inventoryId` (caminho, obrigatório) — Identificador do balanço.

Resposta:  `RfidInventory`

### GET /api/headcoach/stock/v1/inventories/{inventoryId}/rfid-tags

Etiquetas lidas num balanço — Lista das etiquetas (EPC) lidas no balanço, paginada.

Parâmetros:
- `inventoryId` (caminho, obrigatório) — Identificador do balanço.
- `page` (integer) — Página (começa em 1).
- `pageSize` (integer) — Itens por página (até 1000).

Resposta: página de `RfidInventoryTag`

Esquemas:

**StockBalance** — Saldo de um produto numa empresa.

- `branchCode` (integer) — 
- `productCode` (integer) — 
- `productName` (string) — 
- `quantity` (number) — Saldo (soma dos movimentos).
- `rfidTagQuantity` (integer) — Etiquetas RFID deste produto que entraram na loja.
- `lastMovementDate` (date-time) — 

**StockMovement** — Cada movimento no estoque da loja: `TransferReceipt` é a entrada pelo Recebimento de Mercadoria; `ReceiptReversal` é o estorno, com quantidade negativa, quando esse recebimento é cancelado (goods-receipt/receipts com `canceledDate`).

- `movementId` (integer) — Identificador do movimento.
- `branchCode` (integer) — Empresa.
- `productCode` (integer) — Produto.
- `productName` (string) — Nome do produto.
- `quantity` (number) — Quantidade (positivo entra).
- `rfidTag` (string) — Etiqueta RFID, quando a peça foi lida.
- `movementType` (string) — Tipo do movimento. Valores: TransferReceipt, ReceiptReversal.
- `receiptId` (integer) — Recebimento que gerou (goods-receipt/receipts).
- `createdBy` (string) — Quem fez.
- `movementDate` (date-time) — Quando aconteceu.

**StockRfidTag** — Etiquetas (EPC) que entraram no estoque de uma loja pelo Recebimento de Mercadoria, com o produto de cada uma.

- `rfidTag` (string) — Etiqueta RFID (EPC).
- `branchCode` (integer) — Empresa em que a etiqueta está.
- `productCode` (integer) — Produto.
- `productName` (string) — Nome do produto.
- `receiptId` (integer) — Recebimento em que entrou.
- `entryDate` (date-time) — Quando entrou.

**RfidMovement** — Histórico de cada etiqueta nas transações: saiu numa venda, voltou numa devolução ou troca, ou foi estornada por cancelamento. Serve para rastrear uma peça pela etiqueta.

- `movementId` (integer) — Identificador do movimento.
- `rfidTag` (string) — Etiqueta RFID (EPC).
- `movementType` (string) — Tipo do movimento. Valores: Sale, Return, Reversal.
- `branchCode` (integer) — Empresa.
- `transactionCode` (integer) — Transação.
- `productCode` (integer) — Produto.
- `productSku` (string) — Código de barras.
- `productName` (string) — Nome do produto.
- `referenceName` (string) — Referência.
- `unitValue` (number) — Valor unitário na transação.
- `customerCode` (integer) — Cliente.
- `customerName` (string) — Nome do cliente.
- `sellerCode` (integer) — Vendedor.
- `sellerName` (string) — Nome do vendedor.
- `invoiceId` (integer) — Nota no HeadCoach.
- `invoiceAccessKey` (string) — Chave da nota.
- `movementDate` (date-time) — Quando aconteceu.

**RfidInventory** — Contagens feitas com o coletor RFID (app Android). A lista traz o resumo por produto; as etiquetas lidas ficam em /inventories/{inventoryId}/rfid-tags.

- `inventoryId` (integer) — Identificador do balanço.
- `name` (string) — Nome dado ao balanço.
- `branchCode` (integer) — Empresa.
- `branchName` (string) — Nome da empresa.
- `sector` (string) — Setor contado.
- `userName` (string) — Quem contou.
- `startDate` (date-time) — Início da contagem.
- `endDate` (date-time) — Fim da contagem.
- `durationSeconds` (integer) — Duração em segundos.
- `rfidTagQuantity` (integer) — Etiquetas diferentes lidas.
- `readQuantity` (integer) — Leituras feitas (uma etiqueta pode ser lida várias vezes).
- `productSummary` (array) — Resumo por produto (chaves em português, como gravado pelo app).
- `productSummaryDate` (date-time) — Quando o resumo por produto foi calculado.
- `observation` (string) — Observação.
- `createdDate` (date-time) — Quando o balanço chegou ao servidor.

**RfidInventoryTag** — Etiqueta lida no balanço.

- `rfidTag` (string) — Etiqueta RFID (EPC).

## SalePanel — `sale-panel`

Painel de vendas do que passa pelo HeadCoach (PDV Crosby e faturamento da expedição). Não inclui as vendas que as lojas ainda fazem pelo TOTVS. Regra: faturamento = vendas − devoluções; a venda entra pelo valor cheio e a troca ou devolução entra como devolução; transferência entre empresas não conta. Só transação com nota autorizada, pela data do caixa.

### GET /api/headcoach/sale-panel/v1/totals-branch

Totais por empresa — Vendas, devoluções e faturamento de cada empresa no período.

Parâmetros:
- `startDate` (string) — Data do caixa a partir de (AAAA-MM-DD).
- `endDate` (string) — Data do caixa até (AAAA-MM-DD).
- `branchCodeList` (string) — Empresas, separadas por vírgula.
- `origin` (string) — Só o PDV Crosby (Pos) ou só o faturamento da expedição (Billing). Sem o parâmetro, os dois.
- `page` (integer) — Página (começa em 1).
- `pageSize` (integer) — Itens por página (até 1000).

Resposta: página de `SaleTotalsBranch`

### GET /api/headcoach/sale-panel/v1/totals-seller

Totais por vendedor — Vendas, devoluções e faturamento por empresa e vendedor no período. A troca ou devolução conta no vendedor que a registrou.

Parâmetros:
- `startDate` (string) — Data do caixa a partir de (AAAA-MM-DD).
- `endDate` (string) — Data do caixa até (AAAA-MM-DD).
- `branchCodeList` (string) — Empresas, separadas por vírgula.
- `origin` (string) — Só o PDV Crosby (Pos) ou só o faturamento da expedição (Billing). Sem o parâmetro, os dois.
- `page` (integer) — Página (começa em 1).
- `pageSize` (integer) — Itens por página (até 1000).

Resposta: página de `SaleTotalsSeller`

### GET /api/headcoach/sale-panel/v1/totals-day

Totais por dia — Vendas, devoluções e faturamento por empresa e dia (data do caixa).

Parâmetros:
- `startDate` (string) — Data do caixa a partir de (AAAA-MM-DD).
- `endDate` (string) — Data do caixa até (AAAA-MM-DD).
- `branchCodeList` (string) — Empresas, separadas por vírgula.
- `origin` (string) — Só o PDV Crosby (Pos) ou só o faturamento da expedição (Billing). Sem o parâmetro, os dois.
- `page` (integer) — Página (começa em 1).
- `pageSize` (integer) — Itens por página (até 1000).

Resposta: página de `SaleTotalsDay`

### GET /api/headcoach/sale-panel/v1/exchange-coupons

Cupons de troca — Cupom entregue ao cliente junto com a nota da venda (serve para presente: não mostra valores). `transactionCode` é a transação do HeadCoach nos cupons novos; nos antigos, do tempo em que a venda ia ao TOTVS, é a transação do TOTVS. Na troca de presente o caixa lê o código do cupom: a troca é conferida contra a venda do cupom e cada peça trocada fica anotada em `uses`.

Parâmetros:
- `branchCodeList` (string) — Empresas, separadas por vírgula.
- `transactionCode` (integer) — Cupom de uma transação.
- `customerCode` (integer) — Cliente.
- `startDate` (string) — Data da venda a partir de (AAAA-MM-DD).
- `endDate` (string) — Data da venda até (AAAA-MM-DD).
- `page` (integer) — Página (começa em 1).
- `pageSize` (integer) — Itens por página (até 1000).

Resposta: página de `ExchangeCoupon`

### GET /api/headcoach/sale-panel/v1/exchange-coupons/{couponCode}

Cupons de troca — um registro — Cupom entregue ao cliente junto com a nota da venda (serve para presente: não mostra valores). `transactionCode` é a transação do HeadCoach nos cupons novos; nos antigos, do tempo em que a venda ia ao TOTVS, é a transação do TOTVS. Na troca de presente o caixa lê o código do cupom: a troca é conferida contra a venda do cupom e cada peça trocada fica anotada em `uses`.

Parâmetros:
- `couponCode` (caminho, obrigatório) — Código impresso no cupom.

Resposta:  `ExchangeCoupon`

### GET /api/headcoach/sale-panel/v1/promotions

Promoções do PDV — Promoções geradas no HeadCoach para o PDV Crosby (tela Preço Promocional). Vale nas empresas de `branchCodes`, entre `startDate` e `endDate`, enquanto `isActive` for true.

Parâmetros:
- `isActive` (boolean) — Só as ligadas (true) ou desligadas (false).
- `name` (string) — Trecho do nome.
- `page` (integer) — Página (começa em 1).
- `pageSize` (integer) — Itens por página (até 1000).
- `expand` (string) — Listas extras para trazer junto, separadas por vírgula: items.

Resposta: página de `Promotion`

### GET /api/headcoach/sale-panel/v1/promotions/{promotionId}

Promoções do PDV — um registro — Promoções geradas no HeadCoach para o PDV Crosby (tela Preço Promocional). Vale nas empresas de `branchCodes`, entre `startDate` e `endDate`, enquanto `isActive` for true.

Parâmetros:
- `promotionId` (caminho, obrigatório) — Identificador da promoção.
- `expand` (string) — Listas extras para trazer junto, separadas por vírgula: items.

Resposta:  `Promotion`

### GET /api/headcoach/sale-panel/v1/promotion-items

Produtos em promoção — Produto de uma promoção do PDV, com o preço cheio e o promocional.

Parâmetros:
- `promotionId` (integer) — Produtos de uma promoção.
- `productCode` (integer) — Produto.
- `page` (integer) — Página (começa em 1).
- `pageSize` (integer) — Itens por página (até 1000).

Resposta: página de `PromotionItem`

### GET /api/headcoach/sale-panel/v1/discount-limits

Limite de desconto por vendedor — Percentual máximo de desconto que cada usuário do setor Varejo pode dar no PDV Crosby sem a senha de um owner/admin (tela Financeiro › Liberação de Desconto). Só traz quem já teve o limite gravado: **usuário que não aparece aqui usa o padrão de 15% (gerente: 30%)**. Owner e admin não têm limite. Acima do próprio limite, outro usuário pode autorizar com a senha dele, até o limite dele.

Parâmetros:
- `userEmail` (string) — Trecho do e-mail.
- `userName` (string) — Trecho do nome.
- `page` (integer) — Página (começa em 1).
- `pageSize` (integer) — Itens por página (até 1000).

Resposta: página de `DiscountLimit`

### GET /api/headcoach/sale-panel/v1/discount-limits/{userId}

Limite de desconto por vendedor — um registro — Percentual máximo de desconto que cada usuário do setor Varejo pode dar no PDV Crosby sem a senha de um owner/admin (tela Financeiro › Liberação de Desconto). Só traz quem já teve o limite gravado: **usuário que não aparece aqui usa o padrão de 15% (gerente: 30%)**. Owner e admin não têm limite. Acima do próprio limite, outro usuário pode autorizar com a senha dele, até o limite dele.

Parâmetros:
- `userId` (caminho, obrigatório) — Usuário do HeadCoach (uuid).

Resposta:  `DiscountLimit`

### GET /api/headcoach/sale-panel/v1/discount-limit-changes

Histórico do limite de desconto — Uma linha por usuário a cada mudança do limite de desconto do PDV Crosby: de quanto para quanto, quem mudou e se foi só aquele usuário (`User`), todos de uma loja (`Branch`) ou todos (`All`).

Parâmetros:
- `userId` (string) — Usuário (uuid).
- `scopeBranchCode` (integer) — Mudanças feitas para uma loja.
- `page` (integer) — Página (começa em 1).
- `pageSize` (integer) — Itens por página (até 1000).

Resposta: página de `DiscountLimitChange`

### GET /api/headcoach/sale-panel/v1/discount-limit-changes/{changeId}

Histórico do limite de desconto — um registro — Uma linha por usuário a cada mudança do limite de desconto do PDV Crosby: de quanto para quanto, quem mudou e se foi só aquele usuário (`User`), todos de uma loja (`Branch`) ou todos (`All`).

Parâmetros:
- `changeId` (caminho, obrigatório) — Identificador da mudança.

Resposta:  `DiscountLimitChange`

Esquemas:

**SaleTotalsBranch** — Totais de uma empresa no período.

- `branchCode` (integer) — 
- `saleQuantity` (integer) — Número de vendas.
- `saleValue` (number) — Valor das vendas (cheio).
- `itemQuantity` (number) — Peças vendidas.
- `returnQuantity` (integer) — Número de trocas e devoluções.
- `returnValue` (number) — Valor das trocas e devoluções.
- `netValue` (number) — Faturamento: vendas − devoluções.
- `averageTicket` (number) — Ticket médio (valor das vendas ÷ número de vendas).
- `itemsPerSale` (number) — Peças por venda.

**SaleTotalsSeller** — Totais de um vendedor numa empresa.

- `branchCode` (integer) — 
- `sellerCode` (integer) — 
- `sellerName` (string) — 
- `saleQuantity` (integer) — Número de vendas.
- `saleValue` (number) — Valor das vendas (cheio).
- `itemQuantity` (number) — Peças vendidas.
- `returnQuantity` (integer) — Número de trocas e devoluções.
- `returnValue` (number) — Valor das trocas e devoluções.
- `netValue` (number) — Faturamento: vendas − devoluções.
- `averageTicket` (number) — Ticket médio (valor das vendas ÷ número de vendas).
- `itemsPerSale` (number) — Peças por venda.

**SaleTotalsDay** — Totais de uma empresa num dia.

- `cashierDate` (date) — 
- `branchCode` (integer) — 
- `saleQuantity` (integer) — Número de vendas.
- `saleValue` (number) — Valor das vendas (cheio).
- `itemQuantity` (number) — Peças vendidas.
- `returnQuantity` (integer) — Número de trocas e devoluções.
- `returnValue` (number) — Valor das trocas e devoluções.
- `netValue` (number) — Faturamento: vendas − devoluções.
- `averageTicket` (number) — Ticket médio (valor das vendas ÷ número de vendas).
- `itemsPerSale` (number) — Peças por venda.

**ExchangeCoupon** — Cupom entregue ao cliente junto com a nota da venda (serve para presente: não mostra valores). `transactionCode` é a transação do HeadCoach nos cupons novos; nos antigos, do tempo em que a venda ia ao TOTVS, é a transação do TOTVS. Na troca de presente o caixa lê o código do cupom: a troca é conferida contra a venda do cupom e cada peça trocada fica anotada em `uses`.

- `couponCode` (string) — Código impresso no cupom.
- `branchCode` (integer) — Empresa da venda.
- `transactionCode` (integer) — Transação da venda.
- `transactionDate` (date) — Data da venda.
- `totalValue` (number) — Valor da venda.
- `customerCode` (integer) — Cliente da venda.
- `customerName` (string) — Nome do cliente.
- `sellerCode` (integer) — Vendedor.
- `sellerName` (string) — Nome do vendedor.
- `items` (array) — Peças da venda.
- `uses` (array) — Peças já trocadas com este cupom (troca de presente), uma linha por peça de cada troca, com as chaves como gravado na tela. O uso de uma troca cancelada ou rejeitada continua na lista, mas não conta: confira a situação da transação em `transacao_code`.
- `createdBy` (string) — Quem gerou.
- `createdDate` (date-time) — Quando foi gerado.

**PromotionItem** — Produto de uma promoção do PDV, com o preço cheio e o promocional.

- `promotionId` (integer) — Promoção.
- `productCode` (integer) — Produto.
- `productSku` (string) — Código de barras.
- `productName` (string) — Nome do produto.
- `basePrice` (number) — Preço cheio.
- `promotionalPrice` (number) — Preço promocional.

**Promotion** — Promoções geradas no HeadCoach para o PDV Crosby (tela Preço Promocional). Vale nas empresas de `branchCodes`, entre `startDate` e `endDate`, enquanto `isActive` for true.

- `promotionId` (integer) — Identificador da promoção.
- `name` (string) — Nome da promoção.
- `branchCodes` (array) — Empresas em que vale.
- `startDate` (date) — Início.
- `endDate` (date) — Fim.
- `isActive` (boolean) — Promoção ligada.
- `discountPercentage` (number) — Percentual de desconto aplicado.
- `createdBy` (string) — Quem criou.
- `createdDate` (date-time) — Criação.
- `lastChangeDate` (date-time) — Última alteração.
- `items` (array de PromotionItem) — Produtos da promoção (só vem com expand=items)

**DiscountLimit** — Percentual máximo de desconto que cada usuário do setor Varejo pode dar no PDV Crosby sem a senha de um owner/admin (tela Financeiro › Liberação de Desconto). Só traz quem já teve o limite gravado: **usuário que não aparece aqui usa o padrão de 15% (gerente: 30%)**. Owner e admin não têm limite. Acima do próprio limite, outro usuário pode autorizar com a senha dele, até o limite dele.

- `userId` (string) — Usuário do HeadCoach (uuid).
- `userName` (string) — Nome do usuário.
- `userEmail` (string) — E-mail do usuário.
- `branchCodes` (array) — Lojas configuradas para o usuário quando o limite foi gravado.
- `discountPercentage` (number) — Limite de desconto, em % (0 a 100).
- `changedBy` (string) — Quem definiu.
- `lastChangeDate` (date-time) — Quando foi definido.

**DiscountLimitChange** — Uma linha por usuário a cada mudança do limite de desconto do PDV Crosby: de quanto para quanto, quem mudou e se foi só aquele usuário (`User`), todos de uma loja (`Branch`) ou todos (`All`).

- `changeId` (integer) — Identificador da mudança.
- `userId` (string) — Usuário que teve o limite mudado (uuid).
- `userName` (string) — Nome do usuário.
- `userEmail` (string) — E-mail do usuário.
- `branchCodes` (array) — Lojas do usuário na hora da mudança.
- `previousDiscountPercentage` (number) — Limite anterior, em %.
- `discountPercentage` (number) — Limite novo, em %.
- `scope` (string) — Como foi mudado. Valores: User, Branch, All.
- `scopeBranchCode` (integer) — Loja escolhida, quando a mudança foi por loja.
- `changedBy` (string) — Quem mudou.
- `changeDate` (date-time) — Quando mudou.

