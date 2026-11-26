// API HEADCOACH › transaction — toda transação que o HeadCoach registra.
import { criarModulo, f, q } from './_engine.js';
import { INVOICE } from './fiscal.js';
import { TRANSACTION_STATUS, TRANSACTION_INTERNAL_STATUS, SALE_TYPE, CHANNEL, PAYMENT_METHOD, RFID_MOVEMENT, SELLER_CHANGE_SOURCE, ITEM_FISCAL_TYPE, INVOICE_TYPE, inverso } from './_maps.js';

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

// cashback usado na venda que voltou para o cliente no cancelamento (services/cashbackEstornoTotvs.js)
const cashbackDevolvido = (v) => {
  const c = v.pedido_info?.cashbackDevolvido;
  if (!c || !(Number(c.valor) > 0)) return null;
  const lojas = Array.isArray(c.partes) && c.partes.length ? c.partes : [{ branchCode: c.empresa, valor: c.valor }];
  return {
    value: Number(c.valor),
    branchCode: c.empresa ?? null,
    branches: lojas.map((l) => ({ branchCode: Number(l.branchCode), value: Number(l.valor) })),
    validUntil: c.valeAte || null,
    date: c.em || null,
    refundedBy: c.por || null,
  };
};
// o que a rota de baixa anotou que saiu do saldo bônus do TOTVS para pagar o desconto de cashback
const cashbackBaixado = (v) => {
  const b = v.pedido_info?.cashbackBaixa;
  if (!b) return null;
  return {
    value: Number(b.total) || 0,
    branches: (b.totvs || []).map((l) => ({ branchCode: Number(l.branchCode), value: Number(l.valor) })),
    date: b.em || null,
    error: b.erro || null,
  };
};

// ─── detalhes guardados dentro da transação (pedido_info) ───────────────────
const dia10 = (v) => (v ? String(v).slice(0, 10) : null);
const notaDeOrigem = (n) => ({
  accessKey: n.chave || null,
  invoiceCode: n.numero ?? null,
  serialCode: n.serie != null ? String(n.serie) : null,
  invoiceType: INVOICE_TYPE[n.modelo] || null,
  branchCode: n.empresa ?? null,
  issueDate: dia10(n.data),
  source: n.origem === 'headcoach' ? 'HeadCoach' : n.origem === 'totvs' ? 'Totvs' : null,
  quantity: n.quantidade ?? null,
  unitValue: n.valorUnit ?? null,
});
const NOTA_DE_ORIGEM = {
  type: 'object',
  properties: {
    accessKey: { type: 'string', nullable: true, description: 'Chave da nota em que a peça foi comprada.' },
    invoiceCode: { type: 'integer', nullable: true },
    serialCode: { type: 'string', nullable: true },
    invoiceType: { type: 'string', nullable: true, enum: ['NFe', 'NFCe'] },
    branchCode: { type: 'integer', nullable: true, description: 'Empresa que emitiu a nota.' },
    issueDate: { type: 'string', format: 'date', nullable: true },
    source: { type: 'string', nullable: true, enum: ['HeadCoach', 'Totvs'], description: 'Onde a nota foi emitida.' },
    quantity: { type: 'number', nullable: true, description: 'Peças desta nota usadas na troca / devolução.' },
    unitValue: { type: 'number', nullable: true, description: 'Valor pago por peça nessa nota.' },
  },
};
// compra do crediário BlueCard amarrada à venda (PDV Crosby pede a compra, o cliente aprova no app)
const bluecardDe = (v) => {
  const b = v.pedido_info?.bluecard;
  if (!b?.compraId) return null;
  return {
    purchaseId: b.compraId,
    document: b.documento || null,
    value: b.valorCents != null ? Number(b.valorCents) / 100 : null,
    installmentQuantity: b.parcelas ?? null,
    schedule: (b.vencimentos || []).map((x) => ({ installmentCode: x.numero ?? null, dueDate: dia10(x.vencimento), value: x.valor_cents != null ? Number(x.valor_cents) / 100 : null })),
    approvalDate: b.aprovadaEm || null,
    linkedDate: b.conferidaEm || b.vinculadaEm || null,
    linkedBy: b.por || null,
    invoiceSentDate: b.fiscalEnviadoEm || null,
    canceledInAppDate: b.canceladaNoApp?.em || null,
    canceledInAppReason: b.canceladaNoApp?.motivo || null,
  };
};
// troca no PDV: cada peça devolvida e a(s) nota(s) em que ela foi comprada
const trocaDe = (v) => {
  const tr = v.pedido_info?.troca;
  if (!tr && !v.pedido_info?.cupomTroca && !v.pedido_info?.comprador) return null;
  return {
    checkedDate: tr?.conferidoEm || null,
    couponCode: v.pedido_info?.cupomTroca || null,
    buyerCode: v.pedido_info?.comprador?.code ?? null,
    buyerName: v.pedido_info?.comprador?.nome || null,
    items: (tr?.itens || []).map((i) => ({ productCode: i.productCode != null ? Number(i.productCode) : null, quantity: i.quantidade ?? null, unitValue: i.valorUnit ?? null, originInvoices: (i.notas || []).map(notaDeOrigem) })),
  };
};
// devolução de mercadoria (expedição): nota anulada ou devolução por RFID com as notas de origem
const devolucaoDe = (v) => {
  const d = v.pedido_info?.devolucao;
  const r = v.pedido_info?.devolucaoRfid;
  if (!d && !r) return null;
  return {
    reason: d?.motivo || null,
    operationCode: d?.operacao ?? r?.operacao ?? null,
    operationName: r?.operacaoNome || null,
    requestId: r?.solicitacaoId ?? null,
    originalTransactionCode: d?.vendaOriginal ?? null,
    originalInvoiceCode: d?.notaOriginal ?? null,
    originalInvoiceAccessKey: d?.chaveOriginal || null,
    originInvoices: (r?.notas || []).map(notaDeOrigem),
  };
};
// saldo bônus gerado por peça em falta no faturamento (customer-balance/billing-bonus)
const creditoFaltaDe = (v) => {
  const c = v.pedido_info?.creditoFalta;
  if (!c) return null;
  return {
    status: c.status || null,
    value: c.valor ?? null,
    items: (c.pecas || []).map((x) => ({ productCode: x.productCode != null ? Number(x.productCode) : null, productName: x.nome || null, quantity: x.quantidade ?? null, value: x.valor ?? null })),
    bonusId: c.bonus?.id ?? null,
    ticketNumber: c.chamado?.numero ?? null,
    requestedDate: c.pedidoEm || null,
    generatedDate: c.geradoEm || null,
    createdBy: c.por || null,
    error: c.erro || null,
  };
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
    f('cest', 'cest', 'string', 'CEST, quando o produto tem.'),
    f('fiscalType', 'tipo_fiscal', 'string', 'Tipo fiscal da peça na nota: `OwnProduction` (produção própria) ou `Purchased` (adquirida de terceiros). É o que decide o CFOP. Nulo nas transações antigas.', { map: ITEM_FISCAL_TYPE }),
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
    f('channel', 'canal', 'string', 'Canal de venda do pedido (só faturamento). `Bonification` = bonificação: peças dadas ao cliente, sem pagamento (ver `bonification`).', { map: CHANNEL }),
    f(
      'bonification',
      (v) => {
        const b = v.pedido_info?.bonificacao;
        return b ? { reason: b.justificativa || null, by: b.por || null, date: b.em || null, costName: b.custo?.nome || null, value: b.valor ?? null } : null;
      },
      'object',
      'Bonificação (operação 5910 do faturamento avulso): peças dadas ao cliente, sem custo para ele. A nota sai com cada peça no custo `costName`, sem pagamento e sem contas a receber; `totalValue` é o valor da nota, não uma venda. `reason` é a justificativa obrigatória de quem fez. Nulo nas demais transações.',
      { properties: { reason: { type: 'string', nullable: true }, by: { type: 'string', nullable: true }, date: { type: 'string', format: 'date-time', nullable: true }, costName: { type: 'string', nullable: true }, value: { type: 'number', nullable: true } } },
    ),
    f(
      'transfer',
      (v) => {
        const t = v.pedido_info?.transferencia;
        return t ? { nature: t.natureza === 'venda' ? 'Sale' : 'Transfer', originBranchCode: t.origemCode ?? null, destinationBranchCode: t.destinoCode ?? null, destinationName: t.destinoNome || null, withoutInvoice: !!t.semNota, isRetail: !!t.varejo, requestId: t.solicitacaoId ?? null, reference: t.ref || null, invoiceOperationCode: t.operacaoNota ?? null } : null;
      },
      'object',
      'Transferência de mercadoria (origin `Transfer`): loja de destino e a natureza (`Transfer` entre CNPJs da mesma empresa, `Sale` entre empresas diferentes). `withoutInvoice` = true na movimentação entre Brejinho (99) e Matriz (1): é o mesmo estoque em dois CNPJs, então fica só a transação e a saída das peças, sem nota fiscal — a transação aparece atendida e sem itens em /invoices. `isRetail` = true na Transferência entre Lojas do varejo (loja → loja, ou loja → Brejinho); `originBranchCode` é a loja de origem quando gravada (nulo nas antigas: é a própria empresa da transação); `requestId` liga à solicitação em transfer/requests e `invoiceOperationCode` é a operação da nota (7272 transferência, 7273 / 7280 venda entre empresas). Nulo quando não é transferência.',
      { cols: ['pedido_info'], properties: { nature: { type: 'string', enum: ['Transfer', 'Sale'] }, destinationBranchCode: { type: 'integer', nullable: true }, destinationName: { type: 'string', nullable: true }, withoutInvoice: { type: 'boolean' }, originBranchCode: { type: 'integer', nullable: true }, isRetail: { type: 'boolean' }, requestId: { type: 'integer', nullable: true }, reference: { type: 'string', nullable: true }, invoiceOperationCode: { type: 'integer', nullable: true } } }
    ),
    f('headcoachOnly', (v) => !v.totvs_transacao_code, 'boolean', 'A transação existe SÓ no HeadCoach: não tem espelho no TOTVS (`totvsTransactionCode` nulo). É o caso do faturamento da empresa 99 desde 13/11/2026, do PDV Crosby das lojas que saíram do TOTVS (ver `headcoachOnly` em general/branches) e da movimentação Brejinho ↔ Matriz.', { cols: ['totvs_transacao_code'] }),
    f('isFinalConsumer', (v) => (typeof v.pedido_info?.consumidorFinal === 'boolean' ? v.pedido_info.consumidorFinal : null), 'boolean', 'Faturamento marcado como venda a consumidor final (muda o imposto da nota). Nulo no PDV.'),
    f('saleDate', (v) => dia10(v.pedido_info?.dataVenda), 'date', 'Data da venda informada no faturamento, quando é diferente da data do caixa em que a transação entrou. Nulo = a própria data do registro.'),
    f(
      'bluecard',
      bluecardDe,
      'object',
      'Compra do crediário BlueCard amarrada a esta venda. O PDV Crosby pede a compra ao BlueCard, o cliente aprova no aplicativo e só então a venda fecha; `schedule` são as parcelas que o cliente aceitou (as mesmas dos títulos em accounts-receivable/documents, portador BLUECARD). `invoiceSentDate` = quando a nota foi enviada ao BlueCard. `canceledInAppDate` preenchido = a compra foi cancelada no aplicativo DEPOIS de a venda existir (precisa de acerto). Nulo nas vendas sem BlueCard e nas feitas antes desta amarração.',
      {
        properties: {
          purchaseId: { type: 'string', description: 'Identificador da compra no BlueCard.' },
          document: { type: 'string', nullable: true, description: 'Referência da tentativa enviada ao BlueCard (HC<loja>-…).' },
          value: { type: 'number', nullable: true, description: 'Valor aprovado em BlueCard (pode ser só parte da venda).' },
          installmentQuantity: { type: 'integer', nullable: true },
          schedule: { type: 'array', items: { type: 'object', properties: { installmentCode: { type: 'integer', nullable: true }, dueDate: { type: 'string', format: 'date', nullable: true }, value: { type: 'number', nullable: true } } } },
          approvalDate: { type: 'string', format: 'date-time', nullable: true },
          linkedDate: { type: 'string', format: 'date-time', nullable: true, description: 'Quando a compra foi conferida e amarrada à transação.' },
          linkedBy: { type: 'string', nullable: true },
          invoiceSentDate: { type: 'string', format: 'date-time', nullable: true },
          canceledInAppDate: { type: 'string', format: 'date-time', nullable: true },
          canceledInAppReason: { type: 'string', nullable: true },
        },
      },
    ),
    f(
      'exchange',
      trocaDe,
      'object',
      'Troca no PDV Crosby (origin `Exchange`): cada peça devolvida com a(s) nota(s) em que foi comprada e o valor pago nela (`originInvoices`) — é esse valor que vira Credev. `couponCode` = troca de presente feita pelo cupom (sale-panel/exchange-coupons), com quem comprou em `buyerCode` / `buyerName`. Nulo nas demais transações.',
      {
        properties: {
          checkedDate: { type: 'string', format: 'date-time', nullable: true, description: 'Quando as compras do cliente foram conferidas.' },
          couponCode: { type: 'string', nullable: true },
          buyerCode: { type: 'integer', nullable: true },
          buyerName: { type: 'string', nullable: true },
          items: { type: 'array', items: { type: 'object', properties: { productCode: { type: 'integer', nullable: true }, quantity: { type: 'number', nullable: true }, unitValue: { type: 'number', nullable: true }, originInvoices: { type: 'array', items: NOTA_DE_ORIGEM } } } },
        },
      },
    ),
    f(
      'returnDetails',
      devolucaoDe,
      'object',
      'Devolução de mercadoria da expedição (origin `Return`): motivo e operação, a solicitação de origem (`requestId`, em return/requests), a transação / nota original quando é anulação de nota (`originalTransactionCode`, `originalInvoiceCode`, `originalInvoiceAccessKey`) e, na Devolução RFID, as notas de compra referenciadas (`originInvoices`). Nulo nas demais transações.',
      {
        properties: {
          reason: { type: 'string', nullable: true },
          operationCode: { type: 'integer', nullable: true },
          operationName: { type: 'string', nullable: true },
          requestId: { type: 'integer', nullable: true },
          originalTransactionCode: { type: 'integer', nullable: true },
          originalInvoiceCode: { type: 'integer', nullable: true },
          originalInvoiceAccessKey: { type: 'string', nullable: true },
          originInvoices: { type: 'array', items: NOTA_DE_ORIGEM },
        },
      },
    ),
    f(
      'productSwaps',
      (v) => (Array.isArray(v.pedido_info?.trocas) ? v.pedido_info.trocas.map((x) => ({ fromProductCode: x.de != null ? Number(x.de) : null, fromProductName: x.deNome || null, toProductCode: x.para != null ? Number(x.para) : null, toProductName: x.paraNome || null, quantity: x.quantidade ?? null })) : []),
      'array',
      'Peças trocadas no faturamento: o pedido pedia `fromProduct…` e saiu `toProduct…` (mesmo modelo em outro tamanho / cor). Lista vazia quando não houve.',
      { items: { type: 'object', properties: { fromProductCode: { type: 'integer', nullable: true }, fromProductName: { type: 'string', nullable: true }, toProductCode: { type: 'integer', nullable: true }, toProductName: { type: 'string', nullable: true }, quantity: { type: 'number', nullable: true } } } },
    ),
    f(
      'billingDiscount',
      (v) => (v.pedido_info?.descontoFaturamento ? { percentage: v.pedido_info.descontoFaturamento.pct ?? null, releasedBy: v.pedido_info.descontoFaturamento.liberadoPor || null } : null),
      'object',
      'Desconto dado no faturamento (percentual) e quem liberou, quando passou do limite. Nulo quando não houve.',
      { properties: { percentage: { type: 'number', nullable: true }, releasedBy: { type: 'string', nullable: true } } },
    ),
    f(
      'suframa',
      (v) => (v.pedido_info?.suframa ? { registration: v.pedido_info.suframa.isuf || null, percentage: v.pedido_info.suframa.pct ?? null, exemptIcmsValue: v.pedido_info.suframa.icmsDesonerado ?? null } : null),
      'object',
      'Venda para a Zona Franca / área de livre comércio: inscrição SUFRAMA do cliente, a alíquota e o ICMS desonerado na nota. Nulo nas demais.',
      { properties: { registration: { type: 'string', nullable: true }, percentage: { type: 'number', nullable: true }, exemptIcmsValue: { type: 'number', nullable: true } } },
    ),
    f(
      'missingItemsCredit',
      creditoFaltaDe,
      'object',
      'Peças do pedido que faltaram no faturamento e viraram saldo bônus do cliente (`bonusId` em customer-balance/billing-bonus), com o chamado aberto para o financeiro (`ticketNumber`). `status`: gerado, pendente ou erro. Nulo quando não faltou peça paga.',
      {
        properties: {
          status: { type: 'string', nullable: true },
          value: { type: 'number', nullable: true },
          items: { type: 'array', items: { type: 'object', properties: { productCode: { type: 'integer', nullable: true }, productName: { type: 'string', nullable: true }, quantity: { type: 'number', nullable: true }, value: { type: 'number', nullable: true } } } },
          bonusId: { type: 'integer', nullable: true },
          ticketNumber: { type: 'integer', nullable: true },
          requestedDate: { type: 'string', format: 'date-time', nullable: true },
          generatedDate: { type: 'string', format: 'date-time', nullable: true },
          createdBy: { type: 'string', nullable: true },
          error: { type: 'string', nullable: true },
        },
      },
    ),
    f(
      'paymentAdjustment',
      (v) => {
        const a = v.pedido_info?.ajustePagamento;
        return a ? { from: a.de || null, to: a.para || null, reason: a.motivo || null, adjustedBy: a.por || null, date: a.em || null } : null;
      },
      'object',
      'Correção da forma de pagamento feita depois do faturamento (texto de como estava e como ficou, o motivo e quem fez). Nulo quando não houve.',
      { properties: { from: { type: 'string', nullable: true }, to: { type: 'string', nullable: true }, reason: { type: 'string', nullable: true }, adjustedBy: { type: 'string', nullable: true }, date: { type: 'string', format: 'date-time', nullable: true } } },
    ),
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
    f('discountValue', 'desconto', 'number', 'Tudo o que saiu do valor bruto: desconto dado na venda + cashback usado.'),
    f('discountWithoutCashbackValue', (v) => Math.max(0, Math.round((Number(v.desconto || 0) - Number(v.cashback_usado || 0)) * 100) / 100), 'number', 'Só o desconto dado na venda (discountValue menos o cashback usado).', { cols: ['desconto', 'cashback_usado'] }),
    f('cashbackUsedValue', 'cashback_usado', 'number', 'Cashback que o cliente usou nesta venda.'),
    f('cashbackGeneratedValue', 'cashback_gerado', 'number', 'Cashback que esta venda gerou para o cliente (customer-balance/cashback-grants). Zero se a venda foi cancelada.'),
    f('freightValue', 'frete', 'number', 'Frete.'),
    f('totalValue', 'total', 'number', 'Valor total da transação.'),
    f('orderKey', 'pedido_chave', 'string', 'Chave do pedido no Dryland (faturamento). BRJ:… = Brejinho; AVULSO:… = sem pedido.'),
    f('orderNumber', 'numero_site', 'string', 'Número do pedido (RV…, MT…, FR…, VJ…, PE…, BRJ …).'),
    f('referencedInvoiceKeys', (v) => (v.nf_referenciada ? String(v.nf_referenciada).split(',').map((s) => s.trim()).filter(Boolean) : []), 'array', 'Chaves das notas de origem (troca e devolução).', { cols: ['nf_referenciada'], items: { type: 'string' } }),
    f('linkedExchangeTransactionCode', (v) => v.pedido_info?.trocaVendaId ?? null, 'integer', 'Troca feita no mesmo atendimento desta venda (VENDA | TROCA).'),
    f('cancellation', cancelamento, 'object', 'Quem cancelou e por quê (só transação cancelada pela tela de cancelamento).', {
      properties: { canceledBy: { type: 'string', nullable: true }, reason: { type: 'string', nullable: true }, date: { type: 'string', format: 'date-time', nullable: true }, authorizedBy: { type: 'string', nullable: true } },
    }),
    f('usedCashbackWriteOff', cashbackBaixado, 'object', 'Baixa do cashback usado na venda: quanto saiu de fato do saldo bônus do TOTVS e de que lojas (`branches`). `value` zero com `error` preenchido = o desconto ficou na venda mas a baixa não aconteceu. Nulo nas vendas anteriores a 19/11/2026, que não têm esse registro.', {
      properties: { value: { type: 'number' }, branches: { type: 'array', items: { type: 'object', properties: { branchCode: { type: 'integer' }, value: { type: 'number' } } } }, date: { type: 'string', format: 'date-time', nullable: true }, error: { type: 'string', nullable: true } },
    }),
    f('usedCashbackRefund', cashbackDevolvido, 'object', 'Cashback que a venda tinha usado e voltou para o cliente quando ela foi cancelada (nulo se não houve devolução). O valor volta no saldo bônus do TOTVS, nas lojas de onde tinha saído (`branches`), valendo até `validUntil`. `branchCode` é a loja da venda.', {
      properties: { value: { type: 'number', nullable: true }, branchCode: { type: 'integer', nullable: true }, branches: { type: 'array', items: { type: 'object', properties: { branchCode: { type: 'integer' }, value: { type: 'number' } } } }, validUntil: { type: 'string', format: 'date', nullable: true }, date: { type: 'string', format: 'date-time', nullable: true }, refundedBy: { type: 'string', nullable: true } },
    }),
    f('paymentSchedule', (v) => (Array.isArray(v.cobranca?.parcelas) ? v.cobranca.parcelas.map((p) => ({ dueDate: p.vencimento ? String(p.vencimento).slice(0, 10) : null, value: p.valor ?? null })) : []), 'array', 'Parcelas combinadas no pedido para o boleto (faturamento).', {
      cols: ['cobranca'],
      items: { type: 'object', properties: { dueDate: { type: 'string', format: 'date', nullable: true }, value: { type: 'number', nullable: true } } },
    }),
    f('shipping', 'transporte', 'object', 'Dados de transporte da nota (faturamento), com as chaves como gravadas na tela: `code` e `nome` da transportadora, `cnpj` / `cpf`, `ie`, `uf`, `xMun` (cidade), `xEnder` (endereço), `servico`, `volumes`, `pesoB` (peso bruto), `pesoL` (peso líquido) e `modFrete` (0 = por conta do remetente, 1 = do destinatário, 9 = sem frete).'),
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
    q('bluecardPurchaseId', 'custom', null, 'Transação amarrada a esta compra do BlueCard (identificador da compra no BlueCard).', { apply: (qy, valor) => qy.eq('pedido_info->bluecard->>compraId', valor) }),
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
