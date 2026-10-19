// Contas a pagar (fase 1): mapeamento DuplicateOutModel → accounts_payable_duplicates
// e registro da entidade no sync.
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-key';
process.env.TOTVS_CLIENT_ID = 'x';
process.env.TOTVS_CLIENT_SECRET = 'x';
process.env.TOTVS_USERNAME = 'x';
process.env.TOTVS_PASSWORD = 'x';

const { mapDuplicata, PAGE_SIZE, SEARCH_PATH, MARCO_ZERO } = await import('../services/erp/contasPagar.js');
const { ENTIDADES, ORDEM } = await import('../services/erp/sync/entidades.js');
const { ENTIDADES_DELTA, ENTIDADES_PEQUENAS, ENTIDADES_COM_CRON_PROPRIO } = await import('../services/erp/sync/runner.js');

// item real devolvido por accounts-payable/v2/duplicates/search (17/10/2026)
const ITEM = {
  maxChangeFilterDate: '2026-10-14T18:00:11',
  branchCode: 1,
  duplicateCode: 7030165243,
  supplierCode: 96,
  supplierCpfCnpj: '02.952.192/0001-61',
  installmentCode: 7,
  bearerCode: 5,
  entryDate: '2026-10-09T00:00:00',
  issueDate: '2026-09-09T00:00:00',
  dueDate: '2026-10-09T00:00:00',
  settlementDate: null,
  arrivalDate: '2026-10-09T00:00:00',
  status: 'N',
  duplicateValue: 121.49,
  feesValue: 0,
  discountValue: 0,
  paidValue: 0,
  expense: [{ expenseCode: 6028, expenseName: 'INTERNET', costCenterCode: 37, proratedPercentage: 100, proratedValue: 121.49 }],
  inclusionType: 1,
  userInclusionCode: 281,
  userInclusionName: 'DANIEL ALVES - FINANCEIRO',
};

describe('mapDuplicata', () => {
  const r = mapDuplicata(ITEM);
  test('chave = filial + fornecedor + duplicata + parcela (nomes da API em snake_case)', () => {
    expect(r).toMatchObject({ branch_code: 1, supplier_code: 96, duplicate_code: 7030165243, installment_code: 7 });
  });
  test('campos do DuplicateOutModel preservados', () => {
    expect(r).toMatchObject({
      supplier_cpf_cnpj: '02952192000161',
      bearer_code: 5,
      entry_date: '2026-10-09T00:00:00',
      issue_date: '2026-09-09T00:00:00',
      due_date: '2026-10-09T00:00:00',
      settlement_date: null,
      arrival_date: '2026-10-09T00:00:00',
      status: 'N',
      duplicate_value: 121.49,
      fees_value: 0,
      discount_value: 0,
      paid_value: 0,
      inclusion_type: 1,
      user_inclusion_code: 281,
      user_inclusion_name: 'DANIEL ALVES - FINANCEIRO',
      max_change_filter_date: '2026-10-14T18:00:11',
    });
    expect(r.expense).toEqual(ITEM.expense);
    expect(r.dados).toBe(ITEM);
  });
  test('não envia origem (preserva headcoach em linhas criadas pelo HeadCoach)', () => {
    expect(r).not.toHaveProperty('origem');
  });
  test('nulos e ausentes viram null; expense ausente vira []', () => {
    const m = mapDuplicata({ branchCode: 2, supplierCode: 3, duplicateCode: 4, installmentCode: 1 });
    expect(m.paid_value).toBeNull();
    expect(m.due_date).toBeNull();
    expect(m.expense).toEqual([]);
    expect(m.supplier_cpf_cnpj).toBeNull();
  });
});

describe('entidade contas_pagar', () => {
  test('registrada, com full e delta, depois de empresas', () => {
    expect(ENTIDADES.contas_pagar).toBeDefined();
    expect(typeof ENTIDADES.contas_pagar.full).toBe('function');
    expect(typeof ENTIDADES.contas_pagar.delta).toBe('function');
    expect(ORDEM.indexOf('contas_pagar')).toBeGreaterThan(ORDEM.indexOf('empresas'));
  });
  test('tem cron próprio: fora do delta horário e do full diário das dimensões', () => {
    expect(ENTIDADES_COM_CRON_PROPRIO).toContain('contas_pagar');
    expect(ENTIDADES_DELTA).not.toContain('contas_pagar');
    expect(ENTIDADES_PEQUENAS).not.toContain('contas_pagar');
  });
  test('constantes da API', () => {
    expect(PAGE_SIZE).toBe(100);
    expect(SEARCH_PATH).toBe('/accounts-payable/v2/duplicates/search');
    expect(new Date(MARCO_ZERO).toISOString()).toBe('2026-10-17T03:00:00.000Z');
  });
});
