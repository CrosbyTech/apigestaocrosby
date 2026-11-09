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
  '1575|29000199-0': { titular: 'CROSBY CR VESTUARIO LTDA (CONTA VINCULADA)', cnpj: '17177680000116', apelido: 'CROSBY VINC' }, // cobrança garantia, 2025
  '4543|13008301-6': { titular: 'IRMAOS CR VESTUARIO LTDA', cnpj: '33592092000103', apelido: 'IRMAOS' }, // aberta em 2025
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

// ─── Layouts do Internet Banking Empresarial (2025) ───────────────────────────────────────────
// IBE: "Períodos: 01/01/2025 a 31/01/2025"; colunas Data | Histórico | Documento | Valor (R$) | Saldo (R$);
//      1ª linha "SALDO ANTERIOR <saldo>"; as outras só trazem o valor (sem saldo por linha nem saldo final impresso)
//      → saldo final = anterior + movimentos, conferido pelo encadeamento com o mês seguinte.
// IBPJ: extrato "novo" (set/2025+), ordem DECRESCENTE; para cada dia uma linha "Saldo do dia Cc <saldo>" seguida dos
//      lançamentos do dia; colunas Data | Histórico (+ complemento: data, PERIODO, CNPJ, documento) | Valor ("- R $ 89,00");
//      sem período no cabeçalho (mês = o das datas) e sem saldo anterior (= saldo do 1º dia − movimentos dele).
//      O texto vem picado em letras soltas ("Pi x Recebido", "E x trato") → cola.
const RE_VALOR_IB = /^-?\d{1,3}(\.\d{3})*,\d{2}$/;
const RE_DATA_IB = /^\d{2}\/\d{2}\/\d{4}$/;
const dataIsoIb = (d) => { const m = d.match(/(\d{2})\/(\d{2})\/(\d{4})/); return `${m[3]}-${m[2]}-${m[1]}`; };
// "Pi x Recebido" → "Pix Recebido"; "Tarifa E x trato" → "Tarifa Extrato"; "Deb . Custas" → "Deb. Custas"
const colar = (tokens) => {
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (out.length && /^[a-z.]$/i.test(t)) {
      out[out.length - 1] += t;
      if (tokens[i + 1] && /^[a-z]/.test(tokens[i + 1])) { out[out.length - 1] += tokens[i + 1]; i++; }
    } else out.push(t);
  }
  return limpar(out.join(' '));
};
function cabecalhoIb(todoTexto) {
  const m = todoTexto.match(/^(.+?)\s+Ag[êe]ncia\s*:?\s*(\d{4})\s+Conta\s*:?\s*(\d{8,9})\s*$/m);
  if (!m) throw new Error('Não achei "NOME Agência: 1575 Conta: 130005995" no cabeçalho do Internet Banking Empresarial.');
  const dig = m[3];
  return { titular: limpar(m[1]), agencia: m[2], conta: dig.slice(0, -1), contaDv: dig.slice(-1) };
}
function lerIbe(todas, todoTexto) {
  const cab = cabecalhoIb(todoTexto);
  const mPer = todoTexto.match(/Per[íi]odos:\s*(\d{2}\/\d{2}\/\d{4})\s+a\s+(\d{2}\/\d{2}\/\d{4})/);
  if (!mPer) throw new Error('Não achei "Períodos: dd/mm/aaaa a dd/mm/aaaa".');
  const periodo = { inicio: dataIsoIb(mPer[1]), fim: dataIsoIb(mPer[2]) };
  const lanc = [];
  const saldosDia = [];
  let saldoAnterior = null;
  for (const l of todas) {
    const its = l.itens;
    const t = texto(its);
    const dataIt = its.find((i) => i.x < 90 && RE_DATA_IB.test(i.s)); // a tabela pode vir deslocada (julho: data em x≈65)
    if (!dataIt) {
      // histórico comprido que quebrou para a linha de baixo (sem data, só texto na coluna Histórico)
      const ult = lanc.at(-1);
      const peda = texto(its.filter((i) => i.x >= 95 && i.x < 400));
      if (ult && peda && its.every((i) => i.x >= 95 && i.x < 400) && !/^(Data|Internet Banking|Agência|Conta Corrente|Consultar|Op[çc][ãa]o|Per[íi]odos|Cart[ãa]o|Agora|movimenta|Conta Corrente|O extrato|Acessar)/i.test(t)) ult.descricao = limpar(`${ult.descricao} ${peda}`);
      continue;
    }
    // Valor (R$) termina em x≈485; Saldo (R$), só na última linha de cada dia, começa em x≈505
    const nums = its.filter((i) => RE_VALOR_IB.test(i.s) && i.x >= 440);
    const saldoIt = nums.find((i) => i.x >= 505);
    const valorIt = nums.find((i) => i.x < 505);
    const hist = texto(its.filter((i) => i !== dataIt && i.x >= 95 && i.x < 400 && !RE_VALOR_IB.test(i.s)));
    if (/^SALDO ANTERIOR/i.test(hist)) { if (saldoIt || valorIt) saldoAnterior = numBr((saldoIt || valorIt).s); continue; }
    if (!valorIt) continue;
    const data = dataIsoIb(dataIt.s);
    if (data > periodo.fim) continue; // o extrato entra no 1º dia útil do mês seguinte (o mês seguinte repete esse dia)
    const documento = texto(its.filter((i) => i.x >= 400 && i.x < 440 && /^\d+$/.test(i.s))) || null;
    lanc.push({ pagina: l.pagina, data, descricao: hist, documento: documento && !/^0+$/.test(documento) ? documento : null, valor: numBr(valorIt.s), detalhe: null });
    if (saldoIt) saldosDia.push({ apos: lanc.length - 1, valor: numBr(saldoIt.s) });
  }
  if (saldoAnterior == null) throw new Error('Não achei a linha "SALDO ANTERIOR" do Internet Banking Empresarial.');
  const saldoFinal = saldosDia.length && saldosDia.at(-1).apos === lanc.length - 1 ? saldosDia.at(-1).valor : null;
  return { ...cab, mesRef: periodo.inicio.slice(0, 7), periodo, saldoAnterior, saldoFinal, lanc, saldosDia, layout: 'ibe', fonte: 'PDF Internet Banking Empresarial: SALDO ANTERIOR e saldo impresso no fim de cada dia' };
}
function lerIbpj(todas, todoTexto) {
  const cab = cabecalhoIb(todoTexto);
  const RE_DET = /^(\d{2}\/\d{2}\/\d{4}|\d{2}\/\d{2}\/\d{2}|\d{2}\/\d{2}|\d{5,}|\d{4}\/\d+|\/|PERIODO|:|A|\d{4}|JANEIRO|FEVEREIRO|MAR[ÇC]O|ABRIL|MAIO|JUNHO|JULHO|AGOSTO|SETEMBRO|OUTUBRO|NOVEMBRO|DEZEMBRO)$/i;
  const porDia = new Map(); // data → { saldo, linhas: [] } na ordem do PDF (decrescente)
  for (const l of todas) {
    const its = [...l.itens].sort((a, b) => a.x - b.x);
    const dataIt = its.find((i) => i.x < 60 && RE_DATA_IB.test(i.s));
    if (!dataIt) continue;
    const data = dataIsoIb(dataIt.s);
    const dinheiroTok = its.filter((i) => i.x >= 430).map((i) => i.s).join(' ');
    const mVal = dinheiroTok.match(/(\d{1,3}(?:\.\d{3})*,\d{2})/);
    if (!mVal) continue;
    const valor = numBr(mVal[1]) * (/-/.test(dinheiroTok) ? -1 : 1);
    const meio = its.filter((i) => i !== dataIt && i.x >= 90 && i.x < 430);
    const histTok = meio.filter((i) => !RE_DET.test(i.s) || i.x < 165 && !RE_DATA_IB.test(i.s) && !/^\d{5,}$/.test(i.s)).map((i) => i.s);
    const detTok = meio.filter((i) => !histTok.includes(i.s) || (RE_DET.test(i.s) && i.x >= 165)).map((i) => i.s);
    const historico = colar(histTok);
    const detalhe = limpar(detTok.join(' ')) || null;
    if (!porDia.has(data)) porDia.set(data, { saldo: null, linhas: [] });
    const dia = porDia.get(data);
    if (/^Saldo do dia/i.test(historico)) { dia.saldo = valor; continue; }
    dia.linhas.push({ pagina: l.pagina, data, descricao: historico, documento: null, valor, detalhe });
  }
  if (!porDia.size) throw new Error('Nenhuma linha com data no extrato IBPJ.');
  const dias = [...porDia.keys()].sort();
  const freq = {};
  for (const d of dias) freq[d.slice(0, 7)] = (freq[d.slice(0, 7)] || 0) + porDia.get(d).linhas.length + 1;
  const mesRef = Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0];
  const periodo = { inicio: `${mesRef}-01`, fim: ultimoDiaMes(mesRef) };
  for (const d of [...dias]) if (d > periodo.fim) { porDia.delete(d); dias.splice(dias.indexOf(d), 1); } // 1º dia útil do mês seguinte fica de fora
  // saldo anterior = saldo do 1º dia com saldo − movimentos até ele
  const primeiroComSaldo = dias.find((d) => porDia.get(d).saldo != null);
  if (!primeiroComSaldo) throw new Error('Nenhuma linha "Saldo do dia Cc" no extrato IBPJ.');
  let movAte = 0;
  for (const d of dias) { movAte += porDia.get(d).linhas.reduce((s, x) => s + x.valor, 0); if (d === primeiroComSaldo) break; }
  const saldoAnterior = round2(porDia.get(primeiroComSaldo).saldo - movAte);
  const lanc = [];
  const saldosDia = [];
  let saldoFinal = saldoAnterior;
  for (const d of dias) {
    const dia = porDia.get(d);
    for (const x of [...dia.linhas].reverse()) lanc.push(x); // dentro do dia o PDF também é decrescente
    if (dia.saldo != null) { saldosDia.push({ apos: lanc.length - 1, valor: dia.saldo }); saldoFinal = dia.saldo; }
  }
  return { ...cab, mesRef, periodo, saldoAnterior, saldoFinal, lanc, saldosDia, layout: 'ibpj', fonte: 'PDF Internet Banking Empresarial (novo): "Saldo do dia Cc" conferido dia a dia; saldo anterior = saldo do 1º dia − movimentos dele' };
}
/** Fecha a leitura (numeração, saldo após cada linha, conferência) no formato dos outros leitores. */
function montarSantander(r, paginas, buffer) {
  const conhecida = CONTAS_SANTANDER[`${r.agencia}|${r.conta}-${r.contaDv}`] || null;
  const titular = conhecida?.titular || r.titular || null;
  const cnpj = conhecida?.cnpj || null;
  if (SHOPPING_RECIFE.test(`${r.titular || ''} ${titular} ${cnpj || ''}`)) throw new Error('Extrato da Shopping Recife: não entra em nenhum banco (regra do Yago).');
  const lanc = r.lanc;
  let corrente = round2(r.saldoAnterior);
  const divergencias = [];
  lanc.forEach((l, i) => {
    corrente = round2(corrente + l.valor);
    l.seq = i + 1;
    l.saldoApos = corrente;
    l.saldoInformado = null;
    l.dataBalancete = l.data;
    l.natureza = l.valor < 0 ? 'D' : 'C';
    l.historico = l.detalhe ? `${l.descricao} · ${l.detalhe}` : l.descricao;
    const cp = contraparteSantander(l.descricao, l.detalhe, titular, cnpj);
    l.historicoBase = cp.base;
    l.contraparteNome = l.contraparteNome ?? cp.nome;
    l.contraparteDoc = l.contraparteDoc ?? cp.doc;
    l.hint = hintDaDescricao(l.descricao);
    l.historicoDescricao = null;
    l.hora = null;
  });
  for (const s of r.saldosDia) {
    const l = lanc[s.apos];
    if (!l) continue;
    l.saldoInformado = s.valor;
    if (Math.abs(l.saldoApos - s.valor) > 0.005) divergencias.push({ seq: l.seq, data: l.data, historico: l.descricao, saldoCalculado: l.saldoApos, saldoInformado: s.valor, diferenca: round2(s.valor - l.saldoApos) });
  }
  const saldoFinal = r.saldoFinal == null ? corrente : round2(r.saldoFinal);
  const totalCreditos = round2(lanc.filter((l) => l.valor > 0).reduce((s, l) => s + l.valor, 0));
  const totalDebitos = round2(lanc.filter((l) => l.valor < 0).reduce((s, l) => s - l.valor, 0));
  const bate = divergencias.length === 0 && Math.abs(corrente - saldoFinal) <= 0.005;
  return {
    banco: 'SANTANDER',
    bancoCodigo: '033',
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
    saldoFinal,
    saldoFinalCalculado: r.saldoFinal == null, // IBE: não há saldo final impresso
    lancamentos: lanc,
    conferencia: {
      fonte: r.fonte,
      saldoInicial: round2(r.saldoAnterior),
      totalCreditos,
      totalDebitos,
      saldoCalculado: corrente,
      saldoFinalInformado: saldoFinal,
      diferencaFinal: round2(saldoFinal - corrente),
      saldosDiariosConferidos: r.saldosDia.length,
      divergencias,
      bate,
    },
    paginas: paginas.length,
    hash: crypto.createHash('sha1').update(buffer).digest('hex'),
  };
}

/**
 * Lê o PDF "Extrato Consolidado Inteligente" do Santander. Mesmo formato dos outros leitores.
 * @param {Buffer} buffer
 */
export async function lerExtratoSantander(buffer) {
  const paginas = await paginasDo(buffer);
  const todas = paginas.flatMap((p) => linhasDe(p.itens).map((l) => ({ ...l, pagina: p.numero })));
  const todoTexto = todas.map((l) => texto(l.itens)).join('\n');
  if (/Internet Banking Empresarial/i.test(todoTexto) && /Per[íi]odos:/.test(todoTexto)) return montarSantander(lerIbe(todas, todoTexto), paginas, buffer);
  if (/Internet Banking Empresarial/i.test(todoTexto) && /Saldo do dia/i.test(todoTexto)) return montarSantander(lerIbpj(todas, todoTexto), paginas, buffer);
  if (SHOPPING_RECIFE.test(todoTexto)) throw new Error('Extrato da Shopping Recife: não entra em nenhum banco (regra do Yago).');
  if (!/EXTRATO CONSOLIDADO/i.test(todoTexto) || !/Movimenta[çc][ãa]o/.test(todoTexto)) throw new Error('Este PDF não parece ser um extrato do Santander ("Extrato Consolidado Inteligente" ou Internet Banking Empresarial).');

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
