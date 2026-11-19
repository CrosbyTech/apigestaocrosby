import { describe, it, expect } from '@jest/globals';
import { lerContaEquatorialDaObservacao, passoDaEquatorial, lerContasAbertas, lerImovelEquatorial, pixDaMensagem, mesmaConta, contasParaPegar } from '../utils/contasFixasEquatorial.js';
import { interpretarTextoFaturaEquatorial } from '../utils/faturaEquatorialPdf.js';
import { valorDoPix } from '../utils/contasFixasWhatsapp.js';

// mensagens no formato de buscarMensagens({ comConteudo: true }), como a Clara mandou em 18/11/2026
const lista = (titulos, description = '') => ({ tipo: 'ListMessage', texto: '', conteudo: { description, sections: [{ rows: titulos.map((title) => ({ title })) }] } });
const botoes = (contentText) => ({ tipo: 'ButtonsMessage', texto: '', conteudo: { contentText, buttons: [] } });
const texto = (t) => ({ tipo: 'Conversation', texto: t, conteudo: { text: t } });
const LISTA =
  'Qual conta você quer receber agora? É só digitar apenas o número da opção desejada.\n\n*1* - *Referência:* 03/2026 - *Valor:* R$ 783,35 - *Vencimento:* 18/03/2026\n*2* - *Referência:* 05/2026 - *Valor:* R$ 703,44 - *Vencimento:* 18/05/2026\n*3* - *Referência:* 11/2026 - *Valor:* R$ 913,33 - *Vencimento:* 17/11/2026';
const IMOVEL =
  'Encontrei um imóvel nesse cadastro por aqui em nome de *FULANO.*\n\nA sua *Conta Contrato* atual é 003008536090. A partir de agora, será denominada *Unidade Consumidora*, cuja numeração será 000331745701672, *Rua:* GODOFREDO VIANA, *Numero:* 396, *Bairro:* CE###O, *Cidade:* IMPERATRIZ\n\n\nÉ para esse imóvel que você deseja atendimento?';
const PIX = '00020126580014br.gov.bcb.pix01363c1d2e3f-0000-4111-8222-0123456789ab5204000053039865406913.335802BR5919Equatorial Maranhao6008Sao Luis62070503***630446CE';

describe('conta da Equatorial na observação', () => {
  it('lê a conta contrato e o CPF do titular', () => {
    expect(lerContaEquatorialDaObservacao('está no CPF do antiigo locatário: 529.982.247-25 \nConta contrato: 003008536090')).toEqual({ contaContrato: '003008536090', documento: '52998224725' });
  });

  it('sem conta contrato ou sem documento válido', () => {
    expect(lerContaEquatorialDaObservacao('CPF: 111.111.111-11')).toEqual({ contaContrato: null, documento: null });
    expect(lerContaEquatorialDaObservacao(null)).toEqual({ contaContrato: null, documento: null });
  });

  it('compara contas sem ligar para zeros à esquerda', () => {
    expect(mesmaConta('003008536090', '3008536090')).toBe(true);
    expect(mesmaConta('000331745701672', '331745701672')).toBe(true);
    expect(mesmaConta('3008536090', '3008536091')).toBe(false);
    expect(mesmaConta(null, null)).toBe(false);
  });
});

describe('passoDaEquatorial', () => {
  it.each([
    [lista(['Falta de Energia', 'Pagamentos', 'Segunda via de Fatura'], 'Sobre o que você quer falar?'), 'menu'],
    [botoes('Agora, vamos realizar a sua identificação. Selecione uma das opções abaixo:'), 'identificar'],
    [texto('Digite sua *Unidade Consumidora*'), 'pedir_uc'],
    [botoes(IMOVEL), 'confirmar_imovel'],
    [texto(LISTA), 'lista_contas'],
    [lista(['Pagar agora', 'Pagar com pix', 'Código de barras', '2ª via de conta', 'Pagar com cartão'], 'Para pagar *uma fatura por vez,*'), 'menu_pagamento'],
    [texto('Ok. Pra te enviar a conta, preciso fazer uma validação de segurança. \n\nDigite os 4 primeiros dígitos do *CPF* ou *CNPJ* de quem é titular da conta'), 'validar_inicio'],
    [texto('O número digitado está inválido. 🙁\n\nVamos tentar de novo. Digite os 4 últimos dígitos do CPF ou CNPJ de quem é titular da conta'), 'validar_fim'],
    [botoes('Quer receber alguma outra conta?'), 'outra_conta'],
    [botoes('Posso te ajudar com mais alguma coisa?'), 'algo_mais'],
    [texto('Antes de encerrar, você pode me contar o que achou da nossa conversa? É só digitar o número da sua opção.'), 'pesquisa'],
    [texto('*5* - Muito satisfeito 😍\n*4* - Satisfeito 😊'), 'pesquisa'],
    [texto('Pronto!\nAqui está a *2ª via* da sua fatura.'), 'aguardando'],
    [texto('Encontrei 3 conta(s) em aberto para esta unidade consumidora. \n\nTotalizando *R$ 2400,12*'), 'aguardando'],
    [texto('*Como pagar com Pix?*\n\n1️⃣ Acesse a área Pix no app do seu banco'), 'aguardando'],
    [null, 'aguardando'],
  ])('%#', (msg, passo) => expect(passoDaEquatorial(msg)).toBe(passo));
});

describe('o que a Equatorial manda', () => {
  it('lista de contas em aberto', () => {
    expect(lerContasAbertas(LISTA)).toEqual([
      { opcao: 1, referencia: '03/2026', valor: 783.35, vencimento: '2026-03-18' },
      { opcao: 2, referencia: '05/2026', valor: 703.44, vencimento: '2026-05-18' },
      { opcao: 3, referencia: '11/2026', valor: 913.33, vencimento: '2026-11-17' },
    ]);
    expect(lerContasAbertas('*1* - *Referência:* 01/2027 - *Valor:* R$ 1.234,56 - *Vencimento:* 18/01/2027')).toEqual([{ opcao: 1, referencia: '01/2027', valor: 1234.56, vencimento: '2027-01-18' }]);
    expect(lerContasAbertas('Vamos lá!')).toEqual([]);
  });

  it('por padrão o bot pega só a última conta em aberto (a do mês)', () => {
    const abertas = lerContasAbertas(LISTA);
    expect(contasParaPegar(abertas).map((c) => c.referencia)).toEqual(['11/2026']);
    expect(contasParaPegar(abertas, { todas: true }).map((c) => c.referencia)).toEqual(['03/2026', '05/2026', '11/2026']);
    expect(contasParaPegar(abertas, { referencia: '05/2026' }).map((c) => c.referencia)).toEqual(['05/2026']);
    expect(contasParaPegar(abertas, { referencia: '12/2026' })).toEqual([]);
    expect(contasParaPegar([abertas[0]])).toEqual([abertas[0]]);
    expect(contasParaPegar([])).toEqual([]);
    // a ordem da lista não importa: vale o vencimento
    expect(contasParaPegar([abertas[2], abertas[0]]).map((c) => c.referencia)).toEqual(['11/2026']);
  });

  it('imóvel: conta contrato, UC nova e endereço', () => {
    expect(lerImovelEquatorial(IMOVEL)).toEqual({ contaContrato: '3008536090', uc: '331745701672', rua: 'GODOFREDO VIANA', cidade: 'IMPERATRIZ' });
  });

  it('Pix copia e cola: no texto da mensagem ou dentro do botão de pagamento', () => {
    expect(pixDaMensagem({ tipo: 'NativeFlowMessage', texto: PIX, conteudo: {} })).toBe(PIX);
    const noBotao = { tipo: 'NativeFlowMessage', texto: '', conteudo: { InteractiveMessage: { NativeFlowMessage: { buttons: [{ name: 'payment_request', buttonParamsJSON: JSON.stringify({ payment_setting: { type: 'pix_dynamic_code', pix_dynamic_code: { code: PIX } } }) }] } } } };
    expect(pixDaMensagem(noBotao)).toBe(PIX);
    expect(valorDoPix(PIX)).toBe(913.33);
    expect(pixDaMensagem(texto('Certo. Aqui está o código Pix.'))).toBeNull();
    // campanha do fim da conversa: botão de link, não é Pix
    expect(pixDaMensagem({ tipo: 'NativeFlowMessage', texto: 'Quer ficar com a conta de energia em dia', conteudo: { InteractiveMessage: { NativeFlowMessage: { buttons: [{ name: 'cta_url', buttonParamsJSON: '{"display_text":"Saiba mais","url":"https://exemplo"}' }] } } } })).toBeNull();
  });
});

describe('nota fiscal da Equatorial em PDF', () => {
  // trecho do texto do PDF real da loja 93 (18/11/2026), na ordem em que o leitor entrega; nome e CPF trocados
  const TEXTO =
    'FULANO DE TAL CPF: ***.083.06*-** R. GODOFREDO VIANA , 396 , CEP: 65900-100 - CENTRO - IMPERATRIZ - MA DEBITOS: 03/2026 R$783,35 05/2026 R$703,44 Períodos: Band. Tarif.: Verde : 10/10 - 10/11 10/11/2026 3604/26 BANCO DO BRASIL 001-9 00190.00009 03373.382005 05754.091170 6 16330000091333 LOCAL DE PAGAMENTO VENCIMENTO PAGÁVEL PREFERENCIALMENTE NO BANCO DO BRASIL 17.11.2026 BENEFICIÁRIO UNIDADE CONSUMIDORA REFERÊNCIA EQUATORIAL MARANHÃO DISTRIB. DE ENERGIA S.A. 3.317.457.016-72 11/2026 DATA DOCUMENTO 10.11.2026 0202611174706187 CÓDIGO PARA DÉBITO AUTOMÁTICO 3008536090 NOME DO PAGADOR/CPF/CNPJ/ENDEREÇO 2ª Via Página 1/1 R$ 913,33 17/11/2026 3.317.457.016-72 11/2026 NOTA FISCAL Nº 174706187 - SÉRIE 000 / DATA DE EMISSÃO: 10/11/2026 chave de acesso: 21261106272793000184660001747061871072246886 Protocolo de autorização: 3212600030094010 - 10/11/2026 às 16:54:16';
  const HOJE = new Date('2026-11-18T12:00:00Z');

  it('lê nota, emissão, competência, UC, conta contrato, vencimento, valor e linha digitável', () => {
    const { texto: _t, ...r } = interpretarTextoFaturaEquatorial(TEXTO, HOJE);
    expect(r).toEqual({
      notaFiscal: '174706187',
      serie: '000',
      emissao: '2026-11-10',
      referencia: '11/2026',
      uc: '331745701672',
      contaContrato: '3008536090',
      vencimento: '2026-11-17',
      valor: 913.33,
      linhaDigitavel: '00190.00009 03373.382005 05754.091170 6 16330000091333',
      cnpjEmitente: '06272793000184',
    });
  });

  it('a competência é a da nota, não a dos débitos antigos listados nela', () => {
    expect(interpretarTextoFaturaEquatorial(TEXTO, HOJE).referencia).toBe('11/2026');
  });

  it('texto que não é a nota não inventa dado', () => {
    const { texto: _t, ...r } = interpretarTextoFaturaEquatorial('qualquer coisa 12/2026', HOJE);
    expect(Object.values(r).every((v) => v === null)).toBe(true);
  });
});
