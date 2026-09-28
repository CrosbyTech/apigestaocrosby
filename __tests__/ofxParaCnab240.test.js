// Testa o conversor OFX (Stone) → CNAB 240 FEBRABAN (extrato p/ conciliação).
// Usa um OFX sintético no formato exato que o app da Stone exporta.
import { jest } from '@jest/globals';
import {
  parseOfx,
  gerarCnab240,
  classificarLancamento,
  decodificarOfx,
} from '../utils/ofxParaCnab240.js';

const OFX = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
CHARSET:1252

<OFX>
	<BANKMSGSRSV1>
		<STMTTRNRS>
			<STMTRS>
				<CURDEF>BRL</CURDEF>
				<BANKACCTFROM>
					<BANKID>0197</BANKID>
					<BRANCHID>1</BRANCHID>
					<ACCTID>12345678-9</ACCTID>
					<ACCTTYPE>CHECKING</ACCTTYPE>
				</BANKACCTFROM>
				<BANKTRANLIST>
					<DTSTART>20260901000000[-3:BRT]</DTSTART>
					<DTEND>20260904000000[-3:BRT]</DTEND>
					<STMTTRN>
						<TRNTYPE>DEBIT</TRNTYPE>
						<DTPOSTED>20260903101500</DTPOSTED>
						<TRNAMT>-150.00</TRNAMT>
						<FITID>f3</FITID>
						<MEMO>FORNECEDOR XYZ LTDA - Transferência | Pix</MEMO>
					</STMTTRN>
					<STMTTRN>
						<TRNTYPE>CREDIT</TRNTYPE>
						<DTPOSTED>20260902082000</DTPOSTED>
						<TRNAMT>1000.50</TRNAMT>
						<FITID>f2</FITID>
						<MEMO>Recebimento vendas - Mastercard | Crédito</MEMO>
					</STMTTRN>
					<STMTTRN>
						<TRNTYPE>CREDIT</TRNTYPE>
						<DTPOSTED>20260901140000</DTPOSTED>
						<TRNAMT>49.90</TRNAMT>
						<FITID>f1</FITID>
						<MEMO>JOSÉ DA SILVA - Pix | Maquininha</MEMO>
					</STMTTRN>
					<STMTTRN>
						<TRNTYPE>DEBIT</TRNTYPE>
						<DTPOSTED>20260901090000</DTPOSTED>
						<TRNAMT>-59.90</TRNAMT>
						<FITID>f0</FITID>
						<MEMO>Mensalidade - Maquininha Stone</MEMO>
					</STMTTRN>
				</BANKTRANLIST>
				<LEDGERBAL>
					<BALAMT>1340.50</BALAMT>
					<DTASOF>20260904000000[-3:BRL]</DTASOF>
				</LEDGERBAL>
			</STMTRS>
		</STMTTRNRS>
	</BANKMSGSRSV1>
</OFX>`;

describe('parseOfx', () => {
  const ex = parseOfx(OFX);

  test('lê conta, banco e período', () => {
    expect(ex.banco.codigo).toBe('197');
    expect(ex.conta).toMatchObject({ agencia: '1', numero: '12345678', dv: '9' });
    expect(ex.periodo.inicio).toBe('2026-09-01');
    expect(ex.periodo.fim).toBe('2026-09-03'); // DTEND é o dia seguinte 00:00
  });

  test('ordena cronologicamente e calcula saldos', () => {
    expect(ex.lancamentos.map((l) => l.fitid)).toEqual(['f0', 'f1', 'f2', 'f3']);
    expect(ex.saldo.final).toBe(1340.5);
    expect(ex.saldo.totalCreditos).toBe(1050.4);
    expect(ex.saldo.totalDebitos).toBe(209.9);
    expect(ex.saldo.inicial).toBe(500); // 1340.50 - 1050.40 + 209.90
    expect(ex.saldo.finalEm).toBe('2026-09-03');
  });

  test('decodifica UTF-8 mesmo com CHARSET:1252 declarado', () => {
    const txt = decodificarOfx(Buffer.from(OFX, 'utf8'));
    expect(txt).toContain('JOSÉ DA SILVA');
  });
});

describe('classificarLancamento', () => {
  const c = (memo, valor) => classificarLancamento({ memo, valor });

  test('cartão', () => {
    expect(c('Recebimento vendas - Visa Electron | Débito', 10)).toMatchObject({
      grupo: 'cartao',
      categoria: '205',
      historico: '0CD1',
      descricao: 'VENDAS VISA ELECTRON DEB',
      bandeira: 'VISA ELECTRON',
    });
    expect(c('Recebimento vendas - Antecipação | Crédito', 10)).toMatchObject({
      grupo: 'antecipacao',
      historico: '0AN1',
    });
  });

  test('pix recebido, pago e devolvido', () => {
    expect(c('FULANO - Transferência | Pix', 10)).toMatchObject({ categoria: '209', historico: '0CX1', contraparte: 'FULANO' });
    expect(c('FULANO - Transferência | Pix', -10)).toMatchObject({ categoria: '120', historico: '0DX1' });
    expect(c('FULANO - Devolução | Pix', 10)).toMatchObject({ historico: '0DV1', descricao: 'DEVOLUCAO PIX RECEBIDA' });
    expect(c('FULANO - Pix | Maquininha', 10)).toMatchObject({ historico: '0CX2', descricao: 'PIX MAQUININHA' });
  });

  test('pagamento e tarifa', () => {
    expect(c('BEE TECNOLOGIA LTDA - Pagamento', -250)).toMatchObject({ categoria: '112', historico: '0PG1' });
    expect(c('Mensalidade - Maquininha Stone', -59.9)).toMatchObject({ categoria: '105', historico: '0TF1' });
  });
});

describe('gerarCnab240', () => {
  const ex = parseOfx(OFX);
  const agora = new Date(2026, 8, 25, 14, 30, 0);
  const { linhas, conteudo, resumo } = gerarCnab240(ex, {
    cnpj: '17.177.680/0001-16',
    empresa: 'CROSBY CR VESTUARIO LTDA',
    agora,
    sequencia: 42,
  });
  const campo = (ln, ini, fim) => ln.slice(ini - 1, fim);

  test('estrutura: 240 colunas, CRLF, ASCII, contagem de registros', () => {
    expect(linhas).toHaveLength(8); // header arq + header lote + 4 detalhes + trailer lote + trailer arq
    for (const ln of linhas) expect(ln).toHaveLength(240);
    expect(conteudo.endsWith('\r\n')).toBe(true);
    expect(conteudo.split('\r\n').filter(Boolean)).toHaveLength(8);
    expect(/^[\x20-\x7E\r\n]*$/.test(conteudo)).toBe(true);
    expect(resumo.qtdRegistros).toBe(8);
  });

  test('header de arquivo', () => {
    const h = linhas[0];
    expect(campo(h, 1, 8)).toBe('19700000');
    expect(campo(h, 18, 32)).toBe('217177680000116');
    expect(campo(h, 53, 57)).toBe('00001');
    expect(campo(h, 59, 71)).toBe('0000123456789');
    expect(campo(h, 73, 102)).toBe('CROSBY CR VESTUARIO LTDA      ');
    expect(campo(h, 103, 132)).toBe('STONE PAGAMENTOS              ');
    expect(campo(h, 143, 163)).toBe('2' + '25092026' + '143000' + '000042');
    expect(campo(h, 164, 166)).toBe('087');
  });

  test('header de lote com saldo inicial do dia anterior', () => {
    const h = linhas[1];
    expect(campo(h, 1, 16)).toBe('19700011E0440032');
    expect(campo(h, 143, 150)).toBe('31082026');
    expect(campo(h, 151, 168)).toBe('000000000000050000');
    expect(campo(h, 169, 173)).toBe('CPBRL');
  });

  test('detalhe segmento E na ordem cronológica', () => {
    const d = linhas[2]; // f0: tarifa 59,90 em 01/09
    expect(campo(d, 1, 14)).toBe('1970001300001E');
    expect(campo(d, 109, 113)).toBe('DPV01');
    expect(campo(d, 134, 150)).toBe('N' + '01092026' + '01092026');
    expect(campo(d, 151, 169)).toBe('000000000000005990D');
    expect(campo(d, 170, 176)).toBe('1050TF1');
    expect(campo(d, 177, 201)).toBe('TARIFA MAQUININHA STONE  ');

    const pix = linhas[3]; // f1: pix maquininha 49,90 (acento removido)
    expect(campo(pix, 151, 169)).toBe('000000000000004990C');
    expect(campo(pix, 170, 176)).toBe('2090CX2');
    expect(campo(pix, 202, 240)).toBe('PIX_POS   JOSE DA SILVA'.padEnd(39));

    const cartao = linhas[4]; // f2
    expect(campo(cartao, 170, 201)).toBe('2050CR1' + 'VENDAS MASTERCARD CRED   ');

    const deb = linhas[5]; // f3
    expect(campo(deb, 151, 176)).toBe('000000000000015000D1200DX1');
  });

  test('trailer de lote: saldo final, contagem e somas', () => {
    const t = linhas[6];
    expect(campo(t, 1, 8)).toBe('19700015');
    expect(campo(t, 73, 88)).toBe(' '.repeat(16));
    expect(campo(t, 89, 142)).toBe('0'.repeat(54));
    expect(campo(t, 143, 150)).toBe('03092026');
    expect(campo(t, 151, 170)).toBe('000000000000134050CP');
    expect(campo(t, 171, 176)).toBe('000006');
    expect(campo(t, 177, 194)).toBe('000000000000020990'); // débitos
    expect(campo(t, 195, 212)).toBe('000000000000105040'); // créditos
  });

  test('trailer de arquivo', () => {
    const t = linhas[7];
    expect(campo(t, 1, 8)).toBe('19799999');
    expect(campo(t, 18, 35)).toBe('000001' + '000008' + '000001');
  });

  test('exige CNPJ e empresa', () => {
    expect(() => gerarCnab240(ex, { empresa: 'X' })).toThrow(/CNPJ/);
    expect(() => gerarCnab240(ex, { cnpj: '17177680000116' })).toThrow(/empresa/);
  });
});
