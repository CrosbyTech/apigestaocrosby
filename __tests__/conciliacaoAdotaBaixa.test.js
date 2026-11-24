import { describe, it, expect } from '@jest/globals';
import { baixaParaAdotar } from '../services/conciliacaoPropagacao.js';

const b = (id, valor, data, obs = 'Liberação de Pagamento') => ({ id, valor_pago: valor, data_pagamento: data, observacao: obs });

describe('conciliação × baixa já lançada pela Liberação de Pagamento', () => {
  it('mesmo valor, perto da data e sem conciliação: adota (não lança outra)', () => {
    expect(baixaParaAdotar([b(1, 1250, '2026-11-24')], 1250, '2026-11-25')?.id).toBe(1);
    expect(baixaParaAdotar([b(1, 1250, '2026-11-24')], 1250, '2026-11-24')?.id).toBe(1);
  });

  it('baixa que já é de outra conciliação não é adotada', () => {
    expect(baixaParaAdotar([b(1, 3750, '2026-11-11', 'Baixa automática pela conciliação do extrato (Stone 0005-49) [conc 2422]')], 3750, '2026-11-11')).toBeNull();
  });

  it('valor diferente ou data longe (mais de 5 dias): não adota', () => {
    expect(baixaParaAdotar([b(1, 1250.01, '2026-11-24')], 1250, '2026-11-24')).toBeNull();
    expect(baixaParaAdotar([b(1, 1250, '2026-11-10')], 1250, '2026-11-24')).toBeNull();
    expect(baixaParaAdotar([b(1, 1250, '2026-11-19')], 1250, '2026-11-24')?.id).toBe(1); // 5 dias ainda vale
  });

  it('duas baixas iguais: adota a mais próxima da saída', () => {
    expect(baixaParaAdotar([b(1, 100, '2026-11-20'), b(2, 100, '2026-11-24')], 100, '2026-11-25')?.id).toBe(2);
  });

  it('sem baixas ou sem data: nada', () => {
    expect(baixaParaAdotar([], 100, '2026-11-25')).toBeNull();
    expect(baixaParaAdotar(null, 100, '2026-11-25')).toBeNull();
    expect(baixaParaAdotar([b(1, 100, '2026-11-25')], 100, null)).toBeNull();
  });
});
