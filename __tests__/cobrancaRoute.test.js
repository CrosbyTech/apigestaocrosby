/**
 * Teste da rota GET /api/cobranca/inadimplentes com TOTVS e Supabase
 * simulados: parâmetros, autenticação, cache, precedência de canal e formatos.
 */
import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

// ─── Mocks ───────────────────────────────────────────────────────────────────
const HOJE = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Fortaleza' });
const ontem = (() => {
  const d = new Date(`${HOJE}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
})();

const chamadas = [];
const axiosMock = {
  get: jest.fn(async (url, { params } = {}) => {
    chamadas.push({ url, params });
    if (url.endsWith('/franchise-clients')) return { data: { success: true, data: [{ code: 10, name: 'FRQ DEZ', cnpj: '11222333000181' }] } };
    if (url.endsWith('/multibrand-clients')) return { data: { success: true, data: [{ code: 10, name: 'TAMBEM MTM' }, { code: 20, name: 'MTM VINTE', cnpj: '22333444000182' }] } };
    if (url.endsWith('/reseller-clients')) return { data: { success: true, data: [{ code: 30, name: 'REV TRINTA', cpf: '12345678901', personType: 'PF' }] } };
    if (url.endsWith('/bluecred/clientes')) return { data: { success: true, data: { codes: [40, 3591] } } };
    if (url.endsWith('/accounts-receivable/filter')) {
      const cods = String(params.cd_cliente).split(',').map(Number);
      const linha = (cd_cliente, extra) => ({
        cd_empresa: 1, cd_cliente, nr_fat: 1000 + cd_cliente, nr_parcela: 1, tp_documento: 1,
        dt_emissao: '2026-01-10T00:00:00', dt_vencimento: '2026-02-10T00:00:00',
        vl_fatura: 100, vl_juros: 1, vl_multa: 2, vl_pago: 0, dt_liq: null,
        cd_portador: 748, nm_portador: 'SICREDI', linha_digitavel: '1'.repeat(47), ...extra,
      });
      const items = [];
      for (const c of cods) {
        items.push(linha(c));
        if (c === 20) items.push(linha(c, { nr_fat: 2020, dt_vencimento: ontem })); // 1 dia de atraso
        if (c === 40) items.push(linha(c, { nr_fat: 4040, cd_empresa: 551 })); // filial fora do BlueCred
        if (c === 30) items.push(linha(c, { nr_fat: 3030, dt_vencimento: HOJE })); // vence hoje
      }
      return { data: { success: true, data: { items } } };
    }
    throw new Error(`GET inesperado: ${url}`);
  }),
  post: jest.fn(async (url, body) => {
    if (url.endsWith('/persons/batch-lookup')) {
      const r = {};
      for (const c of body.personCodes) r[c] = { name: `NOME ${c}`, fantasyName: `F${c}`, phone: c === 40 ? '' : '85 9 8888 00' + String(c).padStart(2, '0'), uf: 'CE' };
      return { data: { success: true, data: r } };
    }
    throw new Error(`POST inesperado: ${url}`);
  }),
};

const tabelas = {
  call_center_contatos: [{ cd_cliente: '20', telefone: '(11) 97777-6666' }],
  classificacoes_inadimplentes: [{ cd_cliente: 20, representante: 'WALTER' }],
  esteira_protesto: [{ cd_empresa: 1, nr_fat: '1010', nr_parcela: 1 }],
};
const supabaseMock = {
  from: (tabela) => ({
    select: () => ({
      range: async (de, ate) => ({ data: (tabelas[tabela] || []).slice(de, ate + 1), error: null }),
    }),
  }),
};

jest.unstable_mockModule('axios', () => ({ default: axiosMock }));
jest.unstable_mockModule('../config/supabase.js', () => ({ default: supabaseMock }));
jest.unstable_mockModule('../utils/totvsTokenManager.js', () => ({ getToken: async () => ({ access_token: 'x' }) }));
jest.unstable_mockModule('../totvsrouter/totvsHelper.js', () => ({
  getBranchesWithNames: async () => [{ code: 1, name: 'CROSBY MATRIZ' }],
}));

const { default: router } = await import('../routes/cobranca.routes.js');
const app = express();
app.use('/api/cobranca', router);

// ─── Testes ──────────────────────────────────────────────────────────────────
describe('GET /api/cobranca/inadimplentes', () => {
  beforeEach(() => {
    delete process.env.COBRANCA_API_TOKEN;
    chamadas.length = 0;
  });

  test('monta os devedores dos 4 canais com precedência, filial e telefone corretos', async () => {
    const r = await request(app).get('/api/cobranca/inadimplentes?refresh=1');
    expect(r.status).toBe(200);
    const d = r.body.data;
    expect(d.hoje).toBe(HOJE);
    expect(d.cached).toBe(false);
    expect(d.resumo.clientes).toBe(4);
    // consulta ao contas a receber só com FATURA, em aberto, até hoje
    const ar = chamadas.find((c) => c.url.endsWith('/accounts-receivable/filter'));
    expect(ar.params).toMatchObject({ tp_documento: '1', situacao: '1', status: 'Em Aberto', dt_fim: HOJE });
    expect(ar.params.cd_cliente.split(',')).not.toContain('3591'); // cliente de teste fora

    const por = Object.fromEntries(d.clientes.map((c) => [c.cd_cliente, c]));
    expect(por[10].canal).toBe('FRANQUIAS'); // está em FRQ e MTM → FRQ vence
    expect(por[20].canal).toBe('MTM');
    expect(por[30].canal).toBe('REVENDA');
    expect(por[40].canal).toBe('BLUECRED');

    expect(por[20].qtd_titulos).toBe(2);
    expect(por[20].titulos.map((t) => t.dias_atraso)).toContain(1);
    expect(por[20].telefone_whatsapp).toBe('5511977776666'); // manual do Call Center
    expect(por[20].telefone_origem).toBe('call_center');
    expect(por[20].representante).toBe('WALTER');

    expect(por[30].qtd_titulos).toBe(1); // a que vence hoje não entra
    expect(por[30].tipo_pessoa).toBe('PF');
    expect(por[40].qtd_titulos).toBe(1); // filial 551 fora
    expect(por[40].telefone_whatsapp).toBeNull();
    expect(por[10].titulos[0].em_protesto).toBe(true);
    expect(por[10].titulos[0].nm_empresa).toBe('CROSBY MATRIZ');
    expect(por[10].titulos[0]).toMatchObject({
      nr_fatura: 1010, nr_parcela: 1, dt_emissao: '2026-01-10', dt_vencimento: '2026-02-10',
      vl_fatura: 100, vl_juros: 1, vl_multa: 2, cd_portador: 748,
    });
  });

  test('segunda chamada vem do cache e filtros pós-cache funcionam', async () => {
    const r = await request(app).get('/api/cobranca/inadimplentes?com_telefone=1&dias_min=2&formato=titulos');
    expect(r.status).toBe(200);
    expect(r.body.data.cached).toBe(true);
    expect(chamadas).toHaveLength(0); // nada foi ao TOTVS
    const t = r.body.data.titulos;
    expect(t.every((x) => x.telefone_whatsapp)).toBe(true);
    expect(t.every((x) => x.dias_atraso >= 2)).toBe(true);
    expect(t.map((x) => x.cd_cliente).sort()).toEqual([10, 20, 30]);
    expect(t[0]).toHaveProperty('nr_fatura');
    expect(t[0]).toHaveProperty('nm_cliente');
  });

  test('canal específico consulta só aquela lista', async () => {
    const r = await request(app).get('/api/cobranca/inadimplentes?canal=bluecred&refresh=1');
    expect(r.status).toBe(200);
    expect(r.body.data.parametros.canais).toEqual(['BLUECRED']);
    expect(chamadas.filter((c) => c.url.includes('-clients'))).toHaveLength(0);
    expect(r.body.data.clientes.map((c) => c.cd_cliente)).toEqual([40]);
  });

  test('valida canal e situacao', async () => {
    expect((await request(app).get('/api/cobranca/inadimplentes?canal=varejo')).status).toBe(400);
    expect((await request(app).get('/api/cobranca/inadimplentes?situacao=x')).status).toBe(400);
  });

  test('exige token quando COBRANCA_API_TOKEN está definido', async () => {
    process.env.COBRANCA_API_TOKEN = 'segredo';
    expect((await request(app).get('/api/cobranca/inadimplentes')).status).toBe(401);
    expect((await request(app).get('/api/cobranca/inadimplentes').set('x-api-key', 'segredo')).status).toBe(200);
    expect(
      (await request(app).get('/api/cobranca/inadimplentes').set('Authorization', 'Bearer segredo')).status,
    ).toBe(200);
  });
});
