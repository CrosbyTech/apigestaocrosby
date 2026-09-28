// ============================================================
// Extrato Stone em PDF ("Comprovante de Extrato") → lançamentos
//
// O PDF é o ÚNICO arquivo da Stone que traz o titular da conta (nome, CNPJ,
// agência, conta). O OFX não traz. Com ~10 contas Stone, é o PDF que diz de
// quem é o extrato — por isso este parser existe.
//
// Estrutura do PDF (lido com pdfjs, coordenadas em pontos):
//   Cabeçalho (só na página 1): "Dados da conta" → Nome / Documento /
//   Instituição / Agência / Conta; depois "Período: de dd/mm/aaaa a dd/mm/aaaa".
//   Tabela em todas as páginas: DATA | TIPO | DESCRIÇÃO | VALOR | SALDO | CONTRAPARTE
//   Cada lançamento é um bloco verticalmente centrado na linha da data;
//   nome/descrição/contraparte podem ocupar várias linhas acima e abaixo.
//   Ordem: do mais recente para o mais antigo. SALDO = saldo APÓS o lançamento.
//
// Saída: mesmo formato de parseOfx() (utils/ofxParaCnab240.js), para o
// classificador e o gerador CNAB 240 serem reaproveitados sem mudança,
// mais `titular` e a verificação de saldo corrente (`conferencia`).
// ============================================================
import { createRequire } from 'node:module';

const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');

// colunas (x em pontos, página A4 de 598pt de largura)
const COL = { data: 75, tipo: 120, descricao: 280, valor: 355, saldo: 425 };
const colunaDe = (x) =>
  x < COL.data ? 'data' : x < COL.tipo ? 'tipo' : x < COL.descricao ? 'descricao' : x < COL.valor ? 'valor' : x < COL.saldo ? 'saldo' : 'contraparte';

const RE_DATA = /^(\d{2})\/(\d{2})\/(\d{2})$/;
const RE_VALOR = /^(-)?\s*R\$\s*([\d.]+,\d{2})$/;

// "- R$ 36.134,12" → -36134.12
export function parseValorBr(s) {
  const m = String(s || '').trim().match(RE_VALOR);
  if (!m) return null;
  const n = Number(m[2].replace(/\./g, '').replace(',', '.'));
  return m[1] ? -n : n;
}

// "24/09/26" → "2026-09-24"
const dataIso = (s) => {
  const m = String(s || '').trim().match(RE_DATA);
  return m ? `20${m[3]}-${m[2]}-${m[1]}` : null;
};

// ─── extração bruta com pdfjs ──────────────────────────────────
let _pdfjs = null;
function pdfjs() {
  if (_pdfjs) return _pdfjs;
  const require = createRequire(import.meta.url);
  _pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
  return _pdfjs;
}

/** @returns [{ numero, largura, altura, items:[{x,y,w,s}] }] */
export async function extrairPaginasPdf(buffer) {
  const lib = pdfjs();
  const doc = await lib.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    disableFontFace: true,
    verbosity: 0,
  }).promise;
  const paginas = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const vp = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent();
      const items = tc.items
        .filter((it) => it.str && it.str.trim() !== '')
        .map((it) => ({
          x: +it.transform[4].toFixed(1),
          y: +(vp.height - it.transform[5]).toFixed(1),
          w: +(it.width || 0).toFixed(1),
          s: it.str,
        }));
      paginas.push({ numero: p, largura: vp.width, altura: vp.height, items });
      page.cleanup?.();
    }
  } finally {
    await doc.destroy?.();
  }
  return paginas;
}

// ─── interpretação (pura, testável) ────────────────────────────
// Agrupa itens de uma coluna em linhas de texto (mesma y ± 2pt)
function linhasDaColuna(items) {
  const ordenados = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const linhas = [];
  for (const it of ordenados) {
    const ult = linhas.at(-1);
    if (ult && Math.abs(ult.y - it.y) <= 2.5) {
      ult.texto += (ult.texto.endsWith(' ') || it.s.startsWith(' ') ? '' : ' ') + it.s;
    } else {
      linhas.push({ y: it.y, texto: it.s });
    }
  }
  return linhas.map((l) => l.texto.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

function lerCabecalho(pagina) {
  const items = pagina.items;
  const textoApos = (rotulo, xTol = 3) => {
    const r = items.find((it) => it.s.trim() === rotulo);
    if (!r) return null;
    // valor fica ~16pt abaixo do rótulo, mesma coluna x
    const abaixo = items
      .filter((it) => Math.abs(it.x - r.x) <= xTol && it.y > r.y && it.y - r.y < 24)
      .sort((a, b) => a.y - b.y);
    if (!abaixo.length) return null;
    const y = abaixo[0].y;
    // limite à direita: o próximo rótulo na mesma linha do rótulo atual
    // (ex.: "Agência" e "Conta" dividem a linha)
    const proximoRotulo = items
      .filter((it) => Math.abs(it.y - r.y) <= 2 && it.x > r.x + 5 && it.s.trim())
      .sort((a, b) => a.x - b.x)[0];
    const xMax = proximoRotulo ? proximoRotulo.x - 1 : r.x + 200;
    // junta fragmentos na mesma linha a partir da coluna do rótulo (o hífen do
    // CNPJ/conta some no PDF e o número vem em pedaços)
    return items
      .filter((it) => Math.abs(it.y - y) <= 2 && it.x >= r.x - 1 && it.x < xMax)
      .sort((a, b) => a.x - b.x)
      .map((it) => it.s)
      .join('')
      .trim();
  };
  const nome = textoApos('Nome');
  const documento = soDigitos(textoApos('Documento'));
  const agencia = soDigitos(textoApos('Agência'));
  const contaBruta = soDigitos(textoApos('Conta'));
  const periodo = items.map((i) => i.s).join(' ').match(/Per[íi]odo:\s*de\s*(\d{2}\/\d{2}\/\d{4})\s*a\s*(\d{2}\/\d{2}\/\d{4})/);
  const toIso = (d) => (d ? d.split('/').reverse().join('-') : null);
  return {
    nome: nome || null,
    cnpj: documento.length === 14 ? documento : documento || null,
    agencia: agencia || null,
    conta: contaBruta ? contaBruta.slice(0, -1) : null,
    contaDv: contaBruta ? contaBruta.slice(-1) : null,
    periodoInicio: toIso(periodo?.[1]),
    periodoFim: toIso(periodo?.[2]),
  };
}

// Monta o MEMO no mesmo formato do OFX para reaproveitar classificarLancamento()
export function montarMemo(linhasDescricao) {
  const ls = linhasDescricao.filter(Boolean);
  if (!ls.length) return '';
  if (ls.length === 1) return ls[0];
  const primeira = ls[0];
  if (/^Recebimento vendas$/i.test(primeira)) {
    let resto = ls.slice(1).join(' ');
    if (!/\|/.test(resto)) resto += ' | Crédito';
    return `Recebimento vendas - ${resto}`;
  }
  if (/^Mensalidade$/i.test(primeira)) return `Mensalidade - ${ls.slice(1).join(' ')}`;
  const op = ls.at(-1);
  const nome = ls.slice(0, -1).join(' ');
  return `${nome} - ${op}`;
}

/**
 * Converte páginas (itens posicionados) em lançamentos.
 * @returns { titular, lancamentos (cronológico), avisos }
 */
export function interpretarPaginas(paginas) {
  const titular = lerCabecalho(paginas[0]);
  const avisos = [];
  const linhasPdf = []; // na ordem do PDF (mais recente primeiro)

  for (const pg of paginas) {
    const items = pg.items;
    const cab = items.find((it) => it.s.trim() === 'DATA' && it.x < COL.data);
    if (!cab) continue; // página sem tabela
    const yTopo = cab.y + 4;
    const rodape = items.find((it) => /Informa[çc][õo]es do Comprovante/i.test(it.s));
    const yFundo = rodape ? rodape.y - 4 : pg.altura;

    const corpo = items.filter((it) => it.y > yTopo && it.y < yFundo);
    const datas = corpo
      .filter((it) => it.x < COL.data && RE_DATA.test(it.s.trim()))
      .sort((a, b) => a.y - b.y);
    if (!datas.length) continue;

    // limites verticais de cada lançamento: meio-termo entre datas vizinhas
    const limites = datas.map((d, i) => {
      const topo = i === 0 ? yTopo : (datas[i - 1].y + d.y) / 2;
      const base = i === datas.length - 1 ? Math.min(yFundo, d.y + 60) : (d.y + datas[i + 1].y) / 2;
      return { d, topo, base };
    });

    for (const { d, topo, base } of limites) {
      const doBloco = corpo.filter((it) => it.y >= topo && it.y < base);
      const cols = { data: [], tipo: [], descricao: [], valor: [], saldo: [], contraparte: [] };
      for (const it of doBloco) cols[colunaDe(it.x)].push(it);

      const tipo = linhasDaColuna(cols.tipo).join(' ');
      const descLinhas = linhasDaColuna(cols.descricao);
      const valorTxt = linhasDaColuna(cols.valor).join(' ');
      const saldoTxt = linhasDaColuna(cols.saldo).join(' ');
      const contraparteLinhas = linhasDaColuna(cols.contraparte);

      const valor = parseValorBr(valorTxt);
      const saldo = parseValorBr(saldoTxt);
      if (valor == null) {
        avisos.push(`pág. ${pg.numero} ${d.s}: valor não reconhecido ("${valorTxt}")`);
        continue;
      }
      // sinal: pela coluna TIPO (Entrada/Saída); o "-" do valor confirma
      const saida = /sa[íi]da/i.test(tipo) || valor < 0;
      const valorAssinado = saida ? -Math.abs(valor) : Math.abs(valor);

      // contraparte: banco + (opcional) "Ag: 0001 • Cc: 307728"
      const contaContraparte = contraparteLinhas.find((l) => /Ag:\s*\d+/i.test(l)) || null;
      const bancoContraparte = contraparteLinhas.filter((l) => l !== contaContraparte).join(' ') || null;

      linhasPdf.push({
        pagina: pg.numero,
        data: dataIso(d.s.trim()),
        tipo: saida ? 'Saída' : 'Entrada',
        descricaoLinhas: descLinhas,
        memo: montarMemo(descLinhas),
        valor: round2(valorAssinado),
        saldoApos: saldo,
        bancoContraparte,
        contaContraparte,
      });
    }
  }

  // cronológico
  const lancamentos = [...linhasPdf].reverse().map((l, i) => ({
    fitid: `PDF-${l.data}-${String(i + 1).padStart(4, '0')}`,
    tipoOfx: l.valor < 0 ? 'DEBIT' : 'CREDIT',
    data: l.data,
    hora: '000000',
    valor: l.valor,
    natureza: l.valor < 0 ? 'D' : 'C',
    memo: l.memo,
    saldoApos: l.saldoApos,
    bancoContraparte: l.bancoContraparte,
    contaContraparte: l.contaContraparte,
    pagina: l.pagina,
  }));

  // conferência do saldo corrente (valida o parsing inteiro).
  // A Stone repete o MESMO saldo em lançamentos casados (ex.: "Depósito por
  // boleto" + "Tarifa do boleto"): só o último da sequência de saldos iguais
  // reflete o acumulado, então a conferência é feita nele.
  let saldoInicial = null;
  let inconsistencias = 0;
  if (lancamentos.length && lancamentos[0].saldoApos != null) {
    // saldo inicial: a partir do fim da primeira sequência de saldos iguais
    let k = 0;
    while (k + 1 < lancamentos.length && lancamentos[k + 1].saldoApos === lancamentos[k].saldoApos) k += 1;
    const somaAteK = lancamentos.slice(0, k + 1).reduce((s, l) => s + l.valor, 0);
    saldoInicial = round2(lancamentos[k].saldoApos - somaAteK);
    let corrente = saldoInicial;
    for (let i = 0; i < lancamentos.length; i++) {
      const l = lancamentos[i];
      corrente = round2(corrente + l.valor);
      const prox = lancamentos[i + 1];
      if (prox && prox.saldoApos === l.saldoApos) continue; // confere só no fim da sequência
      if (l.saldoApos != null && Math.abs(corrente - l.saldoApos) > 0.009) {
        inconsistencias += 1;
        corrente = l.saldoApos; // ressincroniza para não propagar
      }
    }
  }
  if (inconsistencias) avisos.push(`${inconsistencias} lançamento(s) com saldo que não fecha com o anterior — confira a ordem/valores.`);

  return { titular, lancamentos, avisos, conferencia: { saldoInicial, inconsistencias } };
}

/** Buffer do PDF → extrato no formato de parseOfx() + titular + conferência */
export async function parseExtratoPdfStone(buffer) {
  const paginas = await extrairPaginasPdf(buffer);
  if (!paginas.length) throw new Error('PDF vazio ou ilegível.');
  const { titular, lancamentos, avisos, conferencia } = interpretarPaginas(paginas);
  if (!lancamentos.length) throw new Error('Nenhum lançamento encontrado no PDF. É o "Comprovante de Extrato" da Stone?');

  const totalCred = round2(lancamentos.filter((l) => l.valor > 0).reduce((s, l) => s + l.valor, 0));
  const totalDeb = round2(lancamentos.filter((l) => l.valor < 0).reduce((s, l) => s - l.valor, 0));
  const ultimo = lancamentos.at(-1);
  const saldoFinal = ultimo?.saldoApos ?? round2((conferencia.saldoInicial ?? 0) + totalCred - totalDeb);

  return {
    origem: 'pdf',
    banco: { codigo: '197', nome: 'Stone Instituição de Pagamento S.A.' },
    conta: { agencia: titular.agencia || '1', numero: titular.conta, dv: titular.contaDv, tipo: 'CHECKING' },
    moeda: 'BRL',
    periodo: {
      inicio: titular.periodoInicio || lancamentos[0].data,
      // "a 26/09/2026" no PDF é exclusivo (dia da emissão + 1), usa o último lançamento
      fim: ultimo.data,
      primeiroLancamento: lancamentos[0].data,
      ultimoLancamento: ultimo.data,
    },
    saldo: {
      final: saldoFinal,
      finalEm: ultimo.data,
      inicial: conferencia.saldoInicial ?? round2(saldoFinal - totalCred + totalDeb),
      totalCreditos: totalCred,
      totalDebitos: totalDeb,
    },
    titular: {
      nome: titular.nome,
      cnpj: titular.cnpj,
      agencia: titular.agencia,
      conta: titular.conta,
      contaDv: titular.contaDv,
    },
    conferencia,
    avisos,
    paginas: paginas.length,
    lancamentos,
  };
}

export default { parseExtratoPdfStone, interpretarPaginas, extrairPaginasPdf, montarMemo, parseValorBr };
