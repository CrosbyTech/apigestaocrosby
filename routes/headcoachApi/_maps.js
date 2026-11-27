// Tradução dos valores do banco (em português) para os valores da API (em inglês,
// no estilo do TOTVS). Um lugar só, para todos os módulos responderem igual.
// `inverso(mapa)` devolve ValorDaApi → valor(es) do banco, para os filtros.

export const PAYMENT_METHOD = {
  dinheiro: 'Cash',
  pix: 'Pix',
  credito: 'CreditCard',
  debito: 'DebitCard',
  boleto: 'BankSlip',
  bluecard: 'BlueCard',
  credito_loja: 'Credev',
  adiantamento: 'Advance',
  saldo_bonus: 'BonusBalance',
  vale_troca: 'ExchangeVoucher',
};
// forma de pagamento → como aparece na nota (tPag) e no contas a receber
export const PAYMENT_METHOD_INFO = [
  { code: 'Cash', name: 'Dinheiro', nfePaymentType: '01', documentTypeCode: 3, receivable: 'Paid', description: 'Pago na hora; título nasce pago.' },
  { code: 'Pix', name: 'Pix', nfePaymentType: '17', documentTypeCode: 26, receivable: 'PaidToReconcile', description: 'Pago na emissão, liquida em D+1 e entra na conciliação.' },
  { code: 'CreditCard', name: 'Cartão de crédito', nfePaymentType: '03', documentTypeCode: 4, receivable: 'PaidToReconcile', description: 'Pago na emissão, liquida em D+1 e entra na conciliação.' },
  { code: 'DebitCard', name: 'Cartão de débito', nfePaymentType: '04', documentTypeCode: 5, receivable: 'PaidToReconcile', description: 'Pago na emissão, liquida em D+1 e entra na conciliação.' },
  { code: 'BankSlip', name: 'Boleto / fatura', nfePaymentType: '15', documentTypeCode: 1, receivable: 'Open', description: 'Título em aberto até a baixa, um por parcela.' },
  { code: 'BlueCard', name: 'BlueCard (crediário)', nfePaymentType: '05', documentTypeCode: 1, receivable: 'Open', description: 'Na venda aparece como BlueCard; no contas a receber vira boleto / fatura em aberto, portador BLUECARD, uma parcela por mês.' },
  { code: 'Credev', name: 'Credev (crédito de devolução)', nfePaymentType: '05', documentTypeCode: 20, receivable: 'Paid', description: 'Consome o Credev do cliente na loja; título nasce pago.' },
  { code: 'Advance', name: 'Adiantamento', nfePaymentType: '05', documentTypeCode: 10, receivable: 'Paid', description: 'Consome o adiantamento do cliente na loja; título nasce pago.' },
  { code: 'BonusBalance', name: 'Saldo bônus', nfePaymentType: '05', documentTypeCode: null, receivable: 'Paid', description: 'Consome o saldo bônus do cliente (faturamento).' },
  { code: 'ExchangeVoucher', name: 'Vale-troca', nfePaymentType: '90', documentTypeCode: null, receivable: 'None', description: 'Pagamento da própria troca (devolução); não gera título.' },
];

export const TRANSACTION_STATUS = { registrada: 'InProgress', emitindo: 'InProgress', rejeitada: 'InProgress', autorizada: 'Attended', cancelada: 'Canceled' };
export const TRANSACTION_INTERNAL_STATUS = { registrada: 'Registered', emitindo: 'Issuing', rejeitada: 'InvoiceRejected', autorizada: 'InvoiceAuthorized', cancelada: 'Canceled' };
// troca de vendedor: onde está a transação (pdv_vendas ou devolucoes_transacoes)
export const SELLER_CHANGE_SOURCE = { venda: 'Sale', devolucao: 'Return' };
export const SALE_TYPE = { nfce: 'NFCe', nfe: 'NFe', troca: 'Exchange' };
export const CHANNEL = { revenda: 'Reseller', franquias: 'Franchise', varejo: 'Retail', mtm: 'Multibrand', transferencia: 'Transfer', devolucao: 'Return', geral: 'General', bonificacao: 'Bonification' };

export const INVOICE_STATUS = { autorizada: 'Authorized', cancelada: 'Canceled', rejeitada: 'Rejected', erro: 'Error', pendente: 'Pending', emitindo: 'Issuing', denegada: 'Denied' };
export const ENVIRONMENT = { 1: 'Production', 2: 'Homologation' };
export const INVOICE_TYPE = { 55: 'NFe', 65: 'NFCe' };

export const RECEIVABLE_STATUS = { aberto: 'Open', pago: 'Paid', cancelado: 'Canceled' };
export const ORIGIN_SYSTEM = { pdv: 'Pos', expedicao: 'Billing' };

export const BALANCE_TYPE = { credev: 'Credev', adiantamento: 'Advance', cashback: 'Cashback' };
export const BALANCE_MOVEMENT = {
  carga_inicial: 'InitialLoad',
  devolucao: 'Return',
  devolucao_cancelada: 'ReturnCanceled',
  uso: 'Use',
  estorno: 'Reversal',
  ajuste: 'Adjustment',
  sinc_totvs: 'TotvsSync',
};
export const BONUS_TYPE = { credito: 'Credit', uso: 'Use', estorno: 'Reversal', cancelamento: 'Cancellation' };

export const CASHIER_STATUS = { aberto: 'Open', fechado: 'Closed' };
export const CASHIER_MOVEMENT = { suprimento: 'Supply', retirada: 'Withdrawal', retirada_fechamento: 'ClosingWithdrawal' };

export const DUPLICATE_STATUS = { enviando: 'Sending', enviada: 'Sent', assinada: 'Signed', erro: 'Error', cancelada: 'Canceled' };
// situação da transação no padrão do TOTVS (1 em andamento, 4 atendida, 6 cancelada)
export const TOTVS_TRANSACTION_STATUS = { 1: 'InProgress', 2: 'Closed', 3: 'ExternalProcess', 4: 'Attended', 6: 'Canceled' };

export const RETURN_REQUEST_STATUS = { aguardando_avaliacao: 'AwaitingEvaluation', aguardando_devolucao: 'AwaitingReturn', em_devolucao: 'InReturn', concluida: 'Completed', cancelada: 'Canceled' };
export const RETURN_TYPE = { tradicional: 'Regular', defeito: 'Defect' };
export const RETURN_LOCATION = { em_transito: 'InTransit', matriz: 'Headquarters', local: 'Local' };
export const TRANSFER_REQUEST_STATUS = { aguardando_transferencia: 'AwaitingTransfer', em_transferencia: 'InTransfer', concluida: 'Completed', cancelada: 'Canceled' };
export const TRANSFER_LOCATION = { origem: 'Origin', em_transito: 'InTransit', destino: 'Destination' };
export const TRANSFER_NATURE = { venda: 'Sale', transferencia: 'Transfer' };

export const STOCK_MOVEMENT = { recebimento_transferencia: 'TransferReceipt', estorno_recebimento: 'ReceiptReversal' };
export const RFID_MOVEMENT = { venda: 'Sale', devolucao: 'Return', estorno: 'Reversal' };
// contas fixas das lojas (HeadCoach › Financeiro › Contas a Pagar › Contas Fixas das Lojas)
export const FIXED_EXPENSE_TYPE = { ALUGUEL: 'Rent', CONDOMINIO: 'CondoFee', ENERGIA: 'Electricity', AGUA: 'Water', INTERNET: 'Internet', TELEFONE: 'Phone', AGUA_MINERAL: 'DrinkingWater', OUTRA: 'Other' };
export const FIXED_EXPENSE_COLUMN = { ALUGUEL: 'Rent', CONDOMINIO: 'CondoFee', ENERGIA: 'Electricity', AGUA: 'Water', INTERNET: 'Internet', OUTRAS: 'Other' };
export const FIXED_EXPENSE_CHANNEL = { robo_whatsapp: 'WhatsappBot', email_automatico: 'EmailAutomatic', email: 'Email', whatsapp: 'Whatsapp', site: 'Website', loja_envia: 'StoreSends', pix_direto: 'DirectPix', boleto: 'SupplierBankSlip', sob_demanda: 'OnDemand', fora_do_controle: 'OutOfControl', nao_definido: 'Undefined' };
export const FIXED_EXPENSE_BRANCH_TYPE = { matriz: 'Headquarters', loja_rua: 'StreetStore', loja_shopping: 'MallStore', imovel: 'Property' };
// tipo fiscal da peça na nota: produção própria (CFOP 5101/6101…) ou adquirida de terceiros (5102/6102…)
export const ITEM_FISCAL_TYPE = { producao: 'OwnProduction', adquirido: 'Purchased' };

/** ValorDaApi → [valores do banco] (para filtros do tipo enum). */
export const inverso = (mapa) => {
  const out = {};
  for (const [banco, api] of Object.entries(mapa)) {
    const v = /^\d+$/.test(banco) ? Number(banco) : banco;
    (out[api] = out[api] || []).push(v);
  }
  return out;
};
