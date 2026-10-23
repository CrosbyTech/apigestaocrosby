// Regras puras da conciliação bancária: chave estável, pontuação, uso parcial
// de duplicata e decisão automática.
import { atribuirChaves, candidatosPara, decidir, depositosStoneDoDia, candidatosEntradaStone, ehEntradaStone, ehEntradaPixMaquininha, ehEntradaPixTotvs, ehEntradaPixCliente } from '../services/fluxoCaixaConciliacao.js';

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

describe('Pix da maquininha Stone × contas a receber TOTVS', () => {
  const pix = (over = {}) => ({ id: 20, conta_id: 34, data: '2026-09-03', valor: 149, categoria: 'pix', banco: 'STONE', descricao: 'PIX MAQUININHA', memo: 'Geraldo Alves Do Nascimento Neto - Pix | Maquininha', contraparte_nome: 'GERALDO ALVES DO NASCIMENTO NETO', ...over });
  const tit = (over = {}) => ({ origem: 'TOTVS_CR', id: '65|249700|1', valor: 149, data: '2026-09-03', nome: 'GERALDO IRMAO', doc: '05964582400', empresa: 'Empresa 65', detalhe: 'Nota promissória · portador TITULO EM CARTEIRA · título 249700/1 · liquidado 2026-09-03', duplicata: '249700|1', ...over });

  test('reconhece só o Pix da maquininha em conta Stone', () => {
    expect(ehEntradaPixMaquininha(pix())).toBe(true);
    expect(ehEntradaPixMaquininha(pix({ memo: 'CROSBY - Transferência | Pix', descricao: 'RECEBIMENTO PIX' }))).toBe(false);
    expect(ehEntradaPixMaquininha(pix({ banco: 'SICREDI' }))).toBe(false);
  });

  test('título do mesmo dia e valor, com nome parecido, concilia automaticamente; dois títulos iguais são gêmeos', () => {
    const c = candidatosPara(pix(), { totvs: [tit(), tit({ id: '65|249701|1' })] });
    expect(c).toHaveLength(2);
    expect(c[0].motivos).toEqual(expect.arrayContaining(['valor igual', 'mesma data', 'nome parecido']));
    expect(decidir(c)).toMatchObject({ automatico: true, escolhido: expect.objectContaining({ id: '65|249700|1' }) });
    // o 1º já usado → sobra o 2º para a outra linha de 149
    const c2 = candidatosPara(pix(), { totvs: [tit(), tit({ id: '65|249701|1' })] }, new Map([['TOTVS_CR:65|249700|1', 149]]));
    expect(c2.map((x) => x.id)).toEqual(['65|249701|1']);
  });

  test('título com valor diferente não serve', () => {
    expect(candidatosPara(pix({ valor: 288 }), { totvs: [tit()] })).toHaveLength(0);
  });
});

describe('Pix do QR Code TOTVS (Fiserv) × título PIX', () => {
  const pix = (over = {}) => ({ id: 30, conta_id: 34, data: '2026-09-03', valor: 201.83, categoria: 'pix', banco: 'STONE', descricao: 'RECEBIMENTO PIX', memo: 'Crosby Canguaretama - Transferência | Pix', contraparte_nome: 'CROSBY CANGUARETAMA', contraparte_banco: 'FISERV DO BRASIL INSTITUIÇÃO DE PAGAMENTO LTDA', taxaFixa: 0.79, ...over });
  const tit = (over = {}) => ({ origem: 'TOTVS_CR', id: '65|250136|1', valor: 202.62, data: '2026-09-03', nome: 'WAGNER SOARES', doc: '12399284402', empresa: 'Empresa 65', detalhe: 'PIX · portador PIX · título 250136/1 · liquidado 2026-09-03', duplicata: '250136|1', ...over });

  test('reconhece o Pix pelo banco da contraparte', () => {
    expect(ehEntradaPixTotvs(pix())).toBe(true);
    expect(ehEntradaPixTotvs(pix({ contraparte_banco: 'STONE INSTITUIÇÃO DE PAGAMENTO S.A.' }))).toBe(false);
  });

  test('título vale o extrato + 0,79 e concilia automaticamente; sem a taxa não casa', () => {
    const c = candidatosPara(pix(), { totvs: [tit()] });
    expect(c).toHaveLength(1);
    expect(c[0].motivos[0]).toBe('valor igual (líquido da taxa R$ 0,79)');
    expect(c[0].taxaFixa).toBe(0.79);
    expect(decidir(c).automatico).toBe(true);
    // sem a taxa o título só apareceria como "parcial", e Pix não admite parcial
    expect(candidatosPara(pix({ taxaFixa: 0, semParcial: true }), { totvs: [tit()] })).toHaveLength(0);
    expect(candidatosPara(pix(), { totvs: [tit({ valor: 201.83 })] })).toHaveLength(0);
  });
});

describe('qualquer Pix recebido de cliente vai ao contas a receber', () => {
  const l = (over = {}) => ({ valor: 120, categoria: 'pix', descricao: 'RECEBIMENTO PIX', banco: 'SICREDI', transferencia_id: null, ...over });
  test('entra: Pix de cliente em qualquer banco; não entra: transferência do grupo, devolução, saída', () => {
    expect(ehEntradaPixCliente(l())).toBe(true);
    expect(ehEntradaPixCliente(l({ transferencia_id: 5 }))).toBe(false);
    expect(ehEntradaPixCliente(l({ descricao: 'DEVOLUCAO PIX RECEBIDA' }))).toBe(false);
    expect(ehEntradaPixCliente(l({ valor: -120 }))).toBe(false);
    expect(ehEntradaPixCliente(l({ categoria: 'boleto' }))).toBe(false);
  });
});

describe('Pix de cliente revenda/franquia na conta central', () => {
  const pix = (over = {}) => ({ id: 40, conta_id: 18, data: '2026-09-10', valor: 1023.5, categoria: 'pix', banco: 'SICREDI', descricao: 'RECEBIMENTO PIX', contraparte_nome: 'JOANIS SOARES DA SILVA', contraparte_doc: '11111111000191', filiaisConta: [1, 75], ...over });
  const fat = (over = {}) => ({ origem: 'TOTVS_CR', id: '5|240001|2', branch: 5, valor: 1000, valorPago: 1023.5, data: '2026-09-10', emissao: '2026-07-10', nome: 'JOANIS SOARES DA SILVA ME', doc: '11111111000191', empresa: 'Empresa 5', detalhe: 'Fatura · título 240001/2 · emitido 2026-07-10 · pago 2026-09-10', duplicata: '240001|2', vencimento: '2026-09-09', ...over });

  test('fatura antiga paga com juros casa pelo VALOR PAGO na data do pagamento', () => {
    const c = candidatosPara(pix(), { totvs: [fat()] });
    expect(c).toHaveLength(1);
    expect(c[0].motivos).toEqual(expect.arrayContaining(['valor pago igual (título 1000.00)', 'mesma data', 'mesmo CNPJ/CPF', 'nome parecido']));
    expect(decidir(c).automatico).toBe(true);
  });

  test('título da empresa da conta ganha 5 pontos', () => {
    const [a] = candidatosPara(pix(), { totvs: [fat({ branch: 75 })] });
    const [b] = candidatosPara(pix(), { totvs: [fat({ branch: 5 })] });
    expect(a.score - b.score).toBe(5);
    expect(a.motivos).toContain('empresa da conta');
  });

  test('Pix de revenda pode ser parcial (fica para escolha), Pix de venda não', () => {
    const grande = fat({ valor: 5000, valorPago: null, data: '2026-09-10' });
    expect(candidatosPara(pix(), { totvs: [grande] })[0]).toMatchObject({ parcial: true });
    expect(candidatosPara(pix({ semParcial: true }), { totvs: [grande] })).toHaveLength(0);
  });
});

describe('nome genérico e parcial × exato', () => {
  const pix = (over = {}) => ({ id: 50, conta_id: 18, data: '2026-09-02', valor: 386.21, categoria: 'pix', banco: 'SICREDI', conta_titular: 'CROSBY CR VESTUARIO LTDA', descricao: 'RECEBIMENTO PIX', contraparte_nome: 'CROSBY CR VESTUARIO LTDA', ...over });
  const exato = { origem: 'TOTVS_CR', id: '5|1|1', branch: 5, valor: 387, valorPago: 386.21, data: '2026-09-02', nome: 'JAMES DA SILVA', detalhe: 'PIX' };
  const parcial = { origem: 'TOTVS_CR', id: '5|2|1', branch: 5, valor: 2999.02, valorPago: 3000, data: '2026-09-02', nome: 'FRANQUIA CROSBY GUARARAPES', detalhe: 'Fatura' };
  test('"CROSBY" não conta como nome parecido e o parcial não empata com o exato', () => {
    const c = candidatosPara(pix(), { totvs: [parcial, exato] });
    expect(c[0].id).toBe('5|1|1');
    expect(c[1].motivos).not.toContain('nome parecido');
    expect(decidir(c)).toMatchObject({ automatico: true, escolhido: expect.objectContaining({ id: '5|1|1' }) });
  });
  test('contraparte igual ao titular da conta não pontua nome', () => {
    const c = candidatosPara(pix(), { totvs: [{ ...exato, nome: 'CROSBY CR VESTUARIO LTDA' }] });
    expect(c[0].motivos).not.toContain('nome parecido');
  });
});
