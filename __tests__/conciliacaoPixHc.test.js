import { describe, test, expect } from '@jest/globals';
import { candidatoDoTitulo, pontuarPixHc, candidatosPixHc, juntarCandidatos, diaDaVenda, idsHcCrDaConciliacao, marcaDaConciliacao, textoConciliadoPor, feitaPeloExtrato, PONTOS_MESMO_DIA, PONTOS_UM_DIA, PONTOS_FORA_MAQUININHA } from '../utils/conciliacaoPixHc.js';
import { decidir } from '../services/fluxoCaixaConciliacao.js';

const titulo = (extra = {}) => ({
  id: 1261,
  empresa: 95,
  fatura: 9000000788,
  parcela: 1,
  venda_id: 788,
  origem: 'pdv',
  cliente_nome: 'ARTHUR VICTOR',
  cliente_cpf_cnpj: '123.456.789-09',
  nf_numero: 202,
  nf_modelo: 65,
  emissao: '2026-11-27',
  valor: 281,
  criado_em: '2026-11-27T17:52:26.000Z',
  ...extra,
});
// linha do extrato: Pix da maquininha na conta Stone do Midway (empresa 95)
const linha = (extra = {}) => ({ id: 5, data: '2026-11-27', valor: 281, categoria: 'pix', filiaisConta: [95], pixMaquininha: true, contraparte_nome: 'MARIA DE OUTRA CONTA', ...extra });

describe('venda em Pix do PDV Crosby como candidata do Pix recebido', () => {
  test('dia da venda é o dia local, não o UTC', () => {
    expect(diaDaVenda({ criado_em: '2026-11-28T01:10:00.000Z', emissao: '2026-11-28' })).toBe('2026-11-27');
    expect(diaDaVenda({ emissao: '2026-11-20' })).toBe('2026-11-20');
  });

  test('título vira candidato com origem HC_CR e os dados da venda', () => {
    const c = candidatoDoTitulo(titulo());
    expect(c).toMatchObject({ origem: 'HC_CR', id: '1261', branch: 95, valor: 281, data: '2026-11-27', nome: 'ARTHUR VICTOR', doc: '12345678909', duplicata: '9000000788|1', semNome: true });
    expect(c.detalhe).toContain('venda 788');
    expect(c.hcCr).toMatchObject({ tituloId: 1261, vendaId: 788, nf: 202 });
  });

  test('mesma loja, mesmo valor e mesmo dia casa — o nome de quem pagou não importa', () => {
    const p = pontuarPixHc(linha(), candidatoDoTitulo(titulo()));
    expect(p.score).toBe(PONTOS_MESMO_DIA);
    expect(p.motivos).toEqual(['mesma loja', 'valor igual', 'mesmo dia da venda']);
    expect(decidir([p])).toMatchObject({ automatico: true });
  });

  test('outra loja, outro valor ou dia distante não é candidata', () => {
    const c = candidatoDoTitulo(titulo());
    expect(pontuarPixHc(linha({ filiaisConta: [87] }), c)).toBeNull();
    expect(pontuarPixHc(linha({ valor: 281.5 }), c)).toBeNull();
    expect(pontuarPixHc(linha({ data: '2026-11-29' }), c)).toBeNull();
    expect(pontuarPixHc(linha({ filiaisConta: [] }), c)).toBeNull();
  });

  test('1 dia de diferença aparece para conferir, mas não concilia sozinho', () => {
    const p = pontuarPixHc(linha({ data: '2026-11-28' }), candidatoDoTitulo(titulo()));
    expect(p.score).toBe(PONTOS_UM_DIA);
    expect(decidir([p]).automatico).toBe(false);
  });

  test('Pix que não é da maquininha aparece para conferir, mas não concilia sozinho', () => {
    const p = pontuarPixHc(linha({ pixMaquininha: false }), candidatoDoTitulo(titulo()));
    expect(p.score).toBe(PONTOS_FORA_MAQUININHA);
    expect(p.motivos).toContain('Pix fora da maquininha: confira');
    expect(decidir([p]).automatico).toBe(false);
  });

  test('venda já usada por outra linha não volta como candidata', () => {
    const c = candidatoDoTitulo(titulo());
    expect(pontuarPixHc(linha(), c, 281)).toBeNull();
    expect(candidatosPixHc(linha(), [c], new Map([['HC_CR:1261', 281]]))).toEqual([]);
  });

  test('duas vendas iguais na mesma loja e dia não travam: a 1ª linha usa uma, a 2ª usa a outra', () => {
    const itens = [candidatoDoTitulo(titulo({ id: 10, venda_id: 700, cliente_nome: 'ANA' })), candidatoDoTitulo(titulo({ id: 11, venda_id: 701, cliente_nome: 'BRUNO' }))];
    const usados = new Map();
    const d1 = decidir(candidatosPixHc(linha({ id: 1 }), itens, usados));
    expect(d1.automatico).toBe(true);
    expect(d1.escolhido.id).toBe('10');
    usados.set('HC_CR:10', 281);
    const d2 = decidir(candidatosPixHc(linha({ id: 2 }), itens, usados));
    expect(d2.automatico).toBe(true);
    expect(d2.escolhido.id).toBe('11');
  });

  test('título do TOTVS igualmente provável no mesmo dia deixa a linha para conferir', () => {
    const hc = pontuarPixHc(linha(), candidatoDoTitulo(titulo()));
    const totvs = { origem: 'TOTVS_CR', id: '95|500|1', branch: 95, valor: 281, data: '2026-11-27', nome: 'OUTRO CLIENTE', score: 75, motivos: ['valor igual', 'mesma data', 'empresa da conta'], parcial: false };
    const juntos = juntarCandidatos([totvs], [hc]);
    expect(juntos[0].origem).toBe('HC_CR');
    expect(decidir(juntos).automatico).toBe(false);
  });
});

describe('marca de conciliado no título do HeadCoach', () => {
  test('ids dos títulos usados numa conciliação simples e numa com vários itens', () => {
    expect(idsHcCrDaConciliacao({ origem: 'HC_CR', referencia: { id: '1261' } })).toEqual([1261]);
    expect(idsHcCrDaConciliacao({ origem: 'MULTIPLO', referencia: { itens: [{ origem: 'HC_CR', id: '5' }, { origem: 'TOTVS_CR', id: '95|1|1' }, { origem: 'HC_CR', id: '6' }] } })).toEqual([5, 6]);
    expect(idsHcCrDaConciliacao({ origem: 'TOTVS_CR', referencia: { id: '95|1|1' } })).toEqual([]);
  });

  test('a marca identifica a conciliação bancária e não confunde com a conciliação D+1 da tela', () => {
    const texto = textoConciliadoPor('Yago', 4321);
    expect(texto.endsWith(marcaDaConciliacao(4321))).toBe(true);
    expect(feitaPeloExtrato(texto)).toBe(true);
    expect(feitaPeloExtrato('Niziany')).toBe(false);
    expect(feitaPeloExtrato(null)).toBe(false);
  });
});

describe('dia com data deslocada não vira depósito da Rede', () => {
  test('entrada com depósito de valor idêntico em outra data marca o dia', async () => {
    const { diaComDepositoDeOutraData } = await import('../services/fluxoCaixaConciliacao.js');
    const itens = [{ valor: 503.12, data: '2026-11-05' }, { valor: 62.4, data: '2026-11-19' }];
    expect(diaComDepositoDeOutraData([{ valor: 503.12, data: '2026-11-19' }, { valor: 35.66, data: '2026-11-19' }], itens)).toBe(true);
    // depósito de mesmo valor a até 2 dias é o caso normal, não é data deslocada
    expect(diaComDepositoDeOutraData([{ valor: 62.4, data: '2026-11-20' }], itens)).toBe(false);
    expect(diaComDepositoDeOutraData([{ valor: 99.99, data: '2026-11-19' }], itens)).toBe(false);
    expect(diaComDepositoDeOutraData([], itens)).toBe(false);
  });
});
