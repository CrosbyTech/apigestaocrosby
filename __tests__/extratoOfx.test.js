import { describe, it, expect } from '@jest/globals';
import { classificarOfx, lerExtratoOfx } from '../utils/extratosBancariosPdf.js';
import { mesmoNumeroConta } from '../services/fluxoCaixaExt.js';

const ofx = (trns, { dtStart = '20260401000000', dtEnd = '20260430000000' } = {}) =>
  Buffer.from(`<OFX><BANKACCTFROM><BANKID>0341<ACCTID>6530270617<ACCTTYPE>CHECKING</BANKACCTFROM>
<BANKTRANLIST><DTSTART>${dtStart}<DTEND>${dtEnd}
${trns.map(([d, v, m], i) => `<STMTTRN><TRNTYPE>OTHER<DTPOSTED>${d}120000<TRNAMT>${v}<FITID>F${i}<MEMO>${m}</STMTTRN>`).join('\n')}
</BANKTRANLIST><LEDGERBAL><BALAMT>0.00<DTASOF>${dtEnd}</LEDGERBAL></OFX>`);

describe('classificarOfx', () => {
  it('usa o classificador do banco', () => {
    expect(classificarOfx('ITAU', 'PIX TRANSF RAFAEL 30/04', -10)).toMatchObject({ categoria: 'pix', contraparteNome: 'RAFAEL' });
    expect(classificarOfx('SICREDI', 'RECEBIMENTO PIX', 10)).toMatchObject({ categoria: 'pix', descricao: 'RECEBIMENTO PIX' });
    expect(classificarOfx('MENTORE', '000027 | Pagamento de salário - ANA', -10)).toMatchObject({ categoria: 'folha', contraparteNome: 'ANA' });
  });

  it('extrai o nome da contraparte do memo quando o banco traz', () => {
    expect(classificarOfx('UNICRED', 'DEBITO TRANSFERENCIA PIX ( DOC.: DEB PIX / ADRIAN RODRIGUES )', -10).contraparteNome).toBe('ADRIAN RODRIGUES');
    expect(classificarOfx('BNB', 'RECEBIMENTO VIA PIX -IRMAOS CR VESTUARIO LTDA ::1/8/2024', 10).contraparteNome).toBe('IRMAOS CR VESTUARIO LTDA');
    expect(classificarOfx('BRADESCO', 'TRANSFERENCIA PIX REM: FABIO FERREIRA DE LIM 09/12', 10).contraparteNome).toBe('FABIO FERREIRA DE LIM');
    expect(classificarOfx('BB', 'PIX - ENVIADO - 06/10 17:02 NEOENERGIA COSERN', -10).contraparteNome).toBe('NEOENERGIA COSERN');
  });
});

describe('lerExtratoOfx', () => {
  it('o período cobre todos os lançamentos, inclusive o último dia', () => {
    const ex = lerExtratoOfx(ofx([['20260401', '-1.00', 'TAR CARTAO PJ'], ['20260430', '-2.00', 'TAR CARTAO PJ']]), { banco: 'ITAU' });
    expect(ex.periodo.inicio).toBe('2026-04-01');
    expect(ex.periodo.fim).toBe('2026-04-30');
  });

  it('classifica e mantém o FITID como documento', () => {
    const ex = lerExtratoOfx(ofx([['20260410', '-5.00', 'PIX TRANSF RAFAEL 10/04']]), { banco: 'ITAU' });
    expect(ex.lancamentos[0]).toMatchObject({ categoria: 'pix', documento: 'F0' });
  });
});

describe('mesmoNumeroConta', () => {
  it.each([
    ['36733', '2207000000036733-8'],
    ['27061', '653027061-7'],
    ['000578136459', '000578136459-1'],
    ['13000599', '157513000599-5'],
    ['58711', '58711-7'],
    ['12345', '12345'],
  ])('%s = %s', (a, b) => expect(mesmoNumeroConta(a, b)).toBe(true));

  it.each([
    ['69361', '69363'],
    ['6850', '6850-0'],
    ['36733', '2207000000036734-6'],
    ['', '12345'],
  ])('%s ≠ %s', (a, b) => expect(mesmoNumeroConta(a, b)).toBe(false));
});
