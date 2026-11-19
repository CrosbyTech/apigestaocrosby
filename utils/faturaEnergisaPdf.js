// Leitura do boleto da Energisa (2ª via simplificada) em PDF: número da fatura,
// UC, competência, emissão e linha digitável. Valor e vencimento saem da própria
// linha digitável (fator de vencimento + valor), que é o que o banco vai cobrar.
import { extrairPaginasPdf } from './extratoStonePdf.js';

const MES = { JAN: '01', FEV: '02', MAR: '03', ABR: '04', MAI: '05', JUN: '06', JUL: '07', AGO: '08', SET: '09', OUT: '10', NOV: '11', DEZ: '12' };
const DIA_MS = 86400000;

/**
 * Vencimento pelo fator de 4 dígitos do boleto. O fator voltou a 1000 em
 * 22/02/2025; como só lemos boleto atual, vale a data mais perto de hoje.
 */
export function vencimentoDoFator(fator, hoje = new Date()) {
  const f = Number(fator);
  if (!(f >= 1000 && f <= 9999)) return null;
  const candidatas = [Date.UTC(1997, 9, 7) + f * DIA_MS, Date.UTC(2025, 1, 22) + (f - 1000) * DIA_MS];
  const perto = candidatas.sort((a, b) => Math.abs(a - hoje.getTime()) - Math.abs(b - hoje.getTime()))[0];
  return new Date(perto).toISOString().slice(0, 10);
}

/**
 * @param texto todo o texto do PDF, com os trechos separados por espaço
 * @returns {{ numero, uc, referencia, emissao, vencimento, valor, linhaDigitavel, cnpjBeneficiario, texto }} (null no que não achar)
 */
export function interpretarTextoFaturaEnergisa(texto, hoje = new Date()) {
  const t = String(texto || '').replace(/\s+/g, ' ');
  const numero = t.match(/N[º°o]\s*(\d{3}\.\d{3}\.\d{3})(?!\d)/);
  // a UC tem 2 ou 3 grupos de milhar: "25.474.053-34" e "1.677.776.053-40"
  const uc = t.match(/(?<![\d.])(\d{1,3}(?:\.\d{3}){2,3}-\d{2})(?!\d)/);
  const ref = t.match(/\b(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)\/(20\d{2})\b/i);
  const linha = t.match(/(?<!\d)(\d{5}\.\d{5}) (\d{5}\.\d{6}) (\d{5}\.\d{6}) (\d) (\d{14})(?!\d)/);
  const vencimento = linha ? vencimentoDoFator(linha[5].slice(0, 4), hoje) : null;
  const valor = linha ? Number(linha[5].slice(4)) / 100 : null;
  // emissão = "data do documento": a data do boleto que não é o vencimento
  const vencBr = vencimento ? vencimento.split('-').reverse().join('/') : null;
  const datas = [...t.matchAll(/(?<![\d/])(\d{2})\/(\d{2})\/(20\d{2})(?![\d/])/g)].map((m) => ({ br: m[0], iso: `${m[3]}-${m[2]}-${m[1]}` }));
  const emissao = datas.find((d) => d.br !== vencBr && (!vencimento || d.iso <= vencimento));
  const cnpj = t.match(/CNPJ\s*(\d{2}\.\d{3}\.\d{3}\s*\/\s*\d{4}-\d{2})/i);
  return {
    numero: numero ? numero[1].replace(/\D/g, '') : null,
    uc: uc ? uc[1].replace(/\D/g, '') : null,
    referencia: ref ? `${MES[ref[1].toUpperCase()]}/${ref[2]}` : null,
    emissao: emissao ? emissao.iso : null,
    vencimento,
    valor,
    linhaDigitavel: linha ? linha.slice(1, 6).join(' ') : null,
    cnpjBeneficiario: cnpj ? cnpj[1].replace(/\D/g, '') : null,
    texto: t,
  };
}

export async function lerFaturaEnergisaPdf(buffer, hoje = new Date()) {
  const paginas = await extrairPaginasPdf(buffer);
  return interpretarTextoFaturaEnergisa(paginas.flatMap((p) => (p.items || []).map((i) => i.s)).join(' '), hoje);
}
