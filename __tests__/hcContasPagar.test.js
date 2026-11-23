import { describe, it, expect } from '@jest/globals';
import { validarInclusao, situacaoDeTela, normalizarRateio, ratear, rotuloDuplicata, parcelaDoMes, duplicataDaContaMensal, CpError } from '../services/hcContasPagar.js';

const HOJE = '2026-11-18';
const base = (over = {}) => ({ empresa: 90, fornecedorCode: 184, documentoFiscal: '168706456', despesaCode: 6010, emissao: '2026-10-27', vencimento: '2026-11-16', valor: '991,39', ...over });

describe('validarInclusao', () => {
  it('monta uma duplicata simples', () => {
    const r = validarInclusao(base({ formaPagamento: 'pix', chavePix: ' 000201abc ', portadorCode: '5', observacao: 'teste' }), HOJE);
    expect(r.comum).toMatchObject({ empresa: 90, fornecedor_code: 184, documento_fiscal: '168706456', tipo_documento: 'duplicata', portador_code: 5, forma_pagamento: 'pix', chave_pix: '000201abc', despesa_code: 6010, previsao: 'real', emissao: '2026-10-27', entrada: HOJE, observacao: 'teste' });
    expect(r.parcelas).toEqual([{ parcela: 1, vencimento: '2026-11-16', valor: 991.39 }]);
  });

  it('aceita várias parcelas e numera as que vierem sem número', () => {
    const r = validarInclusao(base({ parcelas: [{ vencimento: '2026-11-16', valor: 100 }, { vencimento: '2026-12-16', valor: 100.5 }] }), HOJE);
    expect(r.parcelas).toEqual([{ parcela: 1, vencimento: '2026-11-16', valor: 100 }, { parcela: 2, vencimento: '2026-12-16', valor: 100.5 }]);
  });

  it.each([
    ['sem empresa', { empresa: '' }, /empresa/],
    ['sem fornecedor', { fornecedorCode: null }, /fornecedor/],
    ['sem despesa', { despesaCode: null }, /despesa/],
    ['sem emissão', { emissao: '27/10/2026' }, /emissão/],
    ['emissão futura em conta real', { emissao: '2026-11-19', vencimento: '2026-11-30' }, /futuro/],
    ['vencimento antes da emissão', { vencimento: '2026-10-01' }, /anterior à emissão/],
    ['valor zero', { valor: 0 }, /valor/],
    ['valor inválido', { valor: 'abc' }, /valor/],
    ['forma inválida', { formaPagamento: 'cheque' }, /Forma/],
    ['parcela repetida', { parcelas: [{ parcela: 1, vencimento: '2026-11-16', valor: 1 }, { parcela: 1, vencimento: '2026-12-16', valor: 1 }] }, /repetida/],
  ])('recusa: %s', (_, over, msg) => {
    expect(() => validarInclusao(base(over), HOJE)).toThrow(CpError);
    expect(() => validarInclusao(base(over), HOJE)).toThrow(msg);
  });

  it('previsão pode ter emissão futura', () => {
    expect(validarInclusao(base({ previsao: 'previsao', emissao: '2026-12-01', vencimento: '2026-12-10' }), HOJE).comum.previsao).toBe('previsao');
  });
});

describe('numeração', () => {
  it('o documento fiscal é opcional (aluguel, recibo sem nota)', () => {
    expect(validarInclusao(base({ documentoFiscal: '  ' }), HOJE).comum.documento_fiscal).toBeNull();
  });

  it('o rótulo é duplicata/parcela', () => {
    expect(rotuloDuplicata({ duplicata: 1, parcela: 11 })).toBe('1/11');
    expect(rotuloDuplicata({ duplicata: 1, parcela: 12 })).toBe('1/12');
    expect(rotuloDuplicata({ duplicata: 14, parcela: 3 })).toBe('14/3');
  });

  it('sem número é duplicata nova; com número, mais parcelas na que já existe', () => {
    expect(validarInclusao(base(), HOJE).duplicata).toBeNull();
    expect(validarInclusao(base({ duplicata: '' }), HOJE).duplicata).toBeNull();
    expect(validarInclusao(base({ duplicata: '3', parcela: 12 }), HOJE)).toMatchObject({ duplicata: 3, parcelas: [{ parcela: 12 }] });
    expect(() => validarInclusao(base({ duplicata: 'x' }), HOJE)).toThrow(/duplicata/);
    expect(() => validarInclusao(base({ duplicata: 0 }), HOJE)).toThrow(/duplicata/);
  });
});

describe('conta que vem todo mês', () => {
  it('a parcela é o mês do vencimento', () => {
    expect(parcelaDoMes('2026-11-06')).toBe(11);
    expect(parcelaDoMes('2026-12-07T00:00:00')).toBe(12);
    expect(parcelaDoMes('2027-01-10')).toBe(1);
  });

  it('primeira fatura da conta abre duplicata nova', () => {
    expect(duplicataDaContaMensal([], 11)).toBeNull();
    expect(duplicataDaContaMensal(undefined, 11)).toBeNull();
  });

  it('as faturas seguintes entram na mesma duplicata (1/11, 1/12, 1/1…)', () => {
    expect(duplicataDaContaMensal([{ duplicata: 1, parcela: 11 }], 12)).toBe(1);
    expect(duplicataDaContaMensal([{ duplicata: 1, parcela: 11 }, { duplicata: 1, parcela: 12 }], 1)).toBe(1);
  });

  it('quando o mês se repete (um ano depois), abre a duplicata seguinte e continua nela', () => {
    const ano1 = [11, 12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((parcela) => ({ duplicata: 1, parcela }));
    expect(duplicataDaContaMensal(ano1, 11)).toBeNull();
    expect(duplicataDaContaMensal([...ano1, { duplicata: 4, parcela: 11 }], 12)).toBe(4);
  });
});

describe('situacaoDeTela', () => {
  it('aberta com vencimento passado é vencida', () => {
    expect(situacaoDeTela({ situacao: 'aberto', vencimento: '2026-11-16' }, HOJE)).toMatchObject({ situacao: 'vencido', diasAtraso: 2 });
    expect(situacaoDeTela({ situacao: 'aberto', vencimento: '2026-11-18' }, HOJE)).toMatchObject({ situacao: 'aberto', diasAtraso: 0 });
    expect(situacaoDeTela({ situacao: 'pago', vencimento: '2026-11-01' }, HOJE)).toMatchObject({ situacao: 'pago', diasAtraso: 0 });
  });
});

describe('rateio por centro de custo', () => {
  it('uma linha só vira 100% na despesa principal', () => {
    const r = validarInclusao(base({ centroCustoCode: 37 }), HOJE);
    expect(r.rateio).toEqual([{ despesa_code: 6010, centro_custo_code: 37, percentual: 100 }]);
    expect(r.comum).toMatchObject({ despesa_code: 6010, centro_custo_code: 37 });
  });

  it('várias linhas: a principal é a de maior percentual', () => {
    const r = validarInclusao(base({ despesaCode: undefined, rateio: [{ despesaCode: 6010, centroCustoCode: 37, percentual: 30 }, { despesaCode: 6010, centroCustoCode: 20, percentual: '70' }] }), HOJE);
    expect(r.rateio).toHaveLength(2);
    expect(r.comum).toMatchObject({ despesa_code: 6010, centro_custo_code: 20 });
  });

  it.each([
    ['soma diferente de 100', [{ despesaCode: 6010, centroCustoCode: 37, percentual: 60 }, { despesaCode: 6010, centroCustoCode: 20, percentual: 30 }], /100%/],
    ['linha sem centro de custo', [{ despesaCode: 6010, centroCustoCode: '', percentual: 100 }], /centro de custo/],
    ['linha sem despesa', [{ despesaCode: '', centroCustoCode: 37, percentual: 100 }], /despesa/],
    ['linha repetida', [{ despesaCode: 6010, centroCustoCode: 37, percentual: 50 }, { despesaCode: 6010, centroCustoCode: 37, percentual: 50 }], /repete/],
    ['percentual zero', [{ despesaCode: 6010, centroCustoCode: 37, percentual: 0 }, { despesaCode: 6010, centroCustoCode: 20, percentual: 100 }], /percentual/],
  ])('recusa: %s', (_, rateio, msg) => expect(() => normalizarRateio(rateio)).toThrow(msg));

  it('os valores fecham com o da parcela, centavo a centavo', () => {
    const linhas = normalizarRateio([{ despesaCode: 6010, centroCustoCode: 37, percentual: 33.3333 }, { despesaCode: 6010, centroCustoCode: 20, percentual: 33.3333 }, { despesaCode: 6010, centroCustoCode: 10, percentual: 33.3334 }]);
    const v = ratear(linhas, 100).map((l) => l.valor);
    expect(v).toEqual([33.33, 33.33, 33.34]);
    expect(ratear(linhas, 991.39).reduce((s, l) => s + l.valor, 0)).toBeCloseTo(991.39, 2);
  });
});
