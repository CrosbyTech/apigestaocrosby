import { lerExtratoCaixaOfx, ehOfx } from '../utils/extratoCaixaOfx.js';

const SGML = `OFXHEADER:100
DATA:OFXSGML
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>BRL</CURDEF><BANKACCTFROM><BANKID>0104</BANKID><BRANCHID>02044</BRANCHID><ACCTID>0005781363862</ACCTID></BANKACCTFROM><BANKTRANLIST><DTSTART>20240131030000.000</DTSTART><DTEND>20240101030000.000</DTEND><STMTTRN><TRNTYPE>CREDIT</TRNTYPE><DTPOSTED>20240102030000.000</DTPOSTED><TRNAMT>1500.00</TRNAMT><FITID>301027</FITID><NAME>DP CX AQUI</NAME></STMTTRN><STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20240102030000.000</DTPOSTED><TRNAMT>-5321.42</TRNAMT><FITID>000000</FITID><NAME>PREST EMP</NAME></STMTTRN><STMTTRN><TRNTYPE>CREDIT</TRNTYPE><DTPOSTED>20240130030000.000</DTPOSTED><TRNAMT>2600.00</TRNAMT><FITID>301908</FITID><NAME>CRED PIX</NAME></STMTTRN></BANKTRANLIST><LEDGERBAL><BALAMT>4100.16</BALAMT><DTASOF>20240131030000.000</DTASOF></LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

const XML = `<?xml version="1.0"?>
<OFX>
 <BANKMSGSRSV1><STMTTRNRS><STMTRS>
  <BANKACCTFROM><BANKID>0104</BANKID><ACCTID>0005781364591</ACCTID><ACCTTYPE>CHECKING</ACCTTYPE></BANKACCTFROM>
  <BANKTRANLIST>
   <DTSTART>20241201</DTSTART>
   <DTEND>20241231</DTEND>
   <STMTTRN>
    <TRNTYPE>DEBIT</TRNTYPE>
    <DTPOSTED>20241202120000[-3:BRT]</DTPOSTED>
    <TRNAMT>-0.20</TRNAMT>
    <FITID>1</FITID>
    <CHECKNUM>1</CHECKNUM>
    <MEMO>TAR EXT EL</MEMO>
   </STMTTRN>
   <STMTTRN>
    <TRNTYPE>CREDIT</TRNTYPE>
    <DTPOSTED>20241204120000[-3:BRT]</DTPOSTED>
    <TRNAMT>2800.00</TRNAMT>
    <FITID>41127</FITID>
    <CHECKNUM>41127</CHECKNUM>
    <MEMO>DP DIN LOT</MEMO>
   </STMTTRN>
  </BANKTRANLIST>
  <LEDGERBAL><BALAMT>2850.41</BALAMT><DTASOF>20250103</DTASOF></LEDGERBAL>
 </STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>`;

describe('Caixa — OFX do Gerenciador CAIXA (leitor novo)', () => {
  test('formato SGML (jan–nov/2024): conta, mês pelo início do período, saldo inicial = final − movimentos', () => {
    expect(ehOfx(Buffer.from(SGML, 'latin1'))).toBe(true);
    const r = lerExtratoCaixaOfx(Buffer.from(SGML, 'latin1'));
    expect(r).toMatchObject({ banco: 'CAIXA', agencia: '02044', conta: '000578136386', contaDv: '2', titular: 'CROSBY DISTRIBUICAO E CONF LTDA', titularCnpj: '17177680000116', mesReferencia: '2024-01' });
    expect(r.lancamentos).toHaveLength(3);
    expect(r.saldoFinal).toBe(4100.16);
    expect(r.saldoInicial).toBe(5321.58); // 4100.16 − 1500 + 5321.42 − 2600
    expect(r.lancamentos[0]).toMatchObject({ data: '2024-01-02', valor: 1500, historico: 'DP CX AQUI', documento: '301027', saldoApos: 6821.58 });
    expect(r.lancamentos[1].documento).toBeNull(); // FITID 000000 não é documento
    expect(r.lancamentos.at(-1).saldoApos).toBe(4100.16);
    expect(r.conferencia.bate).toBe(true);
  });
  test('formato XML (dez/2024+): MEMO/CHECKNUM, sem agência, DTASOF depois do mês', () => {
    const r = lerExtratoCaixaOfx(Buffer.from(XML, 'latin1'));
    expect(r).toMatchObject({ conta: '000578136459', contaDv: '1', agencia: null, titularCnpj: '27728810000115', mesReferencia: '2024-12', saldoFinal: 2850.41 });
    expect(r.lancamentos.map((l) => l.historico)).toEqual(['TAR EXT EL', 'DP DIN LOT']);
    expect(r.lancamentos[0].historicoDescricao).toBe('Tarifa extrato eletrônico');
    expect(r.saldoInicial).toBe(50.61);
    expect(r.periodo).toEqual({ inicio: '2024-12-01', fim: '2024-12-31' });
  });
  test('OFX de outro banco é recusado', () => {
    expect(() => lerExtratoCaixaOfx(Buffer.from(SGML.replace('<BANKID>0104', '<BANKID>001'), 'latin1'))).toThrow(/não da Caixa/);
  });
});
