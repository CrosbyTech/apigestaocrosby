// ============================================================
// Extrato do Sicredi em PDF — leitor novo, feito do zero (06/11/2026).
// ------------------------------------------------------------
// Layout (um PDF por mês, exportado do internet banking):
//   Associado: <titular>          Cooperativa: 2207        Conta: 36733-8
//   Extrato (Período de 01/04/2024 a 30/04/2024)
//   Data | Descrição | Documento | Valor (R$) | Saldo (R$)
//   SALDO ANTERIOR .......................................... 1.699,74
//   11/04/2024 RECEBIMENTO PIX SICREDI 27728810000115 FABIO FER  CX875431  5.000,00  6.699,74
//   ...
//   Lançamentos Futuros (Próximos 30 dias)   ← daqui para baixo não é lançamento
// Cada linha traz o saldo após o lançamento → conferência linha a linha.
// Não há linha de "saldo final": é o saldo da última linha (ou o anterior, se
// não houve movimento). O OFX e o CNAB 240 do mesmo mês trazem o mesmo saldo
// final (LEDGERBAL / trailer), usados como contraprova no teste.
// A descrição traz o CPF/CNPJ e o nome (truncado) da contraparte nos Pix.
// Páginas seguintes não repetem o cabeçalho da tabela.
// ============================================================
import { createRequire } from 'node:module';
import crypto from 'node:crypto';

const require = createRequire(import.meta.url);
let _pdfjs = null;
const pdfjs = () => (_pdfjs ||= require('pdfjs-dist/legacy/build/pdf.js'));

const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const limpar = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const semAcento = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const RE_NUM = /^-?\d{1,3}(\.\d{3})*,\d{2}$/;
const numBr = (s) => {
  const t = String(s).trim();
  const neg = t.startsWith('-');
  return round2(Number(t.replace(/-/g, '').replace(/\./g, '').replace(',', '.')) * (neg ? -1 : 1));
};
const dataIso = (ddmmaaaa) => {
  const m = String(ddmmaaaa).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

// Contas conhecidas (cooperativa|conta → titular e CNPJ, conferidos no cabeçalho do CNAB 240)
export const CONTAS_SICREDI = {
  '2207|36733-8': { titular: 'CROSBY CR VESTUARIO LTDA', cnpj: '17177680000116' },
  '2207|32693-3': { titular: 'FABIO FERREIRA DE LIMA AZEVEDO', cnpj: '27728810000115' },
  '2207|36734-6': { titular: 'IRMAOS CR VESTUARIO LTDA', cnpj: '33592092000103' },
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

// ─── contraparte na descrição ─────────────────────────────────
// "RECEBIMENTO PIX SICREDI 27728810000115 FABIO FER", "PAGAMENTO PIX 14380200000121 iFood",
// "RECEBIMENTO PIX 17177680000116 CROSBY", "TED PAGAMENTO FORNECEDOR 000019" (sem contraparte)
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
export function contraparteDaDescricao(desc) {
  const d = limpar(desc);
  const out = { nome: null, doc: null, base: d, hint: null };
  const m = d.match(/^(.*?)\s(?<!\d)(\d{11}|\d{14})(?!\d)\s*(.*)$/);
  if (m && docValido(m[2])) {
    out.base = limpar(m[1]);
    out.doc = m[2];
    out.nome = /[A-Za-z]{2}/.test(m[3]) ? limpar(m[3]) : null;
  }
  const up = semAcento(out.base).toUpperCase();
  if (/RECEBIMENTO PIX|PIX_CRED|PAGAMENTO PIX|PIX_DEB/.test(up)) out.hint = 'PIX';
  else if (/\bTED\b|\bDOC\b|TRANSF/.test(up)) out.hint = 'TED';
  else if (/COBRANCA|LIQ\.?COB/.test(up)) out.hint = 'COBRANCA';
  else if (/TARIFA|CUSTAS|IOF|JUROS/.test(up)) out.hint = 'TARIFA';
  else if (/LIQUIDACAO DE PARCELA|LIBERACAO CREDITO|PARCELA/.test(up)) out.hint = 'EMPRESTIMO';
  return out;
}

/**
 * Lê o PDF do extrato do Sicredi. Devolve o mesmo formato dos leitores do BB/Itaú/Caixa.
 * @param {Buffer} buffer
 */
export async function lerExtratoSicredi(buffer) {
  const paginas = await paginasDo(buffer);
  const todas = paginas.flatMap((p) => linhasDe(p.itens).map((l) => ({ ...l, pagina: p.numero })));
  const todoTexto = todas.map((l) => texto(l.itens)).join('\n');
  if (SHOPPING_RECIFE.test(todoTexto)) throw new Error('Extrato da Shopping Recife: não entra em nenhum banco (regra do Yago).');
  if (!/Associado:/.test(todoTexto) || !/Cooperativa:/.test(todoTexto) || !/SALDO ANTERIOR/.test(todoTexto)) throw new Error('Este PDF não parece ser um extrato do Sicredi (sem "Associado:", "Cooperativa:" e "SALDO ANTERIOR").');

  const titular = limpar((todoTexto.match(/Associado:\s*(.+)/) || [])[1] || '') || null;
  const cooperativa = (todoTexto.match(/Cooperativa:\s*(\d+)/) || [])[1] || null;
  const mConta = todoTexto.match(/Conta:\s*(\d+)-(\d)/) || todoTexto.match(/(\d{4,})-(\d)\s+Conta:/);
  if (!mConta) throw new Error('Não achei o número da conta ("Conta: 99999-9").');
  const conta = mConta[1];
  const contaDv = mConta[2];
  const mPer = todoTexto.match(/Per[íi]odo de (\d{2}\/\d{2}\/\d{4}) a (\d{2}\/\d{2}\/\d{4})/);
  if (!mPer) throw new Error('Não achei o período do extrato.');
  const periodo = { inicio: dataIso(mPer[1]), fim: dataIso(mPer[2]) };
  const mesRef = periodo.inicio.slice(0, 7);
  const conhecida = CONTAS_SICREDI[`${cooperativa}|${conta}-${contaDv}`] || null;
  const cnpj = conhecida?.cnpj || null;
  if (SHOPPING_RECIFE.test(`${titular} ${cnpj || ''}`)) throw new Error('Extrato da Shopping Recife: não entra em nenhum banco (regra do Yago).');

  let saldoAnterior = null;
  const lanc = [];
  let fim = false;
  for (const l of todas) {
    if (fim) break;
    const its = l.itens;
    const t = texto(its);
    const tUp = semAcento(t).toUpperCase();
    if (/^LANCAMENTOS FUTUROS/.test(tUp)) {
      fim = true;
      break;
    }
    const nums = its.filter((i) => RE_NUM.test(i.s));
    if (/^SALDO ANTERIOR/.test(tUp)) {
      if (!nums.length) throw new Error('"SALDO ANTERIOR" sem valor.');
      saldoAnterior = numBr(nums.at(-1).s);
      continue;
    }
    if (saldoAnterior == null) continue; // cabeçalho
    const dataIt = its.find((i) => i.x < 70 && /^\d{2}\/\d{2}\/\d{4}$/.test(i.s));
    if (!dataIt) continue; // rodapé, textos soltos
    const saldoIt = its.filter((i) => RE_NUM.test(i.s) && i.x >= 500).at(-1);
    const valorIt = its.filter((i) => RE_NUM.test(i.s) && i.x >= 420 && i.x < 500).at(-1);
    if (!saldoIt || !valorIt) throw new Error(`Linha de ${dataIt.s} sem valor ou saldo: "${t}"`);
    const descricao = texto(its.filter((i) => i !== dataIt && i !== saldoIt && i !== valorIt && i.x < 300));
    const documento = texto(its.filter((i) => i !== dataIt && i !== saldoIt && i !== valorIt && i.x >= 300 && i.x < 420)) || null;
    const cp = contraparteDaDescricao(descricao);
    lanc.push({ pagina: l.pagina, data: dataIso(dataIt.s), descricao, documento, valor: numBr(valorIt.s), saldoInformado: numBr(saldoIt.s), contraparteNome: cp.nome, contraparteDoc: cp.doc, historicoBase: cp.base, hint: cp.hint });
  }
  if (saldoAnterior == null) throw new Error('Não achei a linha "SALDO ANTERIOR".');

  let corrente = round2(saldoAnterior);
  const divergencias = [];
  lanc.forEach((l, i) => {
    corrente = round2(corrente + l.valor);
    l.seq = i + 1;
    l.saldoApos = corrente;
    l.dataBalancete = l.data;
    l.natureza = l.valor < 0 ? 'D' : 'C';
    l.historico = l.descricao;
    l.historicoDescricao = null;
    l.hora = null;
    if (Math.abs(l.saldoApos - l.saldoInformado) > 0.005) divergencias.push({ seq: l.seq, data: l.data, historico: l.descricao, saldoCalculado: l.saldoApos, saldoInformado: l.saldoInformado, diferenca: round2(l.saldoInformado - l.saldoApos) });
  });
  const saldoFinal = lanc.length ? lanc.at(-1).saldoInformado : round2(saldoAnterior);
  const totalCreditos = round2(lanc.filter((l) => l.valor > 0).reduce((s, l) => s + l.valor, 0));
  const totalDebitos = round2(lanc.filter((l) => l.valor < 0).reduce((s, l) => s - l.valor, 0));
  const bate = divergencias.length === 0 && Math.abs(corrente - saldoFinal) <= 0.005;

  return {
    banco: 'SICREDI',
    bancoCodigo: '748',
    formato: 'pdf',
    agencia: cooperativa,
    conta,
    contaDv,
    titular: titular || conhecida?.titular || null,
    titularCnpj: cnpj,
    mesReferencia: mesRef,
    periodo,
    saldoInicial: round2(saldoAnterior),
    saldoFinal,
    lancamentos: lanc,
    conferencia: {
      fonte: 'PDF do Sicredi: SALDO ANTERIOR e saldo impresso em cada linha',
      saldoInicial: round2(saldoAnterior),
      totalCreditos,
      totalDebitos,
      saldoCalculado: corrente,
      saldoFinalInformado: saldoFinal,
      diferencaFinal: round2(saldoFinal - corrente),
      saldosDiariosConferidos: lanc.length,
      divergencias,
      bate,
    },
    paginas: paginas.length,
    hash: crypto.createHash('sha1').update(buffer).digest('hex'),
  };
}

export default { lerExtratoSicredi, contraparteDaDescricao, CONTAS_SICREDI };
