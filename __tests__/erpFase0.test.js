// Testes da fundação do ERP (fase 0): mapeamentos TOTVS → tabelas erp_*,
// classificação de erro do cliente TOTVS (retry × definitivo) e modo por módulo.
import { jest } from '@jest/globals';

process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-key';
process.env.TOTVS_CLIENT_ID = 'x';
process.env.TOTVS_CLIENT_SECRET = 'x';
process.env.TOTVS_USERNAME = 'x';
process.env.TOTVS_PASSWORD = 'x';

const { TotvsHttpError } = await import('../services/erp/totvsClient.js');
const { mapPessoa, mapProduto, mapCodigosBarras, ORDEM, ENTIDADES } = await import('../services/erp/sync/entidades.js');
const { HANDLERS, OPERACOES } = await import('../services/erp/outboxHandlers.js');

describe('TotvsHttpError.retryable', () => {
  test('5xx, 408, 429 e erro de rede valem nova tentativa', () => {
    expect(new TotvsHttpError('x', { status: 503 }).retryable).toBe(true);
    expect(new TotvsHttpError('x', { status: 500 }).retryable).toBe(true);
    expect(new TotvsHttpError('x', { status: 408 }).retryable).toBe(true);
    expect(new TotvsHttpError('x', { status: 429 }).retryable).toBe(true);
    expect(new TotvsHttpError('x', {}).retryable).toBe(true);
  });
  test('400/404/422 são definitivos (precisam de correção humana)', () => {
    expect(new TotvsHttpError('x', { status: 400 }).retryable).toBe(false);
    expect(new TotvsHttpError('x', { status: 404 }).retryable).toBe(false);
    expect(new TotvsHttpError('x', { status: 422 }).retryable).toBe(false);
  });
});

describe('mapPessoa', () => {
  const pf = {
    code: 31385,
    cpf: '065.379.644-74',
    isInactive: false,
    gender: 'Male',
    birthDate: '1998-01-16T00:00:00',
    branchInsertCode: 4,
    name: 'YAGO MATIAS',
    insertDate: '2024-04-08T15:29:57',
    maxChangeFilterDate: '2026-10-17T10:56:27',
    isCustomer: true,
    isSupplier: true,
    isEmployee: true,
    customerStatus: 'Ativo',
    addresses: [{ addressTypeCode: 2, cityName: 'NATAL', stateAbbreviation: 'RN', cep: '59030-430', ibgeCityCode: 2408102 }],
    phones: [{ typeName: 'WHATSAPP', number: '(84) 98718-7425', isDefault: true }],
    emails: [{ email: 'y@x.com', isDefault: true }],
    classifications: [{ typeCode: 20, code: '1', name: 'VAREJO' }],
  };
  test('PF: chave natural, documento só dígitos, contato e endereço', () => {
    const r = mapPessoa(pf, 'PF');
    expect(r.code).toBe(31385);
    expect(r.tipo).toBe('PF');
    expect(r.cpf_cnpj).toBe('06537964474');
    expect(r.nascimento).toBe('1998-01-16');
    expect(r.whatsapp).toBe('84987187425');
    expect(r.telefone).toBe('84987187425');
    expect(r.email).toBe('y@x.com');
    expect(r.cidade).toBe('NATAL');
    expect(r.uf).toBe('RN');
    expect(r.cep).toBe('59030430');
    expect(r.is_funcionario).toBe(true);
    expect(r.inativo).toBe(false);
    expect(r.origem).toBe('totvs');
    expect(r.totvs_alterado_em).toMatch(/^2026-10-17/);
    expect(r.dados).toBe(pf);
  });
  test('PJ: CNPJ, IE, regime e CNAE', () => {
    const r = mapPessoa({ code: 110000001, cnpj: '17.177.680/0001-16', name: 'FERREIRA', numberStateRegistration: '202787702', typeTaxRegime: 'PresumedProfit', codeActivityCnae: 4642701, uf: 'RN' }, 'PJ');
    expect(r.tipo).toBe('PJ');
    expect(r.cpf_cnpj).toBe('17177680000116');
    expect(r.ie).toBe('202787702');
    expect(r.regime_tributario).toBe('PresumedProfit');
    expect(r.cnae).toBe(4642701);
    expect(r.uf).toBe('RN');
    expect(r.genero).toBeNull();
  });
});

describe('mapProduto / mapCodigosBarras', () => {
  const p = {
    productCode: 28960,
    productSku: '7890000289603',
    productName: 'PECAS BIANCA CROSBY BLUSA UNICA U',
    ReferenceCode: '08 001 002',
    referenceId: 99,
    referenceName: 'BLUSA',
    colorCode: 'UN',
    colorName: 'UNICA',
    size: 'U',
    gridCode: 1,
    ncm: '6205.20.00',
    cst: '0',
    cest: null,
    isActive: true,
    isBlocked: false,
    measuredUnit: 'UN',
    barCodes: [{ barCode: '7890000289603', isDefault: true }, { barCode: '3034257BF7F0C2D000000001' }],
  };
  test('produto: NCM só dígitos, referência e SKU', () => {
    const r = mapProduto(p);
    expect(r.code).toBe(28960);
    expect(r.ncm).toBe('62052000');
    expect(r.cst_origem).toBe('0');
    expect(r.referencia_code).toBe('08 001 002');
    expect(r.sku).toBe('7890000289603');
    expect(r.tamanho).toBe('U');
    expect(r.ativo).toBe(true);
  });
  test('códigos de barras: EAN e EPC RFID identificados, sem duplicar o SKU', () => {
    const r = mapCodigosBarras(p);
    expect(r).toHaveLength(2);
    expect(r.find((x) => x.codigo === '7890000289603')).toMatchObject({ tipo: 'EAN', principal: true, produto_code: 28960 });
    expect(r.find((x) => x.codigo === '3034257BF7F0C2D000000001')).toMatchObject({ tipo: 'RFID' });
  });
  test('sem barCodes expandido usa o SKU como EAN', () => {
    const r = mapCodigosBarras({ productCode: 1, productSku: '7890009000011', barCodes: null });
    expect(r).toEqual([{ produto_code: 1, codigo: '7890009000011', tipo: 'EAN', principal: true, origem: 'totvs', dados: null }]);
  });
});

describe('registro de entidades e handlers', () => {
  test('toda entidade da ORDEM existe e tem full()', () => {
    for (const nome of ORDEM) {
      expect(ENTIDADES[nome]).toBeDefined();
      expect(typeof ENTIDADES[nome].full).toBe('function');
      expect(ENTIDADES[nome].nome).toBe(nome);
    }
  });
  test('dependências aparecem antes na ORDEM', () => {
    for (const nome of ORDEM) {
      for (const dep of ENTIDADES[nome].dependeDe || []) {
        expect(ORDEM.indexOf(dep)).toBeLessThan(ORDEM.indexOf(nome));
      }
    }
  });
  test('handlers do outbox cobrem as escritas conhecidas no TOTVS', () => {
    for (const op of ['ap.duplicata.criar', 'ar.titulo.baixar', 'pessoa.pf.salvar', 'pessoa.pj.salvar', 'venda.transacao.criar', 'bonus.consumir', 'bonus.conceder', 'voucher.criar', 'totvs.http']) {
      expect(typeof HANDLERS[op]).toBe('function');
    }
    expect(OPERACOES.length).toBeGreaterThanOrEqual(15);
  });
  test('totvs.http exige method e path', async () => {
    await expect(HANDLERS['totvs.http']({})).rejects.toThrow(/method/);
  });
});

// jest é referenciado para manter o import ESM explícito
void jest;
