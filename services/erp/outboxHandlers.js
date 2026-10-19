// Handlers do outbox: operação → chamada no TOTVS.
// payload é o corpo exatamente como o TOTVS espera (montado por quem enfileira).
// Cada handler devolve { http_status, resposta }.
import { totvs } from './totvsClient.js';

const post = (path) => async (payload) => ({ http_status: 200, resposta: await totvs('post', path, { data: payload }) });

export const HANDLERS = {
  // Genérico: { method, path, body?, params? }
  'totvs.http': async (payload) => {
    if (!payload?.method || !payload?.path) throw new Error('totvs.http exige payload.method e payload.path');
    return { http_status: 200, resposta: await totvs(payload.method, payload.path, { data: payload.body, params: payload.params }) };
  },

  // Contas a pagar
  'ap.duplicata.criar': post('/accounts-payable/v2/duplicates'),
  'ap.duplicata.agrupar': post('/accounts-payable/v2/group-duplicates'),

  // Contas a receber
  'ar.titulo.baixar': post('/accounts-receivable/v2/invoices-payment'),
  'ar.titulo.tipo-cobranca': post('/accounts-receivable/v2/documents/change-charge-type'),
  'ar.boleto.gerar': post('/accounts-receivable/v2/bank-slip'),
  'ar.pix.gerar': post('/accounts-receivable/v2/payment-link'),

  // Pessoas
  'pessoa.pf.salvar': post('/person/v2/individual-customers'),
  'pessoa.pj.salvar': post('/person/v2/legal-customers'),

  // Vendas / PDV
  'venda.transacao.criar': post('/general/v2/transactions'),
  'venda.transacao.receber': post('/general/v2/transaction-receiving'),
  'bonus.consumir': post('/person/v2/bonus-consume'),
  'bonus.conceder': post('/person/v2/bonus-due-date'),

  // Vouchers
  'voucher.criar': post('/voucher/v2/create'),
  'voucher.alterar': post('/voucher/v2/update'),
  'voucher.cliente.criar': post('/voucher/v2/customer/create'),
};

export const OPERACOES = Object.keys(HANDLERS);
