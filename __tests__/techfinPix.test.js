import { interpretarTechfin, mesclarTechfin, detectarTechfin } from '../utils/techfinPix.js';

const TRANSACOES = [
  'Unidade de Negócio;Data de Criação;Data de Pagamento;Data de Liquidação;Identificador;Identificador Processadora;Data de Atualização;Ponto de Venda;Valor; Valor dos Juros;Valor da Multa;Valor do Desconto;Valor do Abatimento;Valor Pago;Taxa;Depositado;Status do Pagamento;Status da Liquidação;ID do Repasse;CPF Pagador;Nome Pagador;Banco/Agência/Conta;Id do Cliente;Email do Cliente;Local do Cliente;CPF do Cliente;Nome do Cliente;Produto;Modalidade Pix;NSU;Código de Autorização',
  '27728810000549;31/10/2026 21:02:03;31/10/2026 21:02:28;01/11/2026 05:03:19;cc6515e2;01a19469;31/10/2026 21:02:29;1;221,40;0,00;0,00;0,00;0,00;221,40;0.79;220,61;Aprovado;Liquidado;E0496REP1;;;197/0001/434136909;;;;;;TPI;Pix;E2289PIX1;SE04A',
  '27728810000549;31/10/2026 20:59:12;31/10/2026 20:59:37;01/11/2026 05:03:19;0befb0fb;01a19467;31/10/2026 20:59:39;1;395,40;0,00;0,00;0,00;0,00;395,40;0.79;394,61;Aprovado;Liquidado;E0496REP1;;;197/0001/434136909;;;;;;TPI;Pix;E2289PIX2;SE04B',
  '17177680001007;30/09/2026 17:14:34;01/10/2026 09:32:01;01/10/2026 09:48:45;4cc95215;987b17e5;01/10/2026 09:32:03;1;272,00;0,00;0,00;0,00;0,00;272,00;0.79;271,21;Aprovado;Liquidado;E3153REP2;;;748/2207/367338;;;;;;TPI;Pix;E7003PIX3;987b',
  '17177680001007;30/09/2026 17:14:34;01/10/2026 09:32:01;;zzz;zzz;01/10/2026 09:32:03;1;10,00;0,00;0,00;0,00;0,00;10,00;0.79;9,21;Aprovado;Pendente;;;;-/-/-;;;;;;TPI;Pix;E7003PIX4;zzz',
].join('\r\n');

const CONTA = [
  '﻿Data de:;01/10/2026;Data até:;31/10/2026',
  'Apelido da conta:;STONE MIDWAY',
  'Gerado em:;05/11/2026;12:40:41',
  '',
  'Data da transação;Tipo de transação;CNPJ da loja;Valor;NSU da transação;Id do processo',
  '31/10/2026 23:03:12;Repasse;27728810000549;-884,62;E0496REP9;7b6435de',
  '31/10/2026 21:02:28;Tarifa;27728810000549;-0,79;E2289PIX1;SE04A',
  '31/10/2026 21:02:28;Cobrança;27728810000549;221,40;E2289PIX1;SE04A',
  '31/10/2026 20:59:37;Tarifa;27728810000549;-0,79;E2289PIX2;SE04B',
  '31/10/2026 20:59:37;Cobrança;27728810000549;395,40;E2289PIX2;SE04B',
  '31/10/2026 16:58:32;Tarifa;27728810000549;-0,79;E0041PIX5;SE04C',
  '31/10/2026 16:58:32;Cobrança;27728810000549;331,20;E0041PIX5;SE04C',
  '31/10/2026 13:55:54;Tarifa;27728810000549;-0,79;E1823PIX6;SE04D',
  '31/10/2026 13:55:54;Cobrança;27728810000549;555,00;E1823PIX6;SE04D',
  '',
  'Total de crédito: 1503,00',
  'Total de débito: 887,78',
  'Saldo: 615,22',
].join('\r\n');

describe('Techfin — Relatório de Transações (venda a venda)', () => {
  test('detecta o formato e agrupa os Pix por ID do Repasse com conta de destino', () => {
    expect(detectarTechfin(TRANSACOES)).toBe('transacoes');
    const r = interpretarTechfin(Buffer.from(TRANSACOES, 'utf8'));
    expect(r.formato).toBe('transacoes');
    expect(r.pix).toHaveLength(3); // o pendente sem repasse é ignorado
    expect(r.ignorados).toBe(1);
    const rep = r.repasses.find((x) => x.id === 'E0496REP1');
    expect(rep.valor).toBe(615.22);
    expect(rep.pix).toEqual(['E2289PIX1', 'E2289PIX2']);
    expect(rep.conta).toEqual({ banco: '197', agencia: '0001', numero: '434136909' });
    expect(rep.dataLiquidacao).toBe('2026-11-01T05:03:19');
    const sic = r.repasses.find((x) => x.id === 'E3153REP2');
    expect(sic.conta.banco).toBe('748');
    expect(sic.valor).toBe(271.21);
    expect(r.pix[0]).toMatchObject({ nsu: 'E2289PIX1', cnpj: '27728810000549', valor: 221.4, taxa: 0.79, liquido: 220.61, dataPagamento: '2026-10-31T21:02:28', repasseId: 'E0496REP1' });
  });
});

describe('Techfin — extrato da conta da loja (cobrança / tarifa / repasse)', () => {
  test('o repasse pega o subconjunto de cobranças que fecha o valor; o resto fica sem repasse', () => {
    expect(detectarTechfin(CONTA)).toBe('conta');
    const r = interpretarTechfin(Buffer.from(CONTA, 'utf8'));
    expect(r.formato).toBe('conta');
    expect(r.apelido).toBe('STONE MIDWAY');
    expect(r.pix).toHaveLength(4);
    expect(r.repasses).toHaveLength(1);
    const rep = r.repasses[0];
    expect(rep.id).toBe('E0496REP9');
    expect(rep.valor).toBe(884.62);
    // 331,20 − 0,79 + 555,00 − 0,79 = 884,62 (as duas cobranças da noite ficam para o próximo repasse)
    expect(rep.pix.sort()).toEqual(['E0041PIX5', 'E1823PIX6']);
    expect(r.pix.find((p) => p.nsu === 'E2289PIX1').repasseId).toBeNull();
    expect(r.avisos.some((a) => /sem repasse no fim/.test(a))).toBe(true);
  });
});

describe('Techfin — mescla dos relatórios', () => {
  test('o relatório de transações completa o repasse das cobranças que o extrato da conta deixou pendentes', () => {
    const m = mesclarTechfin([interpretarTechfin(Buffer.from(CONTA, 'utf8')), interpretarTechfin(Buffer.from(TRANSACOES, 'utf8'))]);
    expect(m.repasses).toHaveLength(3);
    const rep1 = m.repasses.find((r) => r.id === 'E0496REP1');
    expect(rep1.pix.sort()).toEqual(['E2289PIX1', 'E2289PIX2']);
    expect(rep1.conta.numero).toBe('434136909');
    expect(m.pix.find((p) => p.nsu === 'E2289PIX1').repasseId).toBe('E0496REP1');
    expect(m.pix.find((p) => p.nsu === 'E0041PIX5').repasseId).toBe('E0496REP9');
    expect(m.pix).toHaveLength(5);
  });
  test('arquivo que não é da Techfin é recusado', () => {
    expect(() => interpretarTechfin(Buffer.from('data;valor\n01/10/2026;10', 'utf8'))).toThrow(/não reconhecido/);
  });
});
