// Leitura da fatura da Neoenergia Cosern (DANFE da nota fiscal de energia) em PDF:
// número da nota, emissão, competência, linha digitável e código do cliente.
// Valor e vencimento vêm da conversa com a Cosern; aqui dá para conferir se o
// PDF traz os mesmos (confereValorEVencimento).
import { extrairPaginasPdf } from './extratoStonePdf.js';

const iso = (d, m, a) => `${a}-${m}-${d}`;

/**
 * @param texto todo o texto do PDF, com os trechos separados por espaço ou quebra de linha
 * @returns {{ notaFiscal, serie, emissao, referencia, linhaDigitavel, codigoCliente, texto }} (null no que não achar)
 */
export function interpretarTextoFaturaCosern(texto) {
  const t = String(texto || '').replace(/\s+/g, ' ');
  const nota = t.match(/NOTA FISCAL N[°ºo.]*\s*(\d{5,})/i);
  const serie = t.match(/S[ÉE]RIE\s*(\d+)/i);
  const emissao = t.match(/DATA DE EMISS[ÃA]O:?\s*(\d{2})\/(\d{2})\/(\d{4})/i);
  // competência: o primeiro MM/AAAA solto (as datas completas têm dia na frente)
  const ref = t.match(/(?<![\d/])(0[1-9]|1[0-2])\/(20\d{2})(?![\d/])/);
  const linha = t.match(/(?<!\d)(\d{12})\s(\d{12})\s(\d{12})\s(\d{12})(?!\d)/);
  const codigo = t.match(/(?<!\d)(70\d{8})(?!\d)/);
  return {
    notaFiscal: nota ? nota[1] : null,
    serie: serie ? serie[1] : null,
    emissao: emissao ? iso(emissao[1], emissao[2], emissao[3]) : null,
    referencia: ref ? `${ref[1]}/${ref[2]}` : null,
    linhaDigitavel: linha ? linha.slice(1, 5).join(' ') : null,
    codigoCliente: codigo ? codigo[1] : null,
    texto: t,
  };
}

/** O PDF mostra este valor (1.234,56) e este vencimento (dd/mm/aaaa)? */
export function confereValorEVencimento(lida, { valor, vencimento }) {
  const valorBr = Number(valor).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const vencBr = String(vencimento).slice(0, 10).split('-').reverse().join('/');
  return lida.texto.includes(valorBr) && lida.texto.includes(vencBr);
}

export async function lerFaturaCosernPdf(buffer) {
  const paginas = await extrairPaginasPdf(buffer);
  return interpretarTextoFaturaCosern(paginas.flatMap((p) => (p.items || []).map((i) => i.s)).join(' '));
}
