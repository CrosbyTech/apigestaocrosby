// ============================================================
// Extrato do Santander PJ em PDF ("EXTRATO CONSOLIDADO INTELIGENTE") — leitor
// novo, feito do zero (06/11/2026).
// ------------------------------------------------------------
// Layout (um PDF por mês):
//   pág. 1: propaganda; pág. 2: "Resumo - janeiro/2024" com Nome, Agência,
//   Conta Corrente (13.000599-5) e os saldos do resumo; depois "Conta Corrente"
//   → "Movimentação":
//     Data | Descrição | Nº Documento | Créditos | Débitos | Saldo
//     SALDO EM 31/12 ................................ 290.030,44   ← saldo anterior
//     02/01 DEBITO DE TITULO DESCONTADO   188577          337,50-
//           0000000004057 / 000173838                              ← continuação (detalhe/contraparte)
//     ...   (a data só aparece na 1ª linha do dia; o saldo só na última linha do dia)
//     SALDO EM 31/01 ................................  11.994,96   ← saldo final (fim da tabela)
//   Depois vêm "Saldos diários", Investimentos, índices etc. (ignorados).
// O saldo da tabela é o "Saldo Total de Conta Corrente" (com bloqueio), não o
// "disponível". Débito = valor com "-" no fim. Saldo negativo também com "-".
// Dezembro/2024 veio em outro formato ("Internet Banking Empresarial", sem
// saldo) → usa-se o OFX (utils/extratoSantanderOfx.js).
// ============================================================
import { createRequire } from 'node:module';
import crypto from 'node:crypto';

const require = createRequire(import.meta.url);
let _pdfjs = null;
const pdfjs = () => (_pdfjs ||= require('pdfjs-dist/legacy/build/pdf.js'));

const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const limpar = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const semAcento = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const RE_NUM = /^\d{1,3}(\.\d{3})*,\d{2}-?$/;
const numBr = (s) => {
  const t = String(s).trim();
  const neg = t.endsWith('-') || t.startsWith('-');
  return round2(Number(t.replace(/-/g, '').replace(/\./g, '').replace(',', '.')) * (neg ? -1 : 1));
};
const MESES = { janeiro: '01', fevereiro: '02', março: '03', marco: '03', abril: '04', maio: '05', junho: '06', julho: '07', agosto: '08', setembro: '09', outubro: '10', novembro: '11', dezembro: '12' };
const ultimoDiaMes = (mes) => {
  const [a, m] = mes.split('-').map(Number);
  return `${mes}-${String(new Date(Date.UTC(a, m, 0)).getUTCDate()).padStart(2, '0')}`;
};

// Contas conhecidas (agência|conta-dv → titular e CNPJ)
export const CONTAS_SANTANDER = {
  '1575|13000599-5': { titular: 'CROSBY DISTRIBUICAO E CONFECCAO LTDA', cnpj: '17177680000116', apelido: 'CROSBY' },
  '1575|13001128-2': { titular: 'CROSBY DISTRIBUICAO E CONFECCAO LTDA (JOAO PESSOA)', cnpj: null, apelido: 'CROSBY JOAO PESSOA' },
  '4543|13006882-4': { titular: 'FABIO FERREIRA DE LIMA AZEVEDO', cnpj: '27728810000115', apelido: 'FABIO' },
};
const SHOPPING_RECIFE = /SHOPPING\s*RECIFE|RECIFE\s*MALL|36\.?569\.?459/i;

async function paginasDo(buffer) {
  const doc = await pdfjs().getDocument({ data: new Uint8Array(buffer), useSystemFonts: true, isEvalSupported: false }).promise;
  const paginas = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const tc = await page.getTextContent();
    const itens = [];
    for (const it of tc.items) {
      const s = limpar(it.str);
      if (!s) continue;
      itens.push({ s, x: it.transform[4], x2: it.transform[4] + (it.width || 0), y: it.transform[5] });
    }
    paginas.push({ numero: n, itens });
  }
  return paginas;
}
function linhasDe(itens, tol = 3) {
  const ord = [...itens].sort((a, b) => b.y - a.y || a.x - b.x);
  const linhas = [];
  for (const it of ord) {
    const l = linhas.at(-1);
    if (l && Math.abs(l.yUlt - it.y) <= tol) {
      l.itens.push(it);
      l.yUlt = it.y;
    } else linhas.push({ y: it.y, yUlt: it.y, itens: [it] });
  }
  for (const l of linhas) l.itens.sort((a, b) => a.x - b.x);
  return linhas;
}
const texto = (its) => limpar(its.map((i) => i.s).join(' '));

// ─── contraparte / natureza pela descrição e pela linha de continuação ───
const docValido = (n) => {
  if (n.length === 11) {
    if (/^(\d)\1{10}$/.test(n)) return false;
    const c = (k) => { let s = 0; for (let i = 0; i < k - 1; i++) s += Number(n[i]) * (k - i); const r = (s * 10) % 11; return (r === 10 ? 0 : r) === Number(n[k - 1]); };
    return c(10) && c(11);
  }
  if (n.length === 14) {
    const calc = (t) => { const p = t === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]; let s = 0; for (let i = 0; i < t; i++) s += Number(n[i]) * p[i]; const r = s % 11; return r < 2 ? 0 : 11 - r; };
    return calc(12) === Number(n[12]) && calc(13) === Number(n[13]);
  }
  return false;
};
// linha de continuação: "SANTANDER 03209092000102", "17177680000116 CROSBY DISTRIBUICAO", "0000000004057 / 000173838" (detalhe de título)
export function contraparteDaContinuacao(txt) {
  const t = limpar(txt);
  const m = t.match(/(?<!\d)(\d{11}|\d{14})(?!\d)/);
  if (m && docValido(m[1])) {
    const nome = limpar(t.replace(m[1], ' '));
    return { doc: m[1], nome: /[A-Za-z]{2}/.test(nome) ? nome : null };
  }
  if (/^\d{6,}\s*\/\s*\d{6,}$/.test(t)) return { doc: null, nome: null }; // detalhe de título (nosso número / convênio)
  return { doc: null, nome: /[A-Za-z]{3}/.test(t) ? t : null };
}
// Contas do grupo em outros bancos, como aparecem no detalhe do Pix do Santander
// ("341/6530/0000000000270617" = banco/agência/conta com zeros à esquerda): conta+dígito → empresa
const CONTAS_GRUPO_OUTROS_BANCOS = [
  { banco: '341', conta: '270617', titular: 'CROSBY DIST CONFEC EIRELI ME', cnpj: '17177680000116' },
  { banco: '341', conta: '336889', titular: 'FABIO FERREIRA DE LIMA AZEVEDO', cnpj: '27728810000115' },
  { banco: '341', conta: '390464', titular: 'IRMAOS CR VESTUARIO LTDA', cnpj: '33592092000103' },
  { banco: '341', conta: '980736', titular: 'IRMAOS VAREJO COMERCIAL LTDA', cnpj: '53661116000138' },
  { banco: '341', conta: '981413', titular: 'FABIO FERREIRA DE LIMA AZEVEDO', cnpj: '27728810000549' },
  { banco: '001', conta: '587117', titular: 'CROSBY D CONFECCAO LTDA', cnpj: '17177680000116' },
  { banco: '001', conta: '369608', titular: 'FABIO F LIMA AZEVEDO', cnpj: '27728810000115' },
  { banco: '001', conta: '370517', titular: 'IRMAOS C V LTDA', cnpj: '33592092000103' },
  { banco: '748', conta: '367338', titular: 'CROSBY CR VESTUARIO LTDA', cnpj: '17177680000116' },
  { banco: '748', conta: '326933', titular: 'FABIO FERREIRA DE LIMA AZEVEDO', cnpj: '27728810000115' },
  { banco: '748', conta: '367346', titular: 'IRMAOS CR VESTUARIO LTDA', cnpj: '33592092000103' },
  { banco: '104', conta: '5781363862', titular: 'CROSBY DISTRIBUICAO E CONF LTDA', cnpj: '17177680000116' },
  { banco: '104', conta: '5781364591', titular: 'FABIO FERREIRA DE LIMA AZEVEDO', cnpj: '27728810000115' },
  { banco: '104', conta: '5781366357', titular: 'IRMAOS CR VESTUARIO LTDA', cnpj: '33592092000103' },
  { banco: '033', conta: '130005995', titular: 'CROSBY DISTRIBUICAO E CONFECCAO LTDA', cnpj: '17177680000116' },
  { banco: '033', conta: '130011282', titular: 'CROSBY DISTRIBUICAO E CONFECCAO LTDA (JOAO PESSOA)', cnpj: null },
  { banco: '033', conta: '130068824', titular: 'FABIO FERREIRA DE LIMA AZEVEDO', cnpj: '27728810000115' },
];
const BANCOS_NO_NOME = /\b(UNICRED|SICREDI|ITAU|SANTANDER|BRADESCO|CAIXA|BNB|STONE|NUBANK|INTER|BB)\b/gi;
/**
 * Contraparte de um lançamento do Santander: pela descrição ("PIX ENVIADO CROSBY",
 * "PIX RECEBIDO 17177680000116", "TED RECEBIDA 02732968000138"), pelo detalhe
 * ("341/6530/0000000000270617" = conta de destino/origem; "SANTANDER 03209092000102")
 * e, em "TRANSF VALORES MESMA TITULARIDADE", o próprio titular da conta.
 */
export function contraparteSantander(descricao, detalhe, titular = null, cnpjTitular = null) {
  const d = limpar(descricao);
  const up = semAcento(d).toUpperCase();
  const out = { nome: null, doc: null, base: d, contaDestino: null };
  if (/MESMA TITULARIDADE/.test(up)) {
    out.nome = titular;
    out.doc = cnpjTitular;
    return out;
  }
  const m = up.match(/^(PIX ENVIADO|PIX RECEBIDO|TED RECEBIDA|TED ENVIADA|TED EMITIDA|DOC RECEBIDO|DOC ENVIADO|TRANSFERENCIA RECEBIDA|TRANSFERENCIA ENVIADA)(?:\s*-\s*DIF TIT)?\s*(.*)$/);
  if (m) {
    out.base = limpar(d.slice(0, m[1].length));
    const resto = limpar(d.slice(d.length - m[2].length));
    const mDoc = resto.match(/(?<!\d)(\d{11}|\d{14})(?!\d)/);
    if (mDoc && docValido(mDoc[1])) out.doc = mDoc[1];
    let nome = resto.replace(/(?<!\d)\d{11}(?!\d)|(?<!\d)\d{14}(?!\d)/g, ' ').replace(/\s+\d{5,}\s*$/, '').replace(BANCOS_NO_NOME, ' ');
    nome = limpar(nome);
    if (/[A-Za-z]{2}/.test(nome)) out.nome = nome;
  }
  const det = limpar(detalhe || '');
  if (det) {
    const mConta = det.match(/^(\d{3})\/(\d{4})\/(\d{6,})$/);
    if (mConta) {
      const digitos = mConta[3].replace(/^0+/, '');
      const c = CONTAS_GRUPO_OUTROS_BANCOS.find((x) => x.banco === mConta[1] && (digitos.endsWith(x.conta) || x.conta.endsWith(digitos)));
      out.contaDestino = `${mConta[1]}/${mConta[2]}/${digitos}`;
      if (c) {
        if (!out.doc) out.doc = c.cnpj;
        if (!out.nome) out.nome = c.titular;
      }
    } else {
      const cp = contraparteDaContinuacao(det);
      if (cp.doc && !out.doc) out.doc = cp.doc;
      if (cp.nome && !out.nome) out.nome = cp.nome;
    }
  }
  return out;
}
export function hintDaDescricao(desc) {
  const up = semAcento(desc).toUpperCase();
  if (/\bPIX\b/.test(up)) return 'PIX';
  if (/\bTED\b|\bDOC\b|TRANSF/.test(up)) return 'TED';
  if (/\bCOB\b|COBRANCA|TITULO DESCONTADO|DESCONTO/.test(up)) return 'COBRANCA';
  if (/TARIFA|\bTAR\b|IOF|JUROS|COMISSAO|CUSTAS/.test(up)) return 'TARIFA';
  if (/CAPITALIZACAO|APLIC|RESGATE|CDB/.test(up)) return 'APLICACAO';
  return null;
}

/**
 * Lê o PDF "Extrato Consolidado Inteligente" do Santander. Mesmo formato dos outros leitores.
 * @param {Buffer} buffer
 */
export async function lerExtratoSantander(buffer) {
  const paginas = await paginasDo(buffer);
  const todas = paginas.flatMap((p) => linhasDe(p.itens).map((l) => ({ ...l, pagina: p.numero })));
  const todoTexto = todas.map((l) => texto(l.itens)).join('\n');
  if (SHOPPING_RECIFE.test(todoTexto)) throw new Error('Extrato da Shopping Recife: não entra em nenhum banco (regra do Yago).');
  if (!/EXTRATO CONSOLIDADO/i.test(todoTexto) || !/Movimenta[çc][ãa]o/.test(todoTexto)) throw new Error('Este PDF não parece ser o "Extrato Consolidado Inteligente" do Santander (dezembro vem em outro formato: use o OFX).');

  // cabeçalho do resumo
  const mMes = todoTexto.match(/EXTRATO CONSOLIDADO INTELIGENTE\s*\n\s*([a-zç]+)\/(\d{4})/i);
  if (!mMes || !MESES[mMes[1].toLowerCase()]) throw new Error('Não achei o mês do extrato (ex.: "janeiro/2024").');
  const mesRef = `${mMes[2]}-${MESES[mMes[1].toLowerCase()]}`;
  const iNome = todas.findIndex((l) => texto(l.itens) === 'Nome');
  const titular = iNome >= 0 ? texto(todas[iNome + 1].itens) : null;
  const mConta = todoTexto.match(/Ag[êe]ncia\s+Conta Corrente\s*\n\s*(\d{3,5})\s+([\d.]+)-(\d)/);
  if (!mConta) throw new Error('Não achei agência e conta no resumo.');
  const agencia = mConta[1];
  const conta = mConta[2].replace(/\./g, '');
  const contaDv = mConta[3];
  const conhecida = CONTAS_SANTANDER[`${agencia}|${conta}-${contaDv}`] || null;
  const cnpj = conhecida?.cnpj || null;
  if (SHOPPING_RECIFE.test(`${titular || ''} ${cnpj || ''}`)) throw new Error('Extrato da Shopping Recife: não entra em nenhum banco (regra do Yago).');

  // movimentação da conta corrente
  const [ano, mes] = mesRef.split('-');
  const dataDe = (ddmm) => {
    const m = ddmm.match(/^(\d{2})\/(\d{2})$/);
    if (!m) return null;
    if (m[2] !== mes) return null; // "31/12" do saldo anterior não é lançamento
    return `${ano}-${m[2]}-${m[1]}`;
  };
  let saldoAnterior = null;
  let saldoFinal = null;
  let dataFinal = null;
  const lanc = [];
  const saldosDia = [];
  let dentro = false;
  let dataAtual = null;
  for (const l of todas) {
    const its = l.itens;
    const t = texto(its);
    const tUp = semAcento(t).toUpperCase();
    if (!dentro) {
      if (/^MOVIMENTACAO$/.test(tUp)) dentro = true;
      continue;
    }
    const mSaldo = tUp.match(/^SALDO EM (\d{2})\/(\d{2})/);
    if (mSaldo) {
      const nums = its.filter((i) => RE_NUM.test(i.s) && i.x >= 480);
      if (!nums.length) throw new Error(`Linha "${t}" sem valor.`);
      if (saldoAnterior == null) {
        saldoAnterior = numBr(nums.at(-1).s);
        continue;
      }
      saldoFinal = numBr(nums.at(-1).s);
      dataFinal = `${ano}-${mSaldo[2]}-${mSaldo[1]}`;
      break;
    }
    if (saldoAnterior == null) continue;
    // cabeçalhos repetidos, rodapés
    if (/^DATA DESCRICAO/.test(tUp) || /^CREDITOS DEBITOS$/.test(tUp) || /^EXTRATO CONSOLIDADO/.test(tUp) || /^PAGINA/.test(tUp) || /^EXTRATO_PJ/.test(tUp) || /^BALP_/.test(tUp) || /^[A-Z]+\/\d{4}$/.test(tUp)) continue;
    const dataIt = its.find((i) => i.x < 50 && /^\d{2}\/\d{2}$/.test(i.s));
    const saldoIt = its.filter((i) => RE_NUM.test(i.s) && i.x >= 480).at(-1);
    const valores = its.filter((i) => RE_NUM.test(i.s) && i.x >= 360 && i.x < 480);
    if (dataIt) dataAtual = dataDe(dataIt.s) || dataAtual;
    if (!valores.length) {
      // continuação do lançamento anterior (detalhe / contraparte)
      const ult = lanc.at(-1);
      if (ult && !dataIt && its.every((i) => i.x >= 55) && !saldoIt) {
        ult.detalhe = ult.detalhe ? `${ult.detalhe} | ${t}` : t;
        const cp = contraparteSantander(ult.descricao, t, titular, cnpj);
        if (cp.doc && !ult.contraparteDoc) ult.contraparteDoc = cp.doc;
        if (cp.nome && !ult.contraparteNome) ult.contraparteNome = cp.nome;
        if (cp.contaDestino) ult.contaDestino = cp.contaDestino;
      }
      if (saldoIt && ult) saldosDia.push({ apos: lanc.length - 1, valor: numBr(saldoIt.s) });
      continue;
    }
    if (!dataAtual) throw new Error(`Lançamento sem data: "${t}"`);
    const valIt = valores.at(-1);
    const debito = valIt.s.endsWith('-') || valIt.x >= 415;
    const valor = Math.abs(numBr(valIt.s)) * (debito ? -1 : 1);
    const descItens = its.filter((i) => i !== dataIt && i !== valIt && i !== saldoIt && i.x < 300 && i.x >= 50);
    let descricao = texto(descItens);
    descricao = descricao.replace(/^A\s+(?=[A-Z])/, ''); // marcador "A" antes da descrição
    const documento = texto(its.filter((i) => i.x >= 300 && i.x < 360 && i.s !== '-')) || null;
    const cp0 = contraparteSantander(descricao, null, titular, cnpj);
    lanc.push({ pagina: l.pagina, data: dataAtual, descricao, documento, valor, contraparteNome: cp0.nome, contraparteDoc: cp0.doc, detalhe: null, hint: hintDaDescricao(descricao) });
    if (saldoIt) saldosDia.push({ apos: lanc.length - 1, valor: numBr(saldoIt.s) });
  }
  if (saldoAnterior == null) throw new Error('Não achei a linha "SALDO EM dd/mm" (saldo anterior) na movimentação.');
  if (saldoFinal == null) throw new Error('Não achei a linha final "SALDO EM dd/mm" (saldo final) na movimentação.');

  let corrente = round2(saldoAnterior);
  const divergencias = [];
  lanc.forEach((l, i) => {
    corrente = round2(corrente + l.valor);
    l.seq = i + 1;
    l.saldoApos = corrente;
    l.saldoInformado = null;
    l.dataBalancete = l.data;
    l.natureza = l.valor < 0 ? 'D' : 'C';
    l.historico = l.detalhe ? `${l.descricao} · ${l.detalhe}` : l.descricao;
    l.historicoBase = contraparteSantander(l.descricao, null, titular, cnpj).base;
    l.historicoDescricao = null;
    l.hora = null;
  });
  for (const s of saldosDia) {
    const l = lanc[s.apos];
    if (!l) continue;
    l.saldoInformado = s.valor;
    if (Math.abs(l.saldoApos - s.valor) > 0.005) divergencias.push({ seq: l.seq, data: l.data, historico: l.descricao, saldoCalculado: l.saldoApos, saldoInformado: s.valor, diferenca: round2(s.valor - l.saldoApos) });
  }
  const totalCreditos = round2(lanc.filter((l) => l.valor > 0).reduce((s, l) => s + l.valor, 0));
  const totalDebitos = round2(lanc.filter((l) => l.valor < 0).reduce((s, l) => s - l.valor, 0));
  const bate = divergencias.length === 0 && Math.abs(corrente - saldoFinal) <= 0.005;

  return {
    banco: 'SANTANDER',
    bancoCodigo: '033',
    formato: 'pdf',
    agencia,
    conta,
    contaDv,
    titular: conhecida?.titular || titular || null,
    titularCnpj: cnpj,
    mesReferencia: mesRef,
    periodo: { inicio: `${mesRef}-01`, fim: dataFinal || ultimoDiaMes(mesRef) },
    saldoInicial: round2(saldoAnterior),
    saldoFinal: round2(saldoFinal),
    lancamentos: lanc,
    conferencia: {
      fonte: 'PDF Extrato Consolidado Inteligente: SALDO EM (anterior e final) e saldo no fim de cada dia',
      saldoInicial: round2(saldoAnterior),
      totalCreditos,
      totalDebitos,
      saldoCalculado: corrente,
      saldoFinalInformado: round2(saldoFinal),
      diferencaFinal: round2(saldoFinal - corrente),
      saldosDiariosConferidos: saldosDia.length,
      divergencias,
      bate,
    },
    paginas: paginas.length,
    hash: crypto.createHash('sha1').update(buffer).digest('hex'),
  };
}

export default { lerExtratoSantander, CONTAS_SANTANDER, contraparteDaContinuacao, contraparteSantander, hintDaDescricao };
