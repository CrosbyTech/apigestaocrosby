// ============================================================
// Extratos bancários — parsers adicionais (Fluxo de Caixa Ext / Extrato Bancário)
//
//   BNB       — "Extrato de Conta Corrente - no período" (Banco do Nordeste):
//               Titular / Agência/Conta Corrente "035 - NATAL TIROL/000069918-1" /
//               Saldo Anterior / Período; tabela Data | Histórico | Documento |
//               Valor R$ | Saldo R$ até "Detalhamento do Saldo";
//               "Nenhuma movimentação encontrada." = extrato vazio.
//   SANTANDER — "Santander Empresas": titular, Agência, Conta (dígito junto);
//               "Períodos: X a Y"; tabela Data | Histórico | Documento | Valor (R$)
//               | Saldo (R$); histórico pode quebrar em linha acima e abaixo da
//               data (bloco centrado, como a Stone); termina em "Saldo de ContaMax".
//   UNICRED   — "Coop: 60 - AG: 6012 - Conta: 68500" (último dígito = DV);
//               "Saldo em dd/mm/aaaa: R$ x" é o saldo inicial; tabela Data |
//               Lançamentos | Valor (R$) | Saldo (R$); descrição pode vir na
//               linha acima da data; termina em "Saldo no final do período"
//               (depois vêm "Lançamentos futuros", ignorados).
//   DAYCOVAL  — Dayconnect: Titular, Agência, Conta "001516580 - 0", período e
//               saldos com dígitos FRAGMENTADOS ("- R $ 71 , 24"); o extrato
//               detalhado com movimentos não veio em amostra — é lido pela
//               tabela genérica (Data … Valor … Saldo) quando existir.
//   PAGARME   — planilha .xlsx exportada do painel Pagar.me (saldo/operações):
//               Data da operação | Tipo | Id | Descrição | Id da transação |
//               Parcela | Método | Entrada bruta | Saída bruta | Taxas |
//               Entrada líquida | Saída líquida. Sem coluna de saldo.
//
// Todos devolvem o mesmo formato interno dos parsers de utils/extratosBancariosPdf.js:
//   { titular:{nome,cnpj,agencia,conta,contaDv}, periodo:{inicio,fim},
//     saldoInicial, saldoFinalInformado, lancamentos:[{pagina,data,hora,valor,
//     saldoApos,memo,descricao,documento,forma,categoria,contraparteNome,…}], avisos }
// ============================================================
import * as XLSX from 'xlsx';

const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');
const semAcento = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const limpar = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const direita = (it) => it.x + (it.w || 0);
const textoDe = (items) => limpar(items.map((i) => i.s).join(' '));
const textoColado = (items) => String(items.map((i) => i.s).join('')).replace(/\s+/g, '');
const RE_DATA4 = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const dataIso4 = (s) => {
  const m = limpar(s).match(RE_DATA4);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

export function parseNumBr(s) {
  const t = limpar(s).replace(/\s+/g, '');
  const m = t.match(/^(-)?R?\$?(-)?([\d.]*\d,\d{2})([CD])?$/i);
  if (!m) return null;
  let n = Number(m[3].replace(/\./g, '').replace(',', '.'));
  if (m[1] || m[2]) n = -n;
  if (m[4] && m[4].toUpperCase() === 'D') n = -Math.abs(n);
  return round2(n);
}
const ehNumero = (s) => parseNumBr(s) != null;

function agruparLinhas(items, tol = 2.5) {
  const ord = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const linhas = [];
  for (const it of ord) {
    const u = linhas.at(-1);
    if (u && Math.abs(u.y - it.y) <= tol) u.items.push(it);
    else linhas.push({ y: it.y, items: [it] });
  }
  for (const l of linhas) l.items.sort((a, b) => a.x - b.x);
  return linhas;
}
const achar = (items, re) => items.find((it) => re.test(limpar(it.s)));
const textoPagina = (pg) => textoDe(agruparLinhas(pg.items).flatMap((l) => l.items));

// Formas (mesmos valores de utils/extratosBancariosPdf.js)
const F = {
  PIX: 'PIX',
  TED: 'TED/DOC',
  BOLETO: 'BOLETO',
  CARTAO_CREDITO: 'CARTÃO CRÉDITO',
  CARTAO_DEBITO: 'CARTÃO DÉBITO',
  ANTECIPACAO: 'ANTECIPAÇÃO CARTÃO',
  DEBITO_AUTOMATICO: 'DÉBITO AUTOMÁTICO',
  TARIFA: 'TARIFA/ENCARGO',
  FOLHA: 'FOLHA/SALÁRIO',
  APLICACAO: 'APLICAÇÃO/RESGATE',
  EMPRESTIMO: 'EMPRÉSTIMO/LIMITE',
  DINHEIRO: 'DINHEIRO',
  TRANSFERENCIA: 'TRANSFERÊNCIA',
  OUTROS: 'OUTROS',
};

// Classificador genérico por histórico (bancos tradicionais)
export function classificarGenerico(desc, valor) {
  const up = semAcento(desc).toUpperCase().replace(/\s+/g, ' ').trim();
  const deb = valor < 0;
  const base = { contraparteNome: null, contraparteDoc: null, documento: null };
  if (/IOF|JUROS|TARIFA|TAR\b|CESTA|ENCARGO|MULTA|ANUIDADE|MANUTEN|CUSTAS|TAXA/.test(up))
    return { ...base, forma: F.TARIFA, categoria: 'tarifa', descricao: up };
  if (/\bPIX\b/.test(up)) return { ...base, forma: F.PIX, categoria: 'pix', descricao: deb ? 'PAGAMENTO PIX' : 'RECEBIMENTO PIX' };
  if (/BOLETO|TITULO|COBRANCA|CONVENIO|PAGAMENTO DE CONTA/.test(up))
    return { ...base, forma: F.BOLETO, categoria: 'boleto', descricao: deb ? 'PAGAMENTO BOLETO' : 'RECEBIMENTO BOLETO' };
  if (/\bTED\b|\bDOC\b|TRANSF/.test(up)) return { ...base, forma: F.TED, categoria: 'transferencia', descricao: deb ? 'TRANSFERÊNCIA ENVIADA' : 'TRANSFERÊNCIA RECEBIDA' };
  if (/CARTAO DE DEBITO|MAESTRO|ELECTRON|GETNET|REDE\b|CIELO|STONE/.test(up))
    return { ...base, forma: /DEBITO|MAESTRO|ELECTRON/.test(up) ? F.CARTAO_DEBITO : F.CARTAO_CREDITO, categoria: 'cartao', descricao: up };
  if (/APLIC|RESGATE|CDB|POUPANCA|FUNDO|INVEST/.test(up)) return { ...base, forma: F.APLICACAO, categoria: 'aplicacao', descricao: up };
  if (/EMPREST|FINANC|DIVIDA|ACORDO|PARCELA|CAPITAL DE GIRO|CHEQUE ESPECIAL|ADIANTAMENTO A DEPOSITANTE/.test(up))
    return { ...base, forma: F.EMPRESTIMO, categoria: 'emprestimo', descricao: up };
  if (/SALARIO|FOLHA|PRO-?LABORE/.test(up)) return { ...base, forma: F.FOLHA, categoria: 'folha', descricao: up };
  if (/SAQUE|DEPOSITO|DINHEIRO/.test(up)) return { ...base, forma: F.DINHEIRO, categoria: 'dinheiro', descricao: up };
  if (/DEBITO AUTOM|DEB AUT/.test(up)) return { ...base, forma: F.DEBITO_AUTOMATICO, categoria: 'debito_automatico', descricao: up };
  return { ...base, forma: F.OUTROS, categoria: 'outros', descricao: up };
}

// ─── tabela genérica Data | … | Valor | Saldo ─────────────────
// Lê linhas ancoradas por uma data na coluna da esquerda. Cada lançamento
// ocupa a faixa vertical entre o meio-termo com as datas vizinhas (textos
// que quebram acima/abaixo da data entram no mesmo lançamento). Valor e
// saldo são os números cujo lado direito encosta nas colunas do cabeçalho.
function lerTabela(paginas, cab, { stop, inicioPg1 }) {
  const lanc = [];
  const avisos = [];
  let parou = false;
  for (const pg of paginas) {
    if (parou) break;
    const yMin = pg.numero === 1 ? inicioPg1 : 0;
    // fim da tabela: o PRIMEIRO marcador abaixo do cabeçalho (itens do pdfjs não vêm ordenados)
    const stopIt = stop
      ? pg.items.filter((it) => it.y > yMin && stop.test(limpar(it.s))).sort((a, b) => a.y - b.y)[0] || null
      : null;
    const yMax = stopIt ? stopIt.y - 3 : pg.altura - 40;
    const corpo = pg.items.filter((it) => it.y > yMin && it.y < yMax && limpar(it.s));
    const datas = corpo.filter((it) => it.x < cab.xDesc - 5 && RE_DATA4.test(limpar(it.s))).sort((a, b) => a.y - b.y);
    datas.forEach((d, i) => {
      const topo = i === 0 ? yMin : (datas[i - 1].y + d.y) / 2;
      const base = i === datas.length - 1 ? Math.min(yMax, d.y + 40) : (d.y + datas[i + 1].y) / 2;
      const its = corpo.filter((it) => it.y >= topo && it.y < base && it !== d);
      const nums = its.filter((it) => it.x > cab.xDesc + 40 && ehNumero(it.s));
      const valorIt = nums.find((it) => Math.abs(direita(it) - cab.rValor) <= 12);
      const saldoIt = cab.rSaldo ? nums.find((it) => it !== valorIt && Math.abs(direita(it) - cab.rSaldo) <= 12) : null;
      const descIts = its.filter((it) => it !== valorIt && it !== saldoIt && it.x >= cab.xDesc - 5 && (cab.xDoc ? it.x < cab.xDoc - 5 : it.x < cab.rValor - 90) && !(/^\d{2}\/\d{2}\/\d{4}$/.test(limpar(it.s)) && it.x < cab.xDesc + 5));
      const docIts = cab.xDoc ? its.filter((it) => it !== valorIt && it !== saldoIt && it.x >= cab.xDoc - 5 && it.x < cab.rValor - 60) : [];
      const descLinhas = agruparLinhas(descIts).map((l) => textoDe(l.items)).filter(Boolean);
      const desc = descLinhas.join(' ');
      const doc = textoDe(docIts) || null;
      if (!valorIt) {
        if (desc) avisos.push(`pág. ${pg.numero} ${limpar(d.s)}: linha sem valor ("${desc}")`);
        return;
      }
      lanc.push({ pagina: pg.numero, data: dataIso4(d.s), hora: null, descricao: desc, documento: doc, valor: parseNumBr(valorIt.s), saldoApos: saldoIt ? parseNumBr(saldoIt.s) : null });
    });
    if (stopIt) parou = true;
  }
  return { lanc, avisos };
}

// cabeçalho: linha com "Data" + "Valor" (+ "Saldo", "Documento", "Histórico"/"Lançamentos")
function acharCabecalho(paginas) {
  for (const pg of paginas) {
    for (const linha of agruparLinhas(pg.items)) {
      const txt = semAcento(textoDe(linha.items)).toUpperCase();
      if (!/\bDATA\b/.test(txt) || !/VALOR/.test(txt)) continue;
      const its = linha.items;
      const data = its.find((it) => /^Data/i.test(limpar(it.s)));
      const valor = its.find((it) => /^Valor/i.test(limpar(it.s)));
      const saldo = its.find((it) => /^Saldo/i.test(limpar(it.s)));
      const doc = its.find((it) => /^Documento/i.test(limpar(it.s)));
      // descrição: primeiro item depois de "Data" (Histórico pode vir fragmentado: "Hist", "ó", "rico")
      const desc = its.filter((it) => it.x > (data?.x ?? 0) + 10 && it !== valor && it !== saldo && it !== doc).sort((a, b) => a.x - b.x)[0];
      if (!data || !valor || !desc) continue;
      // "Valor (R$)" vem fragmentado em alguns bancos: usa o último fragmento da célula
      const fragAte = (it) => {
        const seq = its.filter((o) => o.x >= it.x && o.x < it.x + 60).sort((a, b) => a.x - b.x);
        return direita(seq.at(-1));
      };
      return { pagina: pg.numero, y: linha.y, xData: data.x, xDesc: desc.x, xDoc: doc ? doc.x : null, rValor: fragAte(valor), rSaldo: saldo ? fragAte(saldo) : null };
    }
  }
  return null;
}

// ─── BNB ───────────────────────────────────────────────────────
export function interpretarBnb(paginas) {
  const p1 = paginas[0].items;
  const avisos = [];
  const l1 = agruparLinhas(p1);
  const texto = l1.map((l) => textoDe(l.items)).join('\n');
  const nome = texto.match(/Titular:\s*(.+)/i)?.[1]?.trim() || null;
  const agCc = texto.match(/Ag[êe]ncia\/Conta Corrente:\s*(\d+)\s*-\s*[^/]*\/\s*([\d-]+)/i);
  const contaDig = soDigitos(agCc?.[2]);
  const per = texto.match(/Per[íi]odo:\s*(\d{2}\/\d{2}\/\d{4})\s*at[ée]\s*(\d{2}\/\d{2}\/\d{4})/i);
  const saldoAnt = texto.match(/Saldo Anterior:\s*(-?\s*R\$\s*[\d.]+,\d{2})/i);
  const vazio = /Nenhuma movimenta[çc][ãa]o encontrada/i.test(texto);

  let lanc = [];
  if (!vazio) {
    const cab = acharCabecalho(paginas);
    if (!cab) throw new Error('BNB: cabeçalho da tabela (Data/Histórico/Documento/Valor/Saldo) não encontrado.');
    const r = lerTabela(paginas, cab, { stop: /^Detalhamento do Saldo$/i, inicioPg1: cab.y + 3 });
    lanc = r.lanc;
    avisos.push(...r.avisos);
  } else {
    avisos.push('BNB informa que não houve movimentação no período.');
  }
  const lancamentos = lanc.map((l) => ({ ...l, memo: l.descricao, ...classificarGenerico(l.descricao, l.valor), documento: l.documento }));
  return {
    titular: { nome, cnpj: null, agencia: agCc?.[1] ? String(Number(agCc[1])).padStart(4, '0') : null, conta: contaDig ? String(Number(contaDig.slice(0, -1))) : null, contaDv: contaDig ? contaDig.slice(-1) : null },
    periodo: { inicio: dataIso4(per?.[1]), fim: dataIso4(per?.[2]) },
    saldoInicial: saldoAnt ? parseNumBr(saldoAnt[1]) : null,
    saldoFinalInformado: null,
    lancamentos,
    avisos,
  };
}

// ─── SANTANDER ─────────────────────────────────────────────────
export function interpretarSantander(paginas) {
  const p1 = paginas[0].items;
  const avisos = [];
  const l1 = agruparLinhas(p1);
  const textos = l1.map((l) => textoDe(l.items));
  const texto = textos.join('\n');
  // linha do titular: a que tem "Ag" e "Conta:"; titular é o texto antes
  const linhaTit = l1.find((l) => /Conta:/i.test(textoDe(l.items)) && /Ag/i.test(textoDe(l.items)));
  const nome = linhaTit ? limpar(textoDe(linhaTit.items.filter((it) => it.x < 300))) : null;
  const agencia = texto.match(/Ag\s*[êe]?\s*ncia:\s*(\d+)/i)?.[1] || null;
  const contaDig = soDigitos(texto.match(/Conta:\s*([\d-]+)/i)?.[1]);
  const per = texto.match(/Per\s*[íi]?\s*odos?:\s*(\d{2}\/\d{2}\/\d{4})\s*a\s*(\d{2}\/\d{2}\/\d{4})/i);
  const cab = acharCabecalho(paginas);
  let lanc = [];
  if (cab) {
    // "Saldo de ContaMax" / "Saldo Dispon(ível)" fecham a tabela; o "Saldo dispon…ível para uso" do
    // cabeçalho tem "d" minúsculo e fica acima do cabeçalho, por isso a regex é sensível a maiúsculas
    const r = lerTabela(paginas, cab, { stop: /^Saldo de ContaMax$|^Saldo Dispon|^Saldo$/, inicioPg1: cab.y + 3 });
    lanc = r.lanc;
    avisos.push(...r.avisos);
  } else if (/n[ãa]o (h[áa]|existem|constam) (lan[çc]amentos|movimenta)/i.test(texto)) {
    avisos.push('Santander informa que não há lançamentos no período.');
  } else {
    throw new Error('Santander: cabeçalho da tabela (Data/Histórico/Documento/Valor/Saldo) não encontrado.');
  }
  // saldo inicial = saldo após o primeiro lançamento − valor dele
  const primeiro = lanc[0];
  const saldoInicial = primeiro && primeiro.saldoApos != null ? round2(primeiro.saldoApos - primeiro.valor) : null;
  const lancamentos = lanc.map((l) => ({ ...l, memo: l.descricao, ...classificarGenerico(l.descricao, l.valor), documento: l.documento }));
  return {
    titular: { nome, cnpj: null, agencia, conta: contaDig ? contaDig.slice(0, -1) : null, contaDv: contaDig ? contaDig.slice(-1) : null },
    periodo: { inicio: dataIso4(per?.[1]), fim: dataIso4(per?.[2]) },
    saldoInicial,
    saldoFinalInformado: null,
    lancamentos,
    avisos,
  };
}

// ─── UNICRED ───────────────────────────────────────────────────
export function interpretarUnicred(paginas) {
  const p1 = paginas[0].items;
  const avisos = [];
  const l1 = agruparLinhas(p1);
  const texto = l1.map((l) => textoDe(l.items)).join('\n');
  const coop = texto.match(/Coop:\s*(\d+)\s*-\s*AG:\s*(\d+)\s*-\s*Conta:\s*(\d+)/i);
  const contaDig = soDigitos(coop?.[3]);
  const per = texto.match(/Per[íi]odo de (\d{2}\/\d{2}\/\d{4}) a (\d{2}\/\d{2}\/\d{4})/i);
  const saldoIni = texto.match(/Saldo em (\d{2}\/\d{2}\/\d{4}):\s*(-?\s*R\$\s*[\d.]+,\d{2})/i);
  const saldoFim = texto.match(/Saldo no final do per[íi]odo\s*(-?\s*R\$\s*[\d.]+,\d{2})/i);
  // titular: "CROSBY - **.***.680/0001-**" (nome curto + CNPJ mascarado)
  const linhaTit = l1.find((l) => /\*\*\.\*\*\*\.\d{3}\/\d{4}-\*\*/.test(textoDe(l.items)));
  const nome = linhaTit ? limpar(textoDe(linhaTit.items).split(' - ')[0]) : null;

  const cab = acharCabecalho(paginas);
  let lanc = [];
  if (cab) {
    const r = lerTabela(paginas, cab, { stop: /^Saldo no final do per[íi]odo$/i, inicioPg1: cab.y + 3 });
    lanc = r.lanc;
    avisos.push(...r.avisos);
  } else if (/n[ãa]o (h[áa]|existem|constam)/i.test(texto)) {
    avisos.push('Unicred informa que não há lançamentos no período.');
  } else {
    throw new Error('Unicred: cabeçalho da tabela (Data/Lançamentos/Valor/Saldo) não encontrado.');
  }
  const lancamentos = lanc.map((l) => {
    // "IOF ( Doc.: SALDO DEV )" → documento entre parênteses
    const m = l.descricao.match(/^(.*?)\s*\(\s*Doc\.?:\s*(.*?)\s*\)\s*$/i);
    const desc = m ? m[1] : l.descricao;
    const doc = m && m[2] && m[2] !== '0' ? m[2] : l.documento;
    return { ...l, memo: l.descricao, ...classificarGenerico(desc, l.valor), documento: doc || null };
  });
  // O "Saldo em dd/mm/aaaa" do cabeçalho sai SEM o sinal quando a conta está
  // negativa (cheque especial). O saldo após o 1º lançamento é confiável:
  // saldo inicial = saldo após − valor; o valor do cabeçalho só confirma o módulo.
  const informado = saldoIni ? parseNumBr(saldoIni[2]) : null;
  const primeiro = lanc[0];
  let saldoInicial = informado;
  if (primeiro && primeiro.saldoApos != null) {
    const calc = round2(primeiro.saldoApos - primeiro.valor);
    if (informado == null || Math.abs(Math.abs(calc) - Math.abs(informado)) < 0.009) saldoInicial = calc;
    else avisos.push(`saldo inicial do cabeçalho (${informado}) difere do calculado pelo 1º lançamento (${calc}); usando o calculado.`), (saldoInicial = calc);
  }
  return {
    titular: { nome, cnpj: null, agencia: coop?.[2] || null, conta: contaDig ? contaDig.slice(0, -1) : null, contaDv: contaDig ? contaDig.slice(-1) : null },
    periodo: { inicio: dataIso4(per?.[1]), fim: dataIso4(per?.[2]) },
    saldoInicial,
    saldoFinalInformado: saldoFim ? parseNumBr(saldoFim[1]) : null,
    lancamentos,
    avisos,
  };
}

// ─── DAYCOVAL ──────────────────────────────────────────────────
export function interpretarDaycoval(paginas) {
  const p1 = paginas[0].items;
  const avisos = [];
  const l1 = agruparLinhas(p1);
  // dígitos vêm fragmentados: junta sem espaços por linha
  const colado = l1.map((l) => textoColado(l.items));
  const texto = l1.map((l) => textoDe(l.items)).join('\n');
  const idxTit = l1.findIndex((l) => /^Titular\b/i.test(textoDe(l.items)));
  const nome = idxTit >= 0 && l1[idxTit + 1] ? limpar(textoDe(l1[idxTit + 1].items.filter((it) => it.x < 280))) : null;
  const per = colado.join('\n').match(/(\d{2})\/(\d{2})\/(\d{4})[àa](\d{2})\/(\d{2})\/(\d{4})/);
  const idxAg = l1.findIndex((l) => /^Ag[êe]ncia$/i.test(textoDe(l.items)));
  const agencia = idxAg >= 0 && l1[idxAg + 1] ? soDigitos(textoDe(l1[idxAg + 1].items.filter((it) => it.x < 200))) : null;
  const idxCc = l1.findIndex((l) => /^Conta Corrente$/i.test(textoDe(l.items)) && l.items[0].x > 300);
  const contaDig = idxCc >= 0 && l1[idxCc + 1] ? soDigitos(textoColado(l1[idxCc + 1].items)) : '';
  const saldoDe = (re) => {
    const i = l1.findIndex((l) => re.test(textoDe(l.items)));
    if (i < 0) return null;
    const rot = l1[i].items[0];
    return parseNumBr(textoColado(l1[i].items.filter((it) => it !== rot && it.x > rot.x + 60)));
  };
  const saldoAnterior = saldoDe(/^Saldo anterior/i);
  const saldoAtual = saldoDe(/^Saldo atual/i);

  const cab = acharCabecalho(paginas);
  let lanc = [];
  if (cab) {
    const r = lerTabela(paginas, cab, { stop: /^Saldo Dispon|^Impress[ãa]o realizada/i, inicioPg1: cab.y + 3 });
    lanc = r.lanc;
    avisos.push(...r.avisos);
  } else {
    avisos.push('Daycoval: extrato sem tabela de lançamentos (sem movimentação no período).');
  }
  const lancamentos = lanc.map((l) => ({ ...l, memo: l.descricao, ...classificarGenerico(l.descricao, l.valor), documento: l.documento }));
  return {
    titular: { nome, cnpj: null, agencia: agencia || null, conta: contaDig ? String(Number(contaDig.slice(0, -1))) : null, contaDv: contaDig ? contaDig.slice(-1) : null },
    periodo: { inicio: per ? `${per[3]}-${per[2]}-${per[1]}` : null, fim: per ? `${per[6]}-${per[5]}-${per[4]}` : null },
    saldoInicial: saldoAnterior,
    saldoFinalInformado: saldoAtual,
    lancamentos,
    avisos,
    _texto: texto,
  };
}

// ─── PAGAR.ME (xlsx) ───────────────────────────────────────────
const numCel = (v) => {
  if (v == null || v === '' || v === '-') return 0;
  if (typeof v === 'number') return round2(v);
  const n = parseNumBr(String(v).includes(',') ? String(v) : `${String(v)},00`);
  return n ?? 0;
};
const dataCel = (v) => {
  if (v instanceof Date) return { iso: v.toISOString().slice(0, 10), hora: `${String(v.getHours()).padStart(2, '0')}:${String(v.getMinutes()).padStart(2, '0')}` };
  const m = String(v || '').match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}:\d{2}))?/);
  return m ? { iso: `${m[3]}-${m[2]}-${m[1]}`, hora: m[4] || null } : { iso: null, hora: null };
};

/**
 * @param {Buffer} buffer planilha .xlsx do painel Pagar.me
 * @param {{nomeArquivo?: string}} opts  o nome do arquivo identifica a conta
 *        (ex.: "PAGARME CROSBY SET.xlsx" → conta "CROSBY"), pois a planilha
 *        não traz recebedor/CNPJ.
 */
export function interpretarPagarme(buffer, { nomeArquivo } = {}) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const cabIdx = rows.findIndex((r) => r.some((c) => /Data da opera/i.test(String(c))));
  if (cabIdx < 0) throw new Error('Pagar.me: planilha sem a coluna "Data da operação".');
  const cab = rows[cabIdx].map((c) => semAcento(String(c)).toUpperCase().trim());
  const col = (re) => cab.findIndex((c) => re.test(c));
  const iData = col(/^DATA DA OPERA/);
  const iTipo = col(/^TIPO DA OPERA/);
  const iIdOp = col(/^ID DA OPERA/);
  const iDesc = col(/^DESCRICAO DA OPERA/);
  const iIdTx = col(/^ID DA TRANSA/);
  const iParc = col(/^PARCELA/);
  const iMetodo = col(/^METODO/);
  const iEntB = col(/^ENTRADA BRUTA/);
  const iSaiB = col(/^SAIDA BRUTA/);
  const iTaxa = col(/^TAXA TOTAL/);
  const iEntL = col(/^ENTRADA LIQUIDA/);
  const iSaiL = col(/^SAIDA LIQUIDA/);

  const avisos = [];
  const lanc = [];
  for (const r of rows.slice(cabIdx + 1)) {
    if (!r[iData]) continue;
    const { iso, hora } = dataCel(r[iData]);
    if (!iso) continue;
    const entL = numCel(r[iEntL]);
    const saiL = numCel(r[iSaiL]);
    const entB = numCel(r[iEntB]);
    const saiB = numCel(r[iSaiB]);
    const taxa = numCel(r[iTaxa]);
    const valor = round2(entL + saiL); // saída líquida já vem negativa
    if (!valor) continue;
    const tipo = limpar(r[iTipo]);
    const desc = limpar(r[iDesc]);
    const metodo = limpar(r[iMetodo]);
    const up = semAcento(`${tipo} ${desc} ${metodo}`).toUpperCase();
    let forma = F.OUTROS;
    let categoria = 'outros';
    let descricao = up;
    let bandeira = null;
    if (/ANTECIPACAO/.test(up)) {
      forma = F.ANTECIPACAO;
      categoria = 'antecipacao';
      bandeira = desc.toUpperCase();
      descricao = `ANTECIPAÇÃO ${bandeira}`;
    } else if (/\bPIX\b/.test(up)) {
      forma = F.PIX;
      categoria = 'pix';
      descricao = valor < 0 ? 'PAGAMENTO PIX' : 'RECEBIMENTO PIX (PAGAR.ME)';
    } else if (/TED|DOC/.test(up)) {
      forma = F.TED;
      categoria = 'transferencia';
      descricao = valor < 0 ? 'TRANSFERÊNCIA ENVIADA (SAQUE PAGAR.ME)' : 'TRANSFERÊNCIA RECEBIDA';
    } else if (/BOLETO/.test(up)) {
      forma = F.BOLETO;
      categoria = 'boleto';
      descricao = valor < 0 ? 'PAGAMENTO BOLETO' : 'RECEBIMENTO BOLETO';
    } else if (/CREDIT|DEBIT|CARTAO|MASTER|VISA|ELO|AMEX/.test(up) && /TRANSACAO/.test(up)) {
      forma = /DEBIT/.test(up) ? F.CARTAO_DEBITO : F.CARTAO_CREDITO;
      categoria = 'cartao';
      descricao = `VENDA CARTÃO ${desc.toUpperCase()}`;
      bandeira = metodo.toUpperCase() || null;
    } else if (/GATEWAY|TAXA|TARIFA|SERVICO|OPERACAO DE SALDO/.test(up)) {
      forma = F.TARIFA;
      categoria = 'tarifa';
      descricao = `TARIFA PAGAR.ME: ${desc.toUpperCase()}`;
    }
    const memoPartes = [`${tipo} | ${desc}${metodo && metodo !== '-' ? ` | ${metodo}` : ''}`];
    if (entB) memoPartes.push(`bruto ${entB.toFixed(2)}`);
    if (saiB) memoPartes.push(`saída bruta ${saiB.toFixed(2)}`);
    if (taxa) memoPartes.push(`taxa ${taxa.toFixed(2)}`);
    const parcela = limpar(r[iParc]);
    if (parcela && parcela !== '-') memoPartes.push(`parcela ${parcela}`);
    lanc.push({
      pagina: null,
      data: iso,
      hora,
      valor,
      saldoApos: null,
      memo: memoPartes.join(' · '),
      descricao,
      documento: String(r[iIdTx] && r[iIdTx] !== '-' ? r[iIdTx] : r[iIdOp] || '') || null,
      forma,
      categoria,
      contraparteNome: 'PAGAR.ME',
      contraparteDoc: null,
      bandeira,
    });
  }
  if (!lanc.length) avisos.push('Pagar.me: nenhuma operação com valor na planilha.');

  // a planilha não identifica o recebedor: usa o nome do arquivo ("PAGARME CROSBY SET.xlsx" → CROSBY)
  const base = semAcento(String(nomeArquivo || '').replace(/\.[^.]+$/, '')).toUpperCase();
  const token = base.replace(/PAGAR\.?ME|EXTRATO|SALDO|OPERACOES?|\b(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)[A-Z]*\b|\d{2,4}/g, ' ').trim().split(/\s+/).filter(Boolean)[0] || 'PRINCIPAL';
  const datas = lanc.map((l) => l.data).sort();
  return {
    titular: { nome: `PAGAR.ME ${token}`, cnpj: null, agencia: '', conta: token, contaDv: null },
    periodo: { inicio: datas[0] || null, fim: datas.at(-1) || null },
    saldoInicial: null,
    saldoFinalInformado: null,
    lancamentos: lanc,
    avisos,
  };
}

export const ehXlsx = (buffer) => Buffer.isBuffer(buffer) && buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;

export default { interpretarBnb, interpretarSantander, interpretarUnicred, interpretarDaycoval, interpretarPagarme, classificarGenerico, ehXlsx };
