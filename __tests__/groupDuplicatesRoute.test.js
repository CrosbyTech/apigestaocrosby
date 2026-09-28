/**
 * Teste da rota POST /api/totvs/accounts-payable/duplicates/group
 * (proxy do TOTVS /accounts-payable/v2/group-duplicates) com axios e token mockados.
 */
import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

const posts = [];
let respostaTotvs = () => ({ status: 200, data: { ok: true } });
const axiosMock = {
  post: jest.fn(async (url, body, config) => {
    posts.push({ url, body, auth: config?.headers?.Authorization });
    return respostaTotvs(posts.length);
  }),
  get: jest.fn(),
};

const tokens = [];
jest.unstable_mockModule('axios', () => ({ default: axiosMock }));
jest.unstable_mockModule('../utils/totvsTokenManager.js', () => ({
  getToken: async (force) => {
    tokens.push(!!force);
    return { access_token: force ? 'novo' : 'antigo' };
  },
  getTokenInfo: () => ({}),
}));
jest.unstable_mockModule('../totvsrouter/totvsHelper.js', () => ({
  httpsAgent: undefined,
  httpAgent: undefined,
  TOTVS_BASE_URL: 'https://totvs.test/api/totvsmoda',
  TOTVS_AUTH_ENDPOINT: 'https://totvs.test/token',
  getBranchCodes: async () => [1],
}));

const { default: router } = await import('../totvsrouter/financeiro.js');
const app = express();
app.use(express.json());
app.use('/api/totvs', router);

const URL = '/api/totvs/accounts-payable/duplicates/group';
const bodyOk = () => ({
  branchCnpj: '11.222.333/0001-81',
  supplierCpfCnpj: '22333444000182',
  duplicateCode: '9001',
  document: 'Duplicate',
  dueDate: '2026-10-15',
  groupInstallments: [
    { duplicateCode: 123, installmentCode: 1 },
    { branchCnpj: '11222333000181', supplierCpfCnpj: '22333444000182', duplicateCode: 124, installmentCode: '2' },
  ],
});

const httpError = (status, data) => {
  const e = new Error(`HTTP ${status}`);
  e.response = { status, data };
  return e;
};

describe('POST /api/totvs/accounts-payable/duplicates/group', () => {
  beforeEach(() => {
    posts.length = 0;
    tokens.length = 0;
    respostaTotvs = () => ({ status: 200, data: { ok: true } });
  });

  test('normaliza e envia o payload no formato GroupDuplicatesCommand', async () => {
    const r = await request(app).post(URL).send(bodyOk());
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
    expect(r.body.data.totvsStatus).toBe(200);
    expect(r.body.data.totvsResponse).toEqual({ ok: true });

    expect(posts).toHaveLength(1);
    expect(posts[0].url).toBe('https://totvs.test/api/totvsmoda/accounts-payable/v2/group-duplicates');
    expect(posts[0].auth).toBe('Bearer antigo');
    expect(posts[0].body).toEqual({
      branchCnpj: '11222333000181',
      supplierCpfCnpj: '22333444000182',
      duplicateCode: 9001, // string numérica → inteiro
      document: 1, // 'Duplicate' → inteiro
      dueDate: '2026-10-15T15:00:00.000Z', // único horário aceito pelo TOTVS
      groupInstallments: [
        { branchCnpj: '11222333000181', supplierCpfCnpj: '22333444000182', duplicateCode: 123, installmentCode: 1 },
        { branchCnpj: '11222333000181', supplierCpfCnpj: '22333444000182', duplicateCode: 124, installmentCode: 2 },
      ],
    });
  });

  test('aceita document FreightBill e dueDate completa', async () => {
    const r = await request(app).post(URL).send({ ...bodyOk(), document: 'FreightBill', dueDate: '2026-09-16T18:13:57.949Z' });
    expect(r.status).toBe(200);
    expect(posts[0].body.document).toBe(18);
    expect(posts[0].body.dueDate).toBe('2026-09-16T15:00:00.000Z');
  });

  test.each([
    ['branchCnpj inválido', { branchCnpj: '123' }, /branchCnpj/],
    ['supplierCpfCnpj inválido', { supplierCpfCnpj: '' }, /supplierCpfCnpj/],
    ['duplicateCode ausente', { duplicateCode: '' }, /duplicateCode/],
    ['duplicateCode não numérico', { duplicateCode: 'AGR001' }, /inteiro positivo/],
    ['duplicateCode longo', { duplicateCode: '12345678901' }, /10 dígitos/],
    ['dueDate ausente', { dueDate: null }, /dueDate/],
    ['sem parcelas', { groupInstallments: [] }, /groupInstallments/],
    ['parcela sem duplicateCode', { groupInstallments: [{ installmentCode: 1 }] }, /groupInstallments\[0\]\.duplicateCode/],
    ['parcela com installmentCode inválido', { groupInstallments: [{ duplicateCode: 1, installmentCode: 0 }] }, /installmentCode/],
  ])('valida: %s', async (_nome, patch, msg) => {
    const r = await request(app).post(URL).send({ ...bodyOk(), ...patch });
    expect(r.status).toBe(400);
    expect(r.body.success).toBe(false);
    expect(r.body.message).toMatch(msg);
    expect(posts).toHaveLength(0);
  });

  test('renova o token e reenvia quando o TOTVS responde 401', async () => {
    respostaTotvs = (n) => {
      if (n === 1) throw httpError(401, 'expired');
      return { status: 200, data: { ok: true } };
    };
    const r = await request(app).post(URL).send(bodyOk());
    expect(r.status).toBe(200);
    expect(posts).toHaveLength(2);
    expect(posts[1].auth).toBe('Bearer novo');
    expect(tokens).toEqual([false, true]);
  });

  test('repassa erro de negócio do TOTVS com status e detalhes', async () => {
    respostaTotvs = () => {
      throw httpError(400, { message: 'Parcela já quitada', code: 'X' });
    };
    const r = await request(app).post(URL).send(bodyOk());
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({
      success: false,
      error: 'TOTVS_API_ERROR',
      message: 'Parcela já quitada',
      details: { message: 'Parcela já quitada', code: 'X' },
    });
    expect(posts).toHaveLength(1);
  });

  test('erro de conexão vira 503', async () => {
    respostaTotvs = () => {
      const e = new Error('connect ECONNREFUSED');
      e.code = 'ECONNREFUSED';
      e.request = {};
      throw e;
    };
    const r = await request(app).post(URL).send(bodyOk());
    expect(r.status).toBe(503);
    expect(r.body.message).toMatch(/recusada/);
  });
});
