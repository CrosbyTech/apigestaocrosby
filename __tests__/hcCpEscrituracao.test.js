import { describe, it, expect } from '@jest/globals';
import { ESCRITURACOES, escrituracaoDaSolicitacao, escrituracaoPedida, separarParaEscrituracao } from '../utils/hcCpEscrituracao.js';
import { STATUS_QUE_ENVIAM } from '../utils/solicitacaoCp.js';

describe('marca de escrituração com que nasce a duplicata da solicitação', () => {
  it('com nota fiscal e sem escrituração: pendente', () => {
    expect(escrituracaoDaSolicitacao({ tem_nota_fiscal: true, nf_escriturado_em: null })).toBe('pendente');
  });
  it('com nota fiscal já escriturada (chamado concluído): escriturada', () => {
    expect(escrituracaoDaSolicitacao({ tem_nota_fiscal: true, nf_escriturado_em: '2026-11-20T10:00:00Z' })).toBe('escriturada');
  });
  it('sem nota fiscal (ou sem resposta): não leva marca', () => {
    expect(escrituracaoDaSolicitacao({ tem_nota_fiscal: false })).toBeNull();
    expect(escrituracaoDaSolicitacao({ tem_nota_fiscal: null })).toBeNull();
    expect(escrituracaoDaSolicitacao(null)).toBeNull();
  });
  it('a solicitação no status Nota Fiscal pode ir para o contas a pagar', () => {
    expect(STATUS_QUE_ENVIAM).toContain('nota_fiscal');
  });
});

describe('status pedido pela tela', () => {
  it('aceita pendente e escriturada, em qualquer caixa', () => {
    expect(escrituracaoPedida('pendente')).toBe('pendente');
    expect(escrituracaoPedida(' ESCRITURADA ')).toBe('escriturada');
  });
  it('vazio tira a marca', () => {
    expect(escrituracaoPedida(null)).toBeNull();
    expect(escrituracaoPedida('')).toBeNull();
    expect(escrituracaoPedida('nenhuma')).toBeNull();
  });
  it('qualquer outra coisa é erro', () => {
    expect(() => escrituracaoPedida('paga')).toThrow(/inválido/);
  });
  it('os rótulos da tela', () => {
    expect(ESCRITURACOES).toEqual({ pendente: 'Não escriturada', escriturada: 'Escriturada' });
  });
});

describe('quais duplicatas mudam de status', () => {
  const permitidas = new Set([1, 2]);
  const t = (id, extra = {}) => ({ id, empresa: 1, situacao: 'aberto', escrituracao: 'pendente', fornecedor_nome: 'LINKE SOLUCOES', duplicata: 1, parcela: 4, ...extra });

  it('muda a pendente para escriturada, inclusive a que já está paga', () => {
    const r = separarParaEscrituracao([t(1), t(2, { situacao: 'pago' })], permitidas, 'escriturada');
    expect(r.mudam.map((x) => x.id)).toEqual([1, 2]);
    expect(r.ignoradas).toEqual([]);
  });
  it('cancelada, de outra empresa ou já no status pedido: ficam de fora com o motivo', () => {
    const r = separarParaEscrituracao([t(1, { situacao: 'cancelado' }), t(2, { empresa: 99 }), t(3, { escrituracao: 'escriturada' })], permitidas, 'escriturada');
    expect(r.mudam).toEqual([]);
    expect(r.ignoradas.map((i) => [i.id, i.motivo])).toEqual([
      [1, 'a duplicata está cancelada'],
      [2, 'você não tem acesso à empresa 99'],
      [3, 'já está como escriturada'],
    ]);
    expect(r.ignoradas[0].rotulo).toBe('LINKE SOLUCOES 1/4');
  });
  it('dá para pôr a marca em duplicata que não tinha e para tirar', () => {
    expect(separarParaEscrituracao([t(1, { escrituracao: null })], permitidas, 'pendente').mudam).toHaveLength(1);
    expect(separarParaEscrituracao([t(1)], permitidas, null).mudam).toHaveLength(1);
    expect(separarParaEscrituracao([t(1, { escrituracao: null })], permitidas, null).ignoradas[0].motivo).toBe('já está sem marca de escrituração');
  });
});
