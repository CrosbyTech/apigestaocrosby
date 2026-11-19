import { describe, it, expect } from '@jest/globals';
import { passoDaCagepa, lerContasDaCagepa, documentoConfirmado, matriculaLembrada } from '../utils/contasFixasCagepa.js';
import { interpretarTextoFaturaCagepa } from '../utils/faturaCagepaPdf.js';
import { lerContaDeAguaDaObservacao } from '../utils/contasFixasCaern.js';
import { pixDoBotao } from '../utils/contasFixasEnergisa.js';
import { valorDoPix } from '../utils/contasFixasWhatsapp.js';

// mensagens no formato de buscarMensagens({ comConteudo: true }), como a Cagepa mandou em 19/11/2026
const lista = (titulos, description = '') => ({ tipo: 'ListMessage', texto: '', conteudo: { description, sections: [{ rows: titulos.map((title) => ({ title })) }] } });
const botoes = (contentText, nomes = ['Sim', 'Não']) => ({ tipo: 'ButtonsMessage', texto: '', conteudo: { contentText, buttons: nomes.map((n) => ({ buttonText: { displayText: n } })) } });
const texto = (t) => ({ tipo: 'Conversation', texto: t, conteudo: { text: t } });
// Pix de exemplo no formato do da Cagepa (campo 26 com endereço fictício; os tamanhos de cada campo são calculados)
const campo = (id, valor) => `${id}${String(valor.length).padStart(2, '0')}${valor}`;
const PIX = `000201010212${campo('26', campo('00', 'br.gov.bcb.pix') + campo('25', 'pix.exemplo.com.br/pix/v2/b3f77a6c-0000-4000-8000-000000000000'))}520400005303986${campo('54', '190.44')}5802BR${campo('59', 'COMPANHIA_DE_AGUA_E_ESGOT')}${campo('60', 'JOAO_PESSOA')}62070503***63046BFB`;

describe('conta da Cagepa na observação', () => {
  it('lê a matrícula e o CPF do titular', () => {
    expect(lerContaDeAguaDaObservacao('Conseguimos pegar no whatsapp da Cagepa\nCPF DO TITULAR: 52998224725\nmatrícula: 671762')).toEqual({ matricula: '671762', documento: '52998224725' });
  });
});

describe('passoDaCagepa', () => {
  it.each([
    [botoes('Vamos aproveitar a oportunidade 😉?'), 'oferta_campanha'],
    [texto('Para facilitar o nosso atendimento, preciso que digite todos os números do seu CPF ou CNPJ, sem pontos ou traços, só números. 🙂'), 'pedir_documento'],
    [lista(['Faturas 🧾', 'Parcelamento 🤝', 'Pagamento com cartão 💳'], 'Toque em Opções e escolha o serviço desejado 😉'), 'servicos'],
    [botoes('Escolha uma das opções abaixo👇:', ['Conta detalhada🧾', 'Conta simplificada🧾', 'Mais opções🔎']), 'tipo_conta'],
    [texto('Digite sua Matrícula.\n\n💡 Você pode digitar *SAIR* a qualquer momento para encerrar o atendimento 😉.'), 'pedir_matricula'],
    [botoes('Você deseja prosseguir com o atendimento utilizando o CPF/CNPJ: 52998224725'), 'confirmar_documento'],
    [texto('Qual a melhor opção para você?☺️\n\n1 - Baixar PDF\n2 - Enviar por E-mail\n3 - PDF + E-mail\n4 - Copiar Código de Barras\n5 - PIX copia e cola'), 'opcoes_conta'],
    [botoes('Como você deseja prosseguir?', ['Com o mesmo imóvel', 'Com outro imóvel', 'Sair']), 'prosseguir'],
    [texto('5 - O atendimento foi excelente 😀\n4 - O atendimento foi bom 🙂'), 'pesquisa'],
    [texto('Agradecemos o seu contato! 🤝 E não esqueça de avaliar nosso atendimento. Muito obrigada.'), 'pesquisa'],
    [texto('Obrigado pela avaliação'), 'despedida'],
    [texto('Foi um prazer ter você aqui! Agora, quero te fazer um convite: venha conhecer o novo APP da Cagepa'), 'despedida'],
    [texto('Tudo bem, você será direcionado para o menu principal.'), 'aguardando'],
    [texto('Encontrei uma conta para sua matrícula: 11/2026, R$ 190.44.'), 'aguardando'],
    [texto('Maravilha!🤩 Clique logo abaixo para baixar seu PDF⬇️.'), 'aguardando'],
    [null, 'aguardando'],
  ])('%#', (msg, passo) => expect(passoDaCagepa(msg)).toBe(passo));
});

describe('o que a Cagepa manda', () => {
  it('conta em aberto: competência e valor (com ponto decimal e ponto final)', () => {
    expect(lerContasDaCagepa('Encontrei uma conta para sua matrícula: 11/2026, R$ 190.44.')).toEqual({ qtd: 1, contas: [{ referencia: '11/2026', valor: 190.44 }] });
    expect(lerContasDaCagepa('Encontrei uma conta para sua matrícula: 12/2026, R$ 1234.5.')).toEqual({ qtd: 1, contas: [{ referencia: '12/2026', valor: 1234.5 }] });
  });

  it('mais de uma conta: o bot sabe que são várias, mas não inventa os valores', () => {
    expect(lerContasDaCagepa('Encontrei 3 contas para sua matrícula')).toEqual({ qtd: 3, contas: [] });
    expect(lerContasDaCagepa('Para a matrícula 671762')).toEqual({ qtd: 0, contas: [] });
  });

  it('matrícula que ela lembra da conversa anterior', () => {
    expect(matriculaLembrada('Para a matrícula 671762')).toBe('671762');
    expect(matriculaLembrada('Encontrei uma conta para sua matrícula: 11/2026, R$ 190.44.')).toBeNull();
    expect(matriculaLembrada('Digite sua Matrícula.')).toBeNull();
  });

  it('CPF que ela pede para confirmar', () => {
    expect(documentoConfirmado('Você deseja prosseguir com o atendimento utilizando o CPF/CNPJ: 52998224725')).toBe('52998224725');
    expect(documentoConfirmado('Como você deseja prosseguir?')).toBeNull();
  });

  it('Pix copia e cola dentro do botão de pagamento', () => {
    const msg = { InteractiveMessage: { NativeFlowMessage: { buttons: [{ name: 'review_and_pay', buttonParamsJSON: JSON.stringify({ type: 'digital-goods', payment_settings: [{ type: 'pix_dynamic_code', pix_dynamic_code: { code: PIX, merchant_name: 'Companhia de Água e Esgotos da Paraíba' } }] }) }] } }, body: { text: 'Vencimento: 11/2026' } };
    expect(pixDoBotao(msg)).toBe(PIX);
    expect(valorDoPix(PIX)).toBe(190.44);
    expect(/AGUA.{0,3}E.{0,3}ESGOT|CAGEPA/i.test(PIX)).toBe(true);
  });
});

describe('nota fiscal da Cagepa em PDF', () => {
  // trecho do texto do PDF real da loja 2 (19/11/2026), na ordem embaralhada em que o leitor entrega; nome trocado
  const TEXTO =
    'AGUA 97,81 0,00 0,00 0,00 COMERCIAL 001 UNIDADE CONSUMO DE AGUA 97,81 1 M3 ESGOTO 88,03 82640000001-2 90440010001-5 00067176201-1 11202600003-7 AV PRES EPITACIO PESSOA, 689 - JOAO PESSOA PB 58040-000 INSCRIÇÃO: 001.060.150.0005.000 CEP: 58015-570 FULANO DE TAL COMPANHIA DE AGUAS E ESGOTOS DA PARAIBA CNPJ: 09.123.654/0001-87 TOTAL A PAGAR VENCIMENTO 190,44 13/11/2026 REFERÊNCIA VENCIMENTO MATRÍCULA 67176.2 13/11/2026 NOV/2026 166 167 1 34 0,03 CAGEPA - CNPJ: 09.123.654/0001-87 MATRÍCULA REFERÊNCIA DATA DE EMISSÃO 67176.2 NOV/2026 19/11/2026 NÚMERO DA NOTA FISCAL: 7510493 SÉRIE: 0 CHAVE DE ACESSO: 25261109123654000187750000075104932074078000 PROTOCOLO DE AUTORIZAÇÃO: 3252600005962935 DATA: 06/11/2026 PÁGINA: 1 / 1 06/10/26 09/11/26 TOTAL (R$) 190,44';

  it('lê nota, data da nota, competência, matrícula, vencimento, valor e código de barras', () => {
    const { texto: _t, ...r } = interpretarTextoFaturaCagepa(TEXTO);
    expect(r).toEqual({
      notaFiscal: '7510493',
      serie: '0',
      emissao: '2026-11-06',
      referencia: '11/2026',
      matricula: '671762',
      vencimento: '2026-11-13',
      valor: 190.44,
      linhaDigitavel: '82640000001-2 90440010001-5 00067176201-1 11202600003-7',
      cnpjEmitente: '09123654000187',
    });
  });

  it('a emissão é a data da nota, não o dia em que a 2ª via foi impressa', () => {
    expect(interpretarTextoFaturaCagepa(TEXTO).emissao).toBe('2026-11-06');
  });

  it('texto que não é a nota não inventa dado', () => {
    const { texto: _t, ...r } = interpretarTextoFaturaCagepa('qualquer coisa 12/2026');
    expect(Object.values(r).every((v) => v === null)).toBe(true);
  });
});
