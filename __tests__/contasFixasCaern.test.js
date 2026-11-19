import { describe, it, expect } from '@jest/globals';
import { lerContaDeAguaDaObservacao, passoDaCaern, lerFaturasDaCaern, faturasParaPegar } from '../utils/contasFixasCaern.js';
import { interpretarTextoFaturaCaern, valorDaArrecadacao } from '../utils/faturaCaernPdf.js';
import { pixDaMensagem } from '../utils/contasFixasEquatorial.js';
import { valorDoPix } from '../utils/contasFixasWhatsapp.js';

// mensagens no formato de buscarMensagens({ comConteudo: true }), como a CAERN mandou em 19/11/2026
const lista = (rows, description = '') => ({ tipo: 'ListMessage', texto: '', conteudo: { description, sections: [{ rows }] } });
const botoes = (contentText) => ({ tipo: 'ButtonsMessage', texto: '', conteudo: { contentText, buttons: [] } });
const texto = (t) => ({ tipo: 'Conversation', texto: t, conteudo: { text: t } });
const MENU = lista([{ title: 'Falta de água' }, { title: 'Vazamento de Água' }, { title: 'Segunda via' }, { title: 'Parcelamento' }], 'Como posso ajudar?');
const FATURAS = lista([{ title: 'Venc. 23/11/2026', description: 'R$ 120,72' }], 'Encontrei 1 faturas em aberto. Escolha qual deseja.');
const PIX = '00020126580014BR.GOV.BCB.PIX01361240aaaa-bbbb-4ccc-8ddd-0123456789ab5204000053039865406120.725802BR5905CAERN6005NATAL62070503***6304F284';

describe('conta de água na observação', () => {
  it('lê a matrícula e o CPF do titular, em qualquer ordem', () => {
    expect(lerContaDeAguaDaObservacao('MATRÍCULA: 2045088 CPF TITULAR: 529.982.247-25')).toEqual({ matricula: '2045088', documento: '52998224725' });
    expect(lerContaDeAguaDaObservacao('CPF DO TITULAR: 52998224725 MATRÍCULA: 3720922')).toEqual({ matricula: '3720922', documento: '52998224725' });
  });

  it('conta no nome do locatário, sem CPF: falta o documento', () => {
    expect(lerContaDeAguaDaObservacao('Vendedora envia o boleto. É no nome do locatário (Fulano) Matricula: 11706201')).toEqual({ matricula: '11706201', documento: null });
    expect(lerContaDeAguaDaObservacao(null)).toEqual({ matricula: null, documento: null });
  });
});

describe('passoDaCaern', () => {
  it.each([
    [MENU, 'menu'],
    [texto('Vamos localizar suas faturas. Informe o CPF ou CNPJ do titular da conta.'), 'pedir_documento'],
    [texto('Agora, informe a matrícula do imóvel.'), 'pedir_matricula'],
    [FATURAS, 'lista_faturas'],
    [botoes('Não encontrei faturas em aberto para esta matrícula. 🎉'), 'sem_fatura'],
    [botoes('Como você deseja continuar?'), 'continuar'],
    [texto('Por favor avalie o nosso atendimento de 1 a 5 link:\nhttps://exemplo/nps'), 'avaliacao'],
    [texto('Finalizando atendimento no bot por falta de interação'), 'encerrou'],
    [texto('O protocolo do seu atendimento é: 6afef65de7cce43f73e8225a'), 'aguardando'],
    [texto('💧 Olá! Seja bem-vindo(a) a CAERN. Eu sou a Caren, atendente virtual da Caern.'), 'aguardando'],
    [{ tipo: 'NativeFlowMessage', texto: PIX, conteudo: {} }, 'aguardando'],
    [null, 'aguardando'],
  ])('%#', (msg, passo) => expect(passoDaCaern(msg)).toBe(passo));
});

describe('faturas em aberto', () => {
  it('lê valor e vencimento da lista', () => {
    expect(lerFaturasDaCaern(FATURAS.conteudo)).toEqual([{ titulo: 'Venc. 23/11/2026', valor: 120.72, vencimento: '2026-11-23' }]);
    expect(lerFaturasDaCaern(MENU.conteudo)).toEqual([]);
    expect(lerFaturasDaCaern(null)).toEqual([]);
  });

  it('por padrão o bot pega só a de vencimento mais novo', () => {
    const duas = lerFaturasDaCaern(lista([{ title: 'Venc. 23/10/2026', description: 'R$ 1.118,40' }, { title: 'Venc. 23/11/2026', description: 'R$ 120,72' }]).conteudo);
    expect(duas[0]).toEqual({ titulo: 'Venc. 23/10/2026', valor: 1118.4, vencimento: '2026-10-23' });
    expect(faturasParaPegar(duas).map((f) => f.vencimento)).toEqual(['2026-11-23']);
    expect(faturasParaPegar(duas, { todas: true })).toHaveLength(2);
    expect(faturasParaPegar([])).toEqual([]);
  });

  it('o Pix chega como texto da mensagem, com a CAERN como recebedora', () => {
    const pix = pixDaMensagem({ tipo: 'NativeFlowMessage', texto: PIX, conteudo: {} });
    expect(pix).toBe(PIX);
    expect(valorDoPix(pix)).toBe(120.72);
    expect(/CAERN/.test(pix)).toBe(true);
  });
});

describe('nota fiscal da CAERN em PDF', () => {
  // trecho do texto do PDF real da loja 1 (19/11/2026), na ordem embaralhada em que o leitor entrega; nome e CPF trocados
  const TEXTO =
    '13/11/2026 POTENCIAL NOV/26 120,72 23/11/2026 PROTOCOLO DE AUTORIZAÇÃO: 3242600003882394 NÚMERO DA NOTA FISCAL: 004239564 SÉRIE: 001 CHAVE DE ACESSO: 2426 1108 3343 8500 0135 7500 1004 2395 6420 0353 6465 DATA DE EMISSÃO: 13/11/2026, às 11:22:10 DADOS DA NOTA FISCAL FULANO DE TAL MATRÍCULA VENCIMENTO 00204508.8 COMPANHIA DE ÁGUAS E ESGOTOS DO RIO GRANDE DO NORTE CNPJ: 08.334.385/0001-35 Endereço: MÊS EMISSÃO TOTAL A PAGAR Data: 19/11/2026 CPF/CNPJ: 529.982.247-25 TOTAL(R$) VENCIMENTO NOV/26 23/11/2026 0,60 2,00 82600000001-6 20720006115-9 00204508801-6 11202600003-7 5,50 MÊS REFERÊNCIA R$120,72 COD. DÉB. Nº MATRÍCULA 00204508.8 00204508.8 15/10/26 13/11/26 28/02/2027';

  it('lê nota, emissão, competência, matrícula, vencimento, valor e código de barras', () => {
    const { texto: _t, ...r } = interpretarTextoFaturaCaern(TEXTO);
    expect(r).toEqual({
      notaFiscal: '004239564',
      serie: '001',
      emissao: '2026-11-13',
      referencia: '11/2026',
      matricula: '2045088',
      vencimento: '2026-11-23',
      valor: 120.72,
      linhaDigitavel: '82600000001-6 20720006115-9 00204508801-6 11202600003-7',
      cnpjEmitente: '08334385000135',
    });
  });

  it('valor do código de arrecadação', () => {
    expect(valorDaArrecadacao(['82600000001-6', '20720006115-9', '00204508801-6', '11202600003-7'])).toBe(120.72);
    expect(valorDaArrecadacao(['82600000001-6', '20720006115-9'])).toBeNull();
    expect(valorDaArrecadacao(['00190000090-3', '33733820050-5', '57540911706-1', '63300000913-3'])).toBeNull(); // não começa com 8
  });

  it('texto que não é a nota não inventa dado', () => {
    const { texto: _t, ...r } = interpretarTextoFaturaCaern('qualquer coisa 12/2026');
    expect(Object.values(r).every((v) => v === null)).toBe(true);
  });
});
