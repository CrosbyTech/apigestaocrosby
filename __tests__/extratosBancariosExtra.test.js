// Parsers adicionais de extrato (BNB, Santander, Unicred, Daycoval, Pagar.me)
import * as XLSX from 'xlsx';
import {
  interpretarBnb,
  interpretarSantander,
  interpretarUnicred,
  interpretarDaycoval,
  interpretarPagarme,
  classificarGenerico,
  ehXlsx,
  parseNumBr,
} from '../utils/extratosBancariosExtra.js';

const it = (x, y, s, w = s.length * 4.5) => ({ x, y, w, s });
const pagina = (items, numero = 1) => ({ numero, largura: 595, altura: 842, items });

describe('parseNumBr', () => {
  test('formatos dos bancos', () => {
    expect(parseNumBr('- R$ 43,61')).toBe(-43.61);
    expect(parseNumBr('-R$ 15.032,74')).toBe(-15032.74);
    expect(parseNumBr('-181,55')).toBe(-181.55);
    expect(parseNumBr('R$ 0,00')).toBe(0);
  });
});

describe('BNB', () => {
  test('extrato sem movimentação', () => {
    const r = interpretarBnb([
      pagina([
        it(21.5, 71, 'Extrato de Conta Corrente - no período'),
        it(23.3, 110, 'Titular:'),
        it(50.3, 110, 'CROSBY CR VESTUARIO LTDA'),
        it(340.9, 125, 'Agência/Conta Corrente:'),
        it(434, 125, '035 - NATAL TIROL/000069918-1'),
        it(23.3, 139, 'Saldo Anterior:'),
        it(80.9, 139, 'R$ 0,00'),
        it(434.6, 139, 'Período:'),
        it(467.6, 139, '01/09/2026'),
        it(513.2, 139, 'até'),
        it(528.3, 139, '30/09/2026'),
        it(252, 168, 'Detalhamento do Extrato'),
        it(230.1, 196, 'Nenhuma movimentação encontrada.'),
      ]),
    ]);
    expect(r.titular).toMatchObject({ nome: 'CROSBY CR VESTUARIO LTDA', agencia: '0035', conta: '69918', contaDv: '1' });
    expect(r.periodo).toEqual({ inicio: '2026-09-01', fim: '2026-09-30' });
    expect(r.saldoInicial).toBe(0);
    expect(r.lancamentos).toEqual([]);
  });

  test('tabela com lançamentos', () => {
    const r = interpretarBnb([
      pagina([
        it(21.5, 71, 'Extrato de Conta Corrente - no período'),
        it(23.3, 110, 'Titular:'),
        it(50.3, 110, 'X'),
        it(340.9, 125, 'Agência/Conta Corrente:'),
        it(434, 125, '035 - NATAL/000069918-1'),
        it(23.3, 139, 'Saldo Anterior:'),
        it(80.9, 139, 'R$ 100,00'),
        it(64.4, 182, 'Data'),
        it(192, 182, 'Histórico'),
        it(335.5, 182, 'Documento'),
        it(441.2, 182, 'Valor R$', 40),
        it(532.5, 182, 'Saldo R$', 40),
        it(60, 200, '02/09/2026'),
        it(192, 200, 'PIX RECEBIDO FULANO'),
        it(335.5, 200, 'E123'),
        it(451, 200, '50,00', 30),
        it(537, 200, '150,00', 35),
        it(254.7, 240, 'Detalhamento do Saldo'),
      ]),
    ]);
    expect(r.lancamentos).toHaveLength(1);
    expect(r.lancamentos[0]).toMatchObject({ data: '2026-09-02', valor: 50, saldoApos: 150, forma: 'PIX', documento: 'E123' });
  });
});

describe('Santander', () => {
  test('histórico quebrado acima e abaixo da data; saldo inicial pelo 1º lançamento', () => {
    const r = interpretarSantander([
      pagina([
        it(429.1, 58, 'Santander Empresas'),
        it(34.1, 105, 'FERREIRA COMERCIO E CONFECCOES LTDA'),
        it(367.3, 105, 'Ag'),
        it(379.5, 105, 'ê'),
        it(385.1, 105, 'ncia:'),
        it(409, 105, '1575'),
        it(484, 105, 'Conta:'),
        it(516.3, 105, '130005995'),
        it(31.3, 149, 'Per'),
        it(46.6, 149, 'í'),
        it(49.3, 149, 'odos:'),
        it(76.1, 149, '01/09/2026 a 30/09/2026'),
        it(415.2, 163, 'Saldo dispon'),
        it(474.8, 163, 'vel para uso:'),
        it(533.9, 163, 'R$ 0,00'),
        it(49, 180, 'Data'),
        it(94.6, 180, 'Hist'),
        it(111.6, 180, 'ó'),
        it(117.1, 180, 'rico'),
        it(305.5, 180, 'Documento'),
        it(423.5, 180, 'Valor (R$)', 44),
        it(518.5, 180, 'Saldo (R$)', 44),
        it(33.2, 202, '21/09/2026'),
        it(91.8, 202, 'Debito De Divida/acordo Em Atraso'),
        it(433.1, 202, '-181,55', 34),
        it(544.5, 202, '0,00', 18),
        it(91.8, 227, 'Pagamento Cartao De Debito'),
        it(33.2, 234, '21/09/2026'),
        it(301, 234, '0000152926'),
        it(436.4, 234, '181,55', 31),
        it(533.6, 234, '181,55', 29),
        it(91.8, 241, 'GETNET-MAESTRO'),
        it(380.1, 266, 'Saldo de ContaMax'),
        it(544.5, 266, '0,00'),
        it(391.5, 291, 'Saldo Dispon'),
      ]),
    ]);
    expect(r.titular).toMatchObject({ nome: 'FERREIRA COMERCIO E CONFECCOES LTDA', agencia: '1575', conta: '13000599', contaDv: '5' });
    expect(r.periodo).toEqual({ inicio: '2026-09-01', fim: '2026-09-30' });
    expect(r.lancamentos).toHaveLength(2);
    expect(r.lancamentos[0]).toMatchObject({ valor: -181.55, saldoApos: 0, forma: 'EMPRÉSTIMO/LIMITE' });
    expect(r.lancamentos[1]).toMatchObject({ valor: 181.55, saldoApos: 181.55, documento: '0000152926', forma: 'CARTÃO DÉBITO' });
    expect(r.lancamentos[1].memo).toBe('Pagamento Cartao De Debito GETNET-MAESTRO');
    expect(r.saldoInicial).toBe(181.55);
  });
});

describe('Unicred', () => {
  test('saldo inicial negativo recuperado pelo 1º lançamento; documento entre parênteses', () => {
    const r = interpretarUnicred([
      pagina([
        it(20, 68, 'Extrato'),
        it(379.5, 79, 'CROSBY'),
        it(480.1, 79, '- **.***.680/0001-**'),
        it(20, 95, 'Período de 01/09/2026 a 30/09/2026'),
        it(403.4, 95, 'Coop: 60 - AG: 6012 - Conta: 68500'),
        it(20, 139, 'Saldo em 31/08/2026: R$ 14.989,13'),
        it(21, 192, 'Data'),
        it(91, 192, 'Lançamentos'),
        it(395.8, 192, 'Valor (R$)', 44),
        it(513.5, 192, 'Saldo (R$)', 44),
        it(91, 221, 'IOF ( Doc.: SALDO DEV )'),
        it(21, 221, '01/09/2026'),
        it(396.3, 221, '- R$ 43,61', 44),
        it(499.6, 221, '-R$ 15.032,74', 58),
        it(91, 265, 'JUROS ADIANTAMENTO A DEPOSITANTE ( Doc.: 0 )'),
        it(21, 269, '30/09/2026'),
        it(382.4, 269, '- R$ 2.106,90', 58),
        it(499.6, 269, '-R$ 17.139,64', 58),
        it(20, 329, 'Saldo no final do período'),
        it(500.6, 329, '-R$ 17.139,64'),
        it(21, 499, 'Data'),
        it(91, 499, 'Lançamentos'),
        it(525.8, 499, 'Valor (R$)'),
        it(20, 524, 'Lançamentos futuros'),
      ]),
    ]);
    expect(r.titular).toMatchObject({ nome: 'CROSBY', agencia: '6012', conta: '6850', contaDv: '0' });
    expect(r.saldoInicial).toBe(-14989.13);
    expect(r.saldoFinalInformado).toBe(-17139.64);
    expect(r.lancamentos).toHaveLength(2);
    expect(r.lancamentos[0]).toMatchObject({ valor: -43.61, documento: 'SALDO DEV', forma: 'TARIFA/ENCARGO' });
    // juros de adiantamento a depositante = encargo da conta (não é empréstimo contratado)
    expect(r.lancamentos[1]).toMatchObject({ valor: -2106.9, documento: null, forma: 'TARIFA/ENCARGO' });
  });
});

describe('Daycoval', () => {
  test('cabeçalho com dígitos fragmentados e sem tabela', () => {
    const r = interpretarDaycoval([
      pagina([
        it(291, 22, 'Dayconnect - Banco Daycoval'),
        it(44.5, 196, 'Titular'),
        it(302.5, 196, 'Período'),
        it(44.5, 207, 'CROSBY'),
        it(78.9, 207, 'CR'),
        it(92, 207, 'VESTUARIO'),
        it(139.5, 207, 'LTDA'),
        it(302.5, 207, '01'),
        it(312.1, 207, '/'),
        it(314.4, 207, '09'),
        it(324, 207, '/'),
        it(326.3, 207, '2026'),
        it(347.6, 207, 'à'),
        it(354.5, 207, '30'),
        it(364.1, 207, '/'),
        it(366.3, 207, '09'),
        it(375.9, 207, '/'),
        it(378.2, 207, '2026'),
        it(44.5, 224, 'Agência'),
        it(44.5, 235, '0001'),
        it(503.7, 252, 'Conta Corrente'),
        it(501.1, 263, '001516580'),
        it(544.3, 263, '-'),
        it(547.7, 263, '0'),
        it(44.5, 337, 'Saldo anterior'),
        it(515.6, 337, '-'),
        it(519, 337, 'R'),
        it(524.6, 337, '$'),
        it(531.5, 337, '71'),
        it(541.1, 337, ','),
        it(542.9, 337, '24'),
        it(44.5, 356, 'Saldo atual'),
        it(511.6, 356, '-'),
        it(515, 356, 'R'),
        it(520.6, 356, '$'),
        it(527.5, 356, '71'),
        it(537.1, 356, ','),
        it(538.9, 356, '24'),
      ]),
    ]);
    expect(r.titular).toMatchObject({ nome: 'CROSBY CR VESTUARIO LTDA', agencia: '0001', conta: '1516580', contaDv: '0' });
    expect(r.periodo).toEqual({ inicio: '2026-09-01', fim: '2026-09-30' });
    expect(r.saldoInicial).toBe(-71.24);
    expect(r.saldoFinalInformado).toBe(-71.24);
    expect(r.lancamentos).toEqual([]);
  });
});

describe('Pagar.me (xlsx)', () => {
  const cab = ['Data da operação', 'Tipo da operação', 'Id da operação', 'Descrição da operação', 'Id da transação', 'Parcela', 'Método de pagamento', 'Entrada bruta', 'Saída bruta', 'Taxa de operação', 'Taxa de antecipação', 'Taxa total da operação', 'Entrada líquida', 'Saída líquida', 'Id do arranjo'];
  const linhas = [
    ['30/09/2026 23:42', 'Transação', 19185696415, 'Crédito', 4583048490, '-', 'PIX', '122,79', '0,00', '-0,85', '0,00', '-0,85', '121,94', '0,00', '-'],
    ['15/09/2026 10:00', 'Liquidação', 1, 'mastercard', 2, '3/6', 'Antecipação', '300,00', '0,00', '-9,00', '-3,00', '-12,00', '288,00', '0,00', '-'],
    ['02/09/2026 09:44', 'Transferência', 19052064047, 'Transferência TED', '-', '-', '-', '0,00', '-6.527,40', '-3,67', '0,00', '-3,67', '0,00', '-6.531,07', '-'],
    ['01/09/2026 00:00', 'Operação de saldo', 5, 'Serviços de gateway (01/08/2026 a 31/08/2026)', '-', '-', '-', '0,00', '-50,00', '0,00', '0,00', '0,00', '0,00', '-50,00', '-'],
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([cab, ...linhas]), 'pagarme');
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });

  test('detecta xlsx e lê as operações em ordem cronológica', () => {
    expect(ehXlsx(buf)).toBe(true);
    const r = interpretarPagarme(buf, { nomeArquivo: 'PAGARME CROSBY SET.xlsx' });
    expect(r.titular).toMatchObject({ nome: 'PAGAR.ME CROSBY', conta: 'CROSBY', agencia: '' });
    expect(r.periodo).toEqual({ inicio: '2026-09-01', fim: '2026-09-30' });
    const porData = [...r.lancamentos].sort((a, b) => (a.data < b.data ? -1 : 1));
    expect(porData.map((l) => l.valor)).toEqual([-50, -6531.07, 288, 121.94]);
    expect(porData[0]).toMatchObject({ forma: 'TARIFA/ENCARGO', categoria: 'tarifa' });
    expect(porData[1]).toMatchObject({ forma: 'TED/DOC', categoria: 'transferencia', documento: '19052064047' });
    expect(porData[2]).toMatchObject({ forma: 'ANTECIPAÇÃO CARTÃO', bandeira: 'MASTERCARD', documento: '2' });
    expect(porData[2].memo).toContain('parcela 3/6');
    expect(porData[3]).toMatchObject({ forma: 'PIX', hora: '23:42', documento: '4583048490' });
  });
});

describe('classificarGenerico', () => {
  test('mapeia históricos comuns', () => {
    expect(classificarGenerico('TARIFA MENSALIDADE PACOTE', -30).forma).toBe('TARIFA/ENCARGO');
    expect(classificarGenerico('PIX RECEBIDO FULANO', 10).descricao).toBe('RECEBIMENTO PIX');
    expect(classificarGenerico('TED ENVIADA', -10).descricao).toBe('TRANSFERÊNCIA ENVIADA');
    expect(classificarGenerico('PAGAMENTO BOLETO', -10).forma).toBe('BOLETO');
  });
});
