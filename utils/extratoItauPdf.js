// ============================================================
// Extratos do Itaú em PDF — leitor novo, feito do zero (06/11/2026)
// ------------------------------------------------------------
// Dois layouts na pasta de 2024:
//   A) "extrato mensal" (Extrato Mensal_<Mês><Ano> …): página 1 com
//      "saldo em dd/mm/aa" (início e fim) e a tabela
//      data | descrição | entradas R$ | saídas R$ | saldo R$
//      — a data aparece só na 1ª linha do dia; saídas vêm com "-" no fim
//      ("70.000,00-"); o saldo aparece na última linha de cada dia; a tabela
//      começa em "Saldo anterior" e termina em "Saldo final". Depois vêm
//      seções de detalhe (compras a débito, cheques, débitos automáticos)
//      que repetem lançamentos e NÃO entram.
//   B) extrato "lançamentos período" (ITAU <EMPRESA> <MÊS>.pdf): cabeçalho
//      com CNPJ/agência/conta; linhas "02 / set | descrição | valor (−) |
//      saldo"; "SALDO ANTERIOR" abre e "SALDO TOTAL DISPONÍVEL DIA" fecha
//      cada dia (só saldo, não é lançamento); depois "saldo da conta
//      corrente" e "lançamentos futuros", que não entram.
// Conferência: saldo recalculado a cada lançamento a partir do saldo
// anterior, batido com todos os saldos de fim de dia e com o saldo final.
// Contraparte: tirada da descrição ("PIX TRANSF NOME 02/09", "PIX QRS NOME",
// "SISPAG NOME", "TED 001.2035 NOME", CNPJ/CPF quando vier).
// Shopping Recife (conta 133998391-6 / CNPJ 36.569.459) é recusado: o Yago
// pediu para não entrar em nenhum banco.
// ============================================================
import { createRequire } from 'node:module';
import crypto from 'node:crypto';

const require = createRequire(import.meta.url);
let _pdfjs = null;
const pdfjs = () => (_pdfjs ||= require('pdfjs-dist/legacy/build/pdf.js'));

const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const limpar = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const semAcento = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const RE_NUM = /^-?\d{1,3}(\.\d{3})*,\d{2}-?$/;
const numBr = (s) => {
  const t = String(s).trim();
  const neg = t.startsWith('-') || t.endsWith('-');
  return round2(Number(t.replace(/[-]/g, '').replace(/\./g, '').replace(',', '.')) * (neg ? -1 : 1));
};
const MESES = { jan: '01', fev: '02', mar: '03', abr: '04', mai: '05', jun: '06', jul: '07', ago: '08', set: '09', out: '10', nov: '11', dez: '12' };
const ultimoDiaMes = (mes) => {
  const [a, m] = mes.split('-').map(Number);
  return `${mes}-${String(new Date(Date.UTC(a, m, 0)).getUTCDate()).padStart(2, '0')}`;
};

// Contas conhecidas (o layout A não traz o CNPJ do titular)
export const CONTAS_ITAU = {
  '6530|27061-7': { titular: 'CROSBY DIST CONFEC EIRELI ME', cnpj: '17177680000116' },
  '6530|33688-9': { titular: 'FABIO FERREIRA DE LIMA AZEVEDO', cnpj: '27728810000115' },
  '6530|39046-4': { titular: 'IRMAOS CR VESTUARIO LTDA', cnpj: '33592092000103' },
  '6530|98073-6': { titular: 'IRMAOS VAREJO COMERCIAL LTDA', cnpj: '53661116000138' },
  '0382|98141-3': { titular: 'FABIO FERREIRA DE LIMA AZEVEDO (MIDWAY)', cnpj: '27728810000549' },
};
const SHOPPING_RECIFE = /SHOPPING RECIFE|RECIFE MALL|36\.?569\.?459|1339983916|133998391/i;

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
const GENERICOS_SISPAG = /^(BOLET OUTR BCO|BOLETO|TRANSF CC ITAU|PIX TRANSFERENCI\w*|PIX QR-?CODE|CONCESSIONARIA|TRIB COD BARRAS|TRIBUTOS?|GFIP|GPS|DARF|FGTS|INSS|PAG\w*|FORNECEDORES|SALARIOS?|TITULOS?)\b/i;
const docValido = (d) => {
  const n = d.replace(/\D/g, '');
  if (n.length === 11) return /^(\d)\1{10}$/.test(n) ? false : (() => { const c = (k) => { let s = 0; for (let i = 0; i < k - 1; i++) s += Number(n[i]) * (k - i); const r = (s * 10) % 11; return (r === 10 ? 0 : r) === Number(n[k - 1]); }; return c(10) && c(11); })();
  if (n.length === 14) {
    const calc = (t) => { const p = t === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]; let s = 0; for (let i = 0; i < t; i++) s += Number(n[i]) * p[i]; const r = s % 11; return r < 2 ? 0 : 11 - r; };
    return calc(12) === Number(n[12]) && calc(13) === Number(n[13]);
  }
  return false;
};
export function contraparteDaDescricao(desc) {
  const d = limpar(desc);
  const up = semAcento(d).toUpperCase();
  const out = { nome: null, doc: null, hint: null };
  const mDoc = d.match(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|\d{3}\.\d{3}\.\d{3}-\d{2}|(?<!\d)\d{14}(?!\d)|(?<!\d)\d{11}(?!\d)/);
  if (mDoc && docValido(mDoc[0])) out.doc = mDoc[0].replace(/\D/g, '');
  const limpaNome = (n) => {
    let s = limpar(n).replace(/\s*\d{2}\/\d{2}$/, '').replace(/\d{2}\/\d{2}$/, '').replace(/\s*\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}.*$/, '').replace(/\s+\d{6,}\s*$/, '').trim();
    return /[A-Za-z]{2}/.test(s) ? s : null;
  };
  let m;
  if ((m = up.match(/^PIX (?:TRANSF|QRS|ENVIADO|RECEBIDO|TRANSFERENCIA)\s+(.+)$/))) out.nome = limpaNome(d.slice(d.length - m[1].length));
  else if ((m = up.match(/^SISPAG\s+(.+)$/)) && !GENERICOS_SISPAG.test(m[1])) out.nome = limpaNome(d.slice(d.length - m[1].length));
  else if ((m = up.match(/^(?:INT )?TRANSF(?:ERENCIA)?\s+(\d{4})\.(\d+)-(\d)$/))) out.hint = { agencia: m[1], numero: `${m[2]}${m[3]}`, numeroSemDv: m[2], banco: 'ITAU' };
  else if ((m = up.match(/^TED\s+(\d{3})\.(\d{4})\.?\s*(.*)$/))) {
    out.hint = { banco: m[1], agencia: m[2] };
    out.nome = limpaNome(d.slice(d.length - m[3].length));
  } else if ((m = up.match(/^(?:INT TRANSF|TED|DOC)\s+(.+)$/))) out.nome = limpaNome(d.slice(d.length - m[1].length));
  else if ((m = up.match(/^SISPAG TRANSF CC ITAU/))) out.hint = { banco: 'ITAU' };
  if (out.nome && /^(TRANSF CC ITAU|CC ITAU)$/i.test(out.nome)) out.nome = null;
  return out;
}

// ─── layout A: extrato mensal ─────────────────────────────────
function lerLayoutA(paginas, todoTexto) {
  const mAg = todoTexto.match(/ag\s+(\d{4})\s+cc\s+([\d.]+-\d)/i);
  const agencia = mAg ? mAg[1] : null;
  const ccTxt = mAg ? mAg[2].replace(/\./g, '') : null;
  const conta = ccTxt ? ccTxt.split('-')[0] : null;
  const contaDv = ccTxt ? ccTxt.split('-')[1] : null;
  const mPer = todoTexto.match(/saldo em (\d{2})\/(\d{2})\/(\d{2}).*?saldo em (\d{2})\/(\d{2})\/(\d{2})/i);
  if (!mPer) throw new Error('Extrato mensal do Itaú sem "saldo em dd/mm/aa" na primeira página.');
  const dataIni = `20${mPer[3]}-${mPer[2]}-${mPer[1]}`;
  const dataFim = `20${mPer[6]}-${mPer[5]}-${mPer[4]}`;
  const mesRef = dataFim.slice(0, 7);
  const ano = Number(dataFim.slice(0, 4));
  // saldos do resumo: "01. Conta Corrente e Aplicações Automáticas  R$ x  R$ y"
  let saldoIniResumo = null;
  let saldoFimResumo = null;
  for (const l of linhasDe(paginas[0].itens)) {
    const t = texto(l.itens);
    if (/Conta Corrente e Aplica/i.test(t)) {
      const vals = l.itens.filter((i) => /^R\$\s*-?[\d.]+,\d{2}$/.test(i.s) || RE_NUM.test(i.s));
      if (vals.length >= 2) {
        saldoIniResumo = numBr(vals[0].s.replace(/^R\$\s*/, ''));
        saldoFimResumo = numBr(vals[1].s.replace(/^R\$\s*/, ''));
      }
    }
  }
  const lanc = [];
  const saldosDia = [];
  const aplicacoes = []; // Apl/Res Aplic Aut Mais: dinheiro entre a conta corrente e a aplicação automática (não é entrada nem saída)
  let saldoAnterior = null;
  let saldoFinal = null;
  let dataAtual = null;
  let dentro = false;
  let fim = false;
  // saldo de fim de dia: o PDF imprime o saldo da conta corrente na última linha do dia e,
  // quando há aplicação automática, logo abaixo "SALDO APLIC AUT MAIS x"; o saldo que o
  // Itaú chama de "Conta Corrente e Aplicações Automáticas" (o do resumo e o "Saldo final")
  // é a soma dos dois. Aqui o saldo acompanhado é esse total.
  let pendente = null; // { apos, cc }
  const fecharPendente = (aplic = 0) => {
    if (pendente) saldosDia.push({ apos: pendente.apos, valor: round2(pendente.cc + aplic) });
    pendente = null;
  };
  const dataDe = (ddmm) => {
    const [d, m] = ddmm.split('/');
    const a = Number(m) > Number(dataFim.slice(5, 7)) ? ano - 1 : ano;
    return `${a}-${m}-${d}`;
  };
  for (const pg of paginas) {
    if (fim) break;
    for (const l of linhasDe(pg.itens)) {
      const its = l.itens;
      const t = texto(its);
      const tUp = semAcento(t).toUpperCase();
      const dataIt = its.find((i) => /^\d{2}\/\d{2}$/.test(i.s) && i.x >= 135 && i.x <= 180);
      const descIt = its.find((i) => i.x >= 195 && i.x <= 225);
      const nums = its.filter((i) => RE_NUM.test(i.s) || /^R\$\s*-?[\d.]+,\d{2}$/.test(i.s));
      const saldoIt = nums.find((i) => i.x2 >= 505);
      const entradaIt = nums.find((i) => i.x2 <= 405 && i.x >= 330);
      const saidaIt = nums.find((i) => i.x2 > 405 && i.x2 < 505);
      if (!dentro) {
        if (dataIt && /SALDO ANTERIOR/.test(tUp) && saldoIt) {
          dentro = true;
          saldoAnterior = numBr(saldoIt.s);
          dataAtual = dataDe(dataIt.s);
        }
        continue;
      }
      // legenda da 1ª página ("G = aplicação programada", "Explicativas no final…") fica à esquerda
      // da tabela e se intercala com as linhas: não é linha da tabela, não mexe no saldo pendente
      if (!its.some((i) => i.x >= 140)) continue;
      const descUp = semAcento(texto(its.filter((i) => i.x >= 195 && i.x < 330))).toUpperCase();
      if (/^SALDO FINAL/.test(descUp)) {
        fecharPendente();
        if (saldoIt) saldoFinal = numBr(saldoIt.s);
        fim = true;
        break;
      }
      if (/^SALDO APLIC AUT/.test(descUp)) {
        // saldo da aplicação automática no fim do dia: soma ao saldo da conta corrente pendente
        if (saldoIt) fecharPendente(numBr(saldoIt.s));
        else fecharPendente();
        continue;
      }
      if (/^SALDO EM C\/C/.test(descUp)) {
        fecharPendente();
        continue;
      }
      // qualquer outra linha fecha o saldo pendente do dia anterior (sem aplicação)
      fecharPendente();
      if (/^(DATA|DESCRICAO)\b/.test(tUp) || /^EXTRATO MENSAL/.test(tUp) || /^\(CREDITOS\)/.test(tUp)) continue;
      if (dataIt) dataAtual = dataDe(dataIt.s);
      if (!descIt || (!entradaIt && !saidaIt)) continue;
      const valor = entradaIt ? Math.abs(numBr(entradaIt.s)) : -Math.abs(numBr(saidaIt.s));
      const descricao = texto(its.filter((i) => i.x >= 195 && i.x < 330));
      if (/^(APL|RES) APLIC AUT/.test(descUp) || /^(APLIC|RESG)\w* APLIC AUT/.test(descUp)) {
        aplicacoes.push({ data: dataAtual, descricao, valor });
        if (saldoIt) pendente = { apos: lanc.length - 1, cc: numBr(saldoIt.s) };
        continue;
      }
      const cp = contraparteDaDescricao(descricao);
      lanc.push({ pagina: pg.numero, data: dataAtual, descricao, valor, saldoInformado: null, contraparteNome: cp.nome, contraparteDoc: cp.doc, hint: cp.hint });
      if (saldoIt) pendente = { apos: lanc.length - 1, cc: numBr(saldoIt.s) };
    }
  }
  fecharPendente();
  if (saldoAnterior == null) throw new Error('Não achei a linha "Saldo anterior" na movimentação.');
  if (saldoFinal == null) saldoFinal = saldoFimResumo;
  if (saldoFinal == null) throw new Error('Não achei a linha "Saldo final" nem o saldo do resumo.');
  return { agencia, conta, contaDv, cnpj: null, titular: null, mesRef, periodo: { inicio: `${mesRef}-01`, fim: dataFim }, saldoAnterior, saldoFinal, lanc, saldosDia, aplicacoes, resumo: { saldoIniResumo, saldoFimResumo }, layout: 'A' };
}

// ─── layout B: lançamentos período ─────────────────────────────
function lerLayoutB(paginas, todoTexto) {
  const mCnpj = todoTexto.match(/(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})\s+(\d{4})\s+([\d]+-\d)/);
  const cnpj = mCnpj ? mCnpj[1].replace(/\D/g, '') : null;
  const agencia = mCnpj ? mCnpj[2] : null;
  const conta = mCnpj ? mCnpj[3].split('-')[0] : null;
  const contaDv = mCnpj ? mCnpj[3].split('-')[1] : null;
  const mTit = linhasDe(paginas[0].itens).find((l) => /ag[êe]ncia/i.test(texto(l.itens)) && /conta corrente/i.test(texto(l.itens)));
  const titular = mTit ? limpar(mTit.itens.filter((i) => i.x < 250).map((i) => i.s).join(' ')) : null;
  const mPer = todoTexto.match(/(\d{2})\/(\d{2})\/(\d{4})\s+at[ée]\s+(\d{2})\/(\d{2})\/(\d{4})/);
  if (!mPer) throw new Error('Extrato do Itaú sem o período "dd/mm/aaaa até dd/mm/aaaa".');
  const dataIni = `${mPer[3]}-${mPer[2]}-${mPer[1]}`;
  const dataFim = `${mPer[6]}-${mPer[5]}-${mPer[4]}`;
  const mesRef = dataIni.slice(0, 7);
  const ano = Number(dataIni.slice(0, 4));
  const dataDe = (s) => {
    const m = s.match(/^(\d{2})\s*\/\s*([a-z]{3})$/i);
    if (!m) return null;
    const mm = MESES[m[2].toLowerCase()];
    if (!mm) return null;
    const a = Number(mm) > Number(dataFim.slice(5, 7)) && dataFim.slice(5, 7) === '01' ? ano - 1 : ano;
    return `${a}-${mm}-${m[1]}`;
  };
  const lanc = [];
  const saldosDia = [];
  const aplicacoes = [];
  let saldoAnterior = null;
  let saldoFinal = null;
  let fim = false;
  for (const pg of paginas) {
    if (fim) break;
    for (const l of linhasDe(pg.itens)) {
      const its = l.itens;
      const t = texto(its);
      const tUp = semAcento(t).toUpperCase();
      if (/^SALDO DA CONTA CORRENTE|^LANCAMENTOS FUTUROS/.test(tUp)) {
        fim = true;
        break;
      }
      const dataIt = its.find((i) => /^\d{2}\s*\/\s*[a-z]{3}$/i.test(i.s) && i.x < 70);
      if (!dataIt) continue;
      const data = dataDe(dataIt.s);
      const nums = its.filter((i) => RE_NUM.test(i.s));
      const saldoIt = nums.find((i) => i.x2 >= 505);
      const valorIt = nums.find((i) => i.x2 > 380 && i.x2 < 470);
      const desc = texto(its.filter((i) => i !== dataIt && !RE_NUM.test(i.s) && i.x < 380));
      const descUp = semAcento(desc).toUpperCase();
      if (/^SALDO ANTERIOR/.test(descUp)) {
        if (saldoIt) saldoAnterior = numBr(saldoIt.s);
        continue;
      }
      if (/^SALDO/.test(descUp)) {
        // SALDO TOTAL DISPONÍVEL DIA / SALDO APLIC AUT MAIS…: informação, não lançamento.
        // Com cheque bloqueado o dia traz "SALDO TOTAL" (saldo contábil) e depois "SALDO TOTAL DISPONÍVEL DIA"
        // (sem o bloqueado) + "SALDO BLOQUEADO": o saldo da conta é o TOTAL.
        if (/^SALDO TOTAL$/.test(descUp) && saldoIt) {
          saldosDia.push({ apos: lanc.length - 1, valor: numBr(saldoIt.s), total: true });
          saldoFinal = numBr(saldoIt.s);
        } else if (/DISPON/.test(descUp) && saldoIt && !(saldosDia.at(-1)?.total && saldosDia.at(-1).apos === lanc.length - 1)) {
          saldosDia.push({ apos: lanc.length - 1, valor: numBr(saldoIt.s) });
          saldoFinal = numBr(saldoIt.s);
        }
        continue;
      }
      if (!valorIt || !data) continue;
      const valor = numBr(valorIt.s);
      if (/^(APL|RES|APLIC|RESG)\w* APLIC AUT/.test(descUp)) {
        aplicacoes.push({ data, descricao: desc, valor });
        continue;
      }
      const cp = contraparteDaDescricao(desc);
      lanc.push({ pagina: pg.numero, data, descricao: desc, valor, saldoInformado: null, contraparteNome: cp.nome, contraparteDoc: cp.doc, hint: cp.hint });
    }
  }
  if (saldoAnterior == null) throw new Error('Não achei a linha "SALDO ANTERIOR".');
  if (saldoFinal == null) throw new Error('Não achei nenhum "SALDO TOTAL DISPONÍVEL DIA" (saldo final).');
  return { agencia, conta, contaDv, cnpj, titular, mesRef, periodo: { inicio: dataIni, fim: dataFim }, saldoAnterior, saldoFinal, lanc, saldosDia, aplicacoes, resumo: null, layout: 'B' };
}

// ─── layout C: "Lançamentos do período" (internet banking, set/2025+) ──────────
// Cabeçalho "CROSBY CNPJ 17.177.680/0001-16 Agência 6530 Conta 0027061-7"; "Lançamentos do período: 01/09/2025 até 30/09/2025";
// colunas Data (dd/mm/aaaa) | Lançamentos | Razão Social | CNPJ/CPF | Valor (R$) | Saldo (R$) (só nas linhas de saldo);
// "SALDO ANTERIOR" na 1ª linha e "SALDO TOTAL DISPONÍVEL DIA" no fim de cada dia (= saldo conferido dia a dia).
// A razão social comprida quebra em linhas sem data, uma acima e outra abaixo da linha do lançamento.
function lerLayoutC(paginas, todoTexto) {
  const mCab = todoTexto.match(/CNPJ\s+(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})\s+Ag[êe]ncia\s+(\d{4})\s+Conta\s+0*(\d+)-(\d)/i);
  if (!mCab) throw new Error('Extrato do Itaú (lançamentos do período) sem "CNPJ … Agência … Conta …" no cabeçalho.');
  const cnpj = mCab[1].replace(/\D/g, '');
  const agencia = mCab[2];
  const conta = mCab[3];
  const contaDv = mCab[4];
  const mPer = todoTexto.match(/Lan[çc]amentos do per[íi]odo:\s*(\d{2})\/(\d{2})\/(\d{4})\s+at[ée]\s+(\d{2})\/(\d{2})\/(\d{4})/i);
  if (!mPer) throw new Error('Extrato do Itaú sem "Lançamentos do período: dd/mm/aaaa até dd/mm/aaaa".');
  const dataIni = `${mPer[3]}-${mPer[2]}-${mPer[1]}`;
  const dataFim = `${mPer[6]}-${mPer[5]}-${mPer[4]}`;
  const mesRef = dataIni.slice(0, 7);
  const RE_DATA = /^(\d{2})\/(\d{2})\/(\d{4})$/;
  const RE_DOC = /^(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|[\d*]{3}\.[\d*]{3}\.[\d*]{3}-[\d*]{2})$/;
  const lanc = [];
  const saldosDia = [];
  const aplicacoes = [];
  let saldoAnterior = null;
  let saldoFinal = null;
  let razaoAntes = [];
  for (const pg of paginas) {
    for (const l of linhasDe(pg.itens)) {
      const its = l.itens;
      const t = texto(its);
      if (!t) continue;
      const dataIt = its.find((i) => RE_DATA.test(i.s) && i.x < 70);
      if (!dataIt) {
        // linha sem data: pedaço da razão social (coluna x≈227) — acima vai para a próxima linha, abaixo para a anterior
        const pedaco = texto(its.filter((i) => i.x >= 220 && i.x < 360));
        if (pedaco && !/^(aviso|atualizado|Em caso|novos lan)/i.test(t) && !/Saldo total|Limite da conta|Lan[çc]amentos do per|Data\s+Lan/i.test(t)) {
          const ult = lanc.at(-1);
          if (ult && ult.razaoAberta) { ult.contraparteNome = limpar(`${ult.contraparteNome || ''} ${pedaco}`); ult.razaoAberta = false; }
          else razaoAntes.push(pedaco);
        }
        continue;
      }
      const m = dataIt.s.match(RE_DATA);
      const data = `${m[3]}-${m[2]}-${m[1]}`;
      // Valor (R$) alinhado à direita em x≈505 (começa em 440–500); Saldo (R$) começa em x≈515+
      const nums = its.filter((i) => RE_NUM.test(i.s) && i.x > 440);
      const saldoIt = nums.find((i) => i.x >= 515);
      const valorIt = nums.find((i) => i.x < 515);
      const desc = texto(its.filter((i) => i !== dataIt && i.x >= 85 && i.x < 220));
      const descUp = semAcento(desc).toUpperCase();
      const razao = texto(its.filter((i) => i.x >= 220 && i.x < 360));
      const docIt = its.find((i) => i.x >= 360 && i.x < 440 && RE_DOC.test(i.s));
      if (/^SALDO ANTERIOR/.test(descUp)) { if (saldoIt) saldoAnterior = numBr(saldoIt.s); razaoAntes = []; continue; }
      if (/^SALDO/.test(descUp)) {
        if (/^SALDO TOTAL$/.test(descUp) && saldoIt) { saldosDia.push({ apos: lanc.length - 1, valor: numBr(saldoIt.s), total: true }); saldoFinal = numBr(saldoIt.s); }
        else if (/DISPON/.test(descUp) && saldoIt && !(saldosDia.at(-1)?.total && saldosDia.at(-1).apos === lanc.length - 1)) { saldosDia.push({ apos: lanc.length - 1, valor: numBr(saldoIt.s) }); saldoFinal = numBr(saldoIt.s); }
        razaoAntes = [];
        continue;
      }
      if (!valorIt) { razaoAntes = []; continue; }
      const valor = numBr(valorIt.s);
      if (/^(APL|RES|APLIC|RESG)\w* APLIC AUT/.test(descUp)) { aplicacoes.push({ data, descricao: desc, valor }); razaoAntes = []; continue; }
      const cp = contraparteDaDescricao(desc);
      const nome = limpar([...razaoAntes, razao].filter(Boolean).join(' ')) || cp.nome;
      const doc = docIt && !/\*/.test(docIt.s) ? docIt.s.replace(/\D/g, '') : cp.doc;
      lanc.push({ pagina: pg.numero, data, descricao: desc, valor, saldoInformado: null, contraparteNome: nome || null, contraparteDoc: doc || null, hint: cp.hint, razaoAberta: !!razaoAntes.length || !!razao });
      razaoAntes = [];
    }
  }
  for (const l of lanc) delete l.razaoAberta;
  if (saldoAnterior == null) throw new Error('Não achei a linha "SALDO ANTERIOR".');
  if (saldoFinal == null) saldoFinal = lanc.length ? null : saldoAnterior;
  if (saldoFinal == null) throw new Error('Não achei nenhum "SALDO TOTAL DISPONÍVEL DIA" (saldo final).');
  return { agencia, conta, contaDv, cnpj, titular: null, mesRef, periodo: { inicio: dataIni, fim: dataFim }, saldoAnterior, saldoFinal, lanc, saldosDia, aplicacoes, resumo: null, layout: 'C' };
}

export async function lerExtratoItau(buffer) {
  const paginas = await paginasDo(buffer);
  const todoTexto = paginas.map((p) => linhasDe(p.itens).map((l) => texto(l.itens)).join('\n')).join('\n');
  if (SHOPPING_RECIFE.test(todoTexto)) throw new Error('Extrato da Shopping Recife: não entra em nenhum banco (regra do Yago).');
  let r;
  if (/saldo em \d{2}\/\d{2}\/\d{2}/i.test(todoTexto) && /extrato\s+mensal/i.test(todoTexto)) r = lerLayoutA(paginas, todoTexto);
  else if (/Lan[çc]amentos do per[íi]odo:/i.test(todoTexto) && /SALDO ANTERIOR/i.test(todoTexto)) r = lerLayoutC(paginas, todoTexto);
  else if (/saldo dispon[íi]vel em conta/i.test(todoTexto) && /SALDO ANTERIOR/i.test(todoTexto)) r = lerLayoutB(paginas, todoTexto);
  else throw new Error('Este PDF não parece ser um extrato do Itaú (nem "extrato mensal", nem "lançamentos período", nem "Lançamentos do período" 2025).');
  if (SHOPPING_RECIFE.test(`${r.conta}-${r.contaDv} ${r.cnpj || ''} ${r.titular || ''}`)) throw new Error('Extrato da Shopping Recife: não entra em nenhum banco (regra do Yago).');
  const conhecida = CONTAS_ITAU[`${r.agencia}|${r.conta}-${r.contaDv}`] || null;
  const titular = r.titular || conhecida?.titular || null;
  const cnpj = r.cnpj || conhecida?.cnpj || null;

  // ordem: as linhas vêm na ordem do extrato (cronológica); numera
  const lanc = r.lanc.map((l, i) => ({ ...l, seq: i + 1, dataBalancete: l.data, natureza: l.valor < 0 ? 'D' : 'C', historico: l.descricao, historicoBase: l.descricao.replace(/\s*\d{2}\/\d{2}$/, ''), documento: null, hora: null }));
  let corrente = round2(r.saldoAnterior);
  const divergencias = [];
  for (const l of lanc) {
    corrente = round2(corrente + l.valor);
    l.saldoApos = corrente;
  }
  for (const s of r.saldosDia) {
    const l = lanc[s.apos];
    if (!l) continue;
    if (Math.abs(l.saldoApos - s.valor) > 0.005) divergencias.push({ seq: l.seq, data: l.data, historico: l.descricao, saldoCalculado: l.saldoApos, saldoInformado: s.valor, diferenca: round2(s.valor - l.saldoApos) });
  }
  const saldoCalculado = lanc.length ? lanc.at(-1).saldoApos : round2(r.saldoAnterior);
  const totalCreditos = round2(lanc.filter((l) => l.valor > 0).reduce((s, l) => s + l.valor, 0));
  const totalDebitos = round2(lanc.filter((l) => l.valor < 0).reduce((s, l) => s - l.valor, 0));
  const bate = divergencias.length === 0 && Math.abs(saldoCalculado - r.saldoFinal) <= 0.005;
  return {
    banco: 'ITAU',
    bancoCodigo: '341',
    formato: 'pdf',
    layout: r.layout,
    agencia: r.agencia,
    conta: r.conta,
    contaDv: r.contaDv,
    titular,
    titularCnpj: cnpj,
    mesReferencia: r.mesRef,
    periodo: r.periodo,
    saldoInicial: round2(r.saldoAnterior),
    saldoFinal: round2(r.saldoFinal),
    lancamentos: lanc,
    conferencia: {
      fonte: r.layout === 'A' ? 'PDF extrato mensal: saldo anterior, saldos de fim de dia e saldo final impressos' : r.layout === 'C' ? 'PDF "Lançamentos do período" (2025): SALDO ANTERIOR e SALDO TOTAL DISPONÍVEL DIA impressos, contraparte nas colunas Razão Social e CNPJ/CPF' : 'PDF lançamentos período: SALDO ANTERIOR e SALDO TOTAL DISPONÍVEL DIA impressos',
      saldoInicial: round2(r.saldoAnterior),
      totalCreditos,
      totalDebitos,
      saldoCalculado,
      saldoFinalInformado: round2(r.saldoFinal),
      diferencaFinal: round2(r.saldoFinal - saldoCalculado),
      saldosDiariosConferidos: r.saldosDia.length,
      divergencias,
      bate,
      resumo: r.resumo,
      aplicacoesAutomaticas: { qtd: r.aplicacoes.length, aplicado: round2(r.aplicacoes.filter((a) => a.valor < 0).reduce((s, a) => s - a.valor, 0)), resgatado: round2(r.aplicacoes.filter((a) => a.valor > 0).reduce((s, a) => s + a.valor, 0)) },
    },
    paginas: paginas.length,
    hash: crypto.createHash('sha1').update(buffer).digest('hex'),
  };
}

export default { lerExtratoItau, contraparteDaDescricao, CONTAS_ITAU };
