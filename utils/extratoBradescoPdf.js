// ============================================================
// Extrato do Bradesco PJ em PDF ("Extrato Consolidado / Por Período") — leitor
// novo, feito do zero (07/11/2026).
// ------------------------------------------------------------
// Layout (um PDF por mês):
//   Extrato Consolidado / Por Período
//   CROSBY DISTRIBUICAO E CONFECCAO LTDA | CNPJ: 017.177.680/0001-16
//   Agência | Conta   Total Disponível (R$)   Total (R$)        ← saldo NA DATA DA OPERAÇÃO (c/c + Invest Fácil), não serve
//   Extrato de: Ag: 2821 | CC: 0249374-8 | Entre 01/12/2024 e 31/12/2024
//   Data | Lançamento | Dcto. | Crédito (R$) | Débito (R$) | Saldo (R$)
//   22/11/2024 SALDO ANTERIOR                                   1,00
//   02/12/2024 RESGATE INVEST FACIL  9150125   613,16           614,16
//              TRANSFERENCIA PIX                                        ← nome do lançamento na linha de CIMA
//              1604311  7.000,00  7.614,16                              ← linha dos valores (com a data só na 1ª do dia)
//              REM: CROSBY CR VESTUARIO L 02/12                         ← detalhe/contraparte na linha de BAIXO
//   Total  47.363,62  -47.363,62  1,00                                  ← fim da tabela
//   Últimos Lançamentos (…)  /  Saldos Invest Fácil / Plus (saldo diário da aplicação)   ← ignorados
// Cada linha de valor traz o saldo da conta corrente → conferência linha a linha.
// Invest Fácil: APLIC./RESGATE INVEST FACIL (e APLIC.AUTOM./RESG.AUTOM.) são dinheiro indo
// e voltando da aplicação automática → ficam como lançamentos com tipo APLICACAO (não é
// entrada nem saída); o saldo acompanhado é o da conta corrente (o que o extrato imprime).
// "RENTAB.INVEST FACILCRED*" é rendimento de verdade (entrada). O saldo da aplicação no fim
// do mês vai em conferencia.saldoInvestFacil (tabela "Saldos Invest Fácil").
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
const SHOPPING_RECIFE = /SHOPPING\s*RECIFE|RECIFE\s*MALL|36\.?569\.?459/i;
const RE_INVEST = /^(APLIC\.?|RESG\.?|RESGATE|APLIC\.AUTOM\.|RESG\.AUTOM\.)\s*.*INVEST\s*FACIL|^APLIC\.AUTOM\.INVESTFACIL|^RESG\.AUTOM\.INVESTFACIL/i;

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
function linhasDe(itens, tol = 2.5) {
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

// contraparte no detalhe: "REM: CROSBY CR VESTUARIO L 02/12" (remetente), "DES: FULANO" (destinatário)
export function contraparteBradesco(descricao, detalhe) {
  const d = limpar(detalhe || '');
  const out = { nome: null, doc: null, hint: null };
  const up0 = semAcento(descricao).toUpperCase();
  // "REM: FULANO 02/12" (remetente) · "DES: FULANO" (destinatário) · "TRANSF CC PARA CC PJ · IRMAOS CR VESTUARIO LTDA" (só o nome)
  const m = d.match(/\b(REM|DES|FAV|BENEF)\s*:\s*(.+)$/i) || (/PIX|TED|DOC|TRANSF/.test(up0) && d && !/^\d|^CONTR\b|^Max |^QUANDO|^VALOR DISP/i.test(d) ? [null, null, d] : null);
  if (m) {
    let nome = limpar(m[2]).replace(/\s*\d{2}\/\d{2}\s*$/, '');
    const mDoc = nome.match(/(?<!\d)(\d{11}|\d{14})(?!\d)/);
    if (mDoc) out.doc = mDoc[1];
    nome = limpar(nome.replace(/(?<!\d)\d{11,}(?!\d)/g, ' '));
    if (/[A-Za-z]{2}/.test(nome)) out.nome = nome;
  }
  const up = semAcento(descricao).toUpperCase();
  if (/\bPIX\b/.test(up)) out.hint = 'PIX';
  else if (/\bTED\b|\bDOC\b|TRANSF/.test(up)) out.hint = 'TED';
  else if (/COBRANCA|BOLETO|TITULO/.test(up)) out.hint = 'COBRANCA';
  else if (/TARIFA|ENCARGO|MORA|IOF|JUROS/.test(up)) out.hint = 'TARIFA';
  else if (RE_INVEST.test(up) || /INVEST/.test(up)) out.hint = 'APLICACAO';
  else if (/OPER CREDITO|PARCELA|EMPREST/.test(up)) out.hint = 'EMPRESTIMO';
  return out;
}

/**
 * Lê o PDF "Extrato Consolidado / Por Período" do Bradesco. Mesmo formato dos outros leitores.
 * @param {Buffer} buffer
 */
export async function lerExtratoBradesco(buffer) {
  const paginas = await paginasDo(buffer);
  const todas = paginas.flatMap((p) => linhasDe(p.itens).map((l) => ({ ...l, pagina: p.numero })));
  const todoTexto = todas.map((l) => texto(l.itens)).join('\n');
  if (SHOPPING_RECIFE.test(todoTexto)) throw new Error('Extrato da Shopping Recife: não entra em nenhum banco (regra do Yago).');
  // "Extrato Mensal / Por Período" (set/2024): mesma tabela, mas o saldo já vem SOMADO com o Invest
  // Fácil e as aplicações/resgates não aparecem → o saldo não casa com o dos meses "Consolidado"
  // (a diferença é o saldo do Invest Fácil). Importar com "forçar" e saber disso.
  const layout = /Extrato Mensal\s*\/\s*Por Per[íi]odo/.test(todoTexto) ? 'mensal' : /Extrato Consolidado/.test(todoTexto) ? 'consolidado' : null;
  if (!layout || !/Extrato de:\s*Ag:/.test(todoTexto)) throw new Error('Este PDF não parece ser o "Extrato Consolidado / Por Período" (ou "Extrato Mensal / Por Período") do Bradesco.');
  const mTit = todoTexto.match(/^(.+?)\s*\|\s*CNPJ:\s*([\d./-]+)/m);
  const titular = mTit ? limpar(mTit[1]) : null;
  let cnpj = mTit ? mTit[2].replace(/\D/g, '') : null;
  if (cnpj && cnpj.length === 15 && cnpj.startsWith('0')) cnpj = cnpj.slice(1);
  const mConta = todoTexto.match(/Extrato de:\s*Ag:\s*(\d+)\s*\|\s*CC:\s*([\d.]+)-(\d)\s*\|\s*Entre\s*(\d{2}\/\d{2}\/\d{4})\s*e\s*(\d{2}\/\d{2}\/\d{4})/);
  if (!mConta) throw new Error('Não achei "Extrato de: Ag: … | CC: … | Entre … e …".');
  const agencia = mConta[1];
  const conta = mConta[2].replace(/\D/g, '').replace(/^0+/, '');
  const contaDv = mConta[3];
  const periodo = { inicio: dataIso(mConta[4]), fim: dataIso(mConta[5]) };
  const mesRef = periodo.inicio.slice(0, 7);
  if (SHOPPING_RECIFE.test(`${titular || ''} ${cnpj || ''}`)) throw new Error('Extrato da Shopping Recife: não entra em nenhum banco (regra do Yago).');

  // ── tabela principal ──
  let saldoAnterior = null;
  let dentro = false;
  let fim = false;
  let dataAtual = null;
  let nomePendente = '';
  const lanc = [];
  const ehTexto = (its) => its.every((i) => !RE_NUM.test(i.s) || i.x < 250) && its.some((i) => i.x >= 95 && i.x < 250) && !its.some((i) => i.x >= 500 && RE_NUM.test(i.s));
  const ehValor = (its) => its.some((i) => i.x >= 500 && RE_NUM.test(i.s));
  for (let i = 0; i < todas.length && !fim; i++) {
    const its = todas[i].itens;
    const t = texto(its);
    const tUp = semAcento(t).toUpperCase();
    if (!dentro) {
      if (/^DATA LANCAMENTO DCTO/.test(tUp)) dentro = true;
      continue;
    }
    if (/^EXTRATO CONSOLIDADO|^FOLHA \d|^NOME DO USUARIO|^DATA DA OPERACAO|\| CNPJ:|^DATA LANCAMENTO DCTO/.test(tUp)) continue; // cabeçalhos repetidos
    const dataIt = its.find((x) => x.x < 60 && /^\d{2}\/\d{2}\/\d{4}$/.test(x.s));
    if (/^SALDO ANTERIOR/.test(semAcento(texto(its.filter((x) => x.x >= 95))).toUpperCase())) {
      const n = its.filter((x) => x.x >= 500 && RE_NUM.test(x.s)).at(-1);
      if (!n) throw new Error('"SALDO ANTERIOR" sem valor.');
      saldoAnterior = numBr(n.s);
      continue;
    }
    if (/^TOTAL\b/.test(tUp) && its[0].x < 60) {
      fim = true;
      break;
    }
    if (saldoAnterior == null) continue;
    if (dataIt) dataAtual = dataIso(dataIt.s);
    if (ehValor(its)) {
      const saldoIt = its.filter((x) => x.x >= 500 && RE_NUM.test(x.s)).at(-1);
      const vals = its.filter((x) => x !== saldoIt && RE_NUM.test(x.s) && x.x >= 330);
      const valIt = vals.at(-1);
      if (!valIt) throw new Error(`Linha sem valor: "${t}"`);
      const valor = valIt.s.startsWith('-') || valIt.x >= 420 ? -Math.abs(numBr(valIt.s)) : Math.abs(numBr(valIt.s));
      const nomeAqui = texto(its.filter((x) => x.x >= 95 && x.x < 250));
      const documento = texto(its.filter((x) => x.x >= 250 && x.x < 330)) || null;
      const descricao = limpar(nomeAqui || nomePendente);
      nomePendente = '';
      if (!dataAtual) throw new Error(`Lançamento sem data: "${t}"`);
      lanc.push({ pagina: todas[i].pagina, data: dataAtual, descricao, documento, valor, saldoInformado: numBr(saldoIt.s), detalhe: null });
      continue;
    }
    if (ehTexto(its)) {
      const frag = texto(its.filter((x) => x.x >= 95));
      const prox = todas[i + 1]?.itens || [];
      const proxEhValorSemNome = ehValor(prox) && !prox.some((x) => x.x >= 95 && x.x < 250 && !RE_NUM.test(x.s));
      if (proxEhValorSemNome || !lanc.length) nomePendente = limpar(`${nomePendente} ${frag}`);
      else {
        const ult = lanc.at(-1);
        ult.detalhe = ult.detalhe ? `${ult.detalhe} | ${frag}` : frag;
      }
    }
  }
  if (saldoAnterior == null) throw new Error('Não achei a linha "SALDO ANTERIOR".');
  if (!fim) throw new Error('Não achei a linha "Total" que fecha a tabela.');

  // ── saldo do Invest Fácil no fim do período (tabela "Saldos Invest Fácil / Plus") ──
  let saldoInvestFacil = null;
  for (const l of todas) {
    const t = texto(l.itens);
    const m = t.match(/^(\d{2}\/\d{2}\/\d{4})\s+SALDO INVEST F[ÁA]CIL\s+(-?[\d.]+,\d{2})$/i);
    if (m && dataIso(m[1]) <= periodo.fim) saldoInvestFacil = numBr(m[2]);
  }

  let corrente = round2(saldoAnterior);
  const divergencias = [];
  const aplicacoes = [];
  lanc.forEach((l, i) => {
    corrente = round2(corrente + l.valor);
    const cp = contraparteBradesco(l.descricao, l.detalhe);
    l.seq = i + 1;
    l.saldoApos = corrente;
    l.dataBalancete = l.data;
    l.natureza = l.valor < 0 ? 'D' : 'C';
    l.historico = l.detalhe ? `${l.descricao} · ${l.detalhe}` : l.descricao;
    l.historicoBase = l.descricao;
    l.historicoDescricao = null;
    l.contraparteNome = cp.nome;
    l.contraparteDoc = cp.doc;
    l.hint = cp.hint;
    l.hora = null;
    l.tipo = RE_INVEST.test(semAcento(l.descricao).toUpperCase()) ? 'APLICACAO' : null;
    if (l.tipo === 'APLICACAO') aplicacoes.push({ data: l.data, descricao: l.descricao, valor: l.valor });
    if (Math.abs(l.saldoApos - l.saldoInformado) > 0.005) divergencias.push({ seq: l.seq, data: l.data, historico: l.descricao, saldoCalculado: l.saldoApos, saldoInformado: l.saldoInformado, diferenca: round2(l.saldoInformado - l.saldoApos) });
  });
  const saldoFinal = lanc.length ? lanc.at(-1).saldoInformado : round2(saldoAnterior);
  const totalCreditos = round2(lanc.filter((l) => l.valor > 0).reduce((s, l) => s + l.valor, 0));
  const totalDebitos = round2(lanc.filter((l) => l.valor < 0).reduce((s, l) => s - l.valor, 0));
  const bate = divergencias.length === 0 && Math.abs(corrente - saldoFinal) <= 0.005;

  return {
    banco: 'BRADESCO',
    bancoCodigo: '237',
    formato: 'pdf',
    layout,
    saldoInclui: layout === 'mensal' ? 'cc+investfacil' : 'cc',
    agencia,
    conta,
    contaDv,
    titular,
    titularCnpj: cnpj,
    mesReferencia: mesRef,
    periodo,
    saldoInicial: round2(saldoAnterior),
    saldoFinal,
    lancamentos: lanc,
    conferencia: {
      fonte: layout === 'mensal' ? 'PDF Extrato Mensal / Por Período: SALDO ANTERIOR e saldo (conta corrente + Invest Fácil) em cada linha' : 'PDF Extrato Consolidado / Por Período: SALDO ANTERIOR e saldo da conta corrente em cada linha',
      saldoInicial: round2(saldoAnterior),
      totalCreditos,
      totalDebitos,
      saldoCalculado: corrente,
      saldoFinalInformado: saldoFinal,
      diferencaFinal: round2(saldoFinal - corrente),
      saldosDiariosConferidos: lanc.length,
      divergencias,
      bate,
      saldoInvestFacil,
      aplicacoesAutomaticas: { qtd: aplicacoes.length, aplicado: round2(aplicacoes.filter((a) => a.valor < 0).reduce((s, a) => s - a.valor, 0)), resgatado: round2(aplicacoes.filter((a) => a.valor > 0).reduce((s, a) => s + a.valor, 0)) },
    },
    paginas: paginas.length,
    hash: crypto.createHash('sha1').update(buffer).digest('hex'),
  };
}

export default { lerExtratoBradesco, contraparteBradesco };
