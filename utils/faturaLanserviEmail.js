// Leitura do carnê da Lanservi que chega por e-mail ("Lembrete de pagamento
// LANSERVI TECNOLOGIA", com o PDF anexo): boleto do mês, sem nota fiscal. O Pix
// vem só como QR code em imagem, então a fatura fica com a linha digitável.
import { extrairPaginasPdf } from './extratoStonePdf.js';
import { vencimentoDoFator } from './faturaEnergisaPdf.js';

const iso2 = (d, m, a) => `20${a}-${m}-${d}`;

/**
 * @param texto todo o texto do PDF, com os trechos separados por espaço
 * @returns {{ codigoCliente, nomeCliente, cnpjCliente, documento, emissao, referencia, vencimento, valor, linhaDigitavel, nossoNumero, cnpjEmitente, instalacao, texto }} (null no que não achar)
 */
export function interpretarTextoFaturaLanservi(texto, hoje = new Date()) {
  const t = String(texto || '').replace(/\s+/g, ' ');
  const cliente = t.match(/(?<!\d)(\d{2,8}) - ([A-ZÀ-Ú0-9 .&'-]{3,60}?) (?:End:|CPF\/CNPJ:|\d{2}\.\d{3}\.\d{3}\/)/);
  const cnpjCliente = t.match(/CPF\/CNPJ:?\s*(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|\d{3}\.\d{3}\.\d{3}-\d{2})/i);
  const documento = t.match(/N[úu]mero Doc\s*(\d{4,})/i) || t.match(/Valor do documento \d{2}\/\d{2}\/\d{2} (\d{4,})/i);
  const dataDoc = t.match(/Valor do documento (\d{2})\/(\d{2})\/(\d{2}) \d{4,}/i);
  const periodo = t.match(/Per[íi]odo de Refer[êe]ncia\s*\d{2}\/(\d{2})\/(\d{4})\s*-\s*\d{2}\/\d{2}\/\d{4}/i);
  const linha = t.match(/(?<!\d)(\d{5}\.\d{5}) (\d{5}\.\d{6}) (\d{5}\.\d{6}) (\d) (\d{14})(?!\d)/);
  const nosso = t.match(/Nosso N[úu]mero\s*(\d{6,15}-\d)/i);
  const emitente = t.match(/LANSERVI TECNOLOGIA (\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/i);
  // "End: Rua …, 777 SHOPPING …, Boa Viagem Cidade: Recife - Estado de Pernambuco 51020-900"
  const end = t.match(/End:\s*(.{5,140}?)\s*Cidade:\s*([^-]{2,40}?)\s*-\s*Estado d[eo] ([A-Za-zÀ-ú ]{3,30}?)\s*(\d{5}-?\d{3})/i);
  return {
    codigoCliente: cliente ? cliente[1] : null,
    nomeCliente: cliente ? cliente[2].trim() : null,
    cnpjCliente: cnpjCliente ? cnpjCliente[1].replace(/\D/g, '') : null,
    documento: documento ? documento[1] : null,
    emissao: dataDoc ? iso2(dataDoc[1], dataDoc[2], dataDoc[3]) : null,
    referencia: periodo ? `${periodo[1]}/${periodo[2]}` : null,
    vencimento: linha ? vencimentoDoFator(linha[5].slice(0, 4), hoje) : null,
    valor: linha ? Number(linha[5].slice(4)) / 100 : null,
    linhaDigitavel: linha ? linha.slice(1, 6).join(' ') : null,
    nossoNumero: nosso ? nosso[1] : null,
    cnpjEmitente: emitente ? emitente[1].replace(/\D/g, '') : null,
    instalacao: end ? `${end[1].trim()} - CEP: ${end[4].replace(/\D/g, '')} - ${end[2].trim()} / ${end[3].trim()}` : null,
    texto: t,
  };
}

export async function lerFaturaLanserviPdf(buffer, hoje = new Date()) {
  const paginas = await extrairPaginasPdf(buffer);
  return interpretarTextoFaturaLanservi(paginas.flatMap((p) => (p.items || []).map((i) => i.s)).join(' '), hoje);
}

// Conta em que a Lanservi recebe, vista no carnê real (19/11/2026): Santander (033),
// código do beneficiário 8289204. Boleto com outro começo não é lançado sozinho.
export const BOLETOS_DA_LANSERVI = [{ banco: 'Santander', inicio: '03399.82894 204' }];
export const boletoEhDaLanservi = (linhaDigitavel) => BOLETOS_DA_LANSERVI.some((b) => String(linhaDigitavel || '').startsWith(b.inicio));

/**
 * O que o corpo do lembrete diz ("Fatura: 3348126 / Valor: 149,90 / Vencimento: 10/11/2026"),
 * para conferir com o PDF.
 */
export function lerLembreteLanservi(texto) {
  const t = String(texto || '');
  const fatura = t.match(/\*?Fatura:\*?\s*(\d{4,})/i);
  const valor = t.match(/\*?Valor:\*?\s*([\d.]+,\d{2})/i);
  const venc = t.match(/\*?Vencimento:\*?\s*(\d{2})\/(\d{2})\/(\d{4})/i);
  return {
    documento: fatura ? fatura[1] : null,
    valor: valor ? Number(valor[1].replace(/\./g, '').replace(',', '.')) : null,
    vencimento: venc ? `${venc[3]}-${venc[2]}-${venc[1]}` : null,
  };
}
