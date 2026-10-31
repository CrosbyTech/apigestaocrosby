import { describe, it, expect } from '@jest/globals';
import { cpfValido, cnpjValido, normalizarChavePix, finalContaStone, valorDoTitulo, emCentavos, textoAvisoFabio } from '../utils/stoneInclusao.js';
import { incluirPix, documentoConfere } from '../bots/stone-extratos/inclusoes.mjs';

describe('chave Pix', () => {
  it('valida CPF e CNPJ pelo dígito', () => {
    expect(cpfValido('067.041.974-51')).toBe(true);
    expect(cpfValido('067.051.974-51')).toBe(false);
    expect(cnpjValido('27.728.810/0005-49')).toBe(true);
    expect(cnpjValido('27.728.810/0005-48')).toBe(false);
  });

  it.each([
    ['067.041.974-51', { chave: '06704197451', tipo: 'cpf' }],
    ['27.728.810/0005-49', { chave: '27728810000549', tipo: 'cnpj' }],
    ['Financeiro@Crosby.com.br', { chave: 'financeiro@crosby.com.br', tipo: 'email' }],
    ['6A5AF0BA-1111-2222-3333-444455556666', { chave: '6a5af0ba-1111-2222-3333-444455556666', tipo: 'evp' }],
    ['(84) 98718-7425', { chave: '+5584987187425', tipo: 'telefone' }],
    ['+55 84 98718-7425', { chave: '+5584987187425', tipo: 'telefone' }],
  ])('%s', (bruto, esperado) => expect(normalizarChavePix(bruto)).toEqual(esperado));

  it.each([['067.051.974-51'], ['06705197451'], [''], [null], ['123'], ['chave do fornecedor']])('recusa %s', (bruto) => {
    expect(normalizarChavePix(bruto)).toBeNull();
  });
});

describe('título', () => {
  it('só os rótulos novos entram na inclusão', () => {
    expect(finalContaStone('STONE 0549')).toBe('0549');
    expect(finalContaStone('STONE FABIO')).toBeNull();
    expect(finalContaStone('STONE')).toBeNull();
    expect(finalContaStone('SICREDI CROSBY')).toBeNull();
  });

  it('VALOR REAL vale quando preenchido', () => {
    expect(valorDoTitulo({ vl_duplicata: 100, vl_real: 90.5 })).toBe(90.5);
    expect(valorDoTitulo({ vl_duplicata: 100, vl_real: null })).toBe(100);
    expect(emCentavos(1)).toBe(100);
    expect(emCentavos(19.99)).toBe(1999);
  });
});

describe('aviso no grupo', () => {
  const item = (over) => ({ conta_final: '0549', fornecedor: 'JJI', valor_centavos: 100000, teste: false, ...over });

  it('lista as contas, marca o Fábio e resume fornecedor e valor', () => {
    const t = textoAvisoFabio([item(), item({ conta_final: '0116', fornecedor: 'COSERN', valor_centavos: 5050 })], { mencionar: '558487820986' });
    expect(t).toContain('@558487820986');
    expect(t.indexOf('0116')).toBeLessThan(t.indexOf('0549'));
    expect(t).toContain('0549 — JJI — R$ 1.000,00');
    expect(t).toContain('0116 — COSERN — R$ 50,50');
    expect(t).toContain('Total: *R$ 1.050,50*');
    expect(t).not.toContain('TESTE');
  });

  it('o teste se identifica como teste', () => {
    const t = textoAvisoFabio([item({ teste: true, valor_centavos: 100 })], { mencionar: '558487820986' });
    expect(t).toContain('*TESTE*');
    expect(t).toContain('conta 0549');
  });
});

describe('incluirPix', () => {
  const item = { id: 1, liberacao_id: 'L1', stone_account_id: 'A1', conta_final: '0549', chave_pix: '06704197451', chave_tipo: 'cpf', valor_centavos: 100, descricao: 'Dup 1' };
  const contas = [{ id: 'A1', owner_document: '27728810000549' }];
  const criadoOk = { status: 200, json: { id: 'P1', amount: 100, target: { entity: { name: 'FABIO', document: '***.041.974-**' } } } };
  const fake = ({ criado = criadoOk, confirmado = { status: 204, texto: '' }, lanca = null } = {}) => {
    const chamadas = [];
    return {
      chamadas,
      criarPix: async (a) => (chamadas.push(['criar', a]), criado),
      confirmarPix: async (a) => {
        chamadas.push(['confirmar', a]);
        if (lanca) throw lanca;
        return confirmado;
      },
    };
  };

  it('cria, confere e confirma', async () => {
    const s = fake();
    const r = await incluirPix(s, item, contas);
    expect(r).toMatchObject({ status: 'incluido', stonePagamentoId: 'P1', recebedorNome: 'FABIO' });
    expect(s.chamadas.map((c) => c[0])).toEqual(['criar', 'confirmar']);
    expect(s.chamadas[0][1]).toMatchObject({ accountId: 'A1', chave: '06704197451', valorCentavos: 100 });
    expect(s.chamadas[0][1].idempotencia).not.toBe(s.chamadas[1][1].idempotencia);
  });

  it('não confirma quando o valor devolvido é outro', async () => {
    const s = fake({ criado: { status: 200, json: { ...criadoOk.json, amount: 10000 } } });
    expect((await incluirPix(s, item, contas)).status).toBe('erro');
    expect(s.chamadas.map((c) => c[0])).toEqual(['criar']);
  });

  it('não confirma quando o documento não bate com a chave', async () => {
    const s = fake({ criado: { status: 200, json: { ...criadoOk.json, target: { entity: { document: '***.999.888-**' } } } } });
    expect((await incluirPix(s, item, contas)).status).toBe('erro');
    expect(s.chamadas.map((c) => c[0])).toEqual(['criar']);
  });

  it('para quando a Stone pede senha ou código', async () => {
    const s = fake({ confirmado: { status: 403, texto: '{"type":"srn:error:challenge_required","challenge":{"id":"x"}}' } });
    const r = await incluirPix(s, item, contas);
    expect(r.status).toBe('bloqueado');
    expect(s.chamadas.filter((c) => c[0] === 'confirmar')).toHaveLength(1);
  });

  it('sem resposta no confirm marca verificar e não repete', async () => {
    const s = fake({ lanca: new Error('fetch failed') });
    expect((await incluirPix(s, item, contas)).status).toBe('verificar');
    expect(s.chamadas.filter((c) => c[0] === 'confirmar')).toHaveLength(1);
  });

  it('erro 500 no confirm também marca verificar', async () => {
    expect((await incluirPix(fake({ confirmado: { status: 502, texto: '' } }), item, contas)).status).toBe('verificar');
  });

  it('conta sem acesso nem chama a Stone', async () => {
    const s = fake();
    expect((await incluirPix(s, item, [])).status).toBe('bloqueado');
    expect(s.chamadas).toHaveLength(0);
  });

  it('confere o documento mascarado', () => {
    expect(documentoConfere('06704197451', '***.041.974-**')).toBe(true);
    expect(documentoConfere('06704197451', '***.041.975-**')).toBe(false);
    expect(documentoConfere('06704197451', null)).toBe(true);
  });
});
