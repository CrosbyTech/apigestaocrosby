import { describe, test, expect } from '@jest/globals';
import { veioDeSolicitacao, anexosDaSolicitacao, resumoDaSolicitacao } from '../utils/hcCpSolicitacaoOrigem.js';

describe('solicitação de origem da duplicata', () => {
  test('só a duplicata nascida de Solicitação Crosby aponta para uma solicitação', () => {
    expect(veioDeSolicitacao({ origem: 'solicitacao-crosby', origem_ref: 'abc' })).toBe(true);
    expect(veioDeSolicitacao({ origem: 'solicitacao-crosby', origem_ref: null })).toBe(false);
    expect(veioDeSolicitacao({ origem: 'totvs', origem_ref: '123' })).toBe(false);
    expect(veioDeSolicitacao(null)).toBe(false);
  });

  test('anexos: só links válidos, sem repetir, com a nota fiscal primeiro', () => {
    const a = anexosDaSolicitacao({
      comprovante_url: 'https://x/pedido.pdf',
      nota_fiscal_url: 'https://x/nf.pdf',
      comprovante_gestor_url: 'https://x/pedido.pdf', // repetido
      comprovante_fabio_url: '',
      imagens_exemplo_urls: '["https://x/1.png","nao-e-link"]',
      link_exemplo: null,
    });
    expect(a).toEqual([
      { rotulo: 'Nota fiscal', url: 'https://x/nf.pdf' },
      { rotulo: 'Anexo do pedido', url: 'https://x/pedido.pdf' },
      { rotulo: 'Imagem 1', url: 'https://x/1.png' },
    ]);
  });

  test('resumo traz quem pediu, o porquê, a observação e as aprovações', () => {
    const r = resumoDaSolicitacao({
      id: 'abc',
      solicitante: ' Kleiton Dantas ',
      setor: 'PRODUÇÃO',
      nivel_urgencia: 'urgente',
      status: 'enviado_totvs',
      descricao: 'Aviamentos comprados na Bonor',
      observacao: '  ',
      valor_total: '4537.11',
      forma_pagamento: 'pix',
      aprovado_gestor_em: '2026-11-27T21:23:15Z',
      aprovado_gestor_por_nome: 'Yago',
      tem_nota_fiscal: 'true',
      nf_chamado_dryland_numero: 3076,
      contatos_prestadores: [{ nome: 'João', telefone: '84 9999' }, {}],
    });
    expect(r).toMatchObject({ solicitante: 'Kleiton Dantas', setor: 'PRODUÇÃO', urgencia: 'urgente', descricao: 'Aviamentos comprados na Bonor', observacao: null, valor: 4537.11, formaPagamento: 'pix', temNotaFiscal: true, nfChamadoDryland: '3076', aprovadoFinanceiro: null });
    expect(r.aprovadoGestor).toEqual({ por: 'Yago', em: '2026-11-27T21:23:15Z' });
    expect(r.contatos).toEqual(['João · 84 9999']);
    expect(resumoDaSolicitacao(null)).toBeNull();
  });
});
