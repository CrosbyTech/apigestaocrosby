import { describe, it, expect } from '@jest/globals';
import { lerContasEnergisaDaObservacao, passoDaEnergisa, lerRespostaEnergisa, valorDaEnergisa, pixDoBotao, enderecoEhDaSala } from '../utils/contasFixasEnergisa.js';
import { interpretarTextoFaturaEnergisa, vencimentoDoFator } from '../utils/faturaEnergisaPdf.js';
import { valorDoPix } from '../utils/contasFixasWhatsapp.js';

// mensagens no formato de buscarMensagens({ comConteudo: true }), como a Gisa mandou em 18/11/2026
const lista = (titulos, description = '') => ({ tipo: 'ListMessage', texto: '', conteudo: { description, sections: [{ rows: titulos.map((title) => ({ title })) }] } });
const botoes = (contentText) => ({ tipo: 'ButtonsMessage', texto: '', conteudo: { contentText, buttons: [] } });
const texto = (t) => ({ tipo: 'Conversation', texto: t, conteudo: { text: t } });
const PIX = '00020126580014br.gov.bcb.pix0136fdc3747e-9659-4d7c-a8a8-0123456789ab520400005303986540529.655802BR5925ENERGISA PARAIBA DISTRIBU6011JOAO PESSOA62070503***6304FF25';
const cartaoPix = {
  id: 'pix1',
  tipo: 'NativeFlowMessage',
  texto: '*Número da UC*: 1.677.776.053-40\n(Código do cliente: 5/1780082-2)\n\n*Data de vencimento*: 23/11/2026',
  conteudo: { InteractiveMessage: { NativeFlowMessage: { buttons: [{ name: 'review_and_pay', buttonParamsJSON: JSON.stringify({ type: 'digital-goods', payment_settings: [{ type: 'pix_dynamic_code', pix_dynamic_code: { code: PIX, merchant_name: 'ENERGISA' } }] }) }] } } },
};
const fatura = texto('Você só tem *1 fatura em aberto* no imóvel *1.677.776.053-40*, aqui estão as informações dela:\n(Código do Cliente: 5/1780082-2)\n\n📅 *Referência*: novembro/2026\n\n💲 *Valor*: R$ 29.65\n\n📆 *Vencimento*: 23/11/2026\n\n⚡ *Consumo*: 30 kWh');

describe('contas da Energisa na observação', () => {
  it('lê uma conta por sala, na ordem, e conserta a barra dobrada', () => {
    const obs = 'CPF DO TITULAR: 46862390449\n\nCOD CLIENTE: \nSALA 101: 5/1780082-2 \nSALA 102: 5/1780086-3\nSALA 103:  5/1780079-8\nSALA 104: 5//1780077-2\nSALA 105: 5/105832-0\nSALA  106: 5/1781346-0';
    expect(lerContasEnergisaDaObservacao(obs)).toEqual([
      { rotulo: 'SALA 101', codigo: '5/1780082-2' },
      { rotulo: 'SALA 102', codigo: '5/1780086-3' },
      { rotulo: 'SALA 103', codigo: '5/1780079-8' },
      { rotulo: 'SALA 104', codigo: '5/1780077-2' },
      { rotulo: 'SALA 105', codigo: '5/105832-0' },
      { rotulo: 'SALA 106', codigo: '5/1781346-0' },
    ]);
  });

  it('conta sem sala e observação sem código', () => {
    expect(lerContasEnergisaDaObservacao('COD CLIENTE 5/1780082-2')).toEqual([{ rotulo: null, codigo: '5/1780082-2' }]);
    expect(lerContasEnergisaDaObservacao('CPF DO TITULAR: 46862390449 venc 23/11/2026')).toEqual([]);
    expect(lerContasEnergisaDaObservacao(null)).toEqual([]);
  });
});

describe('passoDaEnergisa', () => {
  it.each([
    [lista(['💰 Faturas e Pagamentos', '⚡ Estou sem energia'], 'Como posso te ajudar hoje?'), 'menu'],
    [botoes('Qual tipo de segunda via você quer emitir?\n\n💡 Lembrando que a fatura completa está disponível apenas para o titular do imóvel!'), 'tipo_via'],
    [botoes('🏠 Para identificar o seu imóvel, você pode nos informar o Número da UC...\n\nComo você deseja identificar o imóvel?'), 'identificar'],
    [texto('🏠 Por favor, informe o *número da UC* ou o *código do cliente.*'), 'pedir_codigo'],
    [botoes('Gostaria de falar sobre esse imóvel?'), 'confirmar_imovel'],
    [botoes('*Como você quer pagar a sua fatura?*\n\nPague sua conta *via Pix*'), 'como_pagar'],
    [lista(['Ver o código Pix', 'Baixar arquivo da fatura', 'Ver contas em aberto', 'Encerrar']), 'opcoes'],
    [lista(['Formas de pagamento', 'Baixar arquivo da fatura', 'Encerrar'], 'Para realizar o download da sua fatura'), 'opcoes'],
    [botoes('Quer receber as suas *próximas faturas* apenas com o QR Code PIX?'), 'so_qr_pix'],
    [texto('O que você gostaria de fazer agora?\n\n1 - Formas de pagamento\n4 - Encerrar'), 'o_que_fazer'],
    [botoes('Posso te ajudar em algo mais?'), 'algo_mais'],
    [texto('Em uma *escala de 0 a 10*, sendo 0 "não recomendaria"...'), 'nota'],
    [texto('Obrigada pelo contato. Estarei aqui sempre que você precisar 😊 Ah! 🔔 Lembrete: a partir de...'), 'despedida'],
    [botoes('Deseja se cadastrar?'), 'oferta_cadastro'],
    [texto('Escolha uma das opções exibidas para continuar.'), 'nao_entendi'],
    [texto('Ok! Vou te ajudar com a segunda via! 📄'), 'aguardando'],
    [fatura, 'aguardando'],
    [null, 'aguardando'],
  ])('%#', (msg, passo) => expect(passoDaEnergisa(msg)).toBe(passo));
});

describe('lerRespostaEnergisa', () => {
  it('junta fatura, Pix e PDF da conversa', () => {
    const r = lerRespostaEnergisa([
      texto('🏠 Encontrei o imóvel de *FULANA L# D# C# F#*.\n\n*Endereço*: AV P# E# P#, B DOS ESTADOS, ###, SL 101, JOAO PESSOA/PB'),
      botoes('Gostaria de falar sobre esse imóvel?'),
      fatura,
      cartaoPix,
      { id: 'pdf1', tipo: 'DocumentMessage', texto: 'boleto_11_2026.pdf', conteudo: { fileName: 'boleto_11_2026.pdf' } },
    ]);
    expect(r).toEqual({
      semFatura: false,
      qtd: 1,
      codigoCliente: '5/1780082-2',
      uc: '167777605340',
      endereco: 'AV P# E# P#, B DOS ESTADOS, ###, SL 101, JOAO PESSOA/PB',
      faturas: [{ referencia: '11/2026', valor: 29.65, vencimento: '2026-11-23' }],
      pix: [PIX],
      pdfs: ['pdf1'],
    });
    expect(valorDoPix(r.pix[0])).toBe(29.65);
  });

  it('o cartão do Pix repete o vencimento mas não é outra fatura', () => {
    expect(lerRespostaEnergisa([cartaoPix]).faturas).toEqual([]);
  });

  it('valor com ponto, com vírgula e com milhar', () => {
    expect(valorDaEnergisa('29.65')).toBe(29.65);
    expect(valorDaEnergisa('29,65')).toBe(29.65);
    expect(valorDaEnergisa('1.234,56')).toBe(1234.56);
    expect(valorDaEnergisa('1234.56')).toBe(1234.56);
    expect(valorDaEnergisa('abc')).toBeNull();
  });

  it('botão sem Pix não devolve código', () => {
    expect(pixDoBotao({ InteractiveMessage: { NativeFlowMessage: { buttons: [{ name: 'x', buttonParamsJSON: '{"flow_cta":"Abrir"}' }] } } })).toBeNull();
    expect(pixDoBotao({ buttons: [] })).toBeNull();
  });
});

describe('enderecoEhDaSala', () => {
  it('confere a sala pedida com o endereço que a Energisa mostrou', () => {
    const end = 'AV P# E# P#, B DOS ESTADOS, ###, SL 101, JOAO PESSOA/PB';
    expect(enderecoEhDaSala(end, 'SALA 101')).toBe(true);
    expect(enderecoEhDaSala(end, 'SALA 102')).toBe(false);
    expect(enderecoEhDaSala('RUA X, 10, SL 1010, JOAO PESSOA/PB', 'SALA 101')).toBe(false);
    expect(enderecoEhDaSala(end, null)).toBe(true);
    expect(enderecoEhDaSala(null, 'SALA 101')).toBe(false);
  });
});

describe('boleto da Energisa em PDF', () => {
  // texto do PDF real da sala 101 (18/11/2026), na ordem em que o leitor entrega
  const TEXTO =
    'Nº 089.831.680 FULANA L* D* C* F* ENERGISA PARAIBA - DISTRIBUIDORA DE ENERGIA S/A Br 230, Km 25 - Cristo Redentor - Joao Pessoa / PB - CEP 58071-680 CNPJ 09.095.183 / 0001-40 Insc.Est. 16.015.823-0 NÚMERO DA UC 1.677.776.053-40 NOV/2026 13/11/2026 29 kWh 23/11/2026 R$ 29,65 CITIBANK 745 74593.10012 19128.013000 01163.350760 9 16390000002965 PAGAR PREFERENCIALMENTE NO BANCO CITIBANK CITIBANK LOCAL DE PAGAMENTO 23/11/2026 VENCIMENTO DATA DO DOCUMENTO 13/11/2026';
  const HOJE = new Date('2026-11-18T12:00:00Z');

  it('lê número, UC, competência, emissão, vencimento, valor e linha digitável', () => {
    const { texto: _t, ...r } = interpretarTextoFaturaEnergisa(TEXTO, HOJE);
    expect(r).toEqual({
      numero: '089831680',
      uc: '167777605340',
      referencia: '11/2026',
      emissao: '2026-11-13',
      vencimento: '2026-11-23',
      valor: 29.65,
      linhaDigitavel: '74593.10012 19128.013000 01163.350760 9 16390000002965',
      cnpjBeneficiario: '09095183000140',
    });
  });

  it('UC curta (sala 105) também é lida, e a inscrição estadual não é confundida com ela', () => {
    expect(interpretarTextoFaturaEnergisa(TEXTO.replace('1.677.776.053-40', '25.474.053-34'), HOJE).uc).toBe('2547405334');
    expect(interpretarTextoFaturaEnergisa('CNPJ 09.095.183 / 0001-40 Insc.Est. 16.015.823-0 NÚMERO DA UC', HOJE).uc).toBeNull();
  });

  it('fator de vencimento: contagem nova (a partir de 22/02/2025) e antiga', () => {
    expect(vencimentoDoFator('1639', HOJE)).toBe('2026-11-23');
    expect(vencimentoDoFator('1000', HOJE)).toBe('2025-02-22');
    expect(vencimentoDoFator('9999', new Date('2025-02-01T12:00:00Z'))).toBe('2025-02-21');
    expect(vencimentoDoFator('0000', HOJE)).toBeNull();
  });

  it('texto que não é boleto não inventa dado', () => {
    const { texto: _t, ...r } = interpretarTextoFaturaEnergisa('qualquer coisa 12/2026', HOJE);
    expect(Object.values(r).every((v) => v === null)).toBe(true);
  });
});
