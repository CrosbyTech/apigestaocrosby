// ============================================================
// Contraparte escondida no texto do extrato
// ------------------------------------------------------------
// Muitos layouts (principalmente os extratos antigos de 2024/2025) trazem a
// outra ponta do Pix/TED só no histórico ou no campo "documento":
//   Sicredi   documento "PIX_CRED  17177680000116 CROSBY DISTRIBUICAO E CONFECCAO LTDA-147"
//             memo "RECEBIMENTO PIX SICREDI 27728810000115 FABIO FER CX420792"
//   Itaú      memo "PIX ENVIADO CROSBY DISTR" · "SISPAG CROSBY DIST CONF" ·
//             "PIX RECEBIDO CROSBY CR VESTUARIO LTDA 17.177.680/0001-16" ·
//             "SISPAG TRANSF CC ITAU" (destino é conta Itaú) · "TRANSF 6530.56927-3"
//   Santander memo "PIX ENVIADO 70038237/2207/00000367338" (ISPB/agência/conta do
//             destino) · "PIX RECEBIDO 17177680000116" · "TRANSF VALORES MESMA TITULARIDADE"
//   Bradesco  "TED DIF.TITUL.CC H.BANK DEST. crosby dist e confec"
//   Unicred   "TRANSFERENCIA TEF PIX ( DOC.: 70980 / FABIO FERREIRA DE LIMA AZEVEDO )"
//   BB        "PIX - ENVIADO - 29/08 18:23 53 162 448 ALEXSANDRA CRIS"
// extrairContraparte() devolve { doc, nome, banco, conta, mesmaTitularidade }
// para completar contraparte_doc/nome na importação e no reparo dos dados
// antigos, e para o casamento de transferências entre contas usar as pistas
// (banco/agência/conta de destino) sem gravar coluna nova.
// ============================================================
import { cpfValido, cnpjValido } from './stoneInclusao.js';

const semAcento = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const limpar = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const soDigitos = (s) => String(s ?? '').replace(/\D/g, '');

// textos do Itaú (SISPAG) que não são nome de ninguém
const GENERICOS = /^(FORNECEDORES|BOLET OUTR BCO|TRANSF CC ITAU|CONCESSIONARIA|TRIB COD BARRAS|GFIP|DARF|FGTS|INSS|GPS|PIX TRANSFERENCI\w*|PIX QR-?CODE|PIX QRS|FORNECEDORES PIX.*|SALARIOS?|TRIBUTOS?|TITULOS?|PAGAMENTO|TRANSFERENCIA|PIX|TED|DOC|SICREDI|CX\d+)$/i;

const docValido = (d) => (d.length === 11 && cpfValido(d)) || (d.length === 14 && cnpjValido(d));

function acharDoc(texto) {
  const fmt = texto.match(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|\d{3}\.\d{3}\.\d{3}-\d{2}/);
  if (fmt && docValido(soDigitos(fmt[0]))) return { doc: soDigitos(fmt[0]), trecho: fmt[0], indice: fmt.index };
  const re = /(?<!\d)(\d{14}|\d{11})(?!\d)/g;
  let m;
  while ((m = re.exec(texto))) if (docValido(m[1])) return { doc: m[1], trecho: m[1], indice: m.index };
  return null;
}

// tira sufixos que não fazem parte do nome
function limparNome(nome) {
  let n = limpar(nome);
  n = n.replace(/\s*\(\s*DOC\.?:.*$/i, '');
  n = n.replace(/\s+CX\d+.*$/i, '');
  n = n.replace(/\s+Internet Banking.*$/i, '');
  n = n.replace(/\s+Sicredi Fone.*$/i, '');
  n = n.replace(/-\d+\s*$/, ''); // "…LTDA-147"
  n = n.replace(/\s+\d{2}\/\d{2}(\s+\d{2}:\d{2})?\s*$/, ''); // data no fim
  n = n.replace(/^[-\s]+/, '').replace(/[-\s]+$/, '');
  n = n.replace(/^(PIX_(CRED|DEB)|CRED PIX|DEB PIX|PGTO PIX)\s*/i, '');
  n = n.replace(/^[\d .-]{6,}\s+/, ''); // CPF mascarado na frente ("53 162 448 ALEXSANDRA")
  n = n.replace(/\s+\d{4,}\s*$/, ''); // pedaço de CPF/CNPJ no fim ("FABIO FERREIRA L A 067041")
  n = limpar(n);
  if (!/[A-Za-z]{2}/.test(n) || GENERICOS.test(semAcento(n).toUpperCase())) return null;
  return n;
}

/**
 * @param {{memo?: string, documento?: string, descricao?: string, contraparte_nome?: string, contraparte_doc?: string, contraparte_banco?: string, contraparteNome?: string, contraparteDoc?: string, contraparteBanco?: string}} l
 * @param {string} [banco] banco da conta do extrato (ITAU, SICREDI…)
 * @returns {{doc: string|null, nome: string|null, banco: string|null, conta: {agencia: string, numero: string}|null, mesmaTitularidade: boolean, fonte: string|null}}
 */
export function extrairContraparte(l, banco = null) {
  const memo = limpar(l.memo || '');
  const documento = limpar(l.documento || '');
  // só vale o documento com texto E espaço (Sicredi "PIX_CRED  1717… NOME"); códigos soltos (N1017E, CX324159) ficam de fora
  const docTemLetras = /[A-Za-z]/.test(documento) && /\s/.test(documento);
  const texto = limpar(`${memo} ${docTemLetras ? documento : ''}`);
  const up = semAcento(texto).toUpperCase();
  const out = { doc: null, nome: null, banco: null, conta: null, mesmaTitularidade: false, fonte: null };
  if (!texto) return out;

  // 1) CNPJ/CPF válido em qualquer lugar do texto
  const achado = acharDoc(texto);
  if (achado) {
    out.doc = achado.doc;
    out.fonte = 'doc';
    const depois = texto.slice(achado.indice + achado.trecho.length);
    const antes = texto.slice(0, achado.indice);
    // nome logo depois do documento (Sicredi) ou logo antes (Itaú "PIX RECEBIDO NOME 17.177.680/0001-16")
    const nDepois = limparNome(depois.replace(/^[\s:/-]+/, ''));
    if (nDepois) out.nome = nDepois;
    else {
      const mAntes = antes.match(/(?:PIX (?:RECEBIDO|ENVIADO|TRANSF)|TED (?:RECEBIDA|ENVIADA)|SISPAG|REM:|DES:|DEST\.?)\s+(.+?)\s*$/i);
      const nAntes = limparNome(mAntes ? mAntes[1] : '');
      if (nAntes) out.nome = nAntes;
    }
  }

  // 2) nome sem documento, pelos padrões de cada banco
  if (!out.nome) {
    const padroes = [
      /^PIX RECEBIDO (.+?)(?:\s+\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})?$/i,
      /^PIX (?:ENVIADO|TRANSF)\s+(.+)$/i,
      /^SISPAG\s+(.+)$/i,
      /(?:REM|DES):\s*(.+?)\s*$/i,
      /DEST\.?\s+(.+)$/i,
      /\(\s*DOC\.?:\s*[^/)]*\/\s*(.+?)\s*\)/i,
      /^PIX - (?:ENVIADO|RECEBIDO) - \d{2}\/\d{2} \d{2}:\d{2}\s+(.+)$/i,
      /^(?:RECEBIMENTO|PAGAMENTO) PIX(?: SICREDI)?\s*[-:]?\s*(?:PIX_(?:CRED|DEB)\s+)?(.+)$/i,
    ];
    for (const re of padroes) {
      const m = texto.match(re);
      if (!m) continue;
      // Santander: "PIX ENVIADO 70038237/2207/00000367338" é conta, não nome
      if (/^\d{6,}\/\d{3,5}\/\d+$/.test(m[1].trim())) break;
      const n = limparNome(m[1]);
      if (n) {
        out.nome = n;
        out.fonte = out.fonte || 'memo';
        break;
      }
    }
  }

  // 3) pistas de banco/conta de destino
  const mConta = up.match(/PIX ENVIADO\s+(\d{6,})\/(\d{3,5})\/(\d+)/);
  if (mConta) out.conta = { ispb: mConta[1], agencia: String(Number(mConta[2])), numero: String(Number(mConta[3])) };
  const mItau = up.match(/^TRANSF\s+(\d{4})\.(\d+)-(\d)$/);
  if (mItau) {
    out.conta = { agencia: mItau[1], numero: `${Number(mItau[2])}${mItau[3]}`, numeroSemDv: String(Number(mItau[2])) };
    out.banco = 'ITAU';
  }
  if (/TRANSF CC ITAU/.test(up)) out.banco = 'ITAU';
  if (/PIX SICREDI\b/.test(up) || /\bSICREDI\b/.test(up) && !/COOPERATIVA DE CREDITO/.test(up)) out.banco = out.banco || 'SICREDI';
  if (/MESMA TITULARIDADE/.test(up)) {
    out.mesmaTitularidade = true;
    out.banco = out.banco || banco || null;
  }
  // banco que a importação já trouxe tem prioridade
  const bancoGravado = l.contraparte_banco || l.contraparteBanco || null;
  if (bancoGravado) out.banco = bancoGravado;
  return out;
}

// o nome gravado é lixo quando é só um banco, começa com código ou tem dígitos de documento
const nomeGravadoRuim = (nome) => {
  const n = limpar(nome || '');
  if (!n) return true;
  if (/^(SICREDI|STONE|ITAU|ITAÚ|BB|CAIXA|BRADESCO|SANTANDER|UNICRED)$/i.test(n)) return true;
  if (/^[-\s]*(PIX_(CRED|DEB)|CX\d+|SICREDI-CX)/i.test(n)) return true;
  if (/\d{8,}/.test(n)) return true;
  return false;
};

/** Completa contraparteNome/Doc/Banco de um lançamento (só preenche o que falta ou é lixo). */
export function completarContraparte(l, banco = null) {
  const ex = extrairContraparte(l, banco);
  const atualNome = l.contraparte_nome ?? l.contraparteNome ?? null;
  const atualDoc = l.contraparte_doc ?? l.contraparteDoc ?? null;
  const atualBanco = l.contraparte_banco ?? l.contraparteBanco ?? null;
  const patch = {};
  if (!atualDoc && ex.doc) patch.doc = ex.doc;
  if (ex.nome && (nomeGravadoRuim(atualNome) || (ex.doc && !atualDoc && limpar(atualNome || '').length < ex.nome.length && semAcento(ex.nome).toUpperCase().startsWith(semAcento(atualNome || '').toUpperCase())))) patch.nome = ex.nome;
  if (!atualBanco && ex.banco && ex.banco !== banco) patch.banco = ex.banco;
  return { ...ex, patch };
}

export default { extrairContraparte, completarContraparte };
