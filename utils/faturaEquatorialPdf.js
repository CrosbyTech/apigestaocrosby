// Leitura da 2ª via da Equatorial Maranhão em PDF (nota fiscal de energia com a
// ficha de compensação): número da nota, emissão, competência, UC, conta
// contrato e linha digitável. Valor e vencimento saem da própria linha digitável
// (fator de vencimento + valor), que é o que o banco vai cobrar.
import { extrairPaginasPdf } from './extratoStonePdf.js';
import { vencimentoDoFator } from './faturaEnergisaPdf.js';

/**
 * @param texto todo o texto do PDF, com os trechos separados por espaço
 * @returns {{ notaFiscal, serie, emissao, referencia, uc, contaContrato, vencimento, valor, linhaDigitavel, cnpjEmitente, texto }} (null no que não achar)
 */
export function interpretarTextoFaturaEquatorial(texto, hoje = new Date()) {
  const t = String(texto || '').replace(/\s+/g, ' ');
  const nota = t.match(/NOTA FISCAL N[º°o.]*\s*(\d{5,})/i);
  const serie = t.match(/S[ÉE]RIE\s*(\d+)/i);
  const emissao = t.match(/DATA DE EMISS[ÃA]O:?\s*(\d{2})\/(\d{2})\/(\d{4})/i);
  const linha = t.match(/(?<!\d)(\d{5}\.\d{5}) (\d{5}\.\d{6}) (\d{5}\.\d{6}) (\d) (\d{14})(?!\d)/);
  const uc = t.match(/(?<![\d.])(\d{1,3}(?:\.\d{3}){2,3}-\d{2})(?!\d)/);
  // a competência desta nota é a que vem logo depois da UC ("3.317.457.016-72 11/2026");
  // os débitos de outros meses também aparecem no texto ("DEBITOS: 03/2026 …")
  const ref = uc ? t.match(new RegExp(`${uc[1].replace(/\./g, '\\.')} (0[1-9]|1[0-2])/(20\\d{2})(?![\\d/])`)) : null;
  const conta = t.match(/C[ÓO]DIGO PARA D[ÉE]BITO AUTOM[ÁA]TICO\s*(\d{6,12})/i);
  // chave de acesso da NF3e: UF(2) AAMM(4) CNPJ do emitente(14) …
  const chave = t.match(/chave de acesso:?\s*(\d{44})/i);
  return {
    notaFiscal: nota ? nota[1] : null,
    serie: serie ? serie[1] : null,
    emissao: emissao ? `${emissao[3]}-${emissao[2]}-${emissao[1]}` : null,
    referencia: ref ? `${ref[1]}/${ref[2]}` : null,
    uc: uc ? uc[1].replace(/\D/g, '') : null,
    contaContrato: conta ? conta[1].replace(/^0+/, '') : null,
    vencimento: linha ? vencimentoDoFator(linha[5].slice(0, 4), hoje) : null,
    valor: linha ? Number(linha[5].slice(4)) / 100 : null,
    linhaDigitavel: linha ? linha.slice(1, 6).join(' ') : null,
    cnpjEmitente: chave ? chave[1].slice(6, 20) : null,
    texto: t,
  };
}

export async function lerFaturaEquatorialPdf(buffer, hoje = new Date()) {
  const paginas = await extrairPaginasPdf(buffer);
  return interpretarTextoFaturaEquatorial(paginas.flatMap((p) => (p.items || []).map((i) => i.s)).join(' '), hoje);
}
