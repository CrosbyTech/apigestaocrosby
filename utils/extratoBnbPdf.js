// ============================================================
// Extratos do Banco do Nordeste (BNB) em PDF — leitor novo, feito do zero (07/11/2026).
// ------------------------------------------------------------
// Dois documentos:
// A) "Extrato de Conta Corrente - no período" (internet banking, uma conta):
//      Titular: CROSBY CR VESTUARIO LTDA      Agência/Conta Corrente: 035 - NATAL TIROL/069918-1
//      Saldo Anterior: R$ 434,80              Período: 01/09/2024 até 30/09/2024
//      Data | Histórico | Documento | Valor R$ | Saldo R$        (saldo em CADA linha)
//        RECEBIMENTO VIA PIX                                     ← tipo do lançamento na linha de CIMA
//      18/09/2024  IRMAOS CR VESTUARIO LTDA  11971  1.000,00  1.329,80   ← linha dos valores; o texto é a contraparte
//        ::18/9/2024                                             ← lixo (data do Pix)
//      02/09/2024  TARIFA PACOTE DE TARIFAS  8227  - 105,00  329,80      ← débito com "- " na frente
//      "Nenhuma movimentação encontrada." quando o mês não teve movimento (saldo final = anterior).
//      "Detalhamento do Saldo" no fim é da data de geração → ignorar.
// B) "Extrato Consolidado" (Internet Banking BNB, contas antigas da agência 185; VÁRIAS contas num PDF):
//      Mês: Maio/2024 · blocos "> CONTA CORRENTE / AGENCIA: 185 CONTA 2.286-3 - NOME" com
//      "> DEMONSTRATIVO DA MOVIMENTACAO": DIA | HISTORICO | DOCUMENTO | VALOR | SALDO,
//      "SALDO ANTERIOR 0,00 7.175,74", linhas "2 TARIFA PACOTE DE TARIFAS 8227 105,00- 7.070,74"
//      (dia + histórico juntos; débito com "-" no fim), "***NAO HOUVE MOVIMENTACAO***" quando parado.
//      Blocos de fundos de investimento são ignorados. Devolve UMA leitura POR CONTA (array).
// O OFX do BNB tem LEDGERBAL na data da exportação → não serve de saldo.
// ============================================================
import { createRequire } from 'node:module';
import crypto from 'node:crypto';

const require = createRequire(import.meta.url);
let _pdfjs = null;
const pdfjs = () => (_pdfjs ||= require('pdfjs-dist/legacy/build/pdf.js'));

const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const limpar = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const semAcento = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const RE_NUM = /^-?\s*\d{1,3}(\.\d{3})*,\d{2}[-+]?$/; // consolidado: "105,00-" débito, "1.000,00+" crédito
const numBr = (s) => {
  const t = String(s).trim();
  const neg = t.startsWith('-') || t.endsWith('-');
  return round2(Number(t.replace(/[-+\s]/g, '').replace(/\./g, '').replace(',', '.')) * (neg ? -1 : 1));
};
// conta sem zeros à esquerda e agência com 3 dígitos, para "069918-1" (no período) e "69.918-1" (consolidado) serem a mesma conta
const normConta = (c) => String(c).replace(/\D/g, '').replace(/^0+/, '') || '0';
const normAgencia = (a) => String(a).replace(/\D/g, '').padStart(3, '0');
const dataIso = (ddmmaaaa) => {
  const m = String(ddmmaaaa).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};
const MESES = { janeiro: '01', fevereiro: '02', março: '03', marco: '03', abril: '04', maio: '05', junho: '06', julho: '07', agosto: '08', setembro: '09', outubro: '10', novembro: '11', dezembro: '12' };
const ultimoDiaMes = (mes) => {
  const [a, m] = mes.split('-').map(Number);
  return `${mes}-${String(new Date(Date.UTC(a, m, 0)).getUTCDate()).padStart(2, '0')}`;
};
const SHOPPING_RECIFE = /SHOPPING\s*RECIFE|RECIFE\s*MALL|36\.?569\.?459/i;

// titular → CNPJ (o PDF não traz o CNPJ)
const CNPJ_TITULAR = [
  { re: /CROSBY/i, cnpj: '17177680000116' },
  { re: /FABIO FERREIRA DE LIMA AZEVEDO|FA MODA/i, cnpj: '27728810000115' },
  { re: /IRMAOS CR VESTUARIO|IRMAOS C V/i, cnpj: '33592092000103' },
  { re: /IRMAOS VAREJO|FLAVIO FERREIRA/i, cnpj: '53661116000138' },
];
const cnpjDe = (titular) => CNPJ_TITULAR.find((c) => c.re.test(titular || ''))?.cnpj || null;

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
// "RECEBIMENTO VIA PIX" + "IRMAOS CR VESTUARIO LTDA" / "PAGAMENTO VIA PIX" + "FABIO FERREIRA L A 06704197"
export function contraparteBnb(tipoLinha, textoLinha) {
  const out = { nome: null, doc: null, base: limpar(tipoLinha || textoLinha), hint: null };
  const up = semAcento(out.base).toUpperCase();
  if (tipoLinha && /PIX|TED|DOC|TRANSF/.test(up)) {
    const t = limpar(textoLinha);
    const mDoc = t.match(/(?<!\d)(\d{11}|\d{14})(?!\d)/);
    if (mDoc && docValido(mDoc[1])) out.doc = mDoc[1];
    const nome = limpar(t.replace(/(?<!\d)\d{11,}(?!\d)/g, ' ').replace(/\s+\d{5,}\s*$/, ''));
    if (/[A-Za-z]{3}/.test(nome)) out.nome = nome;
  }
  if (/\bPIX\b/.test(up)) out.hint = 'PIX';
  else if (/\bTED\b|\bDOC\b|TRANSF/.test(up)) out.hint = 'TED';
  else if (/TARIFA|ENCARGO|IOF|JUROS|MORA/.test(up)) out.hint = 'TARIFA';
  else if (/PRINCIPAL|FINANC|LIBER|CREDITO|PARCELA|EMPREST/.test(up)) out.hint = 'EMPRESTIMO';
  return out;
}

function montar({ layout, agencia, conta, contaDv, titular, periodo, saldoAnterior, lanc, buffer, paginas }) {
  const cnpj = cnpjDe(titular);
  if (SHOPPING_RECIFE.test(`${titular || ''} ${cnpj || ''}`)) throw new Error('Extrato da Shopping Recife: não entra em nenhum banco (regra do Yago).');
  const mesRef = periodo.inicio.slice(0, 7);
  let corrente = round2(saldoAnterior);
  const divergencias = [];
  lanc.forEach((l, i) => {
    corrente = round2(corrente + l.valor);
    l.seq = i + 1;
    l.saldoApos = corrente;
    l.dataBalancete = l.data;
    l.natureza = l.valor < 0 ? 'D' : 'C';
    l.historicoDescricao = null;
    l.hora = null;
    if (Math.abs(l.saldoApos - l.saldoInformado) > 0.005) divergencias.push({ seq: l.seq, data: l.data, historico: l.historico, saldoCalculado: l.saldoApos, saldoInformado: l.saldoInformado, diferenca: round2(l.saldoInformado - l.saldoApos) });
  });
  const saldoFinal = lanc.length ? lanc.at(-1).saldoInformado : round2(saldoAnterior);
  const totalCreditos = round2(lanc.filter((l) => l.valor > 0).reduce((s, l) => s + l.valor, 0));
  const totalDebitos = round2(lanc.filter((l) => l.valor < 0).reduce((s, l) => s - l.valor, 0));
  const bate = divergencias.length === 0 && Math.abs(corrente - saldoFinal) <= 0.005;
  return {
    banco: 'BNB',
    bancoCodigo: '004',
    formato: 'pdf',
    layout,
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
      fonte: layout === 'periodo' ? 'PDF Extrato de Conta Corrente - no período: Saldo Anterior e saldo em cada linha' : 'PDF Extrato Consolidado: SALDO ANTERIOR e saldo em cada linha do demonstrativo',
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
    hash: crypto.createHash('sha1').update(Buffer.concat([buffer, Buffer.from(`${agencia}|${conta}-${contaDv}`)])).digest('hex'),
  };
}

// ─── A) "no período" ───
function lerPeriodo(todas, todoTexto, buffer, paginas) {
  const titular = limpar((todoTexto.match(/Titular:\s*(.+)/) || [])[1] || '') || null;
  const mConta = todoTexto.match(/Ag[êe]ncia\/Conta Corrente:\s*(\d+)\s*-\s*[^/\n]*\/\s*(\d+)-(\d)/);
  if (!mConta) throw new Error('Não achei "Agência/Conta Corrente: 035 - NATAL TIROL/069918-1".');
  const mSaldo = todoTexto.match(/Saldo Anterior:\s*(-?\s*R\$\s*-?[\d.]+,\d{2})/);
  const mPer = todoTexto.match(/Per[íi]odo:\s*(\d{2}\/\d{2}\/\d{4})\s*at[ée]\s*(\d{2}\/\d{2}\/\d{4})/);
  if (!mSaldo || !mPer) throw new Error('Não achei "Saldo Anterior" e "Período".');
  const saldoAnterior = round2(Number(mSaldo[1].replace(/[R$\s]/g, '').replace(/\./g, '').replace(',', '.').replace(/^-?-/, '-')) * (/-/.test(mSaldo[1]) ? (mSaldo[1].replace(/[^-]/g, '').length === 1 ? -1 : 1) : 1));
  const periodo = { inicio: dataIso(mPer[1]), fim: dataIso(mPer[2]) };
  const lanc = [];
  let dentro = false;
  let pendente = '';
  for (const l of todas) {
    const its = l.itens;
    const t = texto(its);
    const tUp = semAcento(t).toUpperCase();
    if (!dentro) {
      if (/^DATA HISTORICO DOCUMENTO VALOR/.test(tUp)) dentro = true;
      continue;
    }
    if (/^DETALHAMENTO DO SALDO|^SALDO DISPONIVEL|^EXTRATO GERADO/.test(tUp)) break;
    if (/^NENHUMA MOVIMENTACAO/.test(tUp)) break;
    const dataIt = its.find((x) => x.x < 70 && /^\d{2}\/\d{2}\/\d{4}$/.test(x.s));
    const saldoIt = its.filter((x) => x.x >= 500 && RE_NUM.test(x.s)).at(-1);
    if (!dataIt || !saldoIt) {
      if (/^::/.test(t)) continue; // "::5/9/2024"
      if (its.every((x) => x.x >= 100 && x.x < 400)) pendente = limpar(`${pendente} ${t}`);
      continue;
    }
    const valIt = its.filter((x) => x !== saldoIt && RE_NUM.test(x.s) && x.x >= 400).at(-1);
    if (!valIt) throw new Error(`Linha de ${dataIt.s} sem valor: "${t}"`);
    const textoLinha = texto(its.filter((x) => x !== dataIt && x !== valIt && x !== saldoIt && x.x >= 100 && x.x < 290));
    const documento = texto(its.filter((x) => x.x >= 290 && x.x < 400)) || null;
    const cp = contraparteBnb(pendente || null, textoLinha);
    const historico = pendente ? `${pendente} · ${textoLinha}` : textoLinha;
    lanc.push({ pagina: l.pagina, data: dataIso(dataIt.s), historico, historicoBase: cp.base, documento: documento && documento !== '0' ? documento : null, valor: numBr(valIt.s), saldoInformado: numBr(saldoIt.s), contraparteNome: cp.nome, contraparteDoc: cp.doc, hint: cp.hint });
    pendente = '';
  }
  if (!dentro) throw new Error('Não achei a tabela "Data Histórico Documento Valor Saldo".');
  return montar({ layout: 'periodo', agencia: normAgencia(mConta[1]), conta: normConta(mConta[2]), contaDv: mConta[3], titular, periodo, saldoAnterior, lanc, buffer, paginas });
}

// ─── B) "Extrato Consolidado" (várias contas) ───
function lerConsolidado(todas, todoTexto, buffer, paginas) {
  const mMes = todoTexto.match(/M[êe]s:\s*([A-Za-zçÇ]+)\/(\d{4})/);
  if (!mMes || !MESES[mMes[1].toLowerCase()]) throw new Error('Não achei "Mês: Maio/2024" no extrato consolidado.');
  const mesRef = `${mMes[2]}-${MESES[mMes[1].toLowerCase()]}`;
  const periodo = { inicio: `${mesRef}-01`, fim: ultimoDiaMes(mesRef) };
  const titularGeral = limpar((todoTexto.match(/Titular:\s*(.+)/) || [])[1] || '') || null;
  const contas = [];
  let atual = null;
  let ultimaCC = null; // última conta corrente vista: o demonstrativo dela pode vir só depois da seção de fundos
  let dentro = false;
  for (const l of todas) {
    const its = l.itens;
    const t = texto(its);
    const tUp = semAcento(t).toUpperCase();
    const mConta = t.match(/^AGENCIA:\s*(\d+)\s+CONTA\s+([\d.]+)-(\d)\s*-\s*(.+)$/i);
    if (mConta) {
      atual = { agencia: normAgencia(mConta[1]), conta: normConta(mConta[2]), contaDv: mConta[3], titular: limpar(mConta[4]) || titularGeral, saldoAnterior: null, saldoAtual: null, lanc: [], diaAtual: null };
      contas.push(atual);
      dentro = false;
      continue;
    }
    if (atual && !dentro) {
      const mSc = t.match(/^SALDO CONTA CORRENTE\.*\s*(-?[\d.]+,\d{2}[-+]?)$/i);
      if (mSc) { atual.saldoAtual = numBr(mSc[1]); ultimaCC = atual; }
    }
    if (/^>\s*APLICACOES|^>\s*FUNDOS|^>\s*MOVIMENTACOES BNB/.test(tUp)) { atual = null; dentro = false; continue; }
    // "> DEMONSTRATIVO DA MOVIMENTACAO DE CONTA CORRENTE" depois da seção de fundos pertence à última conta corrente
    // (ex.: 69.919-0 em set/2024: SALDO CONTA CORRENTE, fundo BNB CONTA RESERVA e só então o demonstrativo com a transferência)
    if (/^>\s*DEMONSTRATIVO DA MOVIMENTACAO DE CONTA CORRENTE/.test(tUp)) {
      if ((!atual || atual.saldoAtual == null) && ultimaCC && ultimaCC.saldoAnterior == null) atual = ultimaCC;
      dentro = false;
      continue;
    }
    if (!atual) continue;
    if (/^DIA HISTORICO DOCUMENTO VALOR SALDO/.test(tUp)) { dentro = true; continue; }
    if (!dentro) continue;
    if (/^\*\*\*NAO HOUVE|^>\s/.test(tUp)) { dentro = false; continue; }
    const nums = its.filter((x) => RE_NUM.test(x.s));
    if (/^SALDO ANTERIOR/.test(tUp)) {
      if (!nums.length) throw new Error('"SALDO ANTERIOR" sem valor no consolidado.');
      atual.saldoAnterior = numBr(nums.at(-1).s);
      continue;
    }
    if (nums.length < 2 || atual.saldoAnterior == null) continue;
    // "2 TARIFA PACOTE DE TARIFAS" (dia + histórico juntos) ou, no mesmo dia da linha anterior, só "DEBITO PRINCIPAL"
    const mDia = (its[0]?.s || '').match(/^(\d{1,2})\s+(.+)$/);
    const dia = mDia ? mDia[1] : atual.diaAtual;
    if (!dia) continue;
    atual.diaAtual = dia;
    const saldoIt = nums.at(-1);
    const valIt = nums.at(-2);
    const historico = limpar(mDia ? mDia[2] : its[0].s);
    const documento = texto(its.filter((x) => x !== its[0] && x !== valIt && x !== saldoIt && x.x >= 150 && x.x < 250)) || null;
    const cp = contraparteBnb(null, historico);
    atual.lanc.push({ pagina: l.pagina, data: `${mesRef}-${dia.padStart(2, '0')}`, historico, historicoBase: historico, documento, valor: numBr(valIt.s), saldoInformado: numBr(saldoIt.s), contraparteNome: null, contraparteDoc: null, hint: cp.hint });
  }
  // conta corrente parada no mês (só "SALDO CONTA CORRENTE", sem demonstrativo): saldo anterior = saldo atual, sem lançamentos;
  // blocos só de fundo de investimento (sem "SALDO CONTA CORRENTE") ficam de fora
  const prontas = contas.filter((c) => c.saldoAnterior != null || c.lanc.length || c.saldoAtual != null);
  if (!prontas.length) throw new Error('Nenhuma conta corrente no extrato consolidado.');
  return prontas.map((c) => montar({ layout: 'consolidado', agencia: c.agencia, conta: c.conta, contaDv: c.contaDv, titular: c.titular, periodo, saldoAnterior: c.saldoAnterior ?? c.saldoAtual ?? 0, lanc: c.lanc, buffer, paginas }));
}

/**
 * Lê um PDF do BNB. "No período" → uma leitura; "Extrato Consolidado" → ARRAY de leituras (uma por conta).
 * @param {Buffer} buffer
 */
export async function lerExtratoBnb(buffer) {
  const paginas = await paginasDo(buffer);
  const todas = paginas.flatMap((p) => linhasDe(p.itens).map((l) => ({ ...l, pagina: p.numero })));
  const todoTexto = todas.map((l) => texto(l.itens)).join('\n');
  if (SHOPPING_RECIFE.test(todoTexto)) throw new Error('Extrato da Shopping Recife: não entra em nenhum banco (regra do Yago).');
  if (/Extrato de Conta Corrente - no per[íi]odo/i.test(todoTexto)) return lerPeriodo(todas, todoTexto, buffer, paginas);
  if (/Extrato Consolidado/.test(todoTexto) && /Internet Banking BNB|AGENCIA:\s*\d+\s+CONTA/.test(todoTexto)) return lerConsolidado(todas, todoTexto, buffer, paginas);
  throw new Error('Este PDF não parece ser um extrato do BNB ("Extrato de Conta Corrente - no período" ou "Extrato Consolidado").');
}

export default { lerExtratoBnb, contraparteBnb };
