// Regras puras da conciliação bancária: chave estável, pontuação, uso parcial
// de duplicata e decisão automática.
import { atribuirChaves, candidatosPara, decidir, depositosStoneDoDia, candidatosEntradaStone, ehEntradaStone, ehEntradaPixMaquininha, ehEntradaPixTotvs, ehEntradaPixCliente, parearTarifasBoleto, parearDevolucoesPix, ehSaquePagarme, parearEstornosCartao, parearAplicacoesStone, pessoaProLabore } from '../services/fluxoCaixaConciliacao.js';

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
    expect(c[0].motivos.join(' ')).toMatch(/vencimento a 2 dia/);
    // mesma solicitação com pagamento registrado na data pontuaria mais
    const pago = candidatosPara(saida(), { liberacao: [lib({ nome: 'CLARO' })], totvs: [], solicitacoes: [] });
    expect(c[0].score).toBeLessThan(pago[0].score);
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
    expect(c[0].motivos).toEqual(expect.arrayContaining(['valor pago igual (título 1000.00)', 'mesma data', 'mesmo CNPJ/CPF', 'mesmo fornecedor']));
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

describe('tarifa de boleto × depósito por boleto (Stone)', () => {
  const dep = (id, seq, valor, saldo) => ({ id, conta_id: 14, data: '2026-10-23', seq, valor, saldo_apos: saldo, descricao: 'DEPOSITO POR BOLETO' });
  const tar = (id, seq, saldo) => ({ id, conta_id: 14, data: '2026-10-23', seq, valor: -1.99, saldo_apos: saldo, descricao: 'TARIFA BOLETO STONE' });
  test('cada tarifa casa com o depósito logo antes (mesmo saldo após); tarifa sem depósito fica de fora', () => {
    const ls = [dep(1, 103, 400, 398.01), tar(2, 104, 398.01), { id: 99, conta_id: 14, data: '2026-10-23', seq: 105, valor: 2400.83, descricao: 'RECEBIMENTO PIX' }, tar(3, 106, 2796.85), dep(4, 107, 750, 3544.86), tar(5, 108, 3544.86)];
    const p = parearTarifasBoleto(ls);
    expect(p.get(2)).toMatchObject({ papel: 'TARIFA', parId: 1, parValor: 400 });
    expect(p.get(1)).toMatchObject({ papel: 'DEPOSITO', parId: 2, parValor: -1.99 });
    expect(p.get(5)).toMatchObject({ papel: 'TARIFA', parId: 4 });
    expect(p.has(3)).toBe(false); // sem depósito antes dela no dia
    expect(p.has(99)).toBe(false);
  });
  test('dias e contas diferentes não se misturam', () => {
    const p = parearTarifasBoleto([dep(1, 1, 300, 298.01), { ...tar(2, 2, 298.01), data: '2026-10-27' }, { ...tar(3, 3, 298.01), conta_id: 7 }]);
    expect(p.size).toBe(0);
  });
});

describe('saída óbvia: solicitação aprovada, mesmo valor e mesmo fornecedor', () => {
  test('iFood 208,00 pago por Pix 3 dias antes do vencimento da solicitação → automático', () => {
    const l = saida({ valor: -208, data: '2026-10-17', contraparte_nome: 'IFOOD.COM AGENCIA DE RESTAURANTES ONLINE S.A.', contraparte_doc: null, memo: 'IFOOD.COM AGENCIA DE RESTAURANTES ONLINE S.A. - Transferência | Pix' });
    const sol = { origem: 'SOLICITACAO', id: 'S9', valor: 208, data: '2026-10-20', nome: 'IFOOD.COM AGENCIA DE RESTAURANTES ONLINE S.A.', doc: '14380200000121', empresa: 'CROSBY SHOPPING PATOS', detalhe: 'pagamento · pix · aprovado_gestor', semDataPagamento: true };
    const c = candidatosPara(l, { liberacao: [], totvs: [], solicitacoes: [sol] });
    expect(c[0].motivos).toEqual(expect.arrayContaining(['valor igual', 'vencimento a 3 dia(s)', 'mesmo fornecedor', 'único candidato com este valor']));
    expect(decidir(c)).toMatchObject({ automatico: true });
  });
  test('nome só vagamente parecido continua pedindo escolha', () => {
    const l = saida({ valor: -208, data: '2026-10-17', contraparte_nome: 'AGENCIA CENTRAL LTDA', contraparte_doc: null });
    const sol = { origem: 'SOLICITACAO', id: 'S9', valor: 208, data: '2026-10-20', nome: 'IFOOD.COM AGENCIA DE RESTAURANTES ONLINE S.A.', doc: '14380200000121', semDataPagamento: true };
    const c = candidatosPara(l, { liberacao: [], totvs: [], solicitacoes: [sol] });
    expect(decidir(c).automatico).toBe(false);
  });
});

describe('solicitação longe do vencimento continua candidata', () => {
  test('JJI 23.862,19 pago 24 dias depois do vencimento, com NF, mesmo fornecedor → automático', () => {
    const l = saida({ valor: -23862.19, data: '2026-10-26', contraparte_nome: 'JJI DISTRIBUIDORA LTDA', contraparte_doc: null });
    const sol = { origem: 'SOLICITACAO', id: 'S1', valor: 23862.19, data: '2026-10-02', nome: 'JJI DISTRIBUIDORA LTDA', doc: '07071009000132', status: 'nota_fiscal', detalhe: 'pagamento · pix · nota_fiscal', semDataPagamento: true };
    const c = candidatosPara(l, { liberacao: [], totvs: [], solicitacoes: [sol] });
    expect(c).toHaveLength(1);
    expect(c[0].motivos).toEqual(expect.arrayContaining(['valor igual', 'vencimento a 24 dias', 'mesmo fornecedor', 'único candidato com este valor']));
    expect(decidir(c).automatico).toBe(true);
  });
  test('mais de 180 dias do vencimento não entra', () => {
    const l = saida({ valor: -100, data: '2026-10-26' });
    const sol = { origem: 'SOLICITACAO', id: 'S2', valor: 100, data: '2026-03-01', nome: 'CLARO', semDataPagamento: true };
    expect(candidatosPara(l, { liberacao: [], totvs: [], solicitacoes: [sol] })).toHaveLength(0);
  });
});

describe('Pix enviado × devolução recebida', () => {
  const sd = (id, seq, over = {}) => ({ id, conta_id: 10, data: '2026-10-26', seq, valor: -23862.19, categoria: 'pix', descricao: 'PAGAMENTO PIX', contraparte_nome: 'JJI DISTRIBUIDORA LTDA', ...over });
  const dev = (id, seq, over = {}) => ({ id, conta_id: 10, data: '2026-10-26', seq, valor: 23862.19, categoria: 'pix', descricao: 'DEVOLUCAO PIX RECEBIDA', memo: 'JJI DISTRIBUIDORA LTDA - Devolução | Pix', contraparte_nome: 'JJI DISTRIBUIDORA LTDA', ...over });
  test('devolução casa com a saída livre mais próxima; a saída já conciliada com a Liberação fica de fora', () => {
    const p = parearDevolucoesPix([sd(24179, 8), dev(24181, 10), sd(24190, 19)], new Set([24179]));
    expect(p.get(24181)).toMatchObject({ papel: 'DEVOLUCAO', parId: 24190 });
    expect(p.get(24190)).toMatchObject({ papel: 'SAIDA', parId: 24181 });
    expect(p.has(24179)).toBe(false);
  });
  test('contraparte diferente ou saída depois da devolução não casa', () => {
    expect(parearDevolucoesPix([sd(1, 1, { contraparte_nome: 'OUTRA EMPRESA' }), dev(2, 2)]).size).toBe(0);
    expect(parearDevolucoesPix([dev(2, 2), sd(1, 3, { data: '2026-10-27' })]).size).toBe(0);
  });
});

describe('saque automático da Pagar.me para a conta Stone', () => {
  const cnpjs = new Set(['27728810000549', '17177680001007']);
  const l = (over = {}) => ({ valor: 39751.81, banco: 'STONE', descricao: 'TRANSFERÊNCIA ENTRE CONTAS STONE', memo: 'Fabio Ferreira De Lima Azevedo - Transferência | Conta Stone', conta_cnpj: '27728810000549', ...over });
  test('entrada "entre contas Stone" em conta Stone com Pagar.me do mesmo CNPJ é saque Pagar.me', () => {
    expect(ehSaquePagarme(l(), cnpjs)).toBe(true);
    expect(ehSaquePagarme(l({ conta_cnpj: '17177680000205' }), cnpjs)).toBe(false); // João Pessoa não tem Pagar.me
    expect(ehSaquePagarme(l({ descricao: 'RECEBIMENTO PIX' }), cnpjs)).toBe(false);
    expect(ehSaquePagarme(l({ valor: -10 }), cnpjs)).toBe(false);
  });
  test('TED recebida na Sicredi vinda do CNPJ da conta Pagar.me também é saque Pagar.me', () => {
    const ted = { valor: 5870.81, banco: 'SICREDI', descricao: 'TED RECEBIDA', memo: 'TED 17177680001007 FERREIRA COMERCIO E CONFECCOES', contraparte_doc: '17177680001007', conta_cnpj: '17177680000116' };
    expect(ehSaquePagarme(ted, cnpjs)).toBe(true);
    expect(ehSaquePagarme({ ...ted, transferencia_id: 5 }, cnpjs)).toBe(false); // já casada com a saída de outra conta
    expect(ehSaquePagarme({ ...ted, contraparte_doc: '17177680000205' }, cnpjs)).toBe(false);
  });
});

describe('compra no cartão × estorno', () => {
  const compra = (id, data, seq) => ({ id, conta_id: 14, data, seq, valor: -338.27, categoria: 'cartao_compra', descricao: 'COMPRA CARTÃO STONE (PRÉ-PAGO)', contraparte_nome: 'IFD  ATACADAO SA' });
  const estorno = (id, data, seq) => ({ id, conta_id: 14, data, seq, valor: 338.27, categoria: 'cartao_compra', descricao: 'ESTORNO COMPRA CARTÃO STONE', contraparte_nome: 'IFD  ATACADAO SA' });
  test('duas compras e dois estornos iguais: cada estorno casa com a compra mais próxima antes dele', () => {
    const p = parearEstornosCartao([compra(116, '2026-10-16', 116), estorno(117, '2026-10-16', 117), compra(118, '2026-10-16', 118), estorno(132, '2026-10-18', 132)]);
    expect(p.get(117)).toMatchObject({ papel: 'ESTORNO', parId: 116 });
    expect(p.get(132)).toMatchObject({ papel: 'ESTORNO', parId: 118 });
    expect(p.get(116)).toMatchObject({ papel: 'COMPRA', parId: 117 });
    expect(p.size).toBe(4);
  });
  test('estabelecimento diferente, valor diferente ou compra já conciliada não casam', () => {
    expect(parearEstornosCartao([{ ...compra(1, '2026-10-16', 1), contraparte_nome: 'OUTRA LOJA' }, estorno(2, '2026-10-16', 2)]).size).toBe(0);
    expect(parearEstornosCartao([{ ...compra(1, '2026-10-16', 1), valor: -300 }, estorno(2, '2026-10-16', 2)]).size).toBe(0);
    expect(parearEstornosCartao([compra(1, '2026-10-16', 1), estorno(2, '2026-10-16', 2)], new Set([1])).size).toBe(0);
  });
});

describe('caixinha Stone: Dinheiro Guardado × Dinheiro Resgatado', () => {
  const apl = (id, data, seq, valor = -5160.51) => ({ id, conta_id: 7, data, seq, valor, categoria: 'emprestimo', descricao: 'PAGAMENTO LIMITE/EMPRÉSTIMO STONE', memo: 'Dinheiro Guardado - Cartão Mais Limite' });
  const res = (id, data, seq, valor = 5160.51) => ({ id, conta_id: 7, data, seq, valor, categoria: 'emprestimo', descricao: 'RESGATE LIMITE/EMPRÉSTIMO STONE', memo: 'Dinheiro Resgatado - Cartão Mais Limite' });
  test('aplicação e resgate de mesmo valor se casam; aplicação sem resgate fica conciliada como aplicação aberta', () => {
    const p = parearAplicacoesStone([apl(1, '2026-10-14', 3), res(2, '2026-10-16', 10), apl(3, '2026-10-20', 1, -2000)]);
    expect(p.get(1)).toMatchObject({ papel: 'APLICACAO', parId: 2, parData: '2026-10-16' });
    expect(p.get(2)).toMatchObject({ papel: 'RESGATE', parId: 1, parData: '2026-10-14' });
    expect(p.get(3)).toMatchObject({ papel: 'APLICACAO_ABERTA' });
  });
  test('resgate sem aplicação antes dele fica pendente; valor diferente não casa', () => {
    const p = parearAplicacoesStone([res(2, '2026-10-16', 10), apl(1, '2026-10-20', 3)]);
    expect(p.has(2)).toBe(false);
    expect(p.get(1)).toMatchObject({ papel: 'APLICACAO_ABERTA' });
    expect(parearAplicacoesStone([apl(1, '2026-10-14', 3, -100), res(2, '2026-10-16', 10)]).has(2)).toBe(false);
  });
});

describe('pró-labore (saídas para os sócios, pessoa física)', () => {
  test('pelo CPF (Sicredi) ou pelo nome completo sem LTDA (Stone → C6)', () => {
    expect(pessoaProLabore({ valor: -5000, contraparte_nome: 'FABIO FERREIRA DE LIMA', contraparte_doc: '06704197451' })?.id).toBe('fabio');
    expect(pessoaProLabore({ valor: -2000, contraparte_nome: 'FELIPE FERREIRA DE LIMA AZEVEDO', contraparte_doc: null, contraparte_banco: 'Banco C6 S.A.' })?.id).toBe('felipe');
    expect(pessoaProLabore({ valor: -200, contraparte_nome: 'FABIO FERREIRA DE LIMA AZEVEDO', contraparte_doc: null, contraparte_banco: null })?.id).toBe('fabio');
  });
  test('empresa do sócio, CNPJ, conta Stone/Mêntore do grupo, entrada ou transferência já casada não são pró-labore', () => {
    expect(pessoaProLabore({ valor: -1000, contraparte_nome: 'FABIO FERREIRA DE LIMA AZEVEDO LTDA', contraparte_banco: 'MÊNTORE INSTITUIÇÃO DE PAGAMENTO' })).toBeNull();
    expect(pessoaProLabore({ valor: -1000, contraparte_nome: 'FABIO FERREIRA DE LIMA AZEVEDO', contraparte_doc: '27728810000549' })).toBeNull();
    expect(pessoaProLabore({ valor: -1000, contraparte_nome: 'FABIO FERREIRA DE LIMA AZEVEDO', contraparte_banco: 'STONE INSTITUIÇÃO DE PAGAMENTO S.A.' })).toBeNull();
    expect(pessoaProLabore({ valor: 1000, contraparte_nome: 'FABIO FERREIRA DE LIMA AZEVEDO' })).toBeNull();
    expect(pessoaProLabore({ valor: -1000, contraparte_nome: 'FABIO FERREIRA DE LIMA AZEVEDO', transferencia_id: 9 })).toBeNull();
  });
});
