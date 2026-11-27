import { describe, it, expect } from '@jest/globals';
import { faltaEmCentavos, tipoDoValor, candidatasDaSaida, planoDeCasamento } from '../utils/hcCpSaidasSemBaixa.js';

// pontuação simples de nome para o teste: fração das palavras do fornecedor que aparecem no extrato
const pontuar = (a, b) => {
  const A = String(a).toUpperCase().split(/\s+/).filter((t) => t.length > 2);
  const B = new Set(String(b).toUpperCase().split(/[^A-Z0-9]+/));
  return A.length ? A.filter((t) => B.has(t)).length / A.length : 0;
};
const tit = (id, valor, fornecedor = 'ALARES TELECOM', over = {}) => ({ id, fornecedor_nome: fornecedor, fornecedor_cpf_cnpj: over.doc ?? '02952192000161', valor, valor_pago: over.pago ?? 0, juros: 0, multa: 0, desconto: 0, situacao: over.situacao ?? 'aberto', previsao: over.previsao ?? 'real', vencimento: over.venc ?? '2026-11-10' });
const saida = (valor, nome = 'ALARES TELECOM', over = {}) => ({ valor, contraparte: nome, contraparteDoc: over.doc ?? null, memo: `${nome} - Transferência | Pix` });

describe('quanto falta e como a saída se compara com a duplicata', () => {
  it('o que já foi abatido sai do que falta', () => {
    expect(faltaEmCentavos(tit(1, 100))).toBe(10000);
    expect(faltaEmCentavos(tit(1, 100, 'X', { pago: 40 }))).toBe(6000);
  });
  it('igual, com acréscimo (até 10%), parcial e fora do limite', () => {
    expect(tipoDoValor(199.99, tit(1, 199.99))).toBe('igual');
    expect(tipoDoValor(204.24, tit(1, 199.99))).toBe('acrescimo');
    expect(tipoDoValor(110, tit(1, 100))).toBe('acrescimo');
    expect(tipoDoValor(110.01, tit(1, 100))).toBeNull();
    expect(tipoDoValor(60, tit(1, 100))).toBe('parcial');
  });
  it('previsão de 1 centavo aceita qualquer valor; previsão com valor só perto dele', () => {
    expect(tipoDoValor(3400, tit(1, 0.01, 'LATAM', { previsao: 'previsao' }))).toBe('previsao');
    expect(tipoDoValor(305.79, tit(1, 294.47, 'CLARO', { previsao: 'previsao' }))).toBe('previsao');
    expect(tipoDoValor(14.76, tit(1, 111.14, 'CLARO', { previsao: 'previsao' }))).toBeNull();
    expect(tipoDoValor(294.47, tit(1, 294.47, 'CLARO', { previsao: 'previsao' }))).toBe('igual');
  });
});

describe('duplicatas que podem casar com a saída', () => {
  it('mesmo fornecedor e valor igual vem primeiro; depois acréscimo, previsão e parcial', () => {
    const titulos = [tit(1, 500), tit(2, 95), tit(3, 0.01, 'ALARES TELECOM', { previsao: 'previsao' }), tit(4, 100)];
    const c = candidatasDaSaida(saida(100), titulos, pontuar);
    expect(c.map((x) => [x.titulo.id, x.tipo])).toEqual([[4, 'igual'], [2, 'acrescimo'], [3, 'previsao'], [1, 'parcial']]);
    expect(c[1].acrescimo).toBe(5);
    expect(c.every((x) => x.mesmoFornecedor)).toBe(true);
  });
  it('outro nome só entra com valor igual, e depois dos do mesmo fornecedor', () => {
    const titulos = [tit(1, 100, 'PADARIA DO ZE', { doc: '11111111000111' }), tit(2, 95, 'PADARIA DO ZE', { doc: '11111111000111' }), tit(3, 300, 'ALARES TELECOM')];
    const c = candidatasDaSaida(saida(100), titulos, pontuar);
    expect(c.map((x) => [x.titulo.id, x.tipo, x.mesmoFornecedor])).toEqual([[3, 'parcial', true], [1, 'igual', false]]);
  });
  it('CPF/CNPJ igual vale mesmo com o nome diferente no extrato', () => {
    const c = candidatasDaSaida(saida(204.24, 'VIVO', { doc: '02.558.157/0001-62' }), [tit(1, 199.99, 'TELEFONICA BRASIL', { doc: '02558157000162' })], pontuar);
    expect(c.map((x) => [x.tipo, x.pontos])).toEqual([['acrescimo', 2]]);
  });
  it('sem nenhuma duplicata compatível: lista vazia', () => {
    expect(candidatasDaSaida(saida(100), [tit(1, 50, 'PADARIA DO ZE', { doc: '1' })], pontuar)).toEqual([]);
    expect(candidatasDaSaida(saida(100), [], pontuar)).toEqual([]);
  });
});

describe('o que acontece ao casar', () => {
  it('valor igual quita', () => {
    expect(planoDeCasamento(100, tit(1, 100))).toEqual({ tipo: 'igual', pago: 100, juros: 0, resta: 0, trocaValor: null });
  });
  it('saída maior: a diferença é juros e multa (sem teto, porque foi o usuário quem escolheu)', () => {
    expect(planoDeCasamento(204.24, tit(1, 199.99))).toEqual({ tipo: 'acrescimo', pago: 204.24, juros: 4.25, resta: 0, trocaValor: null });
    expect(planoDeCasamento(150, tit(1, 100)).juros).toBe(50);
  });
  it('saída menor: baixa parcial e o resto continua em aberto', () => {
    expect(planoDeCasamento(60, tit(1, 100))).toEqual({ tipo: 'parcial', pago: 60, juros: 0, resta: 40, trocaValor: null });
  });
  it('previsão sem pagamento: a duplicata passa a valer o valor da saída', () => {
    expect(planoDeCasamento(3400, tit(1, 0.01, 'LATAM', { previsao: 'previsao' }))).toEqual({ tipo: 'previsao', pago: 3400, juros: 0, resta: 0, trocaValor: 3400 });
    expect(planoDeCasamento(250, tit(1, 294.47, 'CLARO', { previsao: 'previsao' })).trocaValor).toBe(250);
  });
  it('duplicata paga, cancelada ou inexistente: erro', () => {
    expect(planoDeCasamento(100, tit(1, 100, 'X', { situacao: 'pago' })).erro).toMatch(/já está paga/);
    expect(planoDeCasamento(100, null).erro).toMatch(/não encontrada/);
    expect(planoDeCasamento(0, tit(1, 100)).erro).toMatch(/sem valor|não tem valor/);
  });
});

describe('previsão só é sugerida perto do vencimento', () => {
  const previsao = (id, venc) => tit(id, 0.01, 'ALARES TELECOM', { previsao: 'previsao', venc });
  it('a de dezembro não é sugerida para a saída de novembro; a do mês é', () => {
    const s = { ...saida(128.26), data: '2026-11-23' };
    const c = candidatasDaSaida(s, [previsao(1, '2026-12-14'), previsao(2, '2026-11-30')], pontuar);
    expect(c.map((x) => x.titulo.id)).toEqual([2]);
  });
  it('sem a data da saída não filtra (quem chama decide)', () => {
    expect(candidatasDaSaida(saida(128.26), [previsao(1, '2026-12-14')], pontuar)).toHaveLength(1);
  });
});
