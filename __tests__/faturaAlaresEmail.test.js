import { describe, it, expect } from '@jest/globals';
import { crcDoPix, pixIntegro, pixDoTexto, remetenteDoEncaminhado, interpretarTextoFaturaAlares, boletoEhDaAlares, pixEhDoBoleto, empresaDaInstalacao, pixDoBoletoEntre } from '../utils/faturaAlaresEmail.js';
import { valorDoPix } from '../utils/contasFixasWhatsapp.js';

// Pix de exemplo com os tamanhos de cada campo calculados e o CRC de verdade no fim
const campo = (id, valor) => `${id}${String(valor.length).padStart(2, '0')}${valor}`;
const fechar = (semCrc) => `${semCrc}6304${crcDoPix(`${semCrc}6304`)}`;
const PIX_CAIXA = fechar(`000201010212${campo('26', campo('00', 'br.gov.bcb.pix') + campo('25', 'pix-qrcode.exemplo.gov.br/api/v2/cobv/CO01100990607014000000000852234'))}5204000053039865802BR${campo('59', 'ALARES INTERNET S/A')}${campo('60', 'NATAL')}62070503***`);
const PIX_BB = fechar(`000201010212${campo('26', campo('00', 'br.gov.bcb.pix') + campo('25', 'qrcodepix.exemplo.com.br/pix/v2/cobv/9b2328db-0000-4000-8000-000000000000'))}520400005303986${campo('54', '124.12')}5802BR${campo('59', 'ALARES')}${campo('60', 'NATAL')}62070503***`);

describe('Pix copia e cola no corpo do e-mail', () => {
  it('CRC do Pix (vetor conhecido do CRC16-CCITT)', () => {
    expect(crcDoPix('123456789')).toBe('29B1');
    expect(pixIntegro(PIX_CAIXA)).toBe(true);
    expect(pixIntegro(PIX_CAIXA.replace('NATAL', 'NATAX'))).toBe(false);
    expect(pixIntegro('qualquer coisa')).toBe(false);
  });

  it('acha o código mesmo quando o Gmail quebra a linha no nome do recebedor', () => {
    const quebrado = PIX_CAIXA.replace('ALARES INTERNET', 'ALARES\nINTERNET');
    const corpo = `Pelo *copia e cola*\n${quebrado}\n10499.90607 70000.100043 00085.223469 6 16240000017032\nFaça o download do app!`;
    expect(pixDoTexto(corpo)).toBe(PIX_CAIXA);
    expect(pixDoTexto(`*Pix copia e cola:*\n${PIX_BB}\n[image: pix]`)).toBe(PIX_BB);
  });

  it('código adulterado ou cortado não é devolvido', () => {
    expect(pixDoTexto(`Pix:\n${PIX_BB.replace('124.12', '924.12')}\nfim`)).toBeNull();
    expect(pixDoTexto('Sua fatura chegou, sem código nenhum.')).toBeNull();
    expect(pixDoTexto(null)).toBeNull();
  });
});

describe('remetente verdadeiro do e-mail encaminhado à mão', () => {
  it('lê o "De:" do cabeçalho de encaminhamento do Gmail', () => {
    expect(remetenteDoEncaminhado('---------- Forwarded message ---------\nDe: Alares Internet <fatura@fatura.minhaalares.com.br>\nDate: sex., 6 de nov. de 2026')).toBe('fatura@fatura.minhaalares.com.br');
    expect(remetenteDoEncaminhado('---------- Forwarded message ---------\nFrom: Alares <Notificacao@Notificacao.MinhaAlares.com.br>')).toBe('notificacao@notificacao.minhaalares.com.br');
    expect(remetenteDoEncaminhado('Olá, segue a fatura. De: Fulano <x@y.com>')).toBeNull();
  });
});

describe('fatura da Alares em PDF', () => {
  // trecho do texto do PDF real da loja 99 (19/11/2026), na ordem em que o leitor entrega
  const TEXTO =
    'VENCIMENTO VALOR 08/11/2026 R$ 170,32 2683849 - CROSBY CR VESTUARIO LTDA | 17.177.680/0010-07 ENDEREÇO DE INSTALAÇÃO: ANTONIIO ALVES PESSOA, 5733 - NÃO INFORMADO - CEP: 59219000 - BREJINHO / RN Itens da fatura B2B RP 1 Giga PD-[01/10/2026-31/10/2026] 166,59 MULTA REFERENTE DOCUMENTO N: 460476611-1/1-26 3,39 Total: R$ 170,32 Beneficiário:Alares Internet S/A 02.952.192/0001-61 Nosso Número: 14000000000852234 - Linha Digitável: 10499.90607 70000.100043 00085.223469 6 16240000017032 Data Documento Número do Documento 05/11/2026 469045641-1/1-26 3090/0990607 14000000000852234 R$ 170,32 DOCUMENTO AUXILIAR DA NOTA FISCAL FATURA DE SERVIÇOS DE COMUNICAÇÃO ELETRÔNICA Alares Internet S/A CNPJ: 02.952.192/0001-61 | IE: 200832360 DESTINATÁRIO DADOS DA NOTA CROSBY CR VESTUARIO LTDA NOTA FISCAL FATURA Nº 1666145 CNPJ/CPF: 17.177.680/0010-07 SÉRIE: 0 DATA DE EMISSÃO: 29/10/2026 CHAVE DE ACESSO: 2426 1002 9521 9200 0161 6200 0001 6661 4510 1666 1452 CÓDIGO DO CLIENTE: 2683849 PERÍODO: 01/10/2026 à 31/10/2026 Vencimento boleto: 08/11/2026';
  const HOJE = new Date('2026-11-19T12:00:00Z');

  it('lê cliente, nota, emissão, competência, vencimento, valor e boleto', () => {
    const { texto: _t, ...r } = interpretarTextoFaturaAlares(TEXTO, HOJE);
    expect(r).toEqual({
      codigoCliente: '2683849',
      cnpjCliente: '17177680001007',
      notaFiscal: '1666145',
      serie: '0',
      emissao: '2026-10-29',
      referencia: '10/2026',
      vencimento: '2026-11-08',
      valor: 170.32,
      linhaDigitavel: '10499.90607 70000.100043 00085.223469 6 16240000017032',
      nossoNumero: '14000000000852234',
      cnpjEmitente: '02952192000161',
      instalacao: 'ANTONIIO ALVES PESSOA, 5733 - NÃO INFORMADO - CEP: 59219000 - BREJINHO / RN',
    });
  });

  it('só aceita boleto das contas de recebimento conhecidas da Alares', () => {
    expect(boletoEhDaAlares('10499.90607 70000.100043 00085.223469 6 16240000017032')).toBe(true);
    expect(boletoEhDaAlares('00190.00009 03805.454000 01250.380175 2 16250000012412')).toBe(true);
    expect(boletoEhDaAlares('10499.12345 70000.100043 00085.223469 6 16240000017032')).toBe(false); // outro beneficiário na Caixa
    expect(boletoEhDaAlares('34191.09008 12345.678901 23456.780009 1 16240000017032')).toBe(false); // outro banco
    expect(boletoEhDaAlares(null)).toBe(false);
  });

  it('o Pix tem que ser do mesmo título do boleto', () => {
    const lida = interpretarTextoFaturaAlares(TEXTO, HOJE);
    expect(valorDoPix(PIX_CAIXA)).toBeNull(); // o da Caixa não traz valor: confere pelo nosso número
    expect(pixEhDoBoleto(PIX_CAIXA, lida, null)).toBe(true);
    expect(pixEhDoBoleto(PIX_CAIXA, { ...lida, nossoNumero: '14000000000999999' }, null)).toBe(false);
    expect(pixEhDoBoleto(PIX_BB, { nossoNumero: null, valor: 124.12 }, valorDoPix(PIX_BB))).toBe(true);
    expect(pixEhDoBoleto(PIX_BB, { nossoNumero: null, valor: 170.32 }, valorDoPix(PIX_BB))).toBe(false);
    expect(pixEhDoBoleto(null, lida, null)).toBe(false);
  });

  it('texto que não é a fatura não inventa dado', () => {
    const { texto: _t, ...r } = interpretarTextoFaturaAlares('qualquer coisa 12/2026', HOJE);
    expect(Object.values(r).every((v) => v === null)).toBe(true);
  });
});

describe('de qual loja é a fatura (pelo local de instalação)', () => {
  // endereços do cadastro de empresas em 19/11/2026
  const EMPRESAS = [
    { code: 1, cnpj: '17177680000116', endereco: { cep: '59063150', addressNumber: 2189 } },
    { code: 5, cnpj: '33592092000103', endereco: { cep: '59215000', addressNumber: 567 } },
    { code: 11, cnpj: '27728810000115', endereco: { cep: '59022000', addressNumber: 1718 } },
    { code: 55, cnpj: '53661116000138', endereco: { cep: '59140200', addressNumber: 152 } },
    { code: 90, cnpj: '17177680001430', endereco: { cep: '59151906', addressNumber: 2441 } },
    { code: 99, cnpj: '17177680001007', endereco: { cep: '59219000', addressNumber: 5733 } },
  ];

  it('Parnamirim centro e Ayrton Senna são lojas diferentes, mesmo na mesma cidade', () => {
    expect(empresaDaInstalacao('BRIGADEIRO EVERALDO BREVES, 152 - CENTRO - CEP: 59140200 - PARNAMIRIM / RN', '53661116000138', EMPRESAS)).toEqual({ code: 55, por: 'instalacao' });
    // a da Ayrton Senna está contratada no CNPJ da matriz
    expect(empresaDaInstalacao('AYRTON SENNA, 2441 Loja 3 - NOVA PARNAMIRIM - CEP: 59151906 - PARNAMIRIM / RN', '17177680000116', EMPRESAS)).toEqual({ code: 90, por: 'instalacao' });
  });

  it('as da matriz estão no CNPJ de outra empresa do grupo', () => {
    expect(empresaDaInstalacao('SAO JOSE, 2189 CAMERAS - LAGOA NOVA - CEP: 59063150 - NATAL / RN', '27728810000115', EMPRESAS)).toEqual({ code: 1, por: 'instalacao' });
    expect(empresaDaInstalacao('SAO JOSE, 2189 DIRETORIA - LAGOA NOVA - CEP: 59063150 - NATAL / RN', '27728810000115', EMPRESAS)).toEqual({ code: 1, por: 'instalacao' });
  });

  it('CEP sem empresa no cadastro: vale a do CNPJ; sem nenhum dos dois, não decide', () => {
    expect(empresaDaInstalacao('RUA X, 10 - CENTRO - CEP: 59999000 - OUTRA / RN', '33592092000103', EMPRESAS)).toEqual({ code: 5, por: 'cnpj' });
    expect(empresaDaInstalacao('RUA X, 10 - CENTRO - CEP: 59999000 - OUTRA / RN', '00000000000191', EMPRESAS)).toBeNull();
    expect(empresaDaInstalacao(null, '17177680001007', EMPRESAS)).toEqual({ code: 99, por: 'cnpj' });
  });

  it('duas empresas no mesmo CEP: desempata pelo número e depois pelo CNPJ', () => {
    const shopping = [{ code: 87, cnpj: '27728810000972', endereco: { cep: '59080900', addressNumber: 340 } }, { code: 200, cnpj: '52681454000179', endereco: { cep: '59080900', addressNumber: 900 } }];
    expect(empresaDaInstalacao('ROBERTO FREIRE, 340 LJ 12 - CAPIM MACIO - CEP: 59080900 - NATAL / RN', '52681454000179', shopping)).toEqual({ code: 87, por: 'instalacao' });
    const mesmoNumero = shopping.map((e) => ({ ...e, endereco: { ...e.endereco, addressNumber: 340 } }));
    expect(empresaDaInstalacao('ROBERTO FREIRE, 340 - CEP: 59080900 - NATAL / RN', '52681454000179', mesmoNumero)).toEqual({ code: 200, por: 'cnpj' });
    expect(empresaDaInstalacao('ROBERTO FREIRE, 340 - CEP: 59080900 - NATAL / RN', '00000000000191', mesmoNumero)).toBeNull();
  });
});

describe('Pix de cada boleto num e-mail com várias faturas', () => {
  const fatura = (nossoNumero, valor) => ({ nossoNumero, valor });
  const pixBB = (valor, id) => fechar(`000201010212${campo('26', campo('00', 'br.gov.bcb.pix') + campo('25', `qrcodepix.exemplo.com.br/pix/v2/cobv/${id}`))}520400005303986${campo('54', valor)}5802BR${campo('59', 'ALARES')}${campo('60', 'NATAL')}62070503***`);

  it('valor único: o Pix é daquele boleto; nosso número dentro do código também serve', () => {
    const pixs = [pixBB('103.60', 'aaaa'), pixBB('124.12', 'bbbb'), PIX_CAIXA];
    const f55 = fatura('00038054540001248230', 103.6);
    const f90 = fatura('00038054540001250380', 124.12);
    const f99 = fatura('14000000000852234', 170.32);
    const todas = [f55, f90, f99];
    expect(pixDoBoletoEntre(pixs, f55, todas, valorDoPix)).toBe(pixs[0]);
    expect(pixDoBoletoEntre(pixs, f90, todas, valorDoPix)).toBe(pixs[1]);
    expect(pixDoBoletoEntre(pixs, f99, todas, valorDoPix)).toBe(PIX_CAIXA);
  });

  it('duas faturas de mesmo valor (câmeras e diretoria da matriz): nenhuma leva Pix, ficam só com o boleto', () => {
    const pixs = [pixBB('136.65', 'cccc'), pixBB('136.65', 'dddd')];
    const cameras = fatura('00037338870004113272', 136.65);
    const diretoria = fatura('00037338870004113275', 136.65);
    expect(pixDoBoletoEntre(pixs, cameras, [cameras, diretoria], valorDoPix)).toBeNull();
    expect(pixDoBoletoEntre(pixs, diretoria, [cameras, diretoria], valorDoPix)).toBeNull();
    // um Pix só para duas faturas de mesmo valor também não dá para atribuir
    expect(pixDoBoletoEntre([pixs[0]], cameras, [cameras, diretoria], valorDoPix)).toBeNull();
  });

  it('sem Pix no e-mail para o boleto: null', () => {
    expect(pixDoBoletoEntre([pixBB('103.60', 'aaaa')], fatura('00038054540001216412', 107.26), [], valorDoPix)).toBeNull();
    expect(pixDoBoletoEntre([], fatura('1', 10), [], valorDoPix)).toBeNull();
  });
});

describe('conversa inteira encaminhada ("Encaminhar tudo")', () => {
  it('o remetente verdadeiro é o da primeira mensagem da conversa', () => {
    const texto = 'Forwarded Conversation\nSubject: A fatura digital da sua internet chegou!\n------------------------\n\nDe: Alares Internet <fatura@fatura.minhaalares.com.br>\nDate: sex., 6 de nov. de 2026 às 22:04\nTo: <patrimonio@exemplo.com>\n\nOlá';
    expect(remetenteDoEncaminhado(texto)).toBe('fatura@fatura.minhaalares.com.br');
  });
});
