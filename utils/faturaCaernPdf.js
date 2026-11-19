// Leitura da 2ª via da CAERN em PDF (documento auxiliar da nota fiscal de água e
// saneamento): número da nota, emissão, competência, matrícula, vencimento e o
// código de barras de arrecadação. O valor sai do próprio código de barras, que é
// o que o banco vai cobrar.
import { extrairPaginasPdf } from './extratoStonePdf.js';

const MES = { JAN: '01', FEV: '02', MAR: '03', ABR: '04', MAI: '05', JUN: '06', JUL: '07', AGO: '08', SET: '09', OUT: '10', NOV: '11', DEZ: '12' };

/**
 * Valor de um código de arrecadação (conta de consumo, começa com 8): os 11
 * dígitos das posições 5 a 15 do código de barras de 44, em centavos.
 * @param blocos os 4 blocos "82600000001-6" como vêm na conta
 */
export function valorDaArrecadacao(blocos) {
  const barras = (blocos || []).map((b) => String(b).replace(/\D/g, '').slice(0, 11)).join('');
  if (barras.length !== 44 || barras[0] !== '8') return null;
  return Number(barras.slice(4, 15)) / 100;
}

/**
 * @param texto todo o texto do PDF, com os trechos separados por espaço (a ordem dos trechos vem embaralhada)
 * @returns {{ notaFiscal, serie, emissao, referencia, matricula, vencimento, valor, linhaDigitavel, cnpjEmitente, texto }} (null no que não achar)
 */
export function interpretarTextoFaturaCaern(texto) {
  const t = String(texto || '').replace(/\s+/g, ' ');
  const nota = t.match(/N[ÚU]MERO DA NOTA FISCAL:?\s*(\d{5,})/i);
  const serie = t.match(/S[ÉE]RIE:?\s*(\d+)/i);
  const emissao = t.match(/DATA DE EMISS[ÃA]O:?\s*(\d{2})\/(\d{2})\/(\d{4})/i);
  const matricula = t.match(/(?<![\d.])(\d{8}\.\d)(?![\d.])/);
  // "NOV/26 120,72 23/11/2026" ou "NOV/26 23/11/2026": competência e vencimento vêm juntos
  const ref = t.match(/\b(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)\/(\d{2}) (?:[\d.]+,\d{2} )?(\d{2})\/(\d{2})\/(20\d{2})(?!\d)/i);
  const linha = t.match(/(?<![\d-])(\d{11}-\d) (\d{11}-\d) (\d{11}-\d) (\d{11}-\d)(?![\d-])/);
  // chave de acesso da nota: UF(2) AAMM(4) CNPJ do emitente(14) …
  const chave = t.match(/CHAVE DE ACESSO:?\s*((?:\d{4} ?){11})/i);
  return {
    notaFiscal: nota ? nota[1] : null,
    serie: serie ? serie[1] : null,
    emissao: emissao ? `${emissao[3]}-${emissao[2]}-${emissao[1]}` : null,
    referencia: ref ? `${MES[ref[1].toUpperCase()]}/20${ref[2]}` : null,
    matricula: matricula ? matricula[1].replace(/\D/g, '').replace(/^0+/, '') : null,
    vencimento: ref ? `${ref[5]}-${ref[4]}-${ref[3]}` : null,
    valor: linha ? valorDaArrecadacao(linha.slice(1, 5)) : null,
    linhaDigitavel: linha ? linha.slice(1, 5).join(' ') : null,
    cnpjEmitente: chave ? chave[1].replace(/\D/g, '').slice(6, 20) : null,
    texto: t,
  };
}

export async function lerFaturaCaernPdf(buffer) {
  const paginas = await extrairPaginasPdf(buffer);
  // a 2ª página repete o cabeçalho da nota; basta a 1ª
  return interpretarTextoFaturaCaern((paginas[0]?.items || []).map((i) => i.s).join(' '));
}
