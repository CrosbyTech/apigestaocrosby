// API HEADCOACH › transaction — toda transação que o HeadCoach registra.
import { criarModulo, f, q } from './_engine.js';
import { INVOICE } from './fiscal.js';
import { TRANSACTION_STATUS, TRANSACTION_INTERNAL_STATUS, SALE_TYPE, CHANNEL, PAYMENT_METHOD, RFID_MOVEMENT, SELLER_CHANGE_SOURCE, inverso } from './_maps.js';

const modulo = criarModulo({
  nome: 'transaction',
  titulo: 'Transaction',
  descricao: 'Transações do HeadCoach: venda do PDV, troca, faturamento da expedição, faturamento Brejinho, transferência e devolução. É a mesma lista da tela Transações.',
});

// de onde veio a transação (mesma regra da tela Transações)
const origemDe = (v) => {
  if (v.origem === 'pdv' || !v.origem) return v.tipo_venda === 'troca' ? 'Exchange' : 'Pos';
  if (v.canal === 'transferencia' || v.pedido_info?.transferencia) return 'Transfer';
  if (v.canal === 'devolucao') return 'Return';
  if (String(v.pedido_chave || '').startsWith('BRJ:')) return 'BrejinhoBilling';
  if (v.pedido_info?.avulso || String(v.pedido_chave || '').startsWith('AVULSO:')) return 'DirectBilling';
  return 'Billing';
};
const ORIGENS = {
  Pos: 'Venda do PDV Crosby',
  Exchange: 'Troca no PDV Crosby (devolução do cliente, gera Credev)',
  Billing: 'Faturamento de pedido da expedição',
  BrejinhoBilling: 'Faturamento Brejinho',
  DirectBilling: 'Faturamento avulso (sem pedido)',
  Transfer: 'Transferência entre empresas',
  Return: 'Devolução de mercadoria',
};
const filtroOrigem = (qy, valor, ruim) => {
  const o = Object.keys(ORIGENS).find((k) => k.toLowerCase() === valor.toLowerCase());
  if (!o) ruim(`Valores aceitos: ${Object.keys(ORIGENS).join(', ')}.`);
  if (o === 'Pos') return qy.eq('origem', 'pdv').neq('tipo_venda', 'troca');
  if (o === 'Exchange') return qy.eq('origem', 'pdv').eq('tipo_venda', 'troca');
  if (o === 'Transfer') return qy.eq('canal', 'transferencia');
  if (o === 'Return') return qy.eq('canal', 'devolucao');
  if (o === 'BrejinhoBilling') return qy.like('pedido_chave', 'BRJ:%');
  if (o === 'DirectBilling') return qy.like('pedido_chave', 'AVULSO:%');
  return qy.eq('origem', 'expedicao').in('canal', ['revenda', 'franquias', 'varejo', 'mtm', 'geral']).not('pedido_chave', 'like', 'BRJ:%').not('pedido_chave', 'like', 'AVULSO:%');
};
const cancelamento = (v) => {
  const c = v.pedido_info?.cancelamento;
  return c ? { canceledBy: c.por || null, reason: c.motivo || null, date: c.em || null, authorizedBy: c.autorizadoPor || null } : null;
};

const ITEM = {
  name: 'TransactionItem',
  path: '/items',
  table: 'pdv_venda_itens',
  summary: 'Peças da transação',
  description: 'Uma linha por produto da transação, com a quantidade, o valor e as etiquetas RFID lidas.',
  order: [['venda_id', false], ['seq', true]],
  fields: [
    f('itemId', 'id', 'integer', 'Identificador interno do item.'),
    f('transactionCode', 'venda_id', 'integer', 'Transação.'),
    f('sequence', 'seq', 'integer', 'Ordem do item na nota.'),
    f('productCode', 'product_code', 'integer', 'Código do produto (o mesmo do TOTVS).'),
    f('productSku', 'sku', 'string', 'Código de barras (EAN).'),
    f('productName', 'nome', 'string', 'Nome do produto.'),
    f('referenceName', 'referencia', 'string', 'Referência (modelo).'),
    f('ncm', 'ncm', 'string', 'NCM.'),
    f('cfop', 'cfop', 'integer', 'CFOP do item na nota.'),
    f('measureUnit', 'unidade', 'string', 'Unidade.'),
    f('quantity', 'quantidade', 'number', 'Quantidade.'),
    f('unitValue', 'valor_unit', 'number', 'Valor unitário cheio.'),
    f('unitDiscountValue', 'desconto_unit', 'number', 'Desconto por unidade.'),
    f('totalValue', 'total', 'number', 'Total do item (quantidade × (unitário − desconto)).'),
    f('rfidTags', 'epcs', 'array', 'Etiquetas RFID (EPC) das peças lidas.', { items: { type: 'string' } }),
  ],
  filters: [q('productCode', 'int', 'product_code', 'Só este produto.')],
};

const PAYMENT = {
  name: 'TransactionPayment',
  path: '/payments',
  table: 'pdv_venda_pagamentos',
  summary: 'Pagamentos da transação',
  description: 'Uma linha por forma de pagamento. Os títulos gerados ficam em accounts-receivable/documents.',
  order: [['venda_id', false], ['id', true]],
  fields: [
    f('paymentId', 'id', 'integer', 'Identificador interno do pagamento.'),
    f('transactionCode', 'venda_id', 'integer', 'Transação.'),
    f('paymentMethod', 'forma', 'string', 'Forma de pagamento (general/payment-methods).', { map: PAYMENT_METHOD }),
    f('value', 'valor', 'number', 'Valor pago nesta forma.'),
    f('changeValue', 'troco', 'number', 'Troco devolvido (dinheiro).'),
    f('installmentQuantity', 'parcelas', 'integer', 'Número de parcelas (cartão de crédito, BlueCard, boleto).'),
    f('cardBrand', 'bandeira', 'string', 'Bandeira do cartão.'),
    f('nsu', 'nsu', 'string', 'NSU da maquininha.'),
    f('authorizationCode', 'autorizacao', 'string', 'Código de autorização.'),
    f('acquirerCnpj', 'adquirente_cnpj', 'string', 'CNPJ da credenciadora.'),
  ],
  filters: [q('paymentMethod', 'enum', 'forma', 'Forma de pagamento (aceita lista).', { map: inverso(PAYMENT_METHOD) })],
};

const RFID = {
  name: 'TransactionRfidMovement',
  path: '/rfid-movements',
  table: 'pdv_epc_movimentos',
  summary: 'Etiquetas RFID da transação',
  description: 'Movimento de cada etiqueta (EPC) na transação: saída na venda, volta na devolução, estorno no cancelamento.',
  order: [['venda_id', false], ['id', true]],
  fields: [
    f('movementId', 'id', 'integer', 'Identificador interno.'),
    f('rfidTag', 'epc', 'string', 'Etiqueta RFID (EPC).'),
    f('movementType', 'tipo', 'string', 'Tipo do movimento.', { map: RFID_MOVEMENT }),
    f('branchCode', 'empresa', 'integer', 'Empresa.'),
    f('transactionCode', 'venda_id', 'integer', 'Transação.'),
    f('productCode', 'product_code', 'integer', 'Produto.'),
    f('productName', 'produto_nome', 'string', 'Nome do produto.'),
    f('unitValue', 'valor_unit', 'number', 'Valor unitário.'),
    f('movementDate', 'ocorrido_em', 'date-time', 'Quando aconteceu.'),
  ],
  filters: [q('movementType', 'enum', 'tipo', 'Tipo do movimento.', { map: inverso(RFID_MOVEMENT) })],
};

modulo.recurso({
  name: 'Transaction',
  path: '/transactions',
  table: 'pdv_vendas',
  summary: 'Transações',
  description:
    'Uma linha por transação. `status` segue o TOTVS: InProgress (registrada, nota ainda não autorizada), Attended (nota autorizada) e Canceled. `origin` diz de onde veio: ' +
    Object.entries(ORIGENS).map(([k, v]) => `${k} = ${v}`).join('; ') +
    '. Use expand=items,payments,invoices,rfidMovements para trazer os detalhes junto.',
  key: [{ param: 'transactionCode', col: 'id', type: 'integer', description: 'Número da transação no HeadCoach.' }],
  order: [['id', false]],
  extraCols: ['pedido_info', 'origem'],
  fields: [
    f('transactionCode', 'id', 'integer', 'Número da transação no HeadCoach.', { example: 244 }),
    f('branchCode', 'empresa', 'integer', 'Empresa.', { example: 95 }),
    f('branchCnpj', 'empresa_cnpj', 'string', 'CNPJ da empresa.'),
    f('branchName', 'empresa_nome', 'string', 'Nome da empresa.'),
    f('status', 'status', 'string', 'Situação da transação.', { map: TRANSACTION_STATUS }),
    f('internalStatus', 'status', 'string', 'Situação detalhada (inclui nota rejeitada).', { map: TRANSACTION_INTERNAL_STATUS }),
    f('origin', origemDe, 'string', 'De onde veio a transação.', { cols: ['origem', 'tipo_venda', 'canal', 'pedido_chave', 'pedido_info'], enum: Object.keys(ORIGENS) }),
    f('saleType', 'tipo_venda', 'string', 'Tipo de documento: NFC-e, NF-e ou troca (NF-e de devolução).', { map: SALE_TYPE }),
    f('operationType', (v) => (v.tipo_venda === 'troca' || v.canal === 'devolucao' ? 'Input' : 'Output'), 'string', 'Entrada (troca, devolução) ou saída.', { cols: ['tipo_venda', 'canal'], enum: ['Input', 'Output'] }),
    f('operationCode', 'operacao', 'integer', 'Operação (general/operations).'),
    f('channel', 'canal', 'string', 'Canal de venda do pedido (só faturamento).', { map: CHANNEL }),
    f('transactionDate', 'criado_em', 'date-time', 'Data e hora do registro.'),
    f('cashierCode', 'caixa_id', 'integer', 'Caixa em que a transação entrou (cashier/cashiers).'),
    f('cashierDate', 'data_caixa', 'date', 'Data do caixa, quando gravada na transação.'),
    f('customerCode', 'cliente_code', 'integer', 'Código do cliente (o mesmo do TOTVS). Nulo em NFC-e sem cliente.'),
    f('customerName', 'cliente_nome', 'string', 'Nome do cliente.'),
    f('customerCpfCnpj', 'cliente_cpf_cnpj', 'string', 'CPF ou CNPJ do cliente, só dígitos.'),
    f('sellerCode', 'vendedor_code', 'integer', 'Código do vendedor. O owner pode trocar o vendedor depois (histórico em transaction/seller-changes); aqui vem sempre o atual.'),
    f('sellerName', 'vendedor_nome', 'string', 'Nome do vendedor.'),
    f('itemQuantity', 'qtd_pecas', 'number', 'Quantidade de peças.'),
    f('grossValue', 'subtotal', 'number', 'Valor bruto (antes dos descontos).'),
    f('discountValue', 'desconto', 'number', 'Descontos (inclui o cashback usado).'),
    f('cashbackUsedValue', 'cashback_usado', 'number', 'Cashback usado na venda.'),
    f('freightValue', 'frete', 'number', 'Frete.'),
    f('totalValue', 'total', 'number', 'Valor total da transação.'),
    f('orderKey', 'pedido_chave', 'string', 'Chave do pedido no Dryland (faturamento). BRJ:… = Brejinho; AVULSO:… = sem pedido.'),
    f('orderNumber', 'numero_site', 'string', 'Número do pedido (RV…, MT…, FR…, VJ…, PE…, BRJ …).'),
    f('referencedInvoiceKeys', (v) => (v.nf_referenciada ? String(v.nf_referenciada).split(',').map((s) => s.trim()).filter(Boolean) : []), 'array', 'Chaves das notas de origem (troca e devolução).', { cols: ['nf_referenciada'], items: { type: 'string' } }),
    f('linkedExchangeTransactionCode', (v) => v.pedido_info?.trocaVendaId ?? null, 'integer', 'Troca feita no mesmo atendimento desta venda (VENDA | TROCA).'),
    f('cancellation', cancelamento, 'object', 'Quem cancelou e por quê (só transação cancelada pela tela de cancelamento).', {
      properties: { canceledBy: { type: 'string', nullable: true }, reason: { type: 'string', nullable: true }, date: { type: 'string', format: 'date-time', nullable: true }, authorizedBy: { type: 'string', nullable: true } },
    }),
    f('paymentSchedule', (v) => (Array.isArray(v.cobranca?.parcelas) ? v.cobranca.parcelas.map((p) => ({ dueDate: p.vencimento ? String(p.vencimento).slice(0, 10) : null, value: p.valor ?? null })) : []), 'array', 'Parcelas combinadas no pedido para o boleto (faturamento).', {
      cols: ['cobranca'],
      items: { type: 'object', properties: { dueDate: { type: 'string', format: 'date', nullable: true }, value: { type: 'number', nullable: true } } },
    }),
    f('shipping', 'transporte', 'object', 'Dados de transporte da nota (faturamento), com as chaves em português como gravado na tela (transportadora, volumes, peso…).'),
    f('paymentReceipts', 'comprovantes', 'array', 'Comprovantes de pagamento anexados (endereços dos arquivos).', { items: { type: 'object', additionalProperties: true } }),
    f('observation', 'observacao', 'string', 'Observação.'),
    f('createdBy', 'criado_por', 'string', 'Usuário que registrou.'),
    f('totvsTransactionCode', 'totvs_transacao_code', 'integer', 'Transação espelhada no TOTVS, quando houve espelho.'),
    f('lastChangeDate', 'atualizado_em', 'date-time', 'Última alteração.'),
  ],
  filters: [
    q('branchCodeList', 'intList', 'empresa', 'Empresas, separadas por vírgula.'),
    q('startDate', 'startDate', 'criado_em', 'Registradas a partir de (AAAA-MM-DD).'),
    q('endDate', 'endDate', 'criado_em', 'Registradas até (AAAA-MM-DD).'),
    q('status', 'enum', 'status', 'Situação (aceita lista).', { map: inverso(TRANSACTION_STATUS) }),
    q('origin', 'custom', null, `De onde veio. Valores: ${Object.keys(ORIGENS).join(', ')}.`, { apply: filtroOrigem }),
    q('saleType', 'enum', 'tipo_venda', 'Tipo de documento.', { map: inverso(SALE_TYPE) }),
    q('channel', 'enum', 'canal', 'Canal de venda (faturamento).', { map: inverso(CHANNEL) }),
    q('customerCode', 'int', 'cliente_code', 'Código do cliente.'),
    q('customerCpfCnpj', 'digits', 'cliente_cpf_cnpj', 'CPF ou CNPJ do cliente.'),
    q('sellerCode', 'int', 'vendedor_code', 'Código do vendedor.'),
    q('operationCodeList', 'intList', 'operacao', 'Operações, separadas por vírgula.'),
    q('orderNumber', 'string', 'numero_site', 'Número do pedido (exato).'),
    q('orderKey', 'string', 'pedido_chave', 'Chave do pedido no Dryland (exata).'),
    q('cashierCode', 'int', 'caixa_id', 'Transações de um caixa.'),
    q('transactionCodeList', 'intList', 'id', 'Números das transações, separados por vírgula.'),
    q('startChangeDate', 'startDate', 'atualizado_em', 'Alteradas a partir de (AAAA-MM-DD) — para sincronização.'),
  ],
  expand: {
    items: { resource: ITEM, fk: 'venda_id', description: 'Peças da transação' },
    payments: { resource: PAYMENT, fk: 'venda_id', description: 'Pagamentos da transação' },
    invoices: { resource: INVOICE, fk: 'venda_id', description: 'Notas fiscais da transação' },
    rfidMovements: { resource: RFID, fk: 'venda_id', description: 'Etiquetas RFID movimentadas' },
  },
  sub: [
    { path: '/items', resource: ITEM, fk: 'venda_id', summary: 'Peças de uma transação' },
    { path: '/payments', resource: PAYMENT, fk: 'venda_id', summary: 'Pagamentos de uma transação' },
    { path: '/invoices', resource: INVOICE, fk: 'venda_id', summary: 'Notas fiscais de uma transação' },
    { path: '/rfid-movements', resource: RFID, fk: 'venda_id', summary: 'Etiquetas RFID de uma transação' },
  ],
});

// Trocas de vendedor feitas pelo owner na tela de Transações (Yago, 19/11/2026).
// A tabela guarda vendas (pdv_vendas) e devoluções (devolucoes_transacoes) juntas,
// por isso é um recurso próprio e não um expand de /transactions.
modulo.recurso({
  name: 'TransactionSellerChange',
  path: '/seller-changes',
  table: 'hc_transacoes_vendedor_alteracoes',
  summary: 'Trocas de vendedor das transações',
  description:
    'Histórico de quando o vendedor de uma transação foi trocado pela tela de Transações (só o owner troca). A troca vale para o ranking, o New Forecast e o contas a receber: `sellerCode` de transaction/transactions e de accounts-receivable/documents já vem com o vendedor NOVO. `source` diz onde está a transação: Sale = transaction/transactions (`transactionCode`); Return = return/returns (`transactionCode` é o `returnId`). Para sincronizar, leia por `startDate` (data da troca): a transação cancelada e a devolução não mudam de `lastChangeDate` quando o vendedor é trocado.',
  key: [{ param: 'changeId', col: 'id', type: 'integer', description: 'Identificador da troca.' }],
  order: [['id', false]],
  fields: [
    f('changeId', 'id', 'integer', 'Identificador da troca.'),
    f('source', 'fonte', 'string', 'Onde está a transação.', { map: SELLER_CHANGE_SOURCE }),
    f('transactionCode', 'transacao_id', 'integer', 'Número da transação (Sale) ou da devolução (Return).', { example: 244 }),
    f('transactionReference', 'transacao', 'string', 'Como a tela de Transações mostra: V + número (venda, faturamento, transferência) ou D + número (devolução).', { example: 'V244' }),
    f('branchCode', 'empresa', 'integer', 'Empresa da transação.', { example: 95 }),
    f('previousSellerCode', 'de_code', 'integer', 'Vendedor anterior.'),
    f('previousSellerName', 'de_nome', 'string', 'Nome do vendedor anterior.'),
    f('sellerCode', 'para_code', 'integer', 'Vendedor novo.'),
    f('sellerName', 'para_nome', 'string', 'Nome do vendedor novo.'),
    f('reason', 'motivo', 'string', 'Motivo informado por quem trocou.'),
    f('changedBy', 'alterado_por', 'string', 'Quem trocou.'),
    f('changeDate', 'alterado_em', 'date-time', 'Quando foi trocado.'),
  ],
  filters: [
    q('source', 'enum', 'fonte', 'Sale ou Return.', { map: inverso(SELLER_CHANGE_SOURCE) }),
    q('transactionCode', 'int', 'transacao_id', 'Trocas de uma transação (use junto com source).'),
    q('branchCodeList', 'intList', 'empresa', 'Empresas, separadas por vírgula.'),
    q('sellerCode', 'int', 'para_code', 'Trocas que passaram a venda PARA este vendedor.'),
    q('previousSellerCode', 'int', 'de_code', 'Trocas que tiraram a venda DESTE vendedor.'),
    q('startDate', 'startDate', 'alterado_em', 'Trocadas a partir de (AAAA-MM-DD).'),
    q('endDate', 'endDate', 'alterado_em', 'Trocadas até (AAAA-MM-DD).'),
  ],
});

export default modulo;
