// Conferência TOTVS × HeadCoach: regra de igualdade, empresas e definição dos módulos.
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-key';
process.env.TOTVS_CLIENT_ID = 'x';
process.env.TOTVS_CLIENT_SECRET = 'x';
process.env.TOTVS_USERNAME = 'x';
process.env.TOTVS_PASSWORD = 'x';

const { iguais, resolverEmpresas, MODULOS, listarModulos } = await import('../services/erp/comparacao.js');
const { mapDuplicata } = await import('../services/erp/contasPagar.js');
const { mapTitulo } = await import('../services/erp/contasReceber.js');
const { mapTransacao } = await import('../services/erp/vendas.js');
const { FILIAIS } = await import('../config/sefazFiliais.js');

describe('iguais (regra de conferência)', () => {
  test('números com tolerância de centavo e tipos diferentes', () => {
    expect(iguais(121.49, '121.49')).toBe(true);
    expect(iguais(121.49, 121.494)).toBe(true);
    expect(iguais(121.49, 121.5)).toBe(false);
    expect(iguais(0, null)).toBe(false);
    expect(iguais(null, undefined)).toBe(true);
  });
  test('texto ignora espaço nas pontas; datas comparam como texto', () => {
    expect(iguais('UN ', 'UN')).toBe(true);
    expect(iguais('2026-10-09T00:00:00', '2026-10-09T00:00:00')).toBe(true);
    expect(iguais('2026-10-09', '2026-10-10')).toBe(false);
  });
  test('JSON ignora a ordem das chaves (o Postgres reordena o jsonb)', () => {
    expect(iguais([{ expenseCode: 1, costCenterCode: 2 }], [{ costCenterCode: 2, expenseCode: 1 }])).toBe(true);
    expect(iguais([{ expenseCode: 1 }], [{ expenseCode: 2 }])).toBe(false);
    expect(iguais([], null)).toBe(false);
  });
});

describe('resolverEmpresas', () => {
  test('todas → null (sem filtro); próprias → config/sefazFiliais; lista → inteiros únicos', async () => {
    expect(await resolverEmpresas(null)).toBeNull();
    expect(await resolverEmpresas('todas')).toBeNull();
    expect(await resolverEmpresas('proprias')).toEqual(FILIAIS.map((f) => f.codigo));
    expect(await resolverEmpresas('95, 99,95,x')).toEqual([95, 99]);
    expect(await resolverEmpresas([1, '2'])).toEqual([1, 2]);
    expect(await resolverEmpresas('abc')).toBeNull();
  });
});

describe('módulos', () => {
  const amostra = {
    contas_pagar: mapDuplicata({ branchCode: 1, supplierCode: 2, duplicateCode: 3, installmentCode: 1, duplicateValue: 10, status: 'N', issueDate: '2026-10-01T00:00:00', expense: [] }),
    contas_receber: mapTitulo({ branchCode: 1, customerCode: 2, receivableCode: 3, installmentCode: 1, installmentValue: 10, status: 1, issueDate: '2026-10-01' }),
    transacoes: mapTransacao({ branchCode: 1, transactionCode: 3, totalValue: 10, status: 4, transactionDate: '2026-10-01' }),
  };
  test('chave, data e valor de cada módulo existem no mapeamento da API', () => {
    for (const [id, def] of Object.entries(MODULOS)) {
      const row = amostra[id];
      for (const c of [...def.chave, def.campoData, def.campoValor]) expect(row).toHaveProperty(c);
      for (const c of def.campos) expect(row).toHaveProperty(c);
    }
  });
  test('listarModulos expõe os três módulos com limite de dias', () => {
    const m = listarModulos();
    expect(m.map((x) => x.id)).toEqual(['contas_pagar', 'contas_receber', 'transacoes']);
    expect(m.find((x) => x.id === 'transacoes').precisaEmpresa).toBe(true);
    for (const x of m) expect(x.maxDias).toBeGreaterThan(0);
  });
});
