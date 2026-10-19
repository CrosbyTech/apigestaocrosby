// Contas a receber (fase 1): mapeamento DocumentModel → accounts_receivable_documents,
// identificação dos comandos de escrita e registro da entidade no sync.
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-key';
process.env.TOTVS_CLIENT_ID = 'x';
process.env.TOTVS_CLIENT_SECRET = 'x';
process.env.TOTVS_USERNAME = 'x';
process.env.TOTVS_PASSWORD = 'x';

const { mapTitulo, comandoDoPath, titulosDoComando, PAGE_SIZE, EXPAND, SEARCH_PATH } = await import('../services/erp/contasReceber.js');
const { ENTIDADES, ORDEM } = await import('../services/erp/sync/entidades.js');
const { ENTIDADES_DELTA, ENTIDADES_PEQUENAS, ENTIDADES_COM_CRON_PROPRIO } = await import('../services/erp/sync/runner.js');

// item real de accounts-receivable/v2/documents/search (17/10/2026)
const ITEM = {
  branchCode: 1,
  customerCode: 253,
  customerCpfCnpj: '31.451.811/0001-32',
  receivableCode: 253614,
  installmentCode: 1,
  maxChangeFilterDate: '2026-10-14T08:40:00',
  expiredDate: '2026-10-12',
  paymentDate: '2026-10-14',
  issueDate: '2026-09-25',
  settlementBranchCode: 1,
  settlementDate: '2026-10-14',
  settlementSequence: 1175148,
  status: 1,
  documentType: 1,
  billingType: 12,
  dischargeType: 1,
  chargeType: 1,
  originInstallment: null,
  bearerCode: 1098,
  bearerName: 'BAIXADO POR SOLICITACAO DA EMPRESA',
  installmentValue: 1122.23,
  paidValue: 1122.23,
  netValue: null,
  discountValue: 0,
  rebateValue: null,
  interestValue: 0,
  assessmentValue: 0,
  barCode: '74894159700001123211126205905922070201505107',
  digitableLine: '74891126280590592207502015051077415970000112321',
  ourNumber: 26205905,
  dacOurNumber: '9',
  qrCodePix: null,
  dischargeUser: 799998,
  registrationUser: 159,
  chargeAccount: null,
  calculatedValues: null,
  check: null,
  invoice: [{ branchCode: 1, invoiceSequence: 731249, invoiceDate: '2026-09-25', invoiceCode: 4381 }],
  commissions: null,
  classifications: [],
};

describe('mapTitulo', () => {
  const r = mapTitulo(ITEM);
  test('chave = filial + cliente + título + parcela', () => {
    expect(r).toMatchObject({ branch_code: 1, customer_code: 253, receivable_code: 253614, installment_code: 1 });
  });
  test('campos da API em snake_case, datas como DATE e valores numéricos', () => {
    expect(r).toMatchObject({
      customer_cpf_cnpj: '31451811000132',
      expired_date: '2026-10-12',
      payment_date: '2026-10-14',
      issue_date: '2026-09-25',
      settlement_branch_code: 1,
      settlement_sequence: 1175148,
      status: 1,
      document_type: 1,
      billing_type: 12,
      discharge_type: 1,
      charge_type: 1,
      bearer_code: 1098,
      installment_value: 1122.23,
      paid_value: 1122.23,
      our_number: 26205905,
      dac_our_number: '9',
      digitable_line: '74891126280590592207502015051077415970000112321',
      max_change_filter_date: '2026-10-14T08:40:00',
    });
    expect(r.invoice).toEqual(ITEM.invoice);
    expect(r.classifications).toEqual([]);
  });
  test('campo `check` da API vira check_data; não envia origem', () => {
    expect(r).toHaveProperty('check_data', null);
    expect(r).not.toHaveProperty('check');
    expect(r).not.toHaveProperty('origem');
  });
});

describe('comandos de escrita', () => {
  test('caminhos espelhados (bank-slip é consulta e fica fora)', () => {
    expect(comandoDoPath('/accounts-receivable/v2/invoices-payment')).toBe('invoices-payment');
    expect(comandoDoPath('/accounts-receivable/v2/documents/change-charge-type')).toBe('change-charge-type');
    expect(comandoDoPath('/accounts-receivable/v2/payment-link')).toBe('payment-link');
    expect(comandoDoPath('/accounts-receivable/v2/bank-slip')).toBeNull();
    expect(comandoDoPath('/accounts-receivable/v2/documents/search')).toBeNull();
  });
  test('títulos afetados por uma baixa (InvoicesPaymentCommand)', () => {
    const t = titulosDoComando('invoices-payment', {
      branchCode: 99,
      invoices: [{ branchCode: 5, customerCode: 10, receivableCode: 300, installmentCode: 2, paidValue: 50 }],
    });
    expect(t).toEqual([{ branchCode: 5, customerCode: 10, receivableCode: 300, installmentCode: 2 }]);
  });
  test('PIX/payment-link usa installmentNumber e CPF/CNPJ', () => {
    const t = titulosDoComando('payment-link', { branchCode: 551, customerCpfCnpj: '123.456.789-09', receivableCode: 7, installmentNumber: 3 });
    expect(t[0]).toMatchObject({ branchCode: 551, customerCpfCnpj: '12345678909', receivableCode: 7, installmentCode: 3 });
  });
});

describe('entidade contas_receber', () => {
  test('registrada com full e delta e cron próprio', () => {
    expect(ENTIDADES.contas_receber).toBeDefined();
    expect(typeof ENTIDADES.contas_receber.delta).toBe('function');
    expect(ORDEM).toContain('contas_receber');
    expect(ENTIDADES_COM_CRON_PROPRIO).toContain('contas_receber');
    expect(ENTIDADES_DELTA).not.toContain('contas_receber');
    expect(ENTIDADES_PEQUENAS).not.toContain('contas_receber');
  });
  test('constantes da API', () => {
    expect(SEARCH_PATH).toBe('/accounts-receivable/v2/documents/search');
    expect(PAGE_SIZE).toBe(1000);
    expect(EXPAND).toBe('invoice,classifications');
  });
});
