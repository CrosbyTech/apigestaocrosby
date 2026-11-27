import { itensDoCardBrejinho, totaisDosItens, vendedorDoCardBrejinho } from '../services/brejinhoItens.js';

// card 6723 do Dryland (BRJ 62, F024 - CROSBY CAJAZEIRAS), como veio em 27/11/2026
const RAW_6723 = {
  romaneio: '26/11',
  itens: [
    { cor: 'VINHO BORDO', qtd: 5, tam: 'P', unit: 67, codigo: 56685, produto: 'CAMISETA NEW COTTON', referencia: '82081' },
    { cor: 'VINHO BORDO', qtd: 10, tam: 'M', unit: 67, codigo: 56686, produto: 'CAMISETA NEW COTTON', referencia: '82081' },
    { cor: 'VINHO BORDO', qtd: 10, tam: 'G', unit: 67, codigo: 56687, produto: 'CAMISETA NEW COTTON', referencia: '82081' },
    { cor: 'VINHO BORDO', qtd: 5, tam: 'GG', unit: 67, codigo: 56688, produto: 'CAMISETA NEW COTTON', referencia: '82081' },
    { cor: 'VINHO BORDO', qtd: 5, tam: 'XG', unit: 67, codigo: 56689, produto: 'CAMISETA NEW COTTON', referencia: '82081' },
  ],
};

describe('Brejinho — peças gravadas no card do Dryland (raw.itens)', () => {
  test('card 6723: 5 linhas, 35 peças, R$ 2.345,00 (bate com qtd_pecas e valor do card)', () => {
    const { itens, ignoradas } = itensDoCardBrejinho(RAW_6723);
    expect(ignoradas).toEqual([]);
    expect(itens).toHaveLength(5);
    expect(itens[0]).toEqual({ cod: '56685', descricao: 'CAMISETA NEW COTTON', cor: 'VINHO BORDO', tam: 'P', referencia: '82081', qtd: 5, preco: 67 });
    expect(totaisDosItens(itens)).toEqual({ pecas: 35, valor: 2345 });
  });

  test('card sem raw, sem itens ou com itens que não é lista → nenhuma peça', () => {
    for (const raw of [null, undefined, {}, { itens: null }, { itens: 'x' }, { itens: [] }]) expect(itensDoCardBrejinho(raw)).toEqual({ itens: [], ignoradas: [] });
  });

  test('linha sem código, sem quantidade ou sem preço fica de fora e é avisada', () => {
    const { itens, ignoradas } = itensDoCardBrejinho({
      itens: [
        { codigo: null, qtd: 2, unit: 50, produto: 'BERMUDA', cor: 'AZUL', tam: '40' },
        { codigo: 100, qtd: 0, unit: 50 },
        { codigo: 101, qtd: 1 },
        { codigo: 102, qtd: 3, unit: 10 },
      ],
    });
    expect(itens.map((i) => i.cod)).toEqual(['102']);
    expect(ignoradas).toEqual([
      { linha: 1, motivo: 'sem código do produto', descricao: 'BERMUDA AZUL 40' },
      { linha: 2, motivo: 'sem quantidade', descricao: null },
      { linha: 3, motivo: 'sem preço unitário', descricao: null },
    ]);
  });

  test('aceita número em texto ("67,00", "1.234,56") e código em texto', () => {
    const { itens } = itensDoCardBrejinho({ itens: [{ codigo: '56685', qtd: '5', unit: '67,00' }, { codigo: 7, qtd: 1, unit: '1.234,56' }, { codigo: 8, qtd: 2, unit: '12.5' }] });
    expect(itens.map((i) => [i.cod, i.qtd, i.preco])).toEqual([['56685', 5, 67], ['7', 1, 1234.56], ['8', 2, 12.5]]);
    expect(itens[0].descricao).toBe('Produto 56685');
  });

  test('a mesma peça repetida com o mesmo preço soma; com preço diferente fica em linhas separadas', () => {
    const { itens } = itensDoCardBrejinho({ itens: [{ codigo: 1, qtd: 2, unit: 10 }, { codigo: 1, qtd: 3, unit: 10 }, { codigo: 1, qtd: 1, unit: 8 }] });
    expect(itens.map((i) => [i.cod, i.qtd, i.preco])).toEqual([['1', 5, 10], ['1', 1, 8]]);
  });

  test('preço zero é aceito (peça de brinde); negativo não', () => {
    const { itens, ignoradas } = itensDoCardBrejinho({ itens: [{ codigo: 1, qtd: 1, unit: 0 }, { codigo: 2, qtd: 1, unit: -5 }] });
    expect(itens).toHaveLength(1);
    expect(ignoradas[0].motivo).toBe('sem preço unitário');
  });

  test('também entende os nomes da fila de faturamento (cod, preco, descricao, tamanho)', () => {
    const { itens } = itensDoCardBrejinho({ itens: [{ cod: 55, quantidade: 2, preco: 30, descricao: 'POLO', tamanho: 'M' }] });
    expect(itens[0]).toMatchObject({ cod: '55', qtd: 2, preco: 30, descricao: 'POLO', tam: 'M' });
  });
});

describe('Brejinho — vendedor gravado no card (raw.vendedor_cd / raw.vendedor)', () => {
  test('card 6723: vendedor 50 GERAL', () => {
    expect(vendedorDoCardBrejinho({ vendedor_cd: 50, vendedor: 'GERAL' })).toEqual({ code: 50, nome: 'GERAL' });
  });
  test('código em texto e nome ausente', () => {
    expect(vendedorDoCardBrejinho({ vendedor_cd: '241' })).toEqual({ code: 241, nome: null });
  });
  test('sem código (card antigo, raw vazio ou só o nome) → null', () => {
    for (const raw of [null, undefined, {}, { vendedor: 'GERAL' }, { vendedor_cd: null }, { vendedor_cd: '' }, { vendedor_cd: 0 }]) expect(vendedorDoCardBrejinho(raw)).toBeNull();
  });
});
