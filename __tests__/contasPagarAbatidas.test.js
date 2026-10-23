/**
 * Regra fixa do contas a pagar: duplicatas abatidas (agrupadas e baixadas por
 * desconto, com data de liquidação e valor pago zero) nunca aparecem.
 */
import { isDuplicataAbatida, removerAbatidas, FILTRO_ABATIDAS_POSTGREST } from '../utils/contasPagarAbatidas.js';

describe('isDuplicataAbatida', () => {
  test('item cru da API: liquidada com pago zero é abatida', () => {
    expect(isDuplicataAbatida({ settlementDate: '2026-09-28T00:00:00', paidValue: 0 })).toBe(true);
    expect(isDuplicataAbatida({ settlementDate: '2026-09-28T00:00:00', paidValue: null })).toBe(true);
  });

  test('em aberto (sem liquidação) nunca é abatida', () => {
    expect(isDuplicataAbatida({ settlementDate: null, paidValue: 0 })).toBe(false);
    expect(isDuplicataAbatida({ settlementDate: '', paidValue: 0 })).toBe(false);
  });

  test('paga de verdade (liquidação com valor pago) não é abatida', () => {
    expect(isDuplicataAbatida({ settlementDate: '2026-09-16T00:00:00', paidValue: 1824.24 })).toBe(false);
    // original agrupada: situação A, pago = valor
    expect(isDuplicataAbatida({ settlementDate: '2026-09-16T00:00:00', paidValue: 55.43, status: 'A' })).toBe(false);
  });

  test('aceita a linha mapeada do HeadCoach e a do espelho ERP', () => {
    expect(isDuplicataAbatida({ dt_liq: '2026-10-08T00:00:00', vl_pago: 0 })).toBe(true);
    expect(isDuplicataAbatida({ dt_liq: null, vl_pago: 0 })).toBe(false);
    expect(isDuplicataAbatida({ settlement_date: '2026-10-08T00:00:00', paid_value: 0 })).toBe(true);
    expect(isDuplicataAbatida({ settlement_date: '2026-10-08T00:00:00', paid_value: 10 })).toBe(false);
  });

  test('entrada inválida não quebra', () => {
    expect(isDuplicataAbatida(null)).toBe(false);
    expect(isDuplicataAbatida({})).toBe(false);
  });
});

describe('removerAbatidas', () => {
  test('filtra e conta as removidas', () => {
    const r = removerAbatidas([
      { duplicateCode: 1, settlementDate: null, paidValue: 0 },
      { duplicateCode: 261008104, settlementDate: '2026-10-09T00:00:00', paidValue: 0 },
      { duplicateCode: 3, settlementDate: '2026-10-09T00:00:00', paidValue: 100 },
    ]);
    expect(r.removidas).toBe(1);
    expect(r.itens.map((i) => i.duplicateCode)).toEqual([1, 3]);
  });

  test('lista vazia ou inválida', () => {
    expect(removerAbatidas([])).toEqual({ itens: [], removidas: 0 });
    expect(removerAbatidas(undefined)).toEqual({ itens: [], removidas: 0 });
  });
});

test('filtro PostgREST mantém só sem liquidação ou com pago > 0', () => {
  expect(FILTRO_ABATIDAS_POSTGREST).toBe('settlement_date.is.null,paid_value.gt.0');
});
