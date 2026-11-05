import { extrairContraparte, completarContraparte } from '../utils/contraparteExtrato.js';

describe('contraparte escondida no texto do extrato (layouts 2024/2025)', () => {
  test('Sicredi: documento PIX_CRED/CX com CNPJ e nome; memo com CNPJ', () => {
    expect(extrairContraparte({ memo: 'RECEBIMENTO PIX', documento: 'PIX_CRED  17177680000116 CROSBY DISTRIBUICAO E CONFECCAO LTDA-147' })).toMatchObject({ doc: '17177680000116', nome: 'CROSBY DISTRIBUICAO E CONFECCAO LTDA' });
    expect(extrairContraparte({ memo: 'TED', documento: '406265    33592092000103 IRMAOS CR VESTUARIO LTDA-92' })).toMatchObject({ doc: '33592092000103', nome: 'IRMAOS CR VESTUARIO LTDA' });
    expect(extrairContraparte({ memo: 'RECEBIMENTO PIX SICREDI 27728810000115 FABIO FER CX420792', documento: null })).toMatchObject({ doc: '27728810000115', nome: 'FABIO FER', banco: 'SICREDI' });
    expect(extrairContraparte({ memo: 'PAGAMENTO PIX', documento: 'PIX_DEB   14380200000121 iFood-2' })).toMatchObject({ doc: '14380200000121', nome: 'iFood' });
    expect(extrairContraparte({ memo: 'RECEBIMENTO PIX-PIX_CRED 27728810000115 FABIO FERREIRA DE LIMA AZEVEDO', documento: '17425158805' })).toMatchObject({ doc: '27728810000115', nome: 'FABIO FERREIRA DE LIMA AZEVEDO' });
  });
  test('Itaú: nome truncado no PIX ENVIADO/SISPAG, CNPJ formatado no PIX RECEBIDO, pistas de conta Itaú', () => {
    expect(extrairContraparte({ memo: 'PIX ENVIADO CROSBY DISTR', documento: '20240930007' })).toMatchObject({ doc: null, nome: 'CROSBY DISTR' });
    expect(extrairContraparte({ memo: 'SISPAG CROSBY DIST CONF', documento: '20240628019' })).toMatchObject({ nome: 'CROSBY DIST CONF' });
    expect(extrairContraparte({ memo: 'SISPAG FORNECEDORES', documento: null })).toMatchObject({ doc: null, nome: null });
    expect(extrairContraparte({ memo: 'SISPAG TRANSF CC ITAU', documento: '20240628004' })).toMatchObject({ nome: null, banco: 'ITAU' });
    expect(extrairContraparte({ memo: 'PIX RECEBIDO CROSBY CR VESTUARIO LTDA 17.177.680/0001-16', documento: '20250805001' })).toMatchObject({ doc: '17177680000116', nome: 'CROSBY CR VESTUARIO LTDA' });
    expect(extrairContraparte({ memo: 'PIX TRANSF CROSBY 24/09', documento: '20240924034' })).toMatchObject({ nome: 'CROSBY' });
    expect(extrairContraparte({ memo: 'TRANSF 6530.56927-3', documento: '20240930012' })).toMatchObject({ banco: 'ITAU', conta: { agencia: '6530', numero: '569273', numeroSemDv: '56927' } });
  });
  test('Santander: conta de destino, CNPJ só, pedaço de CPF e mesma titularidade', () => {
    const s = extrairContraparte({ memo: 'PIX ENVIADO 70038237/2207/00000367338', documento: '00091810' });
    expect(s.nome).toBeNull();
    expect(s.conta).toEqual({ ispb: '70038237', agencia: '2207', numero: '367338' });
    expect(extrairContraparte({ memo: 'PIX RECEBIDO 17177680000116', documento: '00352612' })).toMatchObject({ doc: '17177680000116', nome: null });
    expect(extrairContraparte({ memo: 'PIX ENVIADO FABIO FERREIRA L A 067041', documento: '00822612' })).toMatchObject({ doc: null, nome: 'FABIO FERREIRA L A' });
    expect(extrairContraparte({ memo: 'PIX ENVIADO FLAVIO F L A 11144477735', documento: '00052612' })).toMatchObject({ doc: '11144477735', nome: 'FLAVIO F L A' });
    expect(extrairContraparte({ memo: 'TRANSF VALORES MESMA TITULARIDADE', documento: '00022612' }, 'SANTANDER')).toMatchObject({ mesmaTitularidade: true, banco: 'SANTANDER' });
  });
  test('Bradesco, Unicred e BB', () => {
    expect(extrairContraparte({ memo: 'TED DIF.TITUL.CC H.BANK DEST. crosby dist e confec', documento: 'N1017E' })).toMatchObject({ nome: 'crosby dist e confec' });
    expect(extrairContraparte({ memo: 'TRANSFERENCIA TEF PIX ( DOC.: 70980 / FABIO FERREIRA DE LIMA AZEVEDO )', documento: '70980' })).toMatchObject({ nome: 'FABIO FERREIRA DE LIMA AZEVEDO' });
    expect(extrairContraparte({ memo: 'PIX - ENVIADO - 29/08 18:23 53 162 448 FERNANDA LIMA', documento: '202508291270000' })).toMatchObject({ nome: 'FERNANDA LIMA' });
    expect(extrairContraparte({ memo: 'PIX - ENVIADO', documento: '20240523120000000' })).toMatchObject({ doc: null, nome: null });
  });
  test('completarContraparte só preenche o que falta ou é lixo', () => {
    const c = completarContraparte({ memo: 'RECEBIMENTO PIX SICREDI', documento: 'CX875431  27728810000115 FABIO FERREIRA DE LIMA AZEVEDO', contraparte_nome: 'SICREDI', contraparte_doc: null, contraparte_banco: null }, 'SICREDI');
    expect(c.patch).toEqual({ doc: '27728810000115', nome: 'FABIO FERREIRA DE LIMA AZEVEDO' });
    const ok = completarContraparte({ memo: 'PIX RECEBIDO X', documento: null, contraparte_nome: 'EMPRESA BOA', contraparte_doc: '17177680000116', contraparte_banco: 'ITAU' });
    expect(ok.patch).toEqual({});
  });
});
