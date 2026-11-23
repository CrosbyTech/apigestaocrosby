import { ocultoNaConsulta, pagamentoDoTitulo, pagoParaImportar, chaveTotvs, rateioDoTotvs, linhaDoTituloTotvs, numerarDuplicatas, conciliacoesDoTitulo, liberacaoDoTitulo, baixasDoTituloTotvs, faltaDoTotvs } from '../utils/hcCpTotvs.js';

const item = (x = {}) => ({
  cd_empresa: 1,
  cd_fornecedor: 500,
  nm_fornecedor: 'ALUGUEL LTDA',
  nr_cpfcnpj_fornecedor: '12.345.678/0001-90',
  nr_duplicata: 7001,
  nr_parcela: 11,
  nr_portador: 0,
  dt_emissao: '2026-11-01T00:00:00',
  dt_vencimento: '2026-11-10T00:00:00',
  dt_liq: null,
  vl_duplicata: 1000,
  vl_pago: 0,
  vl_juros: 0,
  vl_desconto: 0,
  tp_previsaoreal: 'R',
  despesas: [{ expenseCode: 4001, expenseName: 'ALUGUEIS', costCenterCode: 10, proratedPercentage: 100, proratedValue: 1000 }],
  ...x,
});

describe('pagamento do título (mesma ordem da Consulta)', () => {
  test('baixa do TOTVS vem primeiro', () => {
    const pg = pagamentoDoTitulo(item({ dt_liq: '2026-11-09T00:00:00', vl_pago: 1000 }), { conciliacoes: [{ nr_duplicata: '7001', nr_parcela: 11, cd_fornecedor: 500, dt_pagamento: '2026-11-12', vl_pago: 900 }] });
    expect(pg).toEqual({ via: 'TOTVS', data: '2026-11-09', valorPago: 1000, conta: null });
  });

  test('conciliação: soma o que saiu no extrato e fica com a última data', () => {
    const conciliacoes = [
      { nr_duplicata: '7001', cd_empresa: 1, nr_parcela: 11, cd_fornecedor: 500, dt_pagamento: '2026-11-05', vl_pago: 400, banco: 'STONE' },
      { nr_duplicata: '7001', cd_empresa: 1, nr_parcela: 11, cd_fornecedor: 500, dt_pagamento: '2026-11-12', vl_pago: 600, banco: 'STONE' },
      { nr_duplicata: '7001', cd_empresa: 1, nr_parcela: 12, cd_fornecedor: 500, dt_pagamento: '2026-11-12', vl_pago: 999, banco: 'STONE' }, // outra parcela
    ];
    expect(pagamentoDoTitulo(item(), { conciliacoes })).toEqual({ via: 'CONCILIACAO', data: '2026-11-12', valorPago: 1000, conta: 'STONE', partes: [{ data: '2026-11-05', valor: 400, conta: 'STONE' }, { data: '2026-11-12', valor: 600, conta: 'STONE' }] });
    expect(pagamentoDoTitulo(item(), { conciliacoes: conciliacoes.slice(1, 2) })).toEqual({ via: 'CONCILIACAO', data: '2026-11-12', valorPago: 600, conta: 'STONE' }); // um pagamento só: sem partes
    expect(conciliacoesDoTitulo(item(), conciliacoes)).toHaveLength(2);
  });

  test('conciliação de outra empresa ou de outro fornecedor não casa', () => {
    expect(conciliacoesDoTitulo(item(), [{ nr_duplicata: '7001', cd_empresa: 2, nr_parcela: 11, cd_fornecedor: 500 }])).toHaveLength(0);
    expect(conciliacoesDoTitulo(item(), [{ nr_duplicata: '7001', cd_empresa: 1, nr_parcela: 11, cd_fornecedor: 501 }])).toHaveLength(0);
    expect(conciliacoesDoTitulo(item(), [{ nr_duplicata: '7001' }])).toHaveLength(0); // sem parcela nem fornecedor para conferir
  });

  test('Liberação: vale o valor real informado, senão o da duplicata; data do pagamento ou de quando marcou pago', () => {
    const lib = { nr_duplicata: '7001', cd_empresa: 1, nr_parcela: 11, cd_fornecedor: 500, vl_duplicata: 1000, vl_real: 980, dt_pagamento: null, pago_em: '2026-11-13T15:00:00Z', banco_pagamento: 'SICREDI', forma_pagamento: 'PIX' };
    expect(pagamentoDoTitulo(item(), { liberacoes: [lib] })).toEqual({ via: 'LIBERACAO', data: '2026-11-13', valorPago: 980, conta: 'SICREDI', forma: 'PIX' });
    expect(pagamentoDoTitulo(item(), { liberacoes: [{ ...lib, vl_real: null, dt_pagamento: '2026-11-14' }] })).toMatchObject({ data: '2026-11-14', valorPago: 1000 });
    expect(liberacaoDoTitulo(item(), [{ ...lib, nr_parcela: 12 }])).toBeNull();
  });

  test('em aberto = null; só entra com data e valor pago maior que zero', () => {
    expect(pagamentoDoTitulo(item())).toBeNull();
    expect(pagoParaImportar(null)).toBe(false);
    expect(pagoParaImportar({ via: 'TOTVS', data: '2026-11-09', valorPago: 0 })).toBe(false);
    expect(pagoParaImportar({ via: 'TOTVS', data: null, valorPago: 10 })).toBe(false);
    expect(pagoParaImportar({ via: 'TOTVS', data: '2026-11-09', valorPago: 0.79 })).toBe(true);
  });
});

describe('o que a Consulta esconde', () => {
  test('empréstimo sempre; fatura de banco só a emitida antes de 20/10/2026', () => {
    expect(ocultoNaConsulta(item({ ds_despesaitem: 'EMPRESTIMO CAPITAL DE GIRO' }))).toBe(true);
    expect(ocultoNaConsulta(item({ nm_fornecedor: 'BANCO DO NORDESTE', dt_emissao: '2026-10-19' }))).toBe(true);
    expect(ocultoNaConsulta(item({ nm_fornecedor: 'BANCO DO NORDESTE', dt_emissao: '2026-10-20' }))).toBe(false);
    expect(ocultoNaConsulta(item())).toBe(false);
  });
});

describe('linha do HeadCoach', () => {
  const pg = { via: 'CONCILIACAO', data: '2026-11-12', valorPago: 1000, conta: 'STONE' };

  test('nasce paga, com a marca TOTVS e o número de lá no documento fiscal', () => {
    const l = linhaDoTituloTotvs(item(), pg, { despesa: new Map([[4001, 'ALUGUEIS DE IMOVEIS']]), centro: new Map([[10, 'MATRIZ']]) });
    expect(l).toMatchObject({
      empresa: 1,
      fornecedor_code: 500,
      fornecedor_cpf_cnpj: '12345678000190',
      documento_fiscal: '7001',
      parcela: 11,
      situacao: 'pago',
      data_pagamento: '2026-11-12',
      valor: 1000,
      valor_pago: 1000,
      conta_pagamento: 'STONE',
      origem: 'totvs',
      origem_ref: '1|500|7001|11',
      despesa_code: 4001,
      despesa_nome: 'ALUGUEIS DE IMOVEIS',
      centro_custo_code: 10,
      centro_custo_nome: 'MATRIZ',
      emissao: '2026-11-01',
      vencimento: '2026-11-10',
      baixado_por: 'conciliação do extrato',
    });
    expect(l.observacao).toContain('pago via conciliação do extrato');
    expect(chaveTotvs(item())).toBe('1|500|7001|11');
  });

  test('sem parcela vira parcela 1; sem valor ou sem vencimento não entra', () => {
    expect(linhaDoTituloTotvs(item({ nr_parcela: 0 }), pg).parcela).toBe(1);
    expect(linhaDoTituloTotvs(item({ vl_duplicata: 0 }), pg)).toBeNull();
    expect(linhaDoTituloTotvs(item({ dt_vencimento: null }), pg)).toBeNull();
  });

  test('rateio fecha no valor, com a diferença de centavos na última linha', () => {
    const r = rateioDoTotvs(
      [
        { expenseCode: 6010, costCenterCode: 1, proratedPercentage: 33.33 },
        { expenseCode: 6010, costCenterCode: 2, proratedPercentage: 33.33 },
        { expenseCode: 6010, costCenterCode: 3, proratedPercentage: 33.34 },
      ],
      100,
    );
    expect(r.map((x) => x.valor)).toEqual([33.33, 33.33, 33.34]);
    expect(r.reduce((s, x) => s + x.valor, 0)).toBeCloseTo(100, 2);
    expect(rateioDoTotvs([], 100)).toEqual([]);
  });

  test('sem percentual, divide pelo valor de cada linha', () => {
    const r = rateioDoTotvs([{ expenseCode: 1, costCenterCode: 1, proratedValue: 30 }, { expenseCode: 1, costCenterCode: 2, proratedValue: 70 }], 200);
    expect(r.map((x) => x.valor)).toEqual([60, 140]);
  });
});

describe('pago parcial', () => {
  const titulo = item({ nr_duplicata: 6455595, nr_parcela: 5, vl_duplicata: 15000 });
  const pg = { via: 'CONCILIACAO', data: '2026-11-06', valorPago: 9500, conta: 'STONE FABIO', partes: [{ data: '2026-11-03', valor: 2500, conta: 'STONE FABIO' }, { data: '2026-11-06', valor: 7000, conta: 'STONE FABIO' }] };

  test('sem a marca de parcial entra como paga; com ela fica em aberto pelo que falta', () => {
    expect(faltaDoTotvs(titulo, pg)).toBe(5500);
    expect(linhaDoTituloTotvs(titulo, pg)).toMatchObject({ situacao: 'pago', valor: 15000, valor_pago: 9500 });
    const l = linhaDoTituloTotvs(titulo, pg, {}, { parcial: true });
    expect(l).toMatchObject({ situacao: 'aberto', valor: 15000, valor_pago: 9500, data_pagamento: '2026-11-06' });
    expect(l.observacao).toContain('pago em parte');
  });

  test('marca de parcial em título pago por inteiro não muda nada', () => {
    expect(linhaDoTituloTotvs(titulo, { ...pg, valorPago: 15000, partes: undefined }, {}, { parcial: true }).situacao).toBe('pago');
  });

  test('uma baixa por pagamento, cada uma com o que estava em aberto antes', () => {
    const l = linhaDoTituloTotvs(titulo, pg, {}, { parcial: true });
    const b = baixasDoTituloTotvs(l, pg);
    expect(b.map((x) => [x.data_pagamento, x.valor_titulo, x.valor_pago])).toEqual([['2026-11-03', 15000, 2500], ['2026-11-06', 12500, 7000]]);
    expect(baixasDoTituloTotvs(linhaDoTituloTotvs(item(), { via: 'TOTVS', data: '2026-11-09', valorPago: 1000, conta: null }), { via: 'TOTVS', data: '2026-11-09', valorPago: 1000, conta: null })).toEqual([expect.objectContaining({ data_pagamento: '2026-11-09', valor_titulo: 1000, valor_pago: 1000 })]);
  });
});

describe('número da duplicata no HeadCoach', () => {
  const nova = (x) => ({ empresa: 1, fornecedor_code: 500, documento_fiscal: '7001', parcela: 11, vencimento: '2026-11-10', ...x });

  test('uma duplicata por empresa + fornecedor + duplicata do TOTVS, continuando da maior que já existe', () => {
    const existentes = [{ empresa: 1, fornecedor_code: 500, duplicata: 3, parcela: 10, documento_fiscal: 'x', origem: 'manual', situacao: 'aberto' }];
    const { linhas, conflitos } = numerarDuplicatas([nova(), nova({ parcela: 12, vencimento: '2026-12-10' }), nova({ documento_fiscal: '7002', parcela: 1, vencimento: '2026-11-20' }), nova({ fornecedor_code: 600 })], existentes);
    expect(conflitos).toHaveLength(0);
    expect(linhas.map((l) => `${l.fornecedor_code}:${l.documento_fiscal}:${l.duplicata}/${l.parcela}`).sort()).toEqual(['500:7001:4/11', '500:7001:4/12', '500:7002:5/1', '600:7001:1/11']);
  });

  test('duplicata do TOTVS já importada mantém o número; parcela que já existe é conflito', () => {
    const existentes = [{ empresa: 1, fornecedor_code: 500, duplicata: 2, parcela: 11, documento_fiscal: '7001', origem: 'totvs', situacao: 'pago' }];
    const { linhas, conflitos } = numerarDuplicatas([nova({ parcela: 12 }), nova()], existentes);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({ duplicata: 2, parcela: 12 });
    expect(conflitos).toHaveLength(1);
  });
});
