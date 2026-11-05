// ============================================================
// Extrato de conta corrente do Banco do Brasil (PDF "Consultas - Extrato
// de conta corrente") — leitor novo, feito do zero (05/11/2026).
// ------------------------------------------------------------
// O PDF é uma tabela com colunas fixas:
//   Dt. balancete | Dt. movimento | Ag. origem | Lote | Histórico | Documento | Valor R$ | Saldo
// Cada linha de movimento tem data, histórico (código de 3 dígitos + texto),
// documento, valor com sufixo C/D. A última linha do dia repete o saldo do
// dia na coluna Saldo (também com C/D). A primeira linha é "Saldo Anterior"
// (só saldo) e a última é "S A L D O" (saldo final do período).
//
// Lê por coordenada (pdfjs): agrupa os itens de texto em linhas pelo Y e
// distribui nas colunas pelo X do cabeçalho da tabela. Recalcula o saldo a
// cada lançamento a partir do "Saldo Anterior" e confere com todos os saldos
// impressos (dia a dia e final) — a importação só é aceita se bater.
// ============================================================
import { createRequire } from 'node:module';
import crypto from 'node:crypto';

const require = createRequire(import.meta.url);
let _pdfjs = null;
function pdfjs() {
  if (!_pdfjs) _pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
  return _pdfjs;
}

const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const limpar = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const semAcento = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const RE_DATA = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const RE_VALOR = /^\d{1,3}(\.\d{3})*,\d{2}$/;
const dataIso = (s) => {
  const m = String(s).match(RE_DATA);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};
const numBr = (s) => Number(String(s).replace(/\./g, '').replace(',', '.'));

/** itens de texto de cada página com posição (x, y, largura) */
async function extrairPaginas(buffer) {
  const lib = pdfjs();
  const doc = await lib.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true, isEvalSupported: false }).promise;
  const paginas = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const tc = await page.getTextContent();
    const itens = [];
    for (const it of tc.items) {
      const bruto = String(it.str || '');
      if (!bruto.trim()) continue;
      // o pdfjs junta várias células num item só ("99031 830 Depósito Online",
      // "500,00 C"): quebra em palavras e estima o X de cada uma pela posição
      // do caractere dentro do item (fonte monoespaçada-ish, serve para colunas)
      const x0 = it.transform[4];
      const larg = it.width || 0;
      const porChar = bruto.length ? larg / bruto.length : 0;
      const re = /\S+/g;
      let m;
      while ((m = re.exec(bruto))) {
        itens.push({ s: m[0], x: x0 + m.index * porChar, x2: x0 + (m.index + m[0].length) * porChar, y: it.transform[5] });
      }
    }
    paginas.push({ numero: n, itens });
  }
  return paginas;
}

/** agrupa itens pelo Y (mesma linha visual), ordenados pelo X */
// Nos extratos mais novos (set/2024+) o valor, o texto e o sinal C/D da mesma
// linha vêm com Y levemente diferente (ex.: 619 / 614 / 609); as linhas da
// tabela ficam ~12 pt uma da outra. Agrupa em cadeia: o item entra na linha se
// estiver a até `tol` do ÚLTIMO item encaixado (não do primeiro).
function agruparLinhas(itens, tol = 5.5) {
  const ordenados = [...itens].sort((a, b) => b.y - a.y || a.x - b.x);
  const linhas = [];
  for (const it of ordenados) {
    const l = linhas.at(-1);
    if (l && Math.abs(l.yUltimo - it.y) <= tol) {
      l.itens.push(it);
      l.yUltimo = it.y;
    } else linhas.push({ y: it.y, yUltimo: it.y, itens: [it] });
  }
  for (const l of linhas) l.itens.sort((a, b) => a.x - b.x);
  // Sinal C/D que o PDF escreveu numa linha só dele (até ~14 pt acima ou
  // abaixo do número): devolve o sinal para a linha do número correspondente.
  const ehSinal = (i) => /^[CD]$/.test(i.s);
  const temNumero = (l) => l.itens.some((i) => RE_VALOR.test(i.s));
  for (let k = 0; k < linhas.length; k++) {
    const l = linhas[k];
    if (!l.itens.length || !l.itens.every(ehSinal)) continue;
    for (const sinal of [...l.itens]) {
      let melhor = null;
      for (const d of [-1, 1, -2, 2]) {
        const o = linhas[k + d];
        if (!o || !temNumero(o) || Math.abs(o.y - l.y) > 14) continue;
        const num = o.itens.find((i) => RE_VALOR.test(i.s) && sinal.x >= i.x - 2 && sinal.x2 >= i.x2 - 2 && sinal.x <= i.x2 + 22);
        if (!num) continue;
        const jaTem = o.itens.some((i) => ehSinal(i) && i.x >= num.x - 2 && i.x2 >= num.x2 - 2 && i.x <= num.x2 + 22);
        if (!jaTem) {
          melhor = o;
          break;
        }
      }
      if (melhor) {
        melhor.itens.push({ ...sinal, y: melhor.y });
        melhor.itens.sort((a, b) => a.x - b.x);
        l.itens = l.itens.filter((i) => i !== sinal);
      }
    }
  }
  return linhas.filter((l) => l.itens.length);
}
const texto = (itens) => limpar(itens.map((i) => i.s).join(' '));

/**
 * Lê o PDF do extrato BB.
 * @param {Buffer} buffer
 * @returns {Promise<{banco:string, agencia:string, conta:string, contaDv:string, titular:string, periodo:{inicio:string, fim:string}, saldoInicial:number, saldoFinal:number, lancamentos:Array, conferencia:object, hash:string}>}
 */
export async function lerExtratoBb(buffer) {
  const paginas = await extrairPaginas(buffer);
  const todoTexto = paginas.map((p) => texto(p.itens)).join('\n');
  if (!/Extrato de conta corrente/i.test(todoTexto) || !/Dt\.\s*balancete/i.test(todoTexto)) {
    throw new Error('Este PDF não parece ser o "Extrato de conta corrente" do Banco do Brasil.');
  }

  // ── cabeçalho: agência, conta + titular, período ──
  const agencia = (todoTexto.match(/Ag[êe]ncia\s+(\d{3,5}-\d)/i) || [])[1] || null;
  const mConta = todoTexto.match(/Conta corrente\s+(\d{3,9})-(\d)\s*(.*?)\s+Per[íi]odo do extrato/i);
  const conta = mConta ? mConta[1] : null;
  const contaDv = mConta ? mConta[2] : null;
  const titular = mConta ? limpar(mConta[3]) : null;
  const mPer = todoTexto.match(/Per[íi]odo do extrato\s+(\d{2})\s*\/\s*(\d{4})/i);
  const mesRef = mPer ? `${mPer[2]}-${mPer[1]}` : null;

  // ── colunas pelo cabeçalho da tabela (1ª página) ──
  let cols = null;
  for (const pg of paginas) {
    for (const l of agruparLinhas(pg.itens)) {
      const t = texto(l.itens);
      if (/Dt\.\s*balancete/i.test(t) && /Saldo/i.test(t)) {
        const achar = (re) => l.itens.find((i) => re.test(i.s));
        const hist = achar(/Hist[óo]rico/i);
        const docu = achar(/Documento/i);
        const valor = achar(/^Valor/i);
        const saldo = achar(/^Saldo/i);
        const mov = achar(/movimento/i) || achar(/^Dt\./i);
        if (hist && docu && valor && saldo) {
          cols = { xHist: hist.x, xDoc: docu.x, xValor: valor.x, xSaldo: saldo.x, xMov: mov ? mov.x - 12 : hist.x - 150 };
          break;
        }
      }
    }
    if (cols) break;
  }
  if (!cols) throw new Error('Não achei o cabeçalho da tabela (Dt. balancete … Saldo) no PDF.');

  // ── linhas de movimento ──
  const lanc = [];
  const saldosImpressos = []; // { apos: índice do último lançamento, valor }
  let saldoAnterior = null;
  let saldoFinal = null;
  let seq = 0;
  // valor/saldo que ficou sozinho no fim de uma página enquanto o resto da
  // linha (data, histórico, sinal) foi para o começo da página seguinte
  let sobras = [];
  for (const pg of paginas) {
    for (const l of agruparLinhas(pg.itens)) {
      const t = texto(l.itens);
      if (/^Dt\.\s*balancete/i.test(t)) continue;
      const soNumeros = l.itens.length && l.itens.every((i) => RE_VALOR.test(i.s) || /^[CD]$/.test(i.s));
      const temData = l.itens.some((i) => RE_DATA.test(i.s) && i.x < cols.xMov + 120);
      if (soNumeros && !temData) {
        sobras = l.itens;
        continue;
      }
      const its = temData && sobras.length ? [...sobras, ...l.itens].sort((a, b) => a.x - b.x) : l.itens;
      if (temData) sobras = [];
      // sinal C/D fica logo à direita do número: valor termina antes de xSaldo−10; saldo depois
      const sinais = its.filter((i) => /^[CD]$/.test(i.s));
      const numeros = its.filter((i) => RE_VALOR.test(i.s));
      const valorIt = numeros.find((i) => i.x >= cols.xValor - 40 && i.x2 <= cols.xSaldo - 2);
      const saldoIt = numeros.find((i) => i !== valorIt && i.x >= cols.xSaldo - 40);
      // o C/D fica à direita do número; às vezes alinhado pela borda direita (x2 igual)
      const sinalDe = (num) => {
        if (!num) return null;
        const s = sinais.find((i) => i.x >= num.x - 2 && i.x2 >= num.x2 - 2 && i.x <= num.x2 + 22);
        return s ? s.s : null;
      };
      const datas = its.filter((i) => RE_DATA.test(i.s) && i.x < cols.xMov + 120);
      const dtBalancete = datas[0] ? dataIso(datas[0].s) : null;
      const dtMov = datas[1] ? dataIso(datas[1].s) : null;
      // tudo entre a data de movimento e a coluna Documento: "[ag. origem] [lote] código histórico…"
      const histItens = its.filter((i) => i.x >= cols.xMov + 50 && i.x < cols.xDoc - 60 && !RE_DATA.test(i.s));
      const histBruto = texto(histItens);
      const mHist = histBruto.match(/^(?:(\d{4})\s+)?(?:(\d{5})\s+)?(\d{3})\s+(.*)$/);
      const histTxt = mHist ? limpar(mHist[4]) : histBruto;
      const up = semAcento(histTxt).toUpperCase();

      // "Saldo Anterior": só saldo, sem valor
      if (/SALDO ANTERIOR/.test(semAcento(histBruto).toUpperCase()) && saldoIt && !valorIt) {
        const sinal = sinalDe(saldoIt);
        saldoAnterior = numBr(saldoIt.s) * (sinal === 'D' ? -1 : 1);
        continue;
      }
      // "S A L D O" final
      if (/(^|\s)S\s*A\s*L\s*D\s*O$/.test(semAcento(histBruto).toUpperCase()) && saldoIt && !valorIt) {
        const sinal = sinalDe(saldoIt);
        saldoFinal = numBr(saldoIt.s) * (sinal === 'D' ? -1 : 1);
        continue;
      }
      if (!valorIt || !dtBalancete) {
        // linha de continuação do histórico (texto quebrado), sem valor nem data
        if (lanc.length && !dtBalancete && histTxt && !saldoIt && its.every((i) => i.x >= cols.xHist - 25)) {
          const u = lanc.at(-1);
          u.historico = limpar(`${u.historico} ${histTxt}`);
        }
        continue;
      }
      const sinal = sinalDe(valorIt);
      if (!sinal) continue;
      const valor = round2(numBr(valorIt.s) * (sinal === 'D' ? -1 : 1));
      const agOrigem = mHist ? mHist[1] || null : null;
      const lote = mHist ? mHist[2] || null : null;
      const mCod = mHist ? [null, mHist[3], mHist[4]] : null;
      const docIt = its.find((i) => i !== valorIt && i !== saldoIt && i.x >= cols.xDoc - 60 && i.x2 <= cols.xValor - 2 && /^[\d.]+$/.test(i.s));
      lanc.push({
        seq: ++seq,
        pagina: pg.numero,
        data: dtMov || dtBalancete,
        dataBalancete: dtBalancete,
        agenciaOrigem: agOrigem,
        lote,
        historicoCodigo: mCod ? mCod[1] : null,
        historico: mCod ? limpar(mCod[2]) : histTxt,
        documento: docIt ? docIt.s : null,
        valor,
        natureza: sinal,
        saldoInformado: null,
      });
      if (saldoIt) {
        const sS = sinalDe(saldoIt);
        const s = numBr(saldoIt.s) * (sS === 'D' ? -1 : 1);
        lanc.at(-1).saldoInformado = round2(s);
        saldosImpressos.push({ apos: lanc.length - 1, valor: round2(s) });
      }
    }
  }

  if (saldoAnterior == null) throw new Error('Não achei a linha "Saldo Anterior" no extrato.');
  if (saldoFinal == null) throw new Error('Não achei a linha "S A L D O" (saldo final) no extrato.');

  // ── confere o saldo lançamento a lançamento ──
  let corrente = round2(saldoAnterior);
  const divergencias = [];
  for (const l of lanc) {
    corrente = round2(corrente + l.valor);
    l.saldoApos = corrente;
    if (l.saldoInformado != null && Math.abs(l.saldoInformado - corrente) > 0.005) {
      divergencias.push({ seq: l.seq, data: l.data, historico: l.historico, saldoCalculado: corrente, saldoInformado: l.saldoInformado, diferenca: round2(l.saldoInformado - corrente) });
      corrente = l.saldoInformado; // segue pelo saldo do banco para não acumular a diferença
    }
  }
  const saldoCalculado = lanc.length ? lanc.at(-1).saldoApos : round2(saldoAnterior);
  const totalCreditos = round2(lanc.filter((l) => l.valor > 0).reduce((s, l) => s + l.valor, 0));
  const totalDebitos = round2(lanc.filter((l) => l.valor < 0).reduce((s, l) => s - l.valor, 0));
  const bate = divergencias.length === 0 && Math.abs(saldoCalculado - saldoFinal) <= 0.005;
  const datas = lanc.map((l) => l.data).filter(Boolean).sort();
  const periodo = {
    inicio: mesRef ? `${mesRef}-01` : datas[0] || null,
    fim: datas.at(-1) || (mesRef ? `${mesRef}-31` : null),
  };

  return {
    banco: 'BB',
    bancoCodigo: '001',
    agencia,
    conta,
    contaDv,
    titular,
    mesReferencia: mesRef,
    periodo,
    saldoInicial: round2(saldoAnterior),
    saldoFinal: round2(saldoFinal),
    lancamentos: lanc,
    conferencia: {
      saldoInicial: round2(saldoAnterior),
      totalCreditos,
      totalDebitos,
      saldoCalculado,
      saldoFinalInformado: round2(saldoFinal),
      diferencaFinal: round2(saldoFinal - saldoCalculado),
      saldosDiariosConferidos: saldosImpressos.length,
      divergencias,
      bate,
    },
    paginas: paginas.length,
    hash: crypto.createHash('sha1').update(buffer).digest('hex'),
  };
}

export default { lerExtratoBb };
