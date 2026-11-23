import { describe, it, expect } from '@jest/globals';
import { podeMudar, carimboDaMudanca, motivoDeNaoLiberar, resumoDasLiberacoes, EM_ANDAMENTO, STATUS, BANCOS } from '../services/hcCpLiberacao.js';
import { CpError } from '../services/hcContasPagar.js';

const AGORA = '2026-11-23T15:00:00.000Z';
const tit = (over = {}) => ({ situacao: 'aberto', valor: 1000, valor_pago: 0, juros: 0, multa: 0, desconto: 0, ...over });

describe('fluxo da liberação', () => {
  it('a ordem é pendente → previsão → aprovado → incluído; pago e devolvida são finais', () => {
    expect(EM_ANDAMENTO).toEqual(['pendente', 'previsao', 'aprovado', 'incluido']);
    expect(Object.keys(STATUS)).toEqual(['pendente', 'previsao', 'aprovado', 'incluido', 'pago', 'cancelado']);
    expect(BANCOS).toContain('STONE 0116');
  });

  it('entre as etapas em andamento vai e volta', () => {
    expect(podeMudar('pendente', 'previsao')).toBe(true);
    expect(podeMudar('pendente', 'incluido')).toBe(true); // pode pular etapa
    expect(podeMudar('incluido', 'pendente')).toBe(true); // e voltar
    expect(podeMudar('aprovado', 'aprovado')).toBe(false);
  });

  it('paga ou devolvida não se move; e ninguém vira pago por mudança de etapa', () => {
    expect(podeMudar('pago', 'pendente')).toBe(false);
    expect(podeMudar('cancelado', 'aprovado')).toBe(false);
    expect(podeMudar('aprovado', 'pago')).toBe(false);
    expect(podeMudar('aprovado', 'cancelado')).toBe(false);
  });
});

describe('carimbos de quem aprovou e de quem incluiu', () => {
  it('aprovar carimba a aprovação e limpa a inclusão (voltou de incluído)', () => {
    expect(carimboDaMudanca('aprovado', 'Wendy', AGORA)).toEqual({ status: 'aprovado', atualizado_por: 'Wendy', atualizado_em: AGORA, incluido_por: null, incluido_em: null, aprovado_por: 'Wendy', aprovado_em: AGORA });
  });

  it('incluir carimba a inclusão e não mexe em quem aprovou', () => {
    const p = carimboDaMudanca('incluido', 'Wendy', AGORA);
    expect(p).toMatchObject({ status: 'incluido', incluido_por: 'Wendy', incluido_em: AGORA });
    expect(p).not.toHaveProperty('aprovado_por');
  });

  it('voltar para pendente ou previsão limpa os dois carimbos', () => {
    for (const st of ['pendente', 'previsao']) expect(carimboDaMudanca(st, 'Wendy', AGORA)).toEqual({ status: st, atualizado_por: 'Wendy', atualizado_em: AGORA, aprovado_por: null, aprovado_em: null, incluido_por: null, incluido_em: null });
  });

  it('etapa que não existe (ou final) é recusada', () => {
    expect(() => carimboDaMudanca('pago', 'Wendy')).toThrow(CpError);
    expect(() => carimboDaMudanca('qualquer', 'Wendy')).toThrow(CpError);
  });
});

describe('o que pode ser liberado', () => {
  it('em aberto com valor a pagar: pode (inclusive a paga em parte, pelo que falta)', () => {
    expect(motivoDeNaoLiberar(tit())).toBeNull();
    expect(motivoDeNaoLiberar(tit({ valor_pago: 400 }))).toBeNull();
  });

  it('paga, cancelada, já liberada, sem saldo ou inexistente: não', () => {
    expect(motivoDeNaoLiberar(tit({ situacao: 'pago' }))).toMatch(/paga/);
    expect(motivoDeNaoLiberar(tit({ situacao: 'cancelado' }))).toMatch(/cancelada/);
    expect(motivoDeNaoLiberar(tit(), { jaLiberada: true })).toMatch(/Liberação/);
    expect(motivoDeNaoLiberar(tit({ valor_pago: 900, desconto: 100 }))).toMatch(/valor em aberto/);
    expect(motivoDeNaoLiberar(null)).toMatch(/não encontrada/);
  });
});

describe('resumo dos cards', () => {
  it('conta e soma por etapa; "ativos" é só o que ainda vai ser pago', () => {
    const r = resumoDasLiberacoes([
      { status: 'pendente', valor: 100 },
      { status: 'pendente', valor: 50.5 },
      { status: 'previsao', valor: 200 },
      { status: 'aprovado', valor: 300 },
      { status: 'incluido', valor: 400 },
      { status: 'pago', valor: 1000 },
      { status: 'cancelado', valor: 9999 },
    ]);
    expect(r.pendente).toEqual({ qtd: 2, valor: 150.5 });
    expect(r.previsao).toEqual({ qtd: 1, valor: 200 });
    expect(r.aprovado).toEqual({ qtd: 1, valor: 300 });
    expect(r.incluido).toEqual({ qtd: 1, valor: 400 });
    expect(r.pago).toEqual({ qtd: 1, valor: 1000 });
    expect(r.ativos).toEqual({ qtd: 5, valor: 1050.5 });
  });

  it('lista vazia devolve tudo zerado', () => {
    expect(resumoDasLiberacoes([]).ativos).toEqual({ qtd: 0, valor: 0 });
    expect(resumoDasLiberacoes(null).pendente).toEqual({ qtd: 0, valor: 0 });
  });
});
