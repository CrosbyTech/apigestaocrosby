// ============================================================
// Extrato da Caixa em PDF COM TEXTO (2025+) — leitor.
// ------------------------------------------------------------
// Em 2024 o PDF do Gerenciador CAIXA era desenho sem texto (só o OFX servia). Em 2025 vieram quatro
// layouts de PDF com texto, todos com a mesma informação por linha: data, documento, histórico,
// valor e SALDO APÓS a linha — então o saldo de cada linha confere a leitura.
//   A) "Lançamentos de 01/04/2025 à 30/04/2025" (abr–jun): Data de lançamento | Data de movimento |
//      Documento | Histórico | Valor ("- 0,40", "1.000,00") | Saldo ("R$ 1.568,67" — SEM SINAL: conta no
//      cheque especial aparece positiva, como no PDF de 2024 → o sinal vem do recálculo); linhas "SALDO DIA";
//      sem "saldo anterior" → saldo inicial = saldo da 1ª linha − valor dela. Histórico comprido quebra em
//      3 linhas (metade em cima, documento+valor no meio, metade embaixo) e valor negativo pode vir como
//      "-" numa linha e "11.322,45" noutra. Entra no 1º dia útil do mês seguinte → cortado.
//   B) "Extrato no período de 01/08/2025 à 31/08/2025" (ago–out, app): Data processamento | Histórico |
//      Documento | "0,20 D" | "7.528,34 D" (D = devedor/negativo, C = credor), hora na linha de baixo,
//      "= Saldo do Dia". ATENÇÃO: a data é a de PROCESSAMENTO, então um lançamento do fim do mês pode só
//      aparecer no PDF do mês seguinte (28/10 TAR EXT EL da Crosby) → o saldo da última linha não é o do
//      fim do mês; para fechar o mês vale o OFX.
//   B2) mesmo app em novembro: "Saldo anterior ao período solicitado R$ 9.916,05 D" no cabeçalho; a DATA fica
//      numa linha só dela em cima, a linha de baixo começa pelo documento ("000000 DEBITO DE IOF - R$ 43,23
//      R$ 9.959,28 D") e embaixo vem "04/11 02:35" (data efetiva); o "R" e o "$" podem vir separados.
//   C) "Extrato por período" do Gerenciador (jul, set): "Conta: 2044 | 1292 | 000578136386-2", "Mês: Julho/2025",
//      1ª linha "SALDO ANTERIOR 0,00 1.188,34 C", linhas "01/07/2025 011423 DP DIN LOT 1.000,00 C 2.188,34 C",
//      "SALDO DIA"; pode entrar no 1º dia útil do mês seguinte (01/09 no de agosto) → cortado no fim do mês.
// Códigos de histórico ("DP DIN LOT", "DEB PIX CH"…) são os mesmos do OFX → mesma tabela de descrições.
// ============================================================
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { CONTAS_CAIXA, HISTORICOS_CAIXA } from './extratoCaixaOfx.js';

const require = createRequire(import.meta.url);
let _pdfjs;
const pdfjs = () => (_pdfjs ||= require('pdfjs-dist/legacy/build/pdf.js'));

const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const limpar = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const MESES = { janeiro: '01', fevereiro: '02', março: '03', marco: '03', abril: '04', maio: '05', junho: '06', julho: '07', agosto: '08', setembro: '09', outubro: '10', novembro: '11', dezembro: '12' };
const ultimoDiaMes = (mes) => {
  const [a, m] = mes.split('-').map(Number);
  return `${mes}-${String(new Date(Date.UTC(a, m, 0)).getUTCDate()).padStart(2, '0')}`;
};
const dataIso = (d) => { const m = String(d).match(/(\d{2})\/(\d{2})\/(\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };
// dinheiro no texto da linha: "- R$ 1.234,56", "R $ 9.916,05 D", "1.234,56 C", "- 0,40", "0,00"
const RE_DINHEIRO_G = /(-\s*)?(?:R\s*\$\s*)?(-\s*)?(\d{1,3}(?:\.\d{3})*,\d{2})(\s*[CD]\b)?/g;
const dinheiros = (texto) => {
  const out = [];
  for (const m of texto.matchAll(RE_DINHEIRO_G)) {
    // "0,00" de "SALDO DIA 0,00" conta; números inteiros (documento) não casam porque exigem ",dd"
    const v = Number(m[3].replace(/\./g, '').replace(',', '.'));
    const neg = !!(m[1] || m[2] || (m[4] && /D/i.test(m[4])));
    out.push({ v: neg ? -v : v, texto: m[0], inicio: m.index, fim: m.index + m[0].length, comSinal: !!(m[1] || m[2] || m[4]) });
  }
  return out;
};
const RE_DATA_INI = /^(\d{2}\/\d{2}\/\d{4})\b/;
const RE_HORA = /^\d{2}:\d{2}(:\d{2})?$/;
const RE_DATA_HORA = /^\d{2}\/\d{2}\s+\d{2}:\d{2}$/; // "04/11 02:35" (data efetiva, layout B2)
const RE_NUM = /^\d+$/;
// linhas que nunca são lançamento nem pedaço de histórico
const RE_LIXO = /^(Data\b|Documento|lançamento|mo v imento|movimento|Hist[óo]rico|Valor|Saldo\b|SAC CAIXA|Ouvidoria|0800|Pessoas com|Al[ôo] CAIXA|about:blank|https?:|Extrato|Ag[êe]ncia|CNPJ|Conta:|Cliente|M[êe]s:|Per[íi]odo|Data:|Ger|G_eren|\*\s*\d+|Nr\. Doc|Lan[çc]amentos de|Emitido)/i;
const RE_MES_ANO = /^[A-Za-zç]+\s*\/?\s*\d{4}$/;

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
    if (l && Math.abs(l.yUlt - it.y) <= tol) { l.itens.push(it); l.yUlt = it.y; } else linhas.push({ y: it.y, yUlt: it.y, itens: [it] });
  }
  for (const l of linhas) l.itens.sort((a, b) => a.x - b.x);
  return linhas;
}
const texto = (its) => limpar(its.map((i) => i.s).join(' '));

/** "1 TAR EXT EL" / "TAR EXT EL 000001" / "000000 DEBITO DE IOF" → documento + histórico. */
function docEHistorico(tokens) {
  let documento = null;
  const t = [...tokens];
  if (t.length && RE_NUM.test(t[0])) documento = t.shift();
  else if (t.length && RE_NUM.test(t.at(-1))) documento = t.pop();
  return { documento, historico: limpar(t.join(' ')) };
}

/**
 * Lê o PDF (com texto) do extrato da Caixa. Devolve o mesmo formato dos outros leitores.
 * @param {Buffer} buffer
 */
export async function lerExtratoCaixaPdf(buffer) {
  const paginas = await paginasDo(buffer);
  const todas = paginas.flatMap((p) => linhasDe(p.itens).map((l) => ({ ...l, pagina: p.numero })));
  const todoTexto = todas.map((l) => texto(l.itens)).join('\n');
  if (!todoTexto.trim()) throw new Error('Este PDF não tem texto (o Gerenciador CAIXA de 2024 gera só imagem): use o OFX do mesmo mês.');
  if (!/CAIXA|Ag[êe]ncia:\s*0?2044|Conta:\s*0?2044|000578136/i.test(todoTexto)) throw new Error('Este PDF não parece ser um extrato da Caixa.');

  // ── cabeçalho ──
  const mConta = todoTexto.match(/Conta:\s*(\d{6,12})-(\d)/) || todoTexto.match(/Conta:\s*\d{3,5}\s*\|\s*\d{3,5}\s*\|\s*(\d{6,12})-(\d)/);
  if (!mConta) throw new Error('Não achei o número da conta ("Conta: 000578136386-2").');
  const conta = mConta[1].padStart(12, '0');
  const contaDv = mConta[2];
  const mAg = todoTexto.match(/Ag[êe]ncia:\s*(\d{3,5})/) || todoTexto.match(/Conta:\s*(\d{3,5})\s*\|/);
  const agencia = mAg ? mAg[1].padStart(5, '0') : null;
  const conhecida = CONTAS_CAIXA[`${conta}${contaDv}`] || null;
  const mCli = todoTexto.match(/Cliente:\s*(.+)/);
  const titular = limpar(mCli?.[1] || '') || conhecida?.titular || limpar(texto(todas[0]?.itens || []).replace(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}\s*/, '')) || null;
  const mCnpj = todoTexto.match(/CNPJ:\s*([\d./-]{14,18})/);
  const titularCnpj = mCnpj ? mCnpj[1].replace(/\D/g, '') : conhecida?.cnpj || null;
  let periodo = null;
  let layout = null;
  let m;
  if ((m = todoTexto.match(/Lan[çc]amentos de (\d{2}\/\d{2}\/\d{4}) [àa] (\d{2}\/\d{2}\/\d{4})/))) { periodo = { inicio: dataIso(m[1]), fim: dataIso(m[2]) }; layout = 'lancamentos'; }
  else if ((m = todoTexto.match(/Extrato no per[íi]odo de (\d{2}\/\d{2}\/\d{4}) [àa] (\d{2}\/\d{2}\/\d{4})/))) { periodo = { inicio: dataIso(m[1]), fim: dataIso(m[2]) }; layout = /Saldo anterior ao per[íi]odo/i.test(todoTexto) ? 'periodo-b2' : 'periodo'; }
  else if ((m = todoTexto.match(/M[êe]s:\s*([A-Za-zç]+)\s*\/\s*(\d{4})/)) && MESES[m[1].toLowerCase()]) {
    const mes = `${m[2]}-${MESES[m[1].toLowerCase()]}`;
    const mp = todoTexto.match(/Per[íi]odo:\s*(\d{1,2})\s*-\s*(\d{1,2})/);
    periodo = { inicio: `${mes}-${String(mp ? mp[1] : 1).padStart(2, '0')}`, fim: mp ? `${mes}-${String(mp[2]).padStart(2, '0')}` : ultimoDiaMes(mes) };
    layout = 'gerenciador';
  }
  if (!periodo) throw new Error('Não achei o período ("Lançamentos de … à …", "Extrato no período de …" ou "Mês: Julho/2025").');
  const mesRef = periodo.inicio.slice(0, 7);
  const saldoSemSinal = layout === 'lancamentos'; // layout A: coluna Saldo sem sinal

  // ── linhas → lançamentos (com junção dos pedaços em linhas vizinhas) ──
  const rows = [];
  let saldoAnterior = null;
  const saldosDia = [];
  let antesTexto = []; // pedaços de histórico vistos antes da próxima linha de lançamento
  let antesValor = []; // pedaços de valor ("-" ou "11.322,45") idem
  let dataPendente = null; // layout B2: data numa linha só dela (vale para as linhas seguintes até aparecer outra data)
  let nomePendente = null; // layout B2: nome da contraparte que vem na mesma linha da data
  const RE_CNPJ_CPF = /\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|\d{3}\.\d{3}\.\d{3}-\d{2}/;
  const ehPedacoTexto = (t) => /^[A-Z0-9][A-Z0-9 .\/-]{1,40}$/.test(t) && !RE_LIXO.test(t) && !RE_MES_ANO.test(t) && !RE_HORA.test(t) && !/\d{2}\/\d{2}\/\d{4}/.test(t) && !RE_CNPJ_CPF.test(t) && !dinheiros(t).length;
  for (const l of todas) {
    let t = texto(l.itens);
    if (!t) continue;
    const money = dinheiros(t);
    if (/Saldo do Dia/i.test(t) || /\bSALDO DIA\b/.test(t)) { if (money.length) saldosDia.push({ data: dataIso(t) || dataPendente, saldo: money.at(-1).v }); antesTexto = []; antesValor = []; dataPendente = null; continue; }
    if (/SALDO ANTERIOR/i.test(t) && money.length) { saldoAnterior = money.at(-1).v; antesTexto = []; antesValor = []; continue; }
    if (/Saldo anterior ao per/i.test(t)) { if (money.length) saldoAnterior = money.at(-1).v; continue; }
    const mData = t.match(RE_DATA_INI);
    const mDataQualquer = t.match(/\b\d{2}\/\d{2}\/\d{4}\b/);
    const semMoney = t.replace(RE_DINHEIRO_G, ' ');
    const corpo = limpar(semMoney.replace(/\d{2}\/\d{2}\/\d{4}/g, ' '));
    const comecaPorDoc = RE_NUM.test(corpo.split(' ')[0] || '');
    const ehHora = /^\d{2}\/\d{2}\s+\d{2}:\d{2}/.test(t); // "04/11 02:35 …" nunca é lançamento (B2)
    const ehLancamento = money.length && !ehHora && (mData || (dataPendente && (comecaPorDoc || corpo)));
    const destinoValor = () => (rows.at(-1)?.aberta && rows.at(-1).valor == null && !rows.at(-1).valorFechado ? rows.at(-1).valorPartes : antesValor);
    if (!ehLancamento) {
      if (RE_HORA.test(t)) continue;
      if (/^\d{2}\/\d{2}\s+\d{2}:\d{2}/.test(t)) {
        // "04/11 02:35 [R$ 1.435,88] [03.730.204/0001-76]": data efetiva; pedaço de valor vai para a linha aberta; CNPJ/CPF é da contraparte dela
        for (const mo of money) destinoValor().push(mo.texto);
        if (/(^|\s)-(\s|$)/.test(semMoney)) destinoValor().push('-');
        const doc = t.match(RE_CNPJ_CPF);
        if (doc && rows.at(-1)) rows.at(-1).contraparteDoc = doc[0].replace(/\D/g, '');
        continue;
      }
      if (mDataQualquer && !money.length) {
        // data numa linha só dela (B2), às vezes com "-" do valor e/ou o nome da contraparte ("28/11/2025 CAIXA VIDA E PREVIDENCIA S/A")
        dataPendente = dataIso(mDataQualquer[0]);
        if (/(^|\s)-(\s|$)/.test(corpo)) antesValor.push('-');
        const nome = limpar(corpo.replace(/(^|\s)-(\s|$)/g, ' '));
        if (nome && !RE_LIXO.test(nome) && !RE_MES_ANO.test(nome)) nomePendente = nome;
        continue;
      }
      if (RE_LIXO.test(t) || RE_MES_ANO.test(t)) continue;
      if (RE_CNPJ_CPF.test(t) && !corpo.replace(RE_CNPJ_CPF, '').trim()) { if (rows.at(-1)) rows.at(-1).contraparteDoc = t.match(RE_CNPJ_CPF)[0].replace(/\D/g, ''); continue; }
      const ult = rows.at(-1);
      if (money.length === 1 && !corpo && ult?.aberta && ult.valor == null) { ult.valorPartes.push(money[0].texto); ult.valorFechado = true; }
      else if (money.length === 1 && !corpo) antesValor.push(money[0].texto);
      else if (t === '-' && ult?.aberta && ult.valor == null && !ult.valorFechado) ult.valorPartes.push('-');
      else if (t === '-') antesValor.push('-');
      else if (ehPedacoTexto(t) && ult?.aberta && !ult.historicoInline && !ult.histDepois.length) ult.histDepois.push(t);
      else if (ehPedacoTexto(t)) antesTexto.push(t);
      if (ult && (ult.valor != null || ult.valorFechado) && (ult.historicoInline || ult.histDepois.length)) ult.aberta = false;
      continue;
    }
    // linha de lançamento: saldo = último dinheiro; valor = penúltimo (se houver); o resto = documento + histórico
    const saldoTok = money.at(-1);
    const valorTok = money.length >= 2 ? money.at(-2) : null;
    const { documento, historico } = docEHistorico(corpo.split(' ').filter(Boolean));
    const row = {
      pagina: l.pagina,
      data: mData ? dataIso(mData[1]) : dataPendente,
      documento,
      historicoInline: historico,
      histAntes: antesTexto,
      histDepois: [],
      valor: valorTok ? valorTok.v : null,
      valorPartes: valorTok ? [] : antesValor,
      valorFechado: false,
      saldoInformado: saldoTok.v,
      contraparteNome: nomePendente,
      contraparteDoc: null,
    };
    row.aberta = row.valor == null || !row.historicoInline;
    rows.push(row);
    antesTexto = []; antesValor = []; nomePendente = null; // a data pendente continua valendo para a próxima linha sem data (B2)
  }
  const lanc = [];
  for (const r of rows) {
    let valor = r.valor;
    if (valor == null) { const ds = dinheiros(r.valorPartes.join(' ')); valor = ds.length ? ds[0].v : null; }
    if (valor == null) throw new Error(`Linha de ${r.data} sem valor: "${[r.documento, r.historicoInline].filter(Boolean).join(' ')}" (saldo ${r.saldoInformado}).`);
    const historico = limpar([...r.histAntes, r.historicoInline, ...r.histDepois].filter(Boolean).join(' ')) || 'LANÇAMENTO';
    lanc.push({ pagina: r.pagina, data: r.data, documento: r.documento && !/^0+$/.test(r.documento) && r.documento !== '1' ? r.documento : null, historico, historicoBase: historico, historicoDescricao: HISTORICOS_CAIXA[historico] || null, valor: round2(valor), saldoInformado: round2(r.saldoInformado), contraparteNome: r.contraparteNome || null, contraparteDoc: r.contraparteDoc || null, hora: null });
  }
  if (!lanc.length && saldoAnterior == null) throw new Error('Nenhum lançamento e nenhum "SALDO ANTERIOR" no PDF da Caixa.');
  // saldo inicial: "SALDO ANTERIOR" (C e B2) ou saldo da 1ª linha − valor dela (A e B)
  const saldoInicial = saldoAnterior != null ? round2(saldoAnterior) : round2(lanc[0].saldoInformado - lanc[0].valor);
  // o extrato pode entrar no 1º dia útil do mês seguinte: fica só o que é do período
  const foraDoMes = lanc.filter((x) => x.data > periodo.fim);
  const dentro = lanc.filter((x) => x.data <= periodo.fim);
  let corrente = saldoInicial;
  const divergencias = [];
  dentro.forEach((x, i) => {
    corrente = round2(corrente + x.valor);
    x.seq = i + 1;
    x.saldoApos = corrente;
    x.dataBalancete = x.data;
    x.natureza = x.valor < 0 ? 'D' : 'C';
    if (saldoSemSinal && Math.abs(Math.abs(corrente) - Math.abs(x.saldoInformado)) <= 0.005) x.saldoInformado = corrente; // layout A: sinal vem do recálculo
    if (Math.abs(x.saldoApos - x.saldoInformado) > 0.005) divergencias.push({ seq: x.seq, data: x.data, historico: x.historico, saldoCalculado: x.saldoApos, saldoInformado: x.saldoInformado, diferenca: round2(x.saldoInformado - x.saldoApos) });
  });
  const saldoFinal = dentro.length ? dentro.at(-1).saldoInformado : saldoInicial;
  const totalCreditos = round2(dentro.filter((x) => x.valor > 0).reduce((s, x) => s + x.valor, 0));
  const totalDebitos = round2(dentro.filter((x) => x.valor < 0).reduce((s, x) => s - x.valor, 0));
  return {
    banco: 'CAIXA',
    bancoCodigo: '104',
    formato: 'pdf',
    layout,
    agencia,
    conta,
    contaDv,
    titular,
    titularCnpj,
    mesReferencia: mesRef,
    periodo,
    saldoInicial,
    saldoFinal,
    lancamentos: dentro,
    descartadosForaDoMes: foraDoMes.length,
    saldosDia,
    conferencia: {
      fonte: `PDF Caixa (${layout}): saldo após cada linha; ${saldoAnterior != null ? '"saldo anterior" do extrato' : 'saldo inicial = saldo da 1ª linha − valor dela'}${saldoSemSinal ? '; coluna Saldo sem sinal, sinal pelo recálculo' : ''}`,
      saldoInicial,
      totalCreditos,
      totalDebitos,
      saldoCalculado: corrente,
      saldoFinalInformado: saldoFinal,
      diferencaFinal: round2(saldoFinal - corrente),
      saldosDiariosConferidos: dentro.length,
      divergencias,
      bate: divergencias.length === 0 && Math.abs(corrente - saldoFinal) <= 0.005,
    },
    paginas: paginas.length,
    hash: crypto.createHash('sha1').update(buffer).digest('hex'),
  };
}

export default { lerExtratoCaixaPdf };
