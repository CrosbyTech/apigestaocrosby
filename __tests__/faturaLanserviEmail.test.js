import { describe, it, expect } from '@jest/globals';
import { interpretarTextoFaturaLanservi, boletoEhDaLanservi, lerLembreteLanservi } from '../utils/faturaLanserviEmail.js';
import { empresaDaInstalacao, remetenteDoEncaminhado } from '../utils/faturaAlaresEmail.js';

// texto do carnê real da loja 98 (19/11/2026), na ordem em que o leitor entrega
const TEXTO =
  'CARNÊ DE PAGAMENTO LANSERVI TECNOLOGIA Fone: (81) 4109-2545 Rua Doutor Benoni Sá, 784 - Pau Amarelo, CEP: 53431-090 - Paulista / PE www.lanservi.com.br - contato@lanservi.com.br 8581 - CROSBY RECIFE MALL End: Rua Padre Carapuceiro, 777 SHOPPING CENTER RECIFE, Loja PC069, Boa Viagem Cidade: Recife - Estado de Pernambuco 51020-900 033-7 Vencimento Valor 10/11/26 149,90 Pagador 8581 - CROSBY RECIFE MALL CPF/CNPJ: 36.569.459/0001-58 Nosso Número 000003348126-1 Período de Referência 10/10/2026 - 09/11/2026 Número Doc 3348126 Beneficiário LANSERVI TECNOLOGIA 19.567.776/0001-16 Rua Doutor Benoni Sá, 784, - Pau Amarelo - Paulista/PE 03399.82894 20400.000335 48126.101012 1 16260000014990 Beneficiário Vencimento LANSERVI TECNOLOGIA 10/11/26 Data Doc Número Doc Valor do documento 23/04/26 3348126 149,90 Instruções de pagamento Após vencimento cobrar juros de R$0,05 ao dia. Ag./Cód. Beneficiário 4039 / 8289204 FICHA DE COMPENSAÇÃO';
const HOJE = new Date('2026-11-19T12:00:00Z');

describe('carnê da Lanservi em PDF', () => {
  it('lê cliente, documento, datas, valor e boleto', () => {
    const { texto: _t, ...r } = interpretarTextoFaturaLanservi(TEXTO, HOJE);
    expect(r).toEqual({
      codigoCliente: '8581',
      nomeCliente: 'CROSBY RECIFE MALL',
      cnpjCliente: '36569459000158',
      documento: '3348126',
      emissao: '2026-04-23',
      referencia: '10/2026',
      vencimento: '2026-11-10',
      valor: 149.9,
      linhaDigitavel: '03399.82894 20400.000335 48126.101012 1 16260000014990',
      nossoNumero: '000003348126-1',
      cnpjEmitente: '19567776000116',
      instalacao: 'Rua Padre Carapuceiro, 777 SHOPPING CENTER RECIFE, Loja PC069, Boa Viagem - CEP: 51020900 - Recife / Pernambuco',
    });
  });

  it('só aceita boleto da conta de recebimento conhecida da Lanservi', () => {
    expect(boletoEhDaLanservi('03399.82894 20400.000335 48126.101012 1 16260000014990')).toBe(true);
    expect(boletoEhDaLanservi('03399.11111 20400.000335 48126.101012 1 16260000014990')).toBe(false); // outro beneficiário no Santander
    expect(boletoEhDaLanservi('00190.00009 03805.454000 01250.380175 2 16250000012412')).toBe(false);
    expect(boletoEhDaLanservi(null)).toBe(false);
  });

  it('o CEP do shopping não está no cadastro: a loja sai do CNPJ do boleto', () => {
    const empresas = [{ code: 98, cnpj: '36569459000158', endereco: { cep: '51020280', addressNumber: 777 } }, { code: 6, cnpj: '17177680000388', endereco: { cep: '51020031', addressNumber: 2391 } }];
    const lida = interpretarTextoFaturaLanservi(TEXTO, HOJE);
    expect(empresaDaInstalacao(lida.instalacao, lida.cnpjCliente, empresas)).toEqual({ code: 98, por: 'cnpj' });
  });

  it('texto que não é o carnê não inventa dado', () => {
    const { texto: _t, ...r } = interpretarTextoFaturaLanservi('qualquer coisa 12/2026', HOJE);
    expect(Object.values(r).every((v) => v === null)).toBe(true);
  });
});

describe('lembrete de pagamento no corpo do e-mail', () => {
  const CORPO = '---------- Forwarded message ---------\nDe: LANSERVI TECNOLOGIA LTDA <naoresponda@lanservi.com.br>\nDate: seg., 9 de nov. de 2026 às 12:51\nSubject: Lembrete de pagamento LANSERVI TECNOLOGIA\nTo: LOJA <financeiro@exemplo.com>\nPrezado(a) LOJA,\nEste é um lembrete de pagamento para sua fatura número  3348126 que foi\ngerada em* 23/04/2026* e vence em* 10/11/2026*.\n*Fatura:*  3348126\n*Valor:*  149,90\n*Vencimento:*  10/11/2026\n';

  it('lê fatura, valor e vencimento, e o remetente verdadeiro', () => {
    expect(lerLembreteLanservi(CORPO)).toEqual({ documento: '3348126', valor: 149.9, vencimento: '2026-11-10' });
    expect(remetenteDoEncaminhado(CORPO)).toBe('naoresponda@lanservi.com.br');
  });

  it('valor com milhar e e-mail sem os campos', () => {
    expect(lerLembreteLanservi('*Fatura:* 99001\n*Valor:* 1.249,90\n*Vencimento:* 10/12/2026').valor).toBe(1249.9);
    expect(lerLembreteLanservi('Olá')).toEqual({ documento: null, valor: null, vencimento: null });
  });
});
