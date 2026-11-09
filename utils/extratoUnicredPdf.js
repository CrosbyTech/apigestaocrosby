// ============================================================
// Extrato da Unicred em PDF — leitor novo, feito do zero (07/11/2026).
// ------------------------------------------------------------
// Layout (um PDF por mês, exportado do internet banking):
//   27/12/2024 09:10:53 · Extrato · <operador - CPF mascarado>
//   Período de 01/03/2024 a 31/03/2024      Coop: 60 - AG: 6012 - Conta: 70980
//   Total Disponível R$ 1.230,59 · Limite de cheque especial R$ 0,00
//   Data | Lançamentos | Valor (R$) | Saldo (R$)
//   01/03/2024  PJ CONTA PJ 2 ( Doc.: 0 )                      - R$ 27,50   R$ 18.987,65
//   04/03/2024  CREDITO RECEBIMENTO DE PIX ( Doc.: CRED PIX /   R$ 11.100,00 R$ 54.079,17
//               Fabio Ferreira De Lima Azevedo )               ← continuação da descrição
//   ... (cabeçalho da tabela repete em cada página; rodapé "CENTRAL DE RELACIONAMENTO … Pág. 1/25")
//   Total disponível / Saldo bloqueado / Limite … (resumo final, ignorado)
// Cada linha traz o saldo após o lançamento → conferência linha a linha. Não há
// "saldo anterior": é o saldo da 1ª linha menos o valor dela. Saldo final = o da
// última linha ("Total Disponível" do cabeçalho é o saldo na hora da geração do PDF,
// não serve de conferência; o OFX do mês tem LEDGERBAL no fim do mês). Saldo negativo
// vem "-R$ 4.973,20"; débito vem "- R$ 6.000,00". O PDF não traz titular: vem do
// mapa de contas. A contraparte está no "( Doc.: CRED PIX / NOME )".
// O OFX do mesmo mês (BANKID 136) tem LEDGERBAL no fim do mês → contraprova.
// ============================================================
import { createRequire } from 'node:module';
import crypto from 'node:crypto';

const require = createRequire(import.meta.url);
let _pdfjs = null;
const pdfjs = () => (_pdfjs ||= require('pdfjs-dist/legacy/build/pdf.js'));

const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const limpar = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const semAcento = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const RE_VAL = /^-?\s*R\$\s*-?\d{1,3}(\.\d{3})*,\d{2}$/;
const numBr = (s) => {
  const t = String(s).trim();
  const neg = /^-/.test(t) || /R\$\s*-/.test(t);
  return round2(Number(t.replace(/[^\d,]/g, '').replace(',', '.')) * (neg ? -1 : 1));
};
const dataIso = (ddmmaaaa) => {
  const m = String(ddmmaaaa).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

// Contas conhecidas (agência|conta → titular e CNPJ; o PDF não traz o titular)
export const CONTAS_UNICRED = {
  '6012|68500': { titular: 'CROSBY D CONFECCAO LTDA', cnpj: '17177680000116' },
  '6012|70980': { titular: 'FABIO FERREIRA DE LIMA AZEVEDO', cnpj: '27728810000115' },
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

// ─── contraparte na descrição: "CREDITO RECEBIMENTO DE PIX ( Doc.: CRED PIX / CROSBY D CONFECCAO LTDA )" ───
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
export function contraparteUnicred(descricao) {
  const d = limpar(descricao);
  const out = { nome: null, doc: null, base: d, documento: null, hint: null };
  const m = d.match(/^(.*?)\s*\(\s*Doc\.?:\s*(.*?)\s*\)\s*$/i);
  if (m) {
    out.base = limpar(m[1]);
    const partes = m[2].split('/').map(limpar).filter(Boolean);
    out.documento = partes[0] && partes[0] !== '0' ? partes[0] : null;
    const resto = partes.slice(1).join(' / ');
    const mDoc = resto.match(/(?<!\d)(\d{11}|\d{14})(?!\d)/);
    if (mDoc && docValido(mDoc[1])) out.doc = mDoc[1];
    const nome = limpar(resto.replace(/(?<!\d)\d{11,}(?!\d)/g, ' ').replace(/[/]/g, ' '));
    if (/[A-Za-z]{3}/.test(nome) && !/^(CRED|DEB|PGTO) PIX$/i.test(nome)) out.nome = nome;
  }
  const up = semAcento(out.base).toUpperCase();
  if (/\bPIX\b/.test(up)) out.hint = 'PIX';
  else if (/\bTED\b|\bDOC\b|TRANSFERENCIA/.test(up)) out.hint = 'TED';
  else if (/COBRANCA|BOLETO|TITULO/.test(up)) out.hint = 'COBRANCA';
  else if (/TARIFA|CONTA PJ|IOF|JUROS/.test(up)) out.hint = 'TARIFA';
  else if (/EMPRESTIMO|PARCELA|CONSORCIO/.test(up)) out.hint = 'EMPRESTIMO';
  return out;
}

/**
 * Lê o PDF do extrato da Unicred. Mesmo formato dos outros leitores.
 * @param {Buffer} buffer
 */
// ─── layout B: "Extrato de Conta Corrente" (internet banking antigo; ex.: Fabio set/2024) ───
//   Cooperativa 60 · Agência 6012 · Conta 70980 · Cooperado <titular> · Saldo Anterior R$ 1.481,61
//   Data | Nº DOC | Histórico | Lançamentos (R$) (com sinal) | Saldo (R$)
//   O histórico longo quebra em linhas separadas ACIMA e ABAIXO da linha principal
//   ("DEBITO PAGAMENTO PIX(SAO SEBASTIAO" / linha / "CHURRASCARIA)"), e TED traz uma
//   linha "BCO: 197 AG: 0 CC: 16501555 - PAGAR.ME PAGAMENTOS S.A.". Não há período: o
//   mês vem das datas. "Saldo em <data atual>" da última página é o saldo do dia da
//   geração, não do fim do mês.
function lerLayoutB(todas, todoTexto) {
  const mCoop = todoTexto.match(/Cooperativa\s+(\d+)/);
  const mAg = todoTexto.match(/Ag[êe]ncia\s+(\d+)\s+Conta\s+(\d+)/);
  const mTit = todoTexto.match(/Cooperado\s+(.+?)\s+Usu[áa]rio/);
  if (!mAg) throw new Error('Não achei "Agência … Conta …" no extrato.');
  const RE_N = /^-?\d{1,3}(\.\d{3})*,\d{2}$/;
  const num = (s) => round2(Number(String(s).replace(/\./g, '').replace(',', '.')));
  let saldoAnterior = null;
  const lanc = [];
  let pendente = '';
  const aberto = (t) => (t.match(/\(/g) || []).length > (t.match(/\)/g) || []).length;
  for (let i = 0; i < todas.length; i++) {
    const its = todas[i].itens;
    const t = texto(its);
    if (saldoAnterior == null) {
      if (/Saldo Anterior/.test(t)) {
        const n = its.find((x) => RE_N.test(x.s) && x.x >= 480) || (todas[i + 1] || { itens: [] }).itens.find((x) => RE_N.test(x.s) && x.x >= 480);
        if (!n) throw new Error('"Saldo Anterior" sem valor.');
        saldoAnterior = num(n.s);
      }
      continue;
    }
    if (/^\*?\s*Lan[çc]amentos Bloqueados|^Saldo em\b|^Saldo Dispon/.test(t)) break;
    const dataIt = its.find((x) => x.x < 60 && /^\d{2}\/\d{2}\/\d{4}$/.test(x.s));
    const nums = its.filter((x) => RE_N.test(x.s));
    if (!dataIt || nums.length < 2) {
      if (/^Data\b|^CENTRAL DE RELACIONAMENTO|^Capitais e|^Demais regi|^No exterior|^SAC|^OUVIDORIA/i.test(t)) continue;
      const frag = texto(its.filter((x) => x.x >= 100));
      if (!frag) continue;
      const ult = lanc.at(-1);
      if (/^BCO:/.test(t)) { if (ult) ult.detalhe = t; continue; }
      if (ult && aberto(ult.descricao)) ult.descricao = limpar(`${ult.descricao} ${frag}`);
      else pendente = limpar(`${pendente} ${frag}`);
      continue;
    }
    const saldoIt = nums.filter((x) => x.x >= 490).at(-1);
    const valorIt = nums.filter((x) => x.x >= 400 && x.x < 490).at(-1);
    if (!saldoIt || !valorIt) throw new Error(`Linha de ${dataIt.s} sem valor ou saldo: "${t}"`);
    const documento = texto(its.filter((x) => x.x >= 100 && x.x < 175)) || null;
    const desc = texto(its.filter((x) => x.x >= 175 && x.x < 400));
    lanc.push({ pagina: todas[i].pagina, data: dataIso(dataIt.s), descricao: limpar(`${pendente} ${desc}`), documento: documento && documento !== '0' ? documento : null, detalhe: null, valor: num(valorIt.s), saldoInformado: num(saldoIt.s) });
    pendente = '';
  }
  if (saldoAnterior == null) throw new Error('Não achei "Saldo Anterior".');
  if (!lanc.length) throw new Error('Nenhum lançamento encontrado no extrato.');
  const mesRef = lanc.map((l) => l.data).sort()[0].slice(0, 7);
  const [a, m] = mesRef.split('-').map(Number);
  const fim = `${mesRef}-${String(new Date(Date.UTC(a, m, 0)).getUTCDate()).padStart(2, '0')}`;
  return { cooperativa: mCoop ? mCoop[1] : null, agencia: mAg[1], contaNum: mAg[2], titular: mTit ? limpar(mTit[1]) : null, periodo: { inicio: `${mesRef}-01`, fim }, saldoAnterior, lanc, layout: 'B' };
}
// contraparte do layout B: "DEBITO TRANSF PIX(FABIO FERREIRA L A 06704197)", "RECEB TED D STR(PAGAR.ME PAGAMENTOS)" + detalhe "BCO: 197 AG: 0 CC: 16501555 - PAGAR.ME PAGAMENTOS S.A."
function contraparteLayoutB(descricao, detalhe) {
  const d = limpar(descricao);
  const out = { nome: null, doc: null, base: d, documento: null, hint: null };
  const m = d.match(/^(.*?)\s*\((.*)\)\s*$/);
  if (m) {
    out.base = limpar(m[1]);
    const dentro = limpar(m[2]);
    const mDoc = dentro.match(/(?<!\d)(\d{11}|\d{14})(?!\d)/);
    if (mDoc && docValido(mDoc[1])) out.doc = mDoc[1];
    const nome = limpar(dentro.replace(/(?<!\d)\d{11,}(?!\d)/g, ' ').replace(/\s+\d{5,}\s*$/, ''));
    if (/[A-Za-z]{3}/.test(nome)) out.nome = nome;
  }
  if (!out.nome && detalhe) {
    const md = detalhe.match(/-\s*(.+)$/);
    if (md && /[A-Za-z]{3}/.test(md[1])) out.nome = limpar(md[1]);
  }
  const up = semAcento(out.base).toUpperCase();
  if (/\bPIX\b/.test(up)) out.hint = 'PIX';
  else if (/\bTED\b|\bDOC\b|TRANSF/.test(up)) out.hint = 'TED';
  else if (/COBRANCA|BOLETO|TITULO/.test(up)) out.hint = 'COBRANCA';
  else if (/TARIFA|CONTA PJ|IOF|JUROS/.test(up)) out.hint = 'TARIFA';
  else if (/EMPREST|PARCELA|CONSORCIO|INTEG/.test(up)) out.hint = 'EMPRESTIMO';
  return out;
}

export async function lerExtratoUnicred(buffer) {
  const paginas = await paginasDo(buffer);
  const todas = paginas.flatMap((p) => linhasDe(p.itens).map((l) => ({ ...l, pagina: p.numero })));
  const todoTexto = todas.map((l) => texto(l.itens)).join('\n');
  if (SHOPPING_RECIFE.test(todoTexto)) throw new Error('Extrato da Shopping Recife: não entra em nenhum banco (regra do Yago).');
  if (/Extrato de Conta Corrente/.test(todoTexto) && /Saldo Anterior/.test(todoTexto) && /Cooperado/.test(todoTexto)) return montar(lerLayoutB(todas, todoTexto), paginas, buffer);
  const mConta = todoTexto.match(/Coop:\s*(\d+)\s*-\s*AG:\s*(\d+)\s*-\s*Conta:\s*(\d+)/);
  const mPer = todoTexto.match(/Per[íi]odo de (\d{2}\/\d{2}\/\d{4}) a (\d{2}\/\d{2}\/\d{4})/);
  if (!mConta || !mPer || !/Lan[çc]amentos/.test(todoTexto)) throw new Error('Este PDF não parece ser um extrato da Unicred (sem "Coop: … AG: … Conta: …" e período).');
  const cooperativa = mConta[1];
  const agencia = mConta[2];
  const contaNum = mConta[3];
  const conta = contaNum.slice(0, -1);
  const contaDv = contaNum.slice(-1);
  const conhecida = CONTAS_UNICRED[`${agencia}|${contaNum}`] || null;
  const periodo = { inicio: dataIso(mPer[1]), fim: dataIso(mPer[2]) };
  const mesRef = periodo.inicio.slice(0, 7);
  const mTotal = todoTexto.match(/Total Dispon[íi]vel\s+(-?\s*R\$\s*-?[\d.]+,\d{2})/);
  const mLimite = todoTexto.match(/Limite de cheque especial\s+(-?\s*R\$\s*-?[\d.]+,\d{2})/);
  const totalDisponivel = mTotal ? numBr(mTotal[1]) : null;
  const limite = mLimite ? numBr(mLimite[1]) : 0;

  const lanc = [];
  for (const l of todas) {
    const its = l.itens;
    // "Lançamentos futuros" (2025): débitos agendados depois do período, sem saldo → não são do extrato
    if (/^Lan[çc]amentos futuros/i.test(texto(its))) break;
    const dataIt = its.find((i) => i.x < 40 && /^\d{2}\/\d{2}\/\d{4}$/.test(i.s));
    const vals = its.filter((i) => RE_VAL.test(i.s));
    if (!dataIt) {
      // continuação da descrição (só texto em x≈91) → cola na última linha
      const ult = lanc.at(-1);
      if (ult && vals.length === 0 && its.length && its.every((i) => i.x >= 80 && i.x < 380) && !/^(Data|Lan[çc]amentos)$/.test(its[0].s)) ult.descricao = limpar(`${ult.descricao} ${texto(its)}`);
      continue;
    }
    if (vals.length < 2) throw new Error(`Linha de ${dataIt.s} sem valor e saldo: "${texto(its)}"`);
    const saldoIt = vals.filter((i) => i.x >= 470).at(-1);
    const valorIt = vals.filter((i) => i.x < 470).at(-1);
    if (!saldoIt || !valorIt) throw new Error(`Linha de ${dataIt.s} sem valor ou saldo: "${texto(its)}"`);
    const descricao = texto(its.filter((i) => i !== dataIt && i !== saldoIt && i !== valorIt && i.x >= 80 && i.x < 380));
    lanc.push({ pagina: l.pagina, data: dataIso(dataIt.s), descricao, valor: numBr(valorIt.s), saldoInformado: numBr(saldoIt.s) });
  }
  if (!lanc.length) throw new Error('Nenhum lançamento encontrado no extrato.');
  const saldoAnterior = round2(lanc[0].saldoInformado - lanc[0].valor);
  return montar({ cooperativa, agencia, contaNum, titular: null, periodo, saldoAnterior, lanc, layout: 'A', totalDisponivel, limite }, paginas, buffer);
}

function montar(r, paginas, buffer) {
  const { cooperativa, agencia, contaNum, periodo, saldoAnterior, lanc } = r;
  const conta = contaNum.slice(0, -1);
  const contaDv = contaNum.slice(-1);
  const conhecida = CONTAS_UNICRED[`${agencia}|${contaNum}`] || null;
  const mesRef = periodo.inicio.slice(0, 7);
  if (SHOPPING_RECIFE.test(`${r.titular || ''} ${conhecida?.cnpj || ''}`)) throw new Error('Extrato da Shopping Recife: não entra em nenhum banco (regra do Yago).');
  let corrente = saldoAnterior;
  const divergencias = [];
  lanc.forEach((l, i) => {
    corrente = round2(corrente + l.valor);
    const cp = r.layout === 'B' ? contraparteLayoutB(l.descricao, l.detalhe) : contraparteUnicred(l.descricao);
    l.seq = i + 1;
    l.saldoApos = corrente;
    l.dataBalancete = l.data;
    l.natureza = l.valor < 0 ? 'D' : 'C';
    l.historico = l.detalhe ? `${l.descricao} · ${l.detalhe}` : l.descricao;
    l.historicoBase = cp.base;
    l.historicoDescricao = null;
    l.documento = r.layout === 'B' ? l.documento : cp.documento;
    l.contraparteNome = cp.nome;
    l.contraparteDoc = cp.doc;
    l.hint = cp.hint;
    l.hora = null;
    if (Math.abs(l.saldoApos - l.saldoInformado) > 0.005) divergencias.push({ seq: l.seq, data: l.data, historico: l.descricao, saldoCalculado: l.saldoApos, saldoInformado: l.saldoInformado, diferenca: round2(l.saldoInformado - l.saldoApos) });
  });
  const saldoFinal = lanc.at(-1).saldoInformado;
  const totalCreditos = round2(lanc.filter((l) => l.valor > 0).reduce((s, l) => s + l.valor, 0));
  const totalDebitos = round2(lanc.filter((l) => l.valor < 0).reduce((s, l) => s - l.valor, 0));
  // "Total Disponível" do cabeçalho é o saldo NA HORA EM QUE O PDF FOI GERADO (não o do fim do período) → só informativo
  const bate = divergencias.length === 0 && Math.abs(corrente - saldoFinal) <= 0.005;

  return {
    banco: 'UNICRED',
    bancoCodigo: '136',
    formato: 'pdf',
    layout: r.layout,
    agencia,
    cooperativa,
    conta,
    contaDv,
    titular: conhecida?.titular || r.titular || null,
    titularCnpj: conhecida?.cnpj || null,
    mesReferencia: mesRef,
    periodo,
    saldoInicial: saldoAnterior,
    saldoFinal,
    lancamentos: lanc,
    conferencia: {
      fonte: 'PDF da Unicred: saldo impresso em cada linha; saldo anterior = 1ª linha − valor',
      saldoInicial: saldoAnterior,
      totalCreditos,
      totalDebitos,
      saldoCalculado: corrente,
      saldoFinalInformado: saldoFinal,
      diferencaFinal: round2(saldoFinal - corrente),
      saldosDiariosConferidos: lanc.length,
      divergencias,
      bate,
      totalDisponivel: r.totalDisponivel ?? null,
      limiteChequeEspecial: r.limite ?? null,
    },
    paginas: paginas.length,
    hash: crypto.createHash('sha1').update(buffer).digest('hex'),
  };
}

export default { lerExtratoUnicred, contraparteUnicred, CONTAS_UNICRED };
