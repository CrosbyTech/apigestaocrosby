// Leitura da fatura da Alares que chega por e-mail ("A fatura digital da sua
// internet chegou!"): o PDF anexo (boleto + documento auxiliar da nota fiscal de
// comunicação) e o Pix copia e cola que vem escrito no corpo da mensagem.
// O "Sua fatura venceu!" não traz PDF nem diz de qual contrato é: não serve.
import { extrairPaginasPdf } from './extratoStonePdf.js';
import { vencimentoDoFator } from './faturaEnergisaPdf.js';

/** CRC16-CCITT (0xFFFF) usado no fim de todo Pix copia e cola. */
export function crcDoPix(texto) {
  let crc = 0xffff;
  for (const b of Buffer.from(String(texto), 'utf8')) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i += 1) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/** O código fecha com o próprio CRC? (pega código cortado, emendado errado ou adulterado) */
export function pixIntegro(codigo) {
  const m = String(codigo || '').match(/^(000201.*6304)([0-9A-Fa-f]{4})$/s);
  return Boolean(m) && crcDoPix(m[1]) === m[2].toUpperCase();
}

/**
 * Pix copia e cola escrito no corpo de um e-mail. O Gmail quebra a linha onde há
 * espaço (no nome do recebedor: "ALARES\nINTERNET S/A"), então a quebra vira
 * espaço; só devolve o código que fecha com o CRC.
 */
export function pixDoTexto(texto) {
  return pixsDoTexto(texto)[0] || null;
}

/** Todos os Pix copia e cola íntegros do texto (e-mail com várias faturas encaminhadas juntas traz um por fatura). */
export function pixsDoTexto(texto) {
  const achados = [];
  for (const m of String(texto || '').matchAll(/000201[\s\S]{40,600}?6304[0-9A-Fa-f]{4}/g)) {
    for (const emenda of [' ', '']) {
      const codigo = m[0].replace(/\s*\r?\n\s*/g, emenda);
      if (pixIntegro(codigo)) {
        if (!achados.includes(codigo)) achados.push(codigo);
        break;
      }
    }
  }
  return achados;
}

/** Quem escreveu de verdade um e-mail encaminhado à mão ("---------- Forwarded message ---------\nDe: Nome <a@b>"). */
export function remetenteDoEncaminhado(texto) {
  // uma mensagem: "---------- Forwarded message ---------"; a conversa inteira ("Encaminhar tudo"): "Forwarded Conversation\nSubject: …\n------------------------"
  const m = String(texto || '').match(/(?:-{5,}\s*(?:Forwarded message|Mensagem encaminhada)\s*-{5,}|(?:Forwarded Conversation|Conversa encaminhada)[\s\S]{0,300}?-{5,})\s*(?:De|From):[^<\n]*<([^>\s]+@[^>\s]+)>/i);
  return m ? m[1].toLowerCase() : null;
}

/**
 * @param texto todo o texto do PDF, com os trechos separados por espaço
 * @returns {{ codigoCliente, cnpjCliente, notaFiscal, serie, emissao, referencia, vencimento, valor, linhaDigitavel, nossoNumero, cnpjEmitente, instalacao, texto }} (null no que não achar)
 */
export function interpretarTextoFaturaAlares(texto, hoje = new Date()) {
  const t = String(texto || '').replace(/\s+/g, ' ');
  const cliente = t.match(/(?<!\d)(\d{5,9}) - [^|]{3,80}\| (\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|\d{3}\.\d{3}\.\d{3}-\d{2})/);
  const codigo = t.match(/C[ÓO]DIGO DO CLIENTE:?\s*(\d{5,9})/i);
  const nota = t.match(/NOTA FISCAL FATURA N[º°o.]*\s*(\d{4,})/i);
  const serie = t.match(/S[ÉE]RIE:?\s*(\d+)/i);
  const emissao = t.match(/DATA DE EMISS[ÃA]O:?\s*(\d{2})\/(\d{2})\/(\d{4})/i);
  const periodo = t.match(/PER[ÍI]ODO:?\s*\d{2}\/(\d{2})\/(\d{4})\s*[àa]\s*\d{2}\/\d{2}\/\d{4}/i);
  const linha = t.match(/(?<!\d)(\d{5}\.\d{5}) (\d{5}\.\d{6}) (\d{5}\.\d{6}) (\d) (\d{14})(?!\d)/);
  const nosso = t.match(/Nosso N[úu]mero:?\s*(\d{8,20})/i);
  const chave = t.match(/CHAVE DE ACESSO:?\s*((?:\d ?){44})/i);
  const instalacao = t.match(/ENDERE[ÇC]O DE INSTALA[ÇC][ÃA]O:?\s*(.{5,160}?\/ ?[A-Z]{2})(?= |$)/i);
  return {
    codigoCliente: codigo ? codigo[1] : cliente ? cliente[1] : null,
    cnpjCliente: cliente ? cliente[2].replace(/\D/g, '') : null,
    notaFiscal: nota ? nota[1] : null,
    serie: serie ? serie[1] : null,
    emissao: emissao ? `${emissao[3]}-${emissao[2]}-${emissao[1]}` : null,
    referencia: periodo ? `${periodo[1]}/${periodo[2]}` : null,
    vencimento: linha ? vencimentoDoFator(linha[5].slice(0, 4), hoje) : null,
    valor: linha ? Number(linha[5].slice(4)) / 100 : null,
    linhaDigitavel: linha ? linha.slice(1, 6).join(' ') : null,
    nossoNumero: nosso ? nosso[1] : null,
    cnpjEmitente: chave ? chave[1].replace(/\D/g, '').slice(6, 20) : null,
    instalacao: instalacao ? instalacao[1].replace(/\s+/g, ' ').trim() : null,
    texto: t,
  };
}

export async function lerFaturaAlaresPdf(buffer, hoje = new Date()) {
  const paginas = await extrairPaginasPdf(buffer);
  return interpretarTextoFaturaAlares(paginas.flatMap((p) => (p.items || []).map((i) => i.s)).join(' '), hoje);
}

// Contas em que a Alares recebe, vistas nas faturas reais (19/11/2026): o começo da
// linha digitável identifica o banco e o convênio dela. Boleto com outro começo NÃO
// é lançado sozinho — pode ser boleto falso mandado para o endereço de e-mail.
export const BOLETOS_DA_ALARES = [
  { banco: 'Caixa', inicio: '10499.90607 7' }, // banco 104, beneficiário 0990607
  { banco: 'Banco do Brasil', inicio: '00190.00009 03805.454' }, // banco 001, convênio 3805454
  { banco: 'Banco do Brasil', inicio: '00190.00009 03733.887' }, // banco 001, convênio 3733887 (contratos da matriz)
];

export const boletoEhDaAlares = (linhaDigitavel) => BOLETOS_DA_ALARES.some((b) => String(linhaDigitavel || '').startsWith(b.inicio));

/**
 * O Pix do e-mail é o mesmo título do boleto do PDF? No Pix da Caixa a cobrança
 * leva o nosso número do boleto; quando o código traz valor, ele tem que bater.
 */
export function pixEhDoBoleto(pix, { nossoNumero, valor }, valorNoPix) {
  if (!pix) return false;
  if (valorNoPix != null) return Math.abs(valorNoPix - Number(valor)) < 0.005;
  return Boolean(nossoNumero) && pix.includes(nossoNumero);
}

const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');

/**
 * De qual loja é a fatura: a do LOCAL DE INSTALAÇÃO, não a do CNPJ que contratou
 * (a internet da Ayrton Senna está no CNPJ da matriz; as da matriz, no de outra
 * empresa do grupo). Acha pelo CEP da instalação no cadastro de empresas e, se
 * mais de uma empresa tiver aquele CEP, pelo número do endereço ou pelo CNPJ.
 * Sem empresa no CEP, vale a do CNPJ. Devolve null quando não dá para decidir.
 * @param empresas [{ code, cnpj, endereco: { cep, addressNumber } }]
 * @returns {{ code, por: 'instalacao'|'cnpj' }|null}
 */
export function empresaDaInstalacao(instalacao, cnpjCliente, empresas) {
  const lista = empresas || [];
  const cep = soDigitos(String(instalacao || '').match(/CEP:?\s*([\d.-]{8,10})/i)?.[1]);
  const numero = String(instalacao || '').match(/,\s*(\d{1,6})\b/)?.[1] || null;
  const doCnpj = lista.find((e) => soDigitos(e.cnpj) === soDigitos(cnpjCliente)) || null;
  let noCep = cep.length === 8 ? lista.filter((e) => soDigitos(e.endereco?.cep) === cep) : [];
  if (noCep.length > 1 && numero) {
    const noNumero = noCep.filter((e) => String(e.endereco?.addressNumber ?? '') === numero);
    if (noNumero.length) noCep = noNumero;
  }
  if (noCep.length === 1) return { code: noCep[0].code, por: 'instalacao' };
  if (noCep.length > 1) return doCnpj && noCep.some((e) => e.code === doCnpj.code) ? { code: doCnpj.code, por: 'cnpj' } : null;
  return doCnpj ? { code: doCnpj.code, por: 'cnpj' } : null;
}

/**
 * O Pix deste boleto entre os vários do e-mail: só quando há UM candidato e ele
 * não serve também para outra fatura do mesmo e-mail (duas faturas de mesmo valor
 * no Banco do Brasil não dão para distinguir pelo Pix — essas ficam só com o boleto).
 * @param outras as demais faturas lidas no mesmo e-mail
 */
export function pixDoBoletoEntre(pixs, lida, outras, valorDoPix) {
  const serve = (p, f) => pixEhDoBoleto(p, f, valorDoPix(p));
  const candidatos = (pixs || []).filter((p) => serve(p, lida));
  if (candidatos.length !== 1) return null;
  const disputado = (outras || []).some((o) => o.nossoNumero !== lida.nossoNumero && serve(candidatos[0], o));
  return disputado ? null : candidatos[0];
}
