// Vendas (fase 1): transações, saldo de bônus/cashback e vouchers no formato da API.
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-key';
process.env.TOTVS_CLIENT_ID = 'x';
process.env.TOTVS_CLIENT_SECRET = 'x';
process.env.TOTVS_USERNAME = 'x';
process.env.TOTVS_PASSWORD = 'x';

const { mapTransacao, janelas, comandoVendasDoUrl, transacaoDaResposta, PAGE_SIZE, JANELA_MAX_DIAS } = await import('../services/erp/vendas.js');
const { linhasDeSaldo } = await import('../services/erp/bonus.js');
const { mapVoucher, comandoVoucherDoUrl } = await import('../services/erp/vouchers.js');
const { ehErroDeRegistro, TotvsHttpError } = await import('../services/erp/totvsClient.js');
const { ENTIDADES, ORDEM } = await import('../services/erp/sync/entidades.js');
const { ENTIDADES_COM_CRON_PROPRIO, ENTIDADES_DELTA } = await import('../services/erp/sync/runner.js');

// transação real (filial 95, 17/10/2026)
const TRANSACAO = {
  branchCode: 95,
  transactionCode: 893753,
  transactionDate: '2026-10-13',
  customerCode: 38,
  representativeCode: 0,
  lastchangeDate: '2026-10-17T11:39:21',
  operationCode: 545,
  sellerCode: 168,
  guideCode: null,
  paymentConditionCode: 1,
  priceTableCode: null,
  status: 4,
  grossAmountValue: 120,
  totalValue: 120,
  discountValue: 0,
  maxChangeFilterDate: '2026-10-17T11:39:22',
  classifications: [{ typeCode: 4, typeName: 'MOTIVO DA COMPRA', code: '11', name: 'USAR NO DIA A DIA' }],
  items: [{ productCode: 48126, measuredUnit: 'UN ', quantity: 1, value: 120, unitDiscountValue: 0, netValue: 120, sellerCode: 168, additionalItem: { priceTable: null }, promotionalEngines: null, commissions: null, scannedBarcodes: null }],
  originDestination: null,
  additionalInformation: { simulationPercent: null, simulationValue: null, terminalCode: 1 },
  installment: [{ installmentNumber: 1, dueDate: '2026-10-13T00:00:00', installmentValue: 0 }],
  settlementCode: null,
  modality: null,
  transactionType: null,
  relatedFiscalDocument: null,
};

describe('mapTransacao', () => {
  const r = mapTransacao(TRANSACAO);
  test('chave = empresa + número da transação', () => {
    expect(r).toMatchObject({ branch_code: 95, transaction_code: 893753 });
  });
  test('campos da API em snake_case', () => {
    expect(r).toMatchObject({
      transaction_date: '2026-10-13',
      customer_code: 38,
      operation_code: 545,
      seller_code: 168,
      payment_condition_code: 1,
      status: 4,
      gross_amount_value: 120,
      total_value: 120,
      discount_value: 0,
      lastchange_date: '2026-10-17T11:39:21',
      max_change_filter_date: '2026-10-17T11:39:22',
    });
    expect(r.items).toEqual(TRANSACAO.items);
    expect(r.installment).toEqual(TRANSACAO.installment);
    expect(r.additional_information).toEqual({ simulationPercent: null, simulationValue: null, terminalCode: 1 });
    expect(r).not.toHaveProperty('origem');
  });
  test('items/installment ausentes viram []', () => {
    const m = mapTransacao({ branchCode: 1, transactionCode: 2 });
    expect(m.items).toEqual([]);
    expect(m.installment).toEqual([]);
  });
});

describe('janelas de alteração (API aceita no máximo 31 dias)', () => {
  test('quebra em pedaços de até 30 dias, sem buraco nem sobreposição', () => {
    const j = janelas('2026-01-01T00:00:00Z', '2026-03-15T00:00:00Z');
    expect(j.length).toBe(3);
    for (const [a, b] of j) expect((b - a) / 86400000).toBeLessThanOrEqual(JANELA_MAX_DIAS);
    for (let i = 1; i < j.length; i++) expect(j[i][0].getTime() - j[i - 1][1].getTime()).toBe(1000);
    expect(j[j.length - 1][1].toISOString()).toBe('2026-03-15T00:00:00.000Z');
  });
  test('intervalo curto = uma janela', () => {
    expect(janelas('2026-10-17T03:00:00Z', '2026-10-19T12:00:00Z')).toHaveLength(1);
  });
  test('PageSize máximo da API', () => {
    expect(PAGE_SIZE).toBe(500);
  });
});

describe('escritas do HeadCoach', () => {
  test('caminhos espelhados', () => {
    expect(comandoVendasDoUrl('https://www30.bhan.com.br:9443/api/totvsmoda/general/v2/transactions')).toBe('transactions');
    expect(comandoVendasDoUrl('https://x/api/totvsmoda/general/v2/transaction-receiving')).toBe('transaction-receiving');
    expect(comandoVendasDoUrl('https://x/api/totvsmoda/person/v2/bonus-consume')).toBe('bonus-consume');
    expect(comandoVendasDoUrl('https://x/api/totvsmoda/person/v2/bonus-due-date')).toBe('bonus-due-date');
    expect(comandoVendasDoUrl('https://x/api/totvsmoda/general/v2/transactions/search')).toBeNull();
    expect(comandoVoucherDoUrl('https://x/api/totvsmoda/voucher/v2/create')).toBe('create');
    expect(comandoVoucherDoUrl('https://x/api/totvsmoda/voucher/v2/customer/create')).toBe('customer/create');
    expect(comandoVoucherDoUrl('https://x/api/totvsmoda/voucher/v2/search')).toBeNull();
  });
  test('identifica a transação criada pela resposta ou pelo payload', () => {
    expect(transacaoDaResposta({ branchCode: 95 }, { transactionCode: 900001, transactionDate: '2026-10-19T00:00:00' })).toEqual({ branchCode: 95, transactionCode: 900001, transactionDate: '2026-10-19' });
    expect(transacaoDaResposta({ branchCode: 95, transactionCode: 7, transactionDate: '2026-10-18' }, null)).toEqual({ branchCode: 95, transactionCode: 7, transactionDate: '2026-10-18' });
  });
});

describe('saldo de bônus/cashback', () => {
  test('grava só empresas com saldo ≠ 0', () => {
    const r = linhasDeSaldo('11059738406', {
      balanceBonus: [
        { branchCode: 1, branchCnpj: '17177680000116', balanceValue: 0 },
        { branchCode: 91, branchCnpj: '17.177.680/0013-50', balanceValue: 181.8 },
        { branchCode: 6156, branchCnpj: '57820523000100', balanceValue: 76 },
      ],
    }, 38);
    expect(r.map((x) => [x.branch_code, x.balance_value, x.branch_cnpj])).toEqual([
      [91, 181.8, '17177680001350'],
      [6156, 76, '57820523000100'],
    ]);
    expect(r[0]).toMatchObject({ person_cpf: '11059738406', person_code: 38 });
  });
  test('resposta vazia não gera linha', () => {
    expect(linhasDeSaldo('1', {})).toEqual([]);
  });
});

describe('vouchers', () => {
  test('mapVoucher', () => {
    const r = mapVoucher({ voucherNumber: 85, description: 'CROSBY', prefixCode: 'CROSBY', voucherCode: '00000000064', voucherType: 1, status: 1, value: 48.64, startDate: '2025-06-01T00:00:00', endDate: '2025-06-30T00:00:00', customerCode: 10708, branchs: [{ branchCode: 1 }], triggers: [{ triggerType: 1 }] });
    expect(r).toMatchObject({ voucher_number: 85, voucher_code: '00000000064', status: 1, value: 48.64, customer_code: 10708, end_date: '2025-06-30T00:00:00', removido_em: null });
    expect(r.branchs).toEqual([{ branchCode: 1 }]);
  });
});

describe('registro inválido no TOTVS', () => {
  test('erro de dado de UM registro é isolável; erro de filtro não', () => {
    expect(ehErroDeRegistro(new TotvsHttpError('x → 400: Year, Month, and Day parameters describe an un-representable DateTime.. | Individual 67791 not found.', { status: 400 }))).toBe(true);
    expect(ehErroDeRegistro(new TotvsHttpError('x → 400: Empty field filter.branchCodeList.', { status: 400 }))).toBe(false);
    expect(ehErroDeRegistro(new TotvsHttpError('x → 502: erro', { status: 502 }))).toBe(false);
  });
});

describe('entidades de vendas', () => {
  test('registradas, na ordem certa e com cron próprio', () => {
    for (const n of ['transacoes', 'bonus_saldo', 'vouchers']) {
      expect(ENTIDADES[n]).toBeDefined();
      expect(ENTIDADES_COM_CRON_PROPRIO).toContain(n);
      expect(ENTIDADES_DELTA).not.toContain(n);
    }
    expect(ORDEM.indexOf('transacoes')).toBeLessThan(ORDEM.indexOf('bonus_saldo'));
  });
});
