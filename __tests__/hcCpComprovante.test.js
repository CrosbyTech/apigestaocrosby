import { describe, it, expect } from '@jest/globals';
import { titulosHcDaConciliacao, ehReciboDaStone, comprovantesDaSolicitacao } from '../utils/hcCpComprovante.js';

describe('duplicatas do Contas a Pagar HeadCoach citadas na conciliação', () => {
  it('saída conciliada direto com a duplicata (HC_CP)', () => {
    expect(titulosHcDaConciliacao({ origem: 'HC_CP', referencia: { id: '275', nome: 'SECRETARIA DE ESTADO DA TRIBUTACAO', valor: 1298.82 } })).toEqual([275]);
  });
  it('várias duplicatas na mesma saída: só os itens do HeadCoach', () => {
    const conc = { origem: 'MULTIPLO', referencia: { itens: [{ origem: 'HC_CP', id: 12 }, { origem: 'SOLICITACAO', id: 'abc' }, { origem: 'HC_CP', id: '13' }] } };
    expect(titulosHcDaConciliacao(conc)).toEqual([12, 13]);
  });
  it('baixa automática da Liberação de Pagamento (MANUAL com destino HeadCoach)', () => {
    const conc = { origem: 'MANUAL', referencia: { destino: 'contas-pagar-headcoach', nome: 'SALATIEL', valor: 450, liberacoes: [{ valor: 450, empresa: 1, tituloId: 373, duplicata: '1/1', liberacaoId: 69 }] } };
    expect(titulosHcDaConciliacao(conc)).toEqual([373]);
  });
  it('conciliação manual comum, solicitação direta ou sem referência: nenhuma', () => {
    expect(titulosHcDaConciliacao({ origem: 'MANUAL', referencia: { nome: 'TARIFA' } })).toEqual([]);
    expect(titulosHcDaConciliacao({ origem: 'SOLICITACAO', referencia: { id: 'abc' } })).toEqual([]);
    expect(titulosHcDaConciliacao({ origem: 'HC_CP', referencia: null })).toEqual([]);
    expect(titulosHcDaConciliacao(null)).toEqual([]);
  });
  it('não repete a duplicata nem aceita id que não é número', () => {
    expect(titulosHcDaConciliacao({ origem: 'HC_CP', referencia: { id: 5, itens: [{ origem: 'HC_CP', id: 5 }, { origem: 'HC_CP', id: 'x' }] } })).toEqual([5]);
  });
});

describe('o que a tela mostra de comprovante na solicitação', () => {
  const stone = 'https://x.supabase.co/storage/v1/object/public/solicitacoes-crosby/comprovantes/d484fac6/stone-2026-11-24-27150.pdf';
  const anexo = 'https://x.supabase.co/storage/v1/object/public/solicitacoes-crosby/comprovantes/1795612266672-hpfcriqqimc.jpeg';

  it('reconhece o recibo da Stone pelo nome do arquivo', () => {
    expect(ehReciboDaStone(stone)).toBe(true);
    expect(ehReciboDaStone(anexo)).toBe(false);
    expect(ehReciboDaStone(null)).toBe(false);
  });
  it('pedido com anexo e pagamento com recibo: os dois aparecem, cada um no seu lugar', () => {
    expect(comprovantesDaSolicitacao({ comprovante_url: anexo, comprovante_pagamento_url: stone })).toEqual({ pagamento: stone, pedido: anexo });
  });
  it('solicitação antiga, com o recibo da Stone no campo de sempre: é comprovante de pagamento', () => {
    expect(comprovantesDaSolicitacao({ comprovante_url: stone })).toEqual({ pagamento: stone, pedido: null });
  });
  it('só o anexo do pedido: não é comprovante de pagamento', () => {
    expect(comprovantesDaSolicitacao({ comprovante_url: anexo })).toEqual({ pagamento: null, pedido: anexo });
  });
  it('sem nada', () => {
    expect(comprovantesDaSolicitacao({})).toEqual({ pagamento: null, pedido: null });
  });
});
