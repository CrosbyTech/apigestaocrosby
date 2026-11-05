import { nomeTruncadoBate } from '../services/fluxoCaixaExt.js';
describe('nomes truncados do extrato × empresas do grupo', () => {
  test('cada pedaço do nome curto é prefixo do nome completo', () => {
    expect(nomeTruncadoBate('FABIO F LIMA AZE', 'FABIO FERREIRA DE LIMA AZEVEDO')).toBe(true);
    expect(nomeTruncadoBate('CROSBY DIST CONF', 'CROSBY DISTRIBUICAO E CONFECCAO LTDA')).toBe(true);
    expect(nomeTruncadoBate('CROSBY', 'CROSBY CR VESTUARIO LTDA')).toBe(true);
    expect(nomeTruncadoBate('FLAVIO F LIMA AZ', 'FLAVIO FERREIRA DE LIMA AZEVEDO LTDA')).toBe(true);
    expect(nomeTruncadoBate('CROSBY DISTR', 'CROSBY DISTRIBUICAO E CONFECCAO EIRELI')).toBe(true);
    expect(nomeTruncadoBate('FABIO F', 'FA MODA & VAREJO LTDA')).toBe(false);
    expect(nomeTruncadoBate('CROSBY', 'IRMAOS CR VESTUARIO LTDA')).toBe(false);
    expect(nomeTruncadoBate('ELITE CONSULTORES', 'CROSBY CR VESTUARIO LTDA')).toBe(false);
    expect(nomeTruncadoBate('FA', 'FABIO FERREIRA DE LIMA AZEVEDO')).toBe(false);
  });
});
