// Leitura da conta detalhada da Cagepa em PDF (documento auxiliar da nota fiscal
// de água e saneamento): número da nota, data da nota, competência, matrícula,
// vencimento e o código de barras de arrecadação. O valor sai do próprio código
// de barras, que é o que o banco vai cobrar.
import { extrairPaginasPdf } from './extratoStonePdf.js';
import { valorDaArrecadacao } from './faturaCaernPdf.js';

const MES = { JAN: '01', FEV: '02', MAR: '03', ABR: '04', MAI: '05', JUN: '06', JUL: '07', AGO: '08', SET: '09', OUT: '10', NOV: '11', DEZ: '12' };
const iso = (d, m, a) => `${a}-${m}-${d}`;

/**
 * @param texto todo o texto do PDF, com os trechos separados por espaço (a ordem dos trechos vem embaralhada)
 * @returns {{ notaFiscal, serie, emissao, referencia, matricula, vencimento, valor, linhaDigitavel, cnpjEmitente, texto }} (null no que não achar)
 */
export function interpretarTextoFaturaCagepa(texto) {
  const t = String(texto || '').replace(/\s+/g, ' ');
  const nota = t.match(/N[ÚU]MERO DA NOTA FISCAL:?\s*(\d{4,})/i);
  const serie = t.match(/S[ÉE]RIE:?\s*(\d+)/i);
  // "DATA: 06/11/2026" é a data da nota; "DATA DE EMISSÃO … 19/11/2026" é o dia em que a 2ª via foi impressa
  const data = t.match(/(?<!\S)DATA:\s*(\d{2})\/(\d{2})\/(\d{4})/i);
  const matricula = t.match(/(?<![\d.,])(\d{4,8}\.\d)(?![\d.,])/);
  const ref = t.match(/\b(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)\/(20\d{2})\b/i);
  // vencimento: vem colado na matrícula ("67176.2 13/11/2026 NOV/2026") ou no total ("VENCIMENTO 190,44 13/11/2026")
  const venc = t.match(/\d{4,8}\.\d (\d{2})\/(\d{2})\/(20\d{2}) (?:JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)\//i) || t.match(/VENCIMENTO [\d.]+,\d{2} (\d{2})\/(\d{2})\/(20\d{2})/i);
  const linha = t.match(/(?<![\d-])(\d{11}-\d) (\d{11}-\d) (\d{11}-\d) (\d{11}-\d)(?![\d-])/);
  // chave de acesso da nota: UF(2) AAMM(4) CNPJ do emitente(14) …
  const chave = t.match(/CHAVE DE ACESSO:?\s*((?:\d ?){44})/i);
  return {
    notaFiscal: nota ? nota[1] : null,
    serie: serie ? serie[1] : null,
    emissao: data ? iso(data[1], data[2], data[3]) : null,
    referencia: ref ? `${MES[ref[1].toUpperCase()]}/${ref[2]}` : null,
    matricula: matricula ? matricula[1].replace(/\D/g, '').replace(/^0+/, '') : null,
    vencimento: venc ? iso(venc[1], venc[2], venc[3]) : null,
    valor: linha ? valorDaArrecadacao(linha.slice(1, 5)) : null,
    linhaDigitavel: linha ? linha.slice(1, 5).join(' ') : null,
    cnpjEmitente: chave ? chave[1].replace(/\D/g, '').slice(6, 20) : null,
    texto: t,
  };
}

export async function lerFaturaCagepaPdf(buffer) {
  const paginas = await extrairPaginasPdf(buffer);
  return interpretarTextoFaturaCagepa((paginas[0]?.items || []).map((i) => i.s).join(' '));
}
