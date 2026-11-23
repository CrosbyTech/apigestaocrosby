import { describe, it, expect } from '@jest/globals';
import { saldoDoTitulo, abatidoDoTitulo, ehParcial, calcularBaixa, situacaoDeTela, totaisDosTitulos, CpError } from '../services/hcContasPagar.js';

const HOJE = '2026-11-23';
const tit = (over = {}) => ({ situacao: 'aberto', valor: 15000, valor_pago: 0, juros: 0, multa: 0, desconto: 0, vencimento: '2026-11-30', ...over });

describe('saldo da duplicata', () => {
  it('em aberto sem pagamento: falta tudo', () => {
    expect(saldoDoTitulo(tit())).toBe(15000);
    expect(ehParcial(tit())).toBe(false);
  });

  it('paga em parte: falta o resto e continua em aberto', () => {
    const t = tit({ valor_pago: 9500 });
    expect(saldoDoTitulo(t)).toBe(5500);
    expect(ehParcial(t)).toBe(true);
    expect(situacaoDeTela(t, HOJE)).toEqual({ situacao: 'aberto', diasAtraso: 0, parcial: true, saldo: 5500 });
    expect(situacaoDeTela(tit({ valor_pago: 9500, vencimento: '2026-10-15' }), HOJE)).toMatchObject({ situacao: 'vencido', parcial: true, saldo: 5500 });
  });

  it('juros e multa não abatem o valor; desconto abate', () => {
    expect(abatidoDoTitulo(tit({ valor_pago: 1100, juros: 80, multa: 20 }))).toBe(1000);
    expect(saldoDoTitulo(tit({ valor_pago: 1100, juros: 80, multa: 20 }))).toBe(14000);
    expect(saldoDoTitulo(tit({ valor_pago: 900, desconto: 100 }))).toBe(14000);
  });

  it('paga ou cancelada não tem saldo, mesmo com pago menor que o valor', () => {
    expect(saldoDoTitulo(tit({ situacao: 'pago', valor_pago: 7000 }))).toBe(0);
    expect(saldoDoTitulo(tit({ situacao: 'cancelado' }))).toBe(0);
    expect(situacaoDeTela(tit({ situacao: 'pago', valor_pago: 7000 }), HOJE)).toEqual({ situacao: 'pago', diasAtraso: 0, parcial: false, saldo: 0 });
  });
});

describe('conta da baixa', () => {
  it('sem valor pago informado paga tudo o que falta', () => {
    expect(calcularBaixa(tit())).toEqual({ saldo: 15000, pago: 15000, abatido: 15000, resta: 0, quita: true });
    expect(calcularBaixa(tit(), { juros: 100, multa: 50, desconto: 30 })).toMatchObject({ pago: 15120, quita: true, resta: 0 });
  });

  it('valor menor é baixa parcial: 15 mil, pagos 9,5 mil, ficam 5,5 mil', () => {
    expect(calcularBaixa(tit(), { valorPago: 9500 })).toEqual({ saldo: 15000, pago: 9500, abatido: 9500, resta: 5500, quita: false });
  });

  it('a segunda baixa parte do que falta e pode quitar', () => {
    const t = tit({ valor_pago: 9500 });
    expect(calcularBaixa(t)).toEqual({ saldo: 5500, pago: 5500, abatido: 5500, resta: 0, quita: true });
    expect(calcularBaixa(t, { valorPago: 2000 })).toMatchObject({ saldo: 5500, pago: 2000, resta: 3500, quita: false });
  });

  it('parcial com juros: só o que passa dos juros abate o valor', () => {
    expect(calcularBaixa(tit(), { valorPago: 1100, juros: 100 })).toMatchObject({ abatido: 1000, resta: 14000, quita: false });
  });

  it('desconto do restante encerra a duplicata', () => {
    expect(calcularBaixa(tit({ valor_pago: 9500 }), { desconto: 5500 })).toMatchObject({ pago: 0, resta: 0, quita: true });
  });

  it('recusa pagar mais do que falta, valor que não cobre os juros e parcial de zero', () => {
    expect(() => calcularBaixa(tit({ valor_pago: 9500 }), { valorPago: 6000 })).toThrow(CpError);
    expect(() => calcularBaixa(tit(), { valorPago: 50, juros: 100 })).toThrow(/juros/);
    expect(() => calcularBaixa(tit(), { valorPago: 0 })).toThrow(/valor pago/i);
    expect(() => calcularBaixa(tit(), { desconto: 20000 })).toThrow(/desconto/);
    expect(() => calcularBaixa(tit(), { juros: -1 })).toThrow(CpError);
  });
});

describe('totais da consulta', () => {
  const titulos = [
    tit({ valor: 1000 }), // em aberto
    tit({ valor: 15000, valor_pago: 9500 }), // paga parcial
    tit({ valor: 2000, situacao: 'pago', valor_pago: 2050, juros: 50 }), // paga
    tit({ valor: 500, valor_pago: 200, vencimento: '2026-11-10' }), // parcial vencida
    tit({ valor: 300, situacao: 'cancelado' }),
    tit({ valor: 400, vencimento: HOJE }),
  ];

  it('o já pago das parciais soma em pago e só o que falta soma em aberto', () => {
    const t = totaisDosTitulos(titulos, HOJE);
    expect(t.valorPago).toBe(9500 + 2050 + 200);
    expect(t.aberto).toBe(1000 + 5500 + 300 + 400);
    expect(t.vencido).toBe(300);
    expect(t.venceHoje).toBe(400);
    expect(t.parciais).toBe(2);
    expect(t.encargos).toBe(50);
    expect(t.cancelado).toBe(300);
    expect(t.qtd).toBe(6);
    expect(t.valor).toBe(1000 + 15000 + 2000 + 500 + 400);
  });
});
