// Regras puras da conciliação bancária: chave estável, pontuação, uso parcial
// de duplicata e decisão automática.
import { atribuirChaves, candidatosPara, decidir, depositosStoneDoDia, candidatosEntradaStone, ehEntradaStone } from '../services/fluxoCaixaConciliacao.js';

const saida = (over = {}) => ({ id: 1, conta_id: 18, data: '2026-09-01', seq: 1, valor: -43.41, memo: 'PAGAMENTO PIX CLARO', descricao: 'PAGAMENTO PIX', contraparte_nome: 'CLARO', contraparte_doc: '40432544000147', banco: 'SICREDI', conta_apelido: 'Sicredi 36733-8', conta_titular: 'CROSBY CR VESTUARIO LTDA', ...over });
const lib = (over = {}) => ({ origem: 'LIBERACAO', id: 'L1', valor: 43.41, data: '2026-09-01', nome: 'CLARO', doc: '40432544000147', empresa: 'CROSBY MATRIZ', detalhe: 'TELEFONE · BOLETO', bancoPagamento: 'SICREDI CROSBY', duplicata: '160605|6', vencimento: '2026-08-17', ...over });

describe('atribuirChaves', () => {
  test('lançamentos idênticos no mesmo dia recebem n distinto, na ordem do extrato', () => {
    const ls = [
      { conta_id: 1, data: '2026-09-23', seq: 2, valor: -1.99, memo: 'Tarifa do boleto' },
      { conta_id: 1, data: '2026-09-23', seq: 1, valor: -1.99, memo: 'Tarifa do boleto' },
      { conta_id: 1, data: '2026-09-23', seq: 3, valor: 900, memo: 'Depósito por boleto' },
    ];
    atribuirChaves(ls);
    expect(ls[1].chave.endsWith('|1')).toBe(true);
    expect(ls[0].chave.endsWith('|2')).toBe(true);
    expect(new Set(ls.map((l) => l.chave)).size).toBe(3);
    expect(ls[2].chave.startsWith('1|2026-09-23|900.00|')).toBe(true);
  });
});

describe('candidatosPara + decidir', () => {
  test('mesmo valor, data e CNPJ → aceite automático', () => {
    const c = candidatosPara(saida(), { liberacao: [lib()], totvs: [], solicitacoes: [] });
    expect(c).toHaveLength(1);
    expect(c[0].score).toBeGreaterThanOrEqual(100);
    expect(c[0].motivos).toEqual(expect.arrayContaining(['valor igual', 'mesma data', 'mesmo CNPJ/CPF', 'banco de pagamento confere']));
    expect(decidir(c)).toMatchObject({ automatico: true });
  });

  test('duplicata já usada inteira por outra saída não aparece', () => {
    const usados = new Map([['LIBERACAO:L1', 43.41]]);
    expect(candidatosPara(saida(), { liberacao: [lib()], totvs: [], solicitacoes: [] }, usados)).toHaveLength(0);
  });

  test('pagamento parcial: duplicata de 15k cobre saída de 7.500 e depois os outros 7.500, mas não uma terceira', () => {
    const dup = lib({ id: 'L15', valor: 15000, nome: 'FORNECEDOR XYZ', doc: '11111111000191' });
    const s = saida({ valor: -7500, contraparte_doc: '11111111000191', contraparte_nome: 'FORNECEDOR XYZ' });
    const fontes = { liberacao: [dup], totvs: [], solicitacoes: [] };
    const c1 = candidatosPara(s, fontes, new Map());
    expect(c1).toHaveLength(1);
    expect(c1[0]).toMatchObject({ parcial: true, valorDuplicata: 15000, restanteDepois: 7500 });
    expect(c1[0].motivos.join(' ')).toMatch(/parcial/);
    expect(decidir(c1).automatico).toBe(true); // CNPJ + data compensam a penalidade
    const c2 = candidatosPara(s, fontes, new Map([['LIBERACAO:L15', 7500]]));
    expect(c2).toHaveLength(1);
    expect(c2[0].restanteDepois).toBe(0);
    const c3 = candidatosPara(s, fontes, new Map([['LIBERACAO:L15', 15000]]));
    expect(c3).toHaveLength(0);
  });

  test('duplicata menor que a saída nunca é candidata', () => {
    expect(candidatosPara(saida({ valor: -100 }), { liberacao: [lib({ valor: 43.41 })], totvs: [], solicitacoes: [] })).toHaveLength(0);
  });

  test('dois pagamentos diferentes com pontuação próxima → pede escolha', () => {
    const a = lib({ id: 'A', data: '2026-09-01' });
    const b = lib({ id: 'B', data: '2026-08-31', nome: 'CLARO SA' });
    const amb = candidatosPara(saida(), { liberacao: [a, b], totvs: [], solicitacoes: [] });
    expect(amb).toHaveLength(2);
    expect(amb[0].id).toBe('A');
    expect(amb[0].score - amb[1].score).toBeLessThan(15); // 120 × 112
    expect(decidir(amb)).toMatchObject({ automatico: false, motivo: 'mais de um candidato parecido' });
  });

  test('gêmeos (mesmo pagamento repetido) não contam como ambiguidade', () => {
    const g1 = lib({ id: 'G1' });
    const g2 = lib({ id: 'G2' });
    const c = candidatosPara(saida(), { liberacao: [g1, g2], totvs: [], solicitacoes: [] });
    expect(c).toHaveLength(2);
    expect(decidir(c)).toMatchObject({ automatico: true, escolhido: expect.objectContaining({ id: 'G1' }) });
  });

  test('solicitação sem data de pagamento pontua menos e usa o vencimento', () => {
    const sol = { origem: 'SOLICITACAO', id: 'S1', valor: 43.41, data: '2026-09-03', nome: 'CLARO', doc: '40432544000147', semDataPagamento: true };
    const c = candidatosPara(saida(), { liberacao: [], totvs: [], solicitacoes: [sol] });
    expect(c).toHaveLength(1);
    expect(c[0].score).toBeLessThan(80);
    expect(c[0].motivos.join(' ')).toMatch(/vencimento a 2 dia/);
  });
});

describe('entradas Stone (depósitos do arquivo de conciliação)', () => {
  const loja = { nome: 'CROSBY SHOPPING MIDWAY', cnpj: '27728810000549' };
  const liq = (over = {}) => ({ nsu: '351', dataCaptura: '2026-09-08 18:05:04', bruto: 634, liquido: 613.78, taxa: 20.22, antecipada: true, dataOriginal: '2026-10-08', paymentId: 'P1', ...over });
  const dia = {
    data: '2026-09-09',
    pagamentos: [
      { id: 'P1', carteira: 'Antecipação', carteiraId: 7, valorTotal: 696.06, valorEventos: 0, saldoNegativoAnterior: 0, conta: '434136909' },
      { id: 'P2', carteira: 'Visa Crédito', carteiraId: 1, valorTotal: 100, valorEventos: 0, saldoNegativoAnterior: 0, conta: '434136909' },
    ],
    liquidacoes: [liq(), liq({ nsu: '352', bruto: 85, liquido: 82.29, taxa: 2.71 }), liq({ nsu: '400', paymentId: 'P2', bruto: 103, liquido: 100, taxa: 3, antecipada: false, dataOriginal: null })],
  };
  const entrada = (over = {}) => ({ id: 9, conta_id: 10, data: '2026-09-09', valor: 696.06, categoria: 'antecipacao', banco: 'STONE', memo: 'Recebimento vendas - Antecipação | Crédito', ...over });

  test('um candidato por depósito, com bruto/líquido/taxa somados das parcelas', () => {
    const d = depositosStoneDoDia(dia, loja, '192477589');
    expect(d).toHaveLength(2);
    expect(d[0]).toMatchObject({ origem: 'STONE', id: '192477589|2026-09-09|P1', valor: 696.06, data: '2026-09-09', empresa: 'CROSBY SHOPPING MIDWAY' });
    expect(d[0].stone).toMatchObject({ tipo: 'ANTECIPACAO', bruto: 719, liquido: 696.07, taxa: 22.93, taxaPct: 3.19, parcelas: 2, antecipadas: 2, dataOriginal: '2026-10-08' });
    expect(d[0].detalhe).toMatch(/Antecipação · 2 parcela\(s\) · bruto 719,00 · taxa 22,93 \(3,19%\)/);
    expect(d[1].stone).toMatchObject({ tipo: 'LIQUIDACAO', bruto: 103, taxa: 3, parcelas: 1, antecipadas: 0 });
  });

  test('antecipação do extrato casa com o depósito do mesmo dia e valor; depósito já usado não repete', () => {
    const itens = depositosStoneDoDia(dia, loja, '192477589');
    const c = candidatosEntradaStone(entrada(), itens);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ id: '192477589|2026-09-09|P1', score: 110 });
    expect(c[0].motivos).toEqual(['valor igual', 'mesma data', 'antecipação confere']);
    expect(decidir(c).automatico).toBe(true);
    expect(candidatosEntradaStone(entrada(), itens, new Map([['STONE:192477589|2026-09-09|P1', 696.06]]))).toHaveLength(0);
    // 1 dia de diferença ainda serve; 3 dias não
    expect(candidatosEntradaStone(entrada({ data: '2026-09-10' }), itens)[0].score).toBe(95);
    expect(candidatosEntradaStone(entrada({ data: '2026-09-12' }), itens)).toHaveLength(0);
  });

  test('liquidação por bandeira pontua a bandeira; valor diferente não é candidato', () => {
    const itens = depositosStoneDoDia(dia, loja, '192477589');
    const c = candidatosEntradaStone(entrada({ valor: 100, categoria: 'cartao', bandeira: 'VISA' }), itens);
    expect(c).toHaveLength(1);
    expect(c[0].motivos).toContain('bandeira confere');
    expect(candidatosEntradaStone(entrada({ valor: 100.5, categoria: 'cartao' }), itens)).toHaveLength(0);
  });

  test('só entradas de cartão/antecipação em conta Stone entram na busca', () => {
    expect(ehEntradaStone(entrada())).toBe(true);
    expect(ehEntradaStone(entrada({ categoria: 'boleto' }))).toBe(false);
    expect(ehEntradaStone(entrada({ banco: 'SICREDI' }))).toBe(false);
    expect(ehEntradaStone(entrada({ valor: -10 }))).toBe(false);
  });
});
