import { describe, it, expect } from '@jest/globals';
import { lerContaDaObservacao, passoDaCosern, lerRespostaCosern, escolherTitulo, lerListaDeFaturas, valorDoPix } from '../utils/contasFixasWhatsapp.js';

const botao = (fluxo, cta, nome = 'galaxy_message') => ({
  InteractiveMessage: { NativeFlowMessage: { buttons: [{ name: nome, buttonParamsJSON: JSON.stringify({ flow_cta: cta, flow_metadata: { flow_name: fluxo } }) }] } },
});

const lista = { buttonText: 'Ver faturas', sections: [{ rows: [{ description: 'R$169,54 com vencimento em 07/12/2026', rowID: '1', title: 'Fatura 1' }, { description: 'R$1.163,91 com vencimento em 06/11/2026', rowID: '2', title: 'Fatura 2' }] }] };

describe('lista de faturas e Pix', () => {
  it('lê título, valor e vencimento de cada linha', () => {
    expect(lerListaDeFaturas(lista)).toEqual([
      { titulo: 'Fatura 1', valor: 169.54, vencimento: '2026-12-07' },
      { titulo: 'Fatura 2', valor: 1163.91, vencimento: '2026-11-06' },
    ]);
    expect(lerListaDeFaturas({ sections: [{ rows: [{ title: 'Avaliar', description: 'Ótimo' }] }] })).toEqual([]);
    expect(lerListaDeFaturas(null)).toEqual([]);
  });

  it('lê o valor de dentro do Pix copia e cola', () => {
    expect(valorDoPix('00020126580014br.gov.bcb.pix01368cbd0ef7-b1bb-4012-a1ab-c2e0d9e3f9e55204000053039865406163.915802BR5917NEOENERGIA COSERN6005NATAL62560518CODBAR20027565439850300017BR.GOV.BCB.BRCODE01051.0.063042656')).toBe(163.91);
    expect(valorDoPix('00020101021226770014br.gov.bcb.pix2555api.itau/pix/qr/v2/dee65e67-0d00-497a-9c41-e2570816112f5204000053039865802BR5917NEOENERGIA COSERN6005NATAL62070503***63047F66')).toBeNull();
    expect(valorDoPix('')).toBeNull();
  });
});

describe('lerContaDaObservacao', () => {
  it('pega código do cliente e CNPJ rotulado', () => {
    const r = lerContaDaObservacao('WHATSAPP - CÓDIGO DO CLIENTE: 7029458159 CNPJ: 53.661.116/0001-38');
    expect(r).toEqual({ codigos: ['7029458159'], ucs: [], documento: '53661116000138', tipoDocumento: 'CNPJ', ambiguo: false });
  });

  it('tira os zeros à esquerda do código e ignora a UC', () => {
    const r = lerContaDaObservacao('LOGIN: 17.177.680/0001-16\nCÓDIGO DO CLIENTE: 007023691315 | UC: 556.891.032-05 | RUA SAO JOSE');
    expect(r.codigos).toEqual(['7023691315']);
    expect(r.ucs).toEqual(['55689103205']);
    expect(r.documento).toBe('17177680000116');
  });

  it('CPF do titular e dois códigos', () => {
    const r = lerContaDaObservacao('CÓDIGO DO CLIENTE 7027761660 e 7027761733 | CPF TITULAR: 067.041.974-51');
    expect(r.codigos).toEqual(['7027761660', '7027761733']);
    expect(r).toMatchObject({ documento: '06704197451', tipoDocumento: 'CPF' });
  });

  it('sem documento válido não inventa', () => {
    expect(lerContaDaObservacao('CÓDIGO DO CLIENTE: 007022067863 | UC: 2.064.031.032-01').documento).toBeNull();
    expect(lerContaDaObservacao(null)).toEqual({ codigos: [], ucs: [], documento: null, tipoDocumento: null, ambiguo: false });
  });
});

describe('passoDaCosern', () => {
  it.each([
    [{ texto: 'Para começar seu atendimento, clique no botão abaixo.', conteudo: botao('Cosern - Fluxo identificação_v9_1', 'Começar') }, 'identificar'],
    [{ texto: 'Não entendi o que você disse.', conteudo: botao('Cosern - Fluxo identificação_v9_1', 'Informar dados') }, 'identificar'],
    [{ texto: 'preciso saber para qual serviço', conteudo: botao('Cosern - Fluxo Menu_v8_1', 'Ver opções') }, 'menu'],
    [{ texto: 'Você não tem nenhuma fatura vencida ou em aberto', conteudo: botao('', '', 'cta_url') }, 'sem_fatura'],
    [{ texto: 'Encontrei 1 fatura em aberto:\n*Valor*: R$R$ 393,11' }, 'resultado'],
    [{ texto: '00020101021226770014br.gov.bcb.pix', conteudo: botao('', '', 'payment_request') }, 'resultado'],
    [{ texto: 'Poxa! Acho que você não pode falar agora. Vou encerrar nossa conversa' }, 'encerrou'],
    [{ texto: 'Poxa! Acho que não estamos conseguindo nos entender.' }, 'encerrou'],
    [{ texto: 'Hmm... Essa não é uma nota válida. Por favor, clique no botão abaixo para avaliar o nosso atendimento.' }, 'avaliacao'],
    [{ texto: 'Não entendi o que você disse.', conteudo: botao('Cosern - Fluxo Menu_v8_1', 'Ver opções') }, 'menu'],
    [{ texto: 'Aqui estão as informações para pagamento da fatura.' }, 'resultado'],
    [{ texto: 'Hmm... Essa não é uma fatura válida.', tipo: 'ListMessage', conteudo: lista }, 'lista_faturas'],
    [{ texto: '', tipo: 'ButtonsMessage', conteudo: { contentText: 'Você gostaria de emitir a 2ª via de outra fatura?', buttons: [] } }, 'outra_fatura'],
    [{ texto: '', tipo: 'ButtonsMessage', conteudo: { contentText: 'Hmm... Não entendi o que você disse. Clique em um dos botões abaixo para me falar se deseja a 2ª via de outra fatura.' } }, 'outra_fatura'],
    [{ texto: 'Um momento' }, 'aguardando'],
    [null, 'aguardando'],
  ])('%#', (msg, passo) => expect(passoDaCosern(msg)).toBe(passo));
});

describe('lerRespostaCosern', () => {
  it('junta valor, vencimento, Pix e PDF', () => {
    const r = lerRespostaCosern([
      { texto: 'Encontrei 1 fatura em aberto:\n\n*Valor*: R$R$ 1.393,11\n*Vencimento*: 11/11/2026', tipo: 'Conversation', id: 'a' },
      { texto: '', tipo: 'DocumentMessage', id: 'doc1' },
      { texto: '00020101021226770014br.gov.bcb.pix2555api.itau', tipo: 'NativeFlowMessage', id: 'c' },
    ]);
    expect(r).toEqual({ semFatura: false, qtd: 1, faturas: [{ valor: 1393.11, vencimento: '2026-11-11' }], pix: ['00020101021226770014br.gov.bcb.pix2555api.itau'], pdfs: ['doc1'] });
  });

  it('sem fatura em aberto', () => {
    expect(lerRespostaCosern([{ texto: 'Você não tem nenhuma fatura vencida ou em aberto para emissão de 2ª via.' }])).toMatchObject({ semFatura: true, faturas: [] });
  });
});

describe('escolherTitulo', () => {
  const fatura = { valor: 393.11, vencimento: '2026-11-11' };
  const titulo = (over = {}) => ({ id: 't1', status: 'PENDENTE', vl_duplicata: 393.11, dt_vencimento: '2026-11-11', chave_pix: null, codigo_barras: null, ...over });

  it('liga quando só um título bate valor e vencimento', () => {
    expect(escolherTitulo(fatura, [titulo(), titulo({ id: 't2', vl_duplicata: 208.94 })])?.id).toBe('t1');
    expect(escolherTitulo(fatura, [titulo({ dt_vencimento: '2026-11-14T00:00:00' })])?.id).toBe('t1');
  });

  it('VALOR REAL vale mais que o da duplicata', () => {
    expect(escolherTitulo(fatura, [titulo({ vl_duplicata: 400, vl_real: 393.11 })])?.id).toBe('t1');
  });

  it.each([
    ['dois candidatos', [titulo(), titulo({ id: 't2' })]],
    ['já pago', [titulo({ status: 'PAGO' })]],
    ['já tem Pix', [titulo({ chave_pix: '000201' })]],
    ['valor diferente', [titulo({ vl_duplicata: 393.12 })]],
    ['vencimento longe', [titulo({ dt_vencimento: '2026-11-27' })]],
  ])('não liga: %s', (_, titulos) => expect(escolherTitulo(fatura, titulos)).toBeNull());
});
