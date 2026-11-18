import { describe, it, expect } from '@jest/globals';
import { interpretarTextoFaturaCosern, confereValorEVencimento } from '../utils/faturaCosernPdf.js';

// texto de uma fatura fictícia, na ordem em que o PDF entrega os trechos
const TEXTO = [
  'DANFE - DOCUMENTO AUXILIAR DA NOTA FISCAL DE ENERGIA ELÉTRICA ELETRÔNICA',
  'CNPJ 08.324.196/0001-81',
  'NOTA FISCAL N°',
  '168706456',
  '- SÉRIE 000 / DATA DE EMISSÃO: 27/10/2026',
  'Protocolo de autorização: 3242600017015503 - 28/10/2026 às 03:04:47',
  'REF:MÊS/ANO',
  'TOTAL A PAGAR R$',
  'VENCIMENTO',
  '10/2026',
  '1.991,39',
  '16/11/2026',
  '838000000092 913900384076 029458159202 027649860839',
  '7029458159',
].join('\n');

describe('fatura da Cosern em PDF', () => {
  it('lê nota, série, emissão, competência, linha digitável e código do cliente', () => {
    const r = interpretarTextoFaturaCosern(TEXTO);
    expect(r).toMatchObject({
      notaFiscal: '168706456',
      serie: '000',
      emissao: '2026-10-27',
      referencia: '10/2026',
      linhaDigitavel: '838000000092 913900384076 029458159202 027649860839',
      codigoCliente: '7029458159',
    });
  });

  it('confere valor e vencimento contra o que veio na conversa', () => {
    const r = interpretarTextoFaturaCosern(TEXTO);
    expect(confereValorEVencimento(r, { valor: 1991.39, vencimento: '2026-11-16' })).toBe(true);
    expect(confereValorEVencimento(r, { valor: 1991.4, vencimento: '2026-11-16' })).toBe(false);
    expect(confereValorEVencimento(r, { valor: 1991.39, vencimento: '2026-11-17' })).toBe(false);
  });

  it('PDF que não é fatura devolve tudo vazio', () => {
    expect(interpretarTextoFaturaCosern('qualquer coisa')).toMatchObject({ notaFiscal: null, emissao: null, referencia: null, linhaDigitavel: null, codigoCliente: null });
  });
});
