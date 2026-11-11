// ============================================================
// New Extrato Bancário — leitor do PDF do Banco Inter (077)
// ------------------------------------------------------------
// Conta 0001-9 | 4677101-8 da Crosby Distribuição e Confecção (17.177.680/0001-16). Dois layouts em 2023:
//
//   A) "Extrato Conta Corrente PJ" (jan/2023, internet banking antigo):
//        Nome: … Cnpj: 17177680000116 / Agência: 0001-9  Conta: 46771018
//        Data Lançamento | Lançamentos | Valor | Saldo   — uma linha por lançamento, em ordem cronológica,
//        com o SALDO depois de cada linha. Números no formato americano ("-R$ 1,458.33", "R$ 34,332.30").
//        Não traz saldo anterior nem período: saldo inicial = saldo da 1ª linha − valor dela; mês = o dos lançamentos.
//        A descrição longa quebra em duas linhas, uma acima e outra abaixo da linha do valor.
//
//   B) Extrato do app/internet banking novo (mar/2023 em diante):
//        <titular> / CPF/CNPJ: … , Instituição: Banco Inter , Agência: 0001-9 , Conta: 4677101-8
//        Período: 01/03/2023 a 31/03/2023
//        blocos por dia: "6 de Março de 2023" + linhas "Pix enviado | <descrição> | -R$ 150,00" + "Saldo do dia: R$ 16,60".
//        Em março os dias vêm do mais novo para o mais antigo e o "Saldo do dia" fica na linha do título do dia;
//        em abril/maio vêm em ordem cronológica e o "Saldo do dia" fecha o bloco. Sem saldo anterior:
//        saldo inicial = saldo do 1º dia − movimentos dele; cada "Saldo do dia" seguinte é conferido.
//
// O "Saldo total" do cabeçalho é o da hora em que o extrato foi pedido (dias depois), não o do fim do mês.
// O OFX do Inter não serve de fonte: o BALAMT é o saldo na exportação (ou zero) e o de jan/2023 veio incompleto.
// ============================================================
import { createRequire } from 'node:module';
import crypto from 'node:crypto';

const require = createRequire(import.meta.url);
let _pdfjs;
const pdfjs = () => (_pdfjs ||= require('pdfjs-dist/legacy/build/pdf.js'));

const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const limpar = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const semAcento = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const MESES = { janeiro: '01', fevereiro: '02', marco: '03', abril: '04', maio: '05', junho: '06', julho: '07', agosto: '08', setembro: '09', outubro: '10', novembro: '11', dezembro: '12' };
const ultimoDiaMes = (mes) => {
  const [a, m] = mes.split('-').map(Number);
  return `${mes}-${String(new Date(Date.UTC(a, m, 0)).getUTCDate()).padStart(2, '0')}`;
};
const dataIso = (d) => { const m = String(d).match(/(\d{2})\/(\d{2})\/(\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };
const SHOPPING_RECIFE = /SHOPPING\s*RECIFE|RECIFE\s*MALL|36\.?569\.?459/i;

// Contas conhecidas (agência|conta-dígito → titular e CNPJ)
export const CONTAS_INTER = {
  '0001|4677101-8': { titular: 'CROSBY DISTRIBUICAO E CONFECCAO LTDA', cnpj: '17177680000116' },
};

// dinheiro: BR "-R$ 1.458,33" (layout B) e americano "-R$ 1,458.33" (layout A)
const RE_BR = /^(-)?\s*R\$\s*(\d{1,3}(?:\.\d{3})*,\d{2})$/;
const RE_US = /^(-)?\s*R\$\s*(\d{1,3}(?:,\d{3})*\.\d{2})$/;
const numBr = (s) => { const m = String(s).trim().match(RE_BR); return m ? round2((m[1] ? -1 : 1) * Number(m[2].replace(/\./g, '').replace(',', '.'))) : null; };
const numUs = (s) => { const m = String(s).trim().match(RE_US); return m ? round2((m[1] ? -1 : 1) * Number(m[2].replace(/,/g, ''))) : null; };

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
      itens.push({ s, x: it.transform[4], y: it.transform[5] });
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
    if (l && Math.abs(l.y - it.y) <= tol) l.itens.push(it);
    else linhas.push({ y: it.y, itens: [it] });
  }
  for (const l of linhas) l.itens.sort((a, b) => a.x - b.x);
  return linhas;
}
const texto = (its) => limpar(its.map((i) => i.s).join(' '));

/** "PIX ENVIADO - Cp :00360305-F K FACCAO LTDA", "PIX RECEBIDO INTERNO - 00019 0038439816 FABIO AZEVEDO" ou só o nome (mar/2023). */
export function contraparteInter(tipo, descricao) {
  const d = limpar(descricao);
  let nome = null;
  let m;
  if ((m = d.match(/Cp\s*:\s*\d+\s*-\s*(.+)$/i))) nome = limpar(m[1]);
  else if ((m = d.match(/INTERNO\s*-\s*\d+\s+\d+\s+(.+)$/i))) nome = limpar(m[1]);
  else if (/^pix|^transfer|^ted/i.test(tipo || '') && /[A-Za-z]{2}/.test(d) && !/^PIX (ENVIADO|RECEBIDO)/i.test(d)) nome = d;
  return { nome: nome && /[A-Za-z]{2}/.test(nome) ? nome : null, doc: null };
}

// ─── layout A: "Extrato Conta Corrente PJ" (jan/2023) ─────────────────────────
function lerLayoutA(paginas, todoTexto) {
  const mAg = todoTexto.match(/Ag[êe]ncia:\s*(\d{4})-?(\d)?\s+Conta:\s*(\d{5,12})/);
  if (!mAg) throw new Error('Não achei "Agência: … Conta: …" no extrato do Inter.');
  const contaTudo = mAg[3];
  const mCnpj = todoTexto.match(/Cnpj:\s*(\d{14})/i);
  const mNome = todoTexto.match(/Nome:\s*(.+?)\s+Cnpj:/i);
  const rows = [];
  let antes = []; // pedaços de descrição vistos antes da linha do valor
  for (const pg of paginas) {
    for (const l of linhasDe(pg.itens)) {
      const dataIt = l.itens.find((i) => i.x < 115 && /^\d{2}\/\d{2}\/\d{4}$/.test(i.s));
      const dinheiro = l.itens.filter((i) => i.x >= 395 && numUs(i.s) != null);
      const desc = texto(l.itens.filter((i) => i.x >= 115 && i.x < 395));
      if (dataIt && dinheiro.length >= 2) {
        const partida = !desc; // a descrição ficou nas linhas de cima e de baixo
        rows.push({ pagina: pg.numero, data: dataIso(dataIt.s), descricao: partida ? limpar(antes.join(' ')) : desc, valor: numUs(dinheiro.at(-2).s), saldoInformado: numUs(dinheiro.at(-1).s), partida });
        antes = [];
        continue;
      }
      if (dataIt || dinheiro.length) continue; // linha incompleta (cabeçalho de coluna, totais)
      if (!desc || !rows.length || /^Lan[çc]amentos?$|^Os dados a seguir/i.test(texto(l.itens))) continue;
      // texto solto na coluna da descrição: continuação da linha partida anterior, senão começo da próxima
      const ult = rows.at(-1);
      if (ult.partida && !ult.fechada) { ult.descricao = limpar(`${ult.descricao} ${desc}`); ult.fechada = true; } else antes.push(desc);
    }
  }
  if (!rows.length) throw new Error('Nenhum lançamento encontrado no extrato do Inter.');
  const freq = {};
  for (const r of rows) freq[r.data.slice(0, 7)] = (freq[r.data.slice(0, 7)] || 0) + 1;
  const mesRef = Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0];
  const saldoAnterior = round2(rows[0].saldoInformado - rows[0].valor);
  const lanc = rows.map((r) => ({ pagina: r.pagina, data: r.data, tipoInter: semAcento(r.descricao).toUpperCase().match(/^PIX (ENVIADO|RECEBIDO)/)?.[0] || null, descricao: r.descricao, valor: r.valor, saldoInformado: r.saldoInformado }));
  return {
    layout: 'A',
    agencia: mAg[1],
    conta: contaTudo.slice(0, -1),
    contaDv: contaTudo.slice(-1),
    cnpj: mCnpj ? mCnpj[1] : null,
    titular: mNome ? limpar(mNome[1]) : null,
    periodo: { inicio: `${mesRef}-01`, fim: ultimoDiaMes(mesRef) },
    mesRef,
    saldoAnterior,
    lanc,
    saldoFinal: rows.at(-1).saldoInformado,
    saldosConferidos: rows.length,
  };
}

// ─── layout B: extrato por dia com "Saldo do dia" (mar/2023 em diante) ──────────
function lerLayoutB(paginas, todoTexto) {
  const mConta = todoTexto.match(/Ag[êe]ncia:\s*(\d{4})-?(\d)?\s*,\s*Conta:\s*(\d{5,12})-(\d)/);
  if (!mConta) throw new Error('Não achei "Agência: … , Conta: …" no extrato do Inter.');
  const mCnpj = todoTexto.match(/CPF\/CNPJ:\s*([\d./-]{14,18})/);
  const mPer = todoTexto.match(/Per[íi]odo:\s*(\d{2}\/\d{2}\/\d{4})\s*a\s*(\d{2}\/\d{2}\/\d{4})/);
  if (!mPer) throw new Error('Não achei o "Período: dd/mm/aaaa a dd/mm/aaaa" no extrato do Inter.');
  const periodo = { inicio: dataIso(mPer[1]), fim: dataIso(mPer[2]) };
  // titular = linha logo acima de "CPF/CNPJ:"
  let titular = null;
  const l1 = linhasDe(paginas[0].itens);
  const iCnpj = l1.findIndex((l) => /^CPF\/CNPJ:/.test(texto(l.itens)));
  if (iCnpj > 0) titular = texto(l1[iCnpj - 1].itens);

  const dias = []; // na ordem em que aparecem
  let dia = null;
  let saldoNoTitulo = false;
  let ultimaRow = null;
  for (const pg of paginas) {
    for (const l of linhasDe(pg.itens)) {
      if (l.y > 640 || l.y < 80) continue; // cabeçalho repetido em toda página e rodapé
      const t = texto(l.itens);
      if (/^Per[íi]odo:/.test(t)) continue;
      const prim = l.itens[0];
      const iSaldo = l.itens.findIndex((i) => /^Saldo do dia:?$/i.test(i.s));
      const saldoDia = iSaldo >= 0 ? numBr(l.itens.slice(iSaldo + 1).find((i) => numBr(i.s) != null)?.s) : null;
      const mDia = prim.x < 200 ? semAcento(prim.s).toLowerCase().match(/^(\d{1,2}) de ([a-z]+) de (\d{4})$/) : null;
      if (mDia && MESES[mDia[2]]) {
        dia = { data: `${mDia[3]}-${MESES[mDia[2]]}-${mDia[1].padStart(2, '0')}`, rows: [], saldoDia: null };
        dias.push(dia);
        ultimaRow = null;
        if (saldoDia != null) { dia.saldoDia = saldoDia; saldoNoTitulo = true; }
        continue;
      }
      if (iSaldo >= 0) {
        if (dia && saldoDia != null) dia.saldoDia = saldoDia;
        ultimaRow = null;
        continue;
      }
      const dinheiro = l.itens.filter((i) => i.x >= 400 && numBr(i.s) != null);
      if (prim.x < 200 && dinheiro.length) {
        if (!dia) throw new Error(`Lançamento antes do título do dia: "${t}"`);
        ultimaRow = { pagina: pg.numero, tipo: prim.s, descricao: texto(l.itens.filter((i) => i.x >= 200 && i.x < 400)), valor: numBr(dinheiro.at(-1).s) };
        dia.rows.push(ultimaRow);
        continue;
      }
      // continuação da descrição (só texto na coluna do meio)
      if (ultimaRow && l.itens.every((i) => i.x >= 200 && i.x < 400)) ultimaRow.descricao = limpar(`${ultimaRow.descricao} ${t}`);
    }
  }
  if (!dias.length) throw new Error('Nenhum dia com lançamentos no extrato do Inter.');
  // ordem cronológica: quando o "Saldo do dia" vem no título (ou os dias vêm decrescentes), o extrato está do mais novo para o mais antigo
  const decrescente = saldoNoTitulo || (dias.length > 1 && dias[0].data > dias.at(-1).data);
  if (decrescente) { dias.reverse(); for (const d of dias) d.rows.reverse(); }
  const primeiro = dias[0];
  if (primeiro.saldoDia == null) throw new Error(`O extrato do Inter não traz o "Saldo do dia" de ${primeiro.data}: não dá para saber o saldo inicial.`);
  const saldoAnterior = round2(primeiro.saldoDia - primeiro.rows.reduce((s, r) => s + r.valor, 0));
  const lanc = [];
  let conferidos = 0;
  for (const d of dias) {
    d.rows.forEach((r, i) => lanc.push({ pagina: r.pagina, data: d.data, tipoInter: r.tipo, descricao: r.descricao, valor: r.valor, saldoInformado: i === d.rows.length - 1 ? d.saldoDia : null }));
    if (d.saldoDia != null) conferidos++;
  }
  const ultimoSaldo = [...dias].reverse().find((d) => d.saldoDia != null)?.saldoDia ?? null;
  return {
    layout: 'B',
    agencia: mConta[1],
    conta: mConta[3],
    contaDv: mConta[4],
    cnpj: mCnpj ? mCnpj[1].replace(/\D/g, '') : null,
    titular,
    periodo,
    mesRef: periodo.inicio.slice(0, 7),
    saldoAnterior,
    lanc,
    saldoFinal: dias.at(-1).saldoDia != null ? dias.at(-1).saldoDia : null, // se o último dia não trouxer saldo, vale o recalculado
    ultimoSaldo,
    saldosConferidos: conferidos,
  };
}

/**
 * Lê o PDF do extrato do Banco Inter. Devolve o mesmo formato dos outros leitores.
 * @param {Buffer} buffer
 */
export async function lerExtratoInter(buffer) {
  const paginas = await paginasDo(buffer);
  const todoTexto = paginas.map((p) => linhasDe(p.itens).map((l) => texto(l.itens)).join('\n')).join('\n');
  if (!todoTexto.trim()) throw new Error('Este PDF não tem texto.');
  let r;
  if (/Institui[çc][ãa]o:\s*Banco Inter/i.test(todoTexto) && /Saldo do dia/i.test(todoTexto)) r = lerLayoutB(paginas, todoTexto);
  else if (/Extrato Conta Corrente PJ/i.test(todoTexto) && /Canais de Atendimento Inter|bancointer/i.test(todoTexto)) r = lerLayoutA(paginas, todoTexto);
  else throw new Error('Este PDF não parece ser um extrato do Banco Inter.');
  const conhecida = CONTAS_INTER[`${r.agencia}|${r.conta}-${r.contaDv}`] || null;
  const titular = conhecida?.titular || r.titular || null;
  const cnpj = r.cnpj || conhecida?.cnpj || null;
  if (SHOPPING_RECIFE.test(`${titular || ''} ${r.titular || ''} ${cnpj || ''}`)) throw new Error('Extrato da Shopping Recife: não entra em nenhum banco (regra do Yago).');

  let corrente = round2(r.saldoAnterior);
  const divergencias = [];
  const lancamentos = r.lanc.map((l, i) => {
    corrente = round2(corrente + l.valor);
    const cp = contraparteInter(l.tipoInter, l.descricao);
    const tipoUp = semAcento(l.tipoInter || '').toUpperCase();
    // layout B de março: a descrição é só o nome → histórico "Pix enviado · Fulano"; nos outros a descrição já diz "PIX ENVIADO - …"
    const historico = /^PIX (ENVIADO|RECEBIDO)/i.test(l.descricao) || !l.tipoInter ? l.descricao : limpar(`${l.tipoInter} · ${l.descricao}`);
    if (l.saldoInformado != null && Math.abs(corrente - l.saldoInformado) > 0.005) divergencias.push({ seq: i + 1, data: l.data, historico, saldoCalculado: corrente, saldoInformado: l.saldoInformado, diferenca: round2(l.saldoInformado - corrente) });
    return {
      seq: i + 1,
      pagina: l.pagina,
      data: l.data,
      dataBalancete: l.data,
      documento: null,
      historico,
      historicoBase: tipoUp || historico,
      historicoDescricao: null,
      valor: l.valor,
      natureza: l.valor < 0 ? 'D' : 'C',
      saldoInformado: l.saldoInformado,
      saldoApos: corrente,
      contraparteNome: cp.nome,
      contraparteDoc: cp.doc,
      hora: null,
    };
  });
  const foraDoMes = lancamentos.filter((l) => l.data.slice(0, 7) !== r.mesRef);
  if (foraDoMes.length) throw new Error(`Extrato do Inter com ${foraDoMes.length} lançamento(s) fora de ${r.mesRef} (ex.: ${foraDoMes[0].data}).`);
  const saldoFinal = round2(r.saldoFinal != null ? r.saldoFinal : corrente);
  const totalCreditos = round2(lancamentos.filter((l) => l.valor > 0).reduce((s, l) => s + l.valor, 0));
  const totalDebitos = round2(lancamentos.filter((l) => l.valor < 0).reduce((s, l) => s - l.valor, 0));
  return {
    banco: 'INTER',
    bancoCodigo: '077',
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
    lancamentos,
    conferencia: {
      fonte: r.layout === 'A'
        ? 'PDF Inter "Extrato Conta Corrente PJ": saldo impresso depois de cada linha; saldo inicial = saldo da 1ª linha − valor dela'
        : 'PDF Inter por dia: "Saldo do dia" impresso em cada dia; saldo inicial = saldo do 1º dia − movimentos dele',
      saldoInicial: round2(r.saldoAnterior),
      totalCreditos,
      totalDebitos,
      saldoCalculado: corrente,
      saldoFinalInformado: saldoFinal,
      diferencaFinal: round2(saldoFinal - corrente),
      saldosDiariosConferidos: r.saldosConferidos,
      divergencias,
      bate: divergencias.length === 0 && Math.abs(corrente - saldoFinal) <= 0.005,
    },
    paginas: paginas.length,
    hash: crypto.createHash('sha1').update(buffer).digest('hex'),
  };
}

export default { lerExtratoInter, contraparteInter, CONTAS_INTER };
