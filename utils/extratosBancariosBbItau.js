// ============================================================
// Extratos bancários — Banco do Brasil e Itaú (Extrato Bancário / Dr Ygor)
//
//   BB   — "Consultas - Extrato de conta corrente" (internet banking PJ):
//          "Agência 22-1" / "Conta corrente 37051-7IRMAOS C V LTDA" (nome colado
//          no número) / "Período do extrato 01 / 2025" (ou "de 01 / 07 / 2025 até
//          31 / 07 / 2025"). Linhas em texto corrido:
//            02/01/2025 0000 13128 500 BB GIRO PRONAMPE 2.228.246.000.098 1.926,10 D 2.882,28 C
//          Dt. balancete | [Dt. movimento] | Ag. origem | Lote | [cód. hist.] |
//          Histórico | [Documento] | Valor C/D | [Saldo C/D] — o saldo só aparece
//          no último lançamento do dia e o código de histórico (3 dígitos) some
//          em alguns layouts. "Saldo Anterior" abre e "S A L D O" fecha; o
//          complemento do histórico vem na linha de baixo (x ≥ 200), e no Pix
//          traz "dd/mm hh:mm <CPF/CNPJ> <nome>" (contraparte).
//
//   ITAU — três layouts:
//          (a) 2024–ago/2025: titular à esquerda, "agência 6530 / conta corrente
//              39046-4", "período: 01/01/2025 até 31/01/2025"; tabela
//              data | lançamentos | ag/origem | valor (R$) | saldo (R$); data
//              "02 / jan" (ano pelo cabeçalho "janeiro 2025"); "SALDO ANTERIOR"
//              abre; cada dia fecha com "SALDO TOTAL DISPONÍVEL DIA".
//          (b) set/2025 em diante: "NOME CNPJ xx Agência 6530 Conta 0039046-4",
//              "Lançamentos do período: 01/09/2025 até 30/09/2025"; tabela
//              Data | Lançamentos | Razão Social | CNPJ/CPF | Valor (R$) |
//              Saldo (R$), data completa, contraparte nas colunas próprias.
//          (c) "extrato mensal" (mai/2025): cabeçalho "ag 6530 cc 98073-6 mai 2025";
//              tabela data | descrição | entradas R$ | saídas R$ | saldo R$, data
//              "06/05" só na 1ª linha do dia, saída com "-" no fim ("278,33-");
//              "Apl/Res Aplic Aut Mais" e "SALDO APLIC AUT MAIS" são a aplicação
//              automática (ignorados); saldo inicial/final = "saldo em dd/mm/aa".
//          Termina em "saldo da conta corrente" / "outros lançamentos".
//
// Mesmo formato interno dos outros parsers:
//   { titular:{nome,cnpj,agencia,conta,contaDv}, periodo:{inicio,fim},
//     saldoInicial, saldoFinalInformado, lancamentos:[…], avisos }
// ============================================================
import { parseNumBr, classificarGenerico } from './extratosBancariosExtra.js';

const limpar = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const semAcento = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');
const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const textoDe = (items) => limpar(items.map((i) => i.s).join(' '));
const ultimoDia = (ano, mes) => String(new Date(ano, mes, 0).getDate()).padStart(2, '0');
const dataIso4 = (s) => {
  const m = limpar(s).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

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

const F = {
  PIX: 'PIX',
  TED: 'TED/DOC',
  BOLETO: 'BOLETO',
  CARTAO_CREDITO: 'CARTÃO CRÉDITO',
  CARTAO_DEBITO: 'CARTÃO DÉBITO',
  ANTECIPACAO: 'ANTECIPAÇÃO CARTÃO',
  TARIFA: 'TARIFA/ENCARGO',
  APLICACAO: 'APLICAÇÃO/RESGATE',
  EMPRESTIMO: 'EMPRÉSTIMO/LIMITE',
  FOLHA: 'FOLHA/SALÁRIO',
  TRANSFERENCIA: 'TRANSFERÊNCIA',
  OUTROS: 'OUTROS',
};

// ─── Banco do Brasil ───────────────────────────────────────────
const RE_BB_PREFIXO = /^(\d{2}\/\d{2}\/\d{4})\s+(?:(\d{2}\/\d{2}\/\d{4})\s+)?(\d{4})\s+(\d{5})\s+(?:(\d{3})\s+)?/;
const RE_BB_ROW = /^(\d{2}\/\d{2}\/\d{4})\s+(?:(\d{2}\/\d{2}\/\d{4})\s+)?(\d{4})\s+(\d{5})\s+(?:(\d{3})\s+)?(.*?)\s+(?:([\d.]{3,})\s+)?(-?[\d.]*\d,\d{2})\s*([CD])(?:\s+(-?[\d.]*\d,\d{2})\s*([CD]))?$/i;
const RE_BB_SALDO = /^(\d{2}\/\d{2}\/\d{4})\s+(?:(\d{2}\/\d{2}\/\d{4})\s+)?(\d{4})\s+(\d{5})\s+(?:(\d{3})\s+)?(Saldo Anterior|S A L D O)\s+(-?[\d.]*\d,\d{2})\s*([CD])(?:\s+(-?[\d.]*\d,\d{2})\s*([CD]))?$/i;

export function classificarBb(desc, valor) {
  const up = semAcento(desc).toUpperCase();
  if (/BB GIRO|PRONAMPE|BB CREDITO|CAPITAL DE GIRO|EMPRESTIMO|FINANCIAMENTO|PARC\.? OPER|ESTORNO DE DEBITO/.test(up)) return { forma: F.EMPRESTIMO, categoria: 'emprestimo', descricao: up };
  if (/SEGURO/.test(up)) return { forma: F.OUTROS, categoria: 'outros', descricao: up };
  if (/TARIFA|TAR\b|PACOTE DE SERVICOS|IOF|JUROS|ENCARGO/.test(up)) return { forma: F.TARIFA, categoria: 'tarifa', descricao: up };
  if (/\bPIX\b/.test(up)) return { forma: F.PIX, categoria: 'pix', descricao: valor < 0 ? 'PAGAMENTO PIX' : 'RECEBIMENTO PIX' };
  if (/TED|DOC\b|TRANSFER/.test(up)) return { forma: F.TED, categoria: 'transferencia', descricao: valor < 0 ? 'TRANSFERÊNCIA ENVIADA' : 'TRANSFERÊNCIA RECEBIDA' };
  if (/BOLETO|TITULO|COBRANCA|CONVENIO|PAGTO|PAGAMENTO/.test(up)) return { forma: F.BOLETO, categoria: 'boleto', descricao: valor < 0 ? 'PAGAMENTO BOLETO' : 'RECEBIMENTO BOLETO' };
  return classificarGenerico(desc, valor);
}

export function interpretarBb(paginas) {
  const avisos = [];
  const lanc = [];
  let titularNome = null;
  let agencia = null;
  let conta = null;
  let contaDv = null;
  let periodo = { inicio: null, fim: null };
  let saldoInicial = null;
  let saldoFinalInformado = null;
  let semMovimento = false;

  for (const pg of paginas) {
    for (const linha of agruparLinhas(pg.items)) {
      const txt = textoDe(linha.items);
      if (!txt) continue;
      const up = semAcento(txt).toUpperCase();
      let m;
      if ((m = txt.match(/^Ag[êe]ncia\s+(\d+)(?:-(\w))?\s*$/i))) {
        agencia = m[1].padStart(4, '0');
        continue;
      }
      if ((m = txt.match(/^Conta corrente\s+(\d+)-(\w)\s*(.*)$/i))) {
        conta = String(Number(m[1]));
        contaDv = m[2];
        titularNome = limpar(m[3]) || titularNome;
        continue;
      }
      if (/^Per[íi]odo do extrato/i.test(txt)) {
        const t = txt.replace(/\s*\/\s*/g, '/');
        if ((m = t.match(/(\d{2}\/\d{2}\/\d{4})\s*(?:a|at[ée])\s*(\d{2}\/\d{2}\/\d{4})/i))) periodo = { inicio: dataIso4(m[1]), fim: dataIso4(m[2]) };
        else if ((m = t.match(/(\d{2})\/(\d{4})\s*$/))) {
          const mes = Number(m[1]);
          const ano = Number(m[2]);
          periodo = { inicio: `${ano}-${String(mes).padStart(2, '0')}-01`, fim: `${ano}-${String(mes).padStart(2, '0')}-${ultimoDia(ano, mes)}` };
        }
        continue;
      }
      if (/A CONTA NAO FOI MOVIMENTADA/.test(up)) {
        semMovimento = true;
        continue;
      }
      if ((m = txt.match(RE_BB_SALDO))) {
        const v = parseNumBr(`${m[9] ?? m[7]}${m[10] ?? m[8]}`);
        if (/ANTERIOR/i.test(m[6])) saldoInicial = v;
        else saldoFinalInformado = v;
        continue;
      }
      if ((m = txt.match(RE_BB_ROW))) {
        const valor = parseNumBr(`${m[8]}${m[9]}`);
        const saldo = m[10] ? parseNumBr(`${m[10]}${m[11]}`) : null;
        const desc = limpar(m[6]);
        lanc.push({ pagina: pg.numero, data: dataIso4(m[1]), hora: null, memo: desc, descricao: desc, documento: m[7] || null, valor, saldoApos: saldo, lote: m[4], codHist: m[5] || null, complemento: [] });
        continue;
      }
      if (RE_BB_PREFIXO.test(txt)) {
        avisos.push(`pág. ${pg.numero}: linha não reconhecida ("${txt.slice(0, 60)}")`);
        continue;
      }
      // complemento do histórico (linha abaixo, deslocada para a direita)
      const x0 = linha.items[0]?.x ?? 0;
      if (lanc.length && x0 >= 200 && !/^(OBSERVA|Transa[çc][ãa]o efetuada|Servi[çc]o de Atendimento|Ouvidoria|Para deficientes|----|Dt\. balancete)/i.test(txt)) {
        lanc.at(-1).complemento.push(txt);
      }
    }
  }
  if (!lanc.length) avisos.push(semMovimento ? 'BB informa que a conta não foi movimentada no período.' : 'BB: nenhum lançamento reconhecido no extrato.');

  const lancamentos = lanc.map((l) => {
    const cls = classificarBb(l.descricao, l.valor);
    const comp = l.complemento.join(' | ');
    // Pix: "07/03 08:42 33592092000103 IRMAOS CR V" → hora + contraparte
    const mc = comp.match(/^(\d{2}\/\d{2})\s+(\d{2}:\d{2})\s+(\d{11}|\d{14})\s+(.+?)(?:\s*\||$)/);
    const { complemento, ...resto } = l;
    return {
      ...resto,
      ...cls,
      memo: comp ? `${l.memo} | ${comp}` : l.memo,
      documento: l.documento,
      hora: mc ? mc[2] : null,
      contraparteDoc: mc ? mc[3] : cls.contraparteDoc || null,
      contraparteNome: mc ? limpar(mc[4]) : cls.contraparteNome || null,
    };
  });
  return {
    titular: { nome: titularNome, cnpj: null, agencia, conta, contaDv },
    periodo,
    saldoInicial,
    saldoFinalInformado,
    lancamentos,
    avisos,
  };
}

// ─── Itaú ──────────────────────────────────────────────────────
const MESES = { jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12 };
const MESES_NOME = { janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6, julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12 };
const RE_ITAU_DATA = /^(\d{2})\s*\/\s*([a-z]{3})$/i;
const RE_DATA4 = /^\d{2}\/\d{2}\/\d{4}$/;
const BANDEIRA = { ELO: 'ELO', MAST: 'MASTERCARD', MASTER: 'MASTERCARD', VISA: 'VISA', AMEX: 'AMEX', HIPER: 'HIPERCARD' };

export function classificarItau(desc, valor) {
  const up = semAcento(desc).toUpperCase().replace(/#/g, '');
  const deb = valor < 0;
  const base = { contraparteNome: null, contraparteDoc: null, bandeira: null };
  let m;
  if ((m = up.match(/^REDE\s+(ELO|MAST|MASTER|VISA|AMEX|HIPER)\w*\s+(DB|CD|AT|CR)\d*/))) {
    const tipo = m[2];
    const forma = tipo === 'DB' ? F.CARTAO_DEBITO : tipo === 'AT' ? F.ANTECIPACAO : F.CARTAO_CREDITO;
    return { ...base, forma, categoria: tipo === 'AT' ? 'antecipacao' : 'cartao', bandeira: BANDEIRA[m[1]] || m[1], descricao: `REDE ${BANDEIRA[m[1]] || m[1]} ${tipo === 'DB' ? 'DÉBITO' : tipo === 'AT' ? 'ANTECIPAÇÃO' : 'CRÉDITO'}` };
  }
  if ((m = desc.match(/^PIX\s+(TRANSF|QRS|QRE|TRANSFERENCIA)\s*(.*?)\s*(\d{2}\/\d{2})?\s*$/i))) {
    const nome = limpar(m[2]) || null;
    return { ...base, forma: F.PIX, categoria: 'pix', contraparteNome: nome, descricao: deb ? 'PAGAMENTO PIX' : 'RECEBIMENTO PIX' };
  }
  if (/^SISPAG/.test(up)) {
    if (/SALARIO|FOLHA/.test(up)) return { ...base, forma: F.FOLHA, categoria: 'folha', descricao: 'FOLHA/SALÁRIOS (SISPAG)' };
    if (/PIX/.test(up)) return { ...base, forma: F.PIX, categoria: 'pix', descricao: deb ? 'PAGAMENTO PIX (SISPAG)' : 'RECEBIMENTO PIX (SISPAG)' };
    if (/PAG TIT|TITULO|BOLETO/.test(up)) return { ...base, forma: F.BOLETO, categoria: 'boleto', descricao: 'PAGAMENTO BOLETO (SISPAG)' };
    if (/FORNECEDOR/.test(up)) return { ...base, forma: F.TED, categoria: 'transferencia', descricao: deb ? 'PAGAMENTO FORNECEDOR (SISPAG)' : 'RECEBIMENTO (SISPAG)' };
    const nome = limpar(up.replace(/^SISPAG\s*/, '').replace(/\.\.\.$/, '')) || null;
    return { ...base, forma: F.TED, categoria: 'transferencia', contraparteNome: nome, descricao: deb ? 'TRANSFERÊNCIA ENVIADA (SISPAG)' : 'TRANSFERÊNCIA RECEBIDA (SISPAG)' };
  }
  if (/^SISDEB/.test(up)) return { ...base, forma: F.TARIFA, categoria: 'debito_automatico', descricao: up };
  if (/^TED\b|^DOC\b|^TEF\b|TRANSF/.test(up)) return { ...base, forma: F.TED, categoria: 'transferencia', descricao: deb ? 'TRANSFERÊNCIA ENVIADA' : 'TRANSFERÊNCIA RECEBIDA' };
  if (/DESC DP|DESC DUPL|TIT DESC|DESCONTO DE/.test(up)) return { ...base, forma: F.EMPRESTIMO, categoria: 'emprestimo', descricao: up };
  if (/REND PAGO|APLIC|RESGATE|CDB|FUNDO/.test(up)) return { ...base, forma: F.APLICACAO, categoria: 'aplicacao', descricao: up };
  if (/^IOF|JUROS|JR MORA|TAR\b|TARIFA|CUSTAS|ENCARGO|MULTA|CESTA|MANUT|SEGURO/.test(up)) return { ...base, forma: F.TARIFA, categoria: 'tarifa', descricao: up };
  if (/EMPREST|FINANC|PARC|CAPITAL DE GIRO|LIS\b|LIMITE/.test(up)) return { ...base, forma: F.EMPRESTIMO, categoria: 'emprestimo', descricao: up };
  if (/BOLETO|TITULO|COBRANCA|PAGTO|PAGAMENTO/.test(up)) return { ...base, forma: F.BOLETO, categoria: 'boleto', descricao: deb ? 'PAGAMENTO BOLETO' : 'RECEBIMENTO BOLETO' };
  return { ...base, ...classificarGenerico(up, valor) };
}

// (c) "extrato mensal"
function interpretarItauMensal(paginas) {
  const avisos = [];
  const lanc = [];
  const l1 = agruparLinhas(paginas[0].items);
  const texto1 = l1.map((l) => textoDe(l.items)).join('\n');
  const ag = texto1.match(/\bag\s+(\d+)\s+cc\s+([\d-]+)/i);
  const contaDig = soDigitos(ag?.[2]);
  const mesAno = texto1.match(/\b(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\s+(\d{4})\b/i);
  const mes = mesAno ? MESES[mesAno[1].toLowerCase()] : null;
  const ano = mesAno ? Number(mesAno[2]) : null;
  const periodo = mes && ano ? { inicio: `${ano}-${String(mes).padStart(2, '0')}-01`, fim: `${ano}-${String(mes).padStart(2, '0')}-${ultimoDia(ano, mes)}` } : { inicio: null, fim: null };
  // "saldo em 30/04/25 | saldo em 30/05/25" e, na linha seguinte, "R$ 2.990,27 | R$ 447,27"
  let saldoInicial = null;
  let saldoFinalInformado = null;
  const iSaldos = l1.findIndex((l) => /saldo em \d{2}\/\d{2}\/\d{2}/i.test(textoDe(l.items)));
  if (iSaldos >= 0) {
    const rot = l1[iSaldos].items.filter((it) => /^saldo em/i.test(limpar(it.s)));
    const vals = (l1[iSaldos + 1]?.items || []).filter((it) => parseNumBr(it.s) != null && it.x > 380);
    if (rot.length >= 2 && vals.length >= 2) {
      saldoInicial = parseNumBr(vals[0].s);
      saldoFinalInformado = parseNumBr(vals[1].s);
    }
  }
  // nome do titular: linha do bloco de endereço toda em maiúsculas (antes de "RUA/AV")
  let nome = null;
  for (let i = 0; i < l1.length; i++) {
    const t = textoDe(l1[i].items);
    if (/^(RUA|AV|AVENIDA|TRAV|R\.)\b/i.test(t) && i > 0) {
      const ant = textoDe(l1[i - 1].items);
      if (/^[A-Z][A-Z .&-]{6,}$/.test(ant)) nome = ant;
      break;
    }
  }

  let dataAtual = null;
  const numSaida = (s) => {
    const t = limpar(s);
    const m = t.match(/^([\d.]*\d,\d{2})-$/);
    return m ? -parseNumBr(m[1]) : parseNumBr(t);
  };
  for (const pg of paginas) {
    for (const linha of agruparLinhas(pg.items)) {
      const its = linha.items.filter((it) => limpar(it.s));
      if (!its.length) continue;
      const dataIt = its.find((it) => it.x >= 140 && it.x < 200 && /^\d{2}\/\d{2}$/.test(limpar(it.s)));
      if (dataIt && mes && ano) {
        const [dd, mm] = limpar(dataIt.s).split('/').map(Number);
        dataAtual = `${mm < mes ? ano + 1 : ano}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
      }
      if (!dataAtual) continue;
      const descIts = its.filter((it) => it !== dataIt && it.x >= 195 && it.x < 350 && parseNumBr(it.s) == null && !/^[\d.]*\d,\d{2}-$/.test(limpar(it.s)));
      const desc = textoDe(descIts);
      if (!desc) continue;
      // aplicação automática (sweep) e rodapé "saldo na conta corrente (1)" não são lançamentos
      if (/^(SALDO APLIC|Apl Aplic Aut|Res Aplic Aut|data$|saldo\b|na conta corrente|\(?\d\)\s*$)/i.test(desc)) continue;
      const entIt = its.find((it) => it.x >= 350 && it.x < 412 && parseNumBr(it.s) != null);
      const saiIt = its.find((it) => it.x >= 412 && it.x < 480 && numSaida(it.s) != null);
      const valor = entIt ? parseNumBr(entIt.s) : saiIt ? -Math.abs(numSaida(saiIt.s)) : null;
      if (valor == null) continue;
      lanc.push({ pagina: pg.numero, data: dataAtual, hora: null, memo: desc, descricao: desc, documento: null, valor, saldoApos: null });
    }
  }
  if (!lanc.length) avisos.push('Itaú (extrato mensal): nenhum lançamento reconhecido.');
  if (saldoInicial != null && saldoFinalInformado != null) {
    const calc = round2(saldoInicial + lanc.reduce((s, l) => s + l.valor, 0));
    if (Math.abs(calc - saldoFinalInformado) > 0.009) avisos.push(`Itaú (extrato mensal): saldo inicial + movimentos = ${calc.toFixed(2)} ≠ saldo final informado ${saldoFinalInformado.toFixed(2)} (aplicação automática não entra no extrato).`);
  }
  const lancamentos = lanc.map((l) => ({ ...l, ...classificarItau(l.descricao, l.valor), memo: l.memo }));
  return {
    titular: { nome, cnpj: null, agencia: ag ? ag[1].padStart(4, '0') : null, conta: contaDig ? String(Number(contaDig.slice(0, -1))) : null, contaDv: contaDig ? contaDig.slice(-1) : null },
    periodo,
    saldoInicial,
    saldoFinalInformado,
    lancamentos,
    avisos,
  };
}

export function interpretarItau(paginas) {
  const texto1 = agruparLinhas(paginas[0].items).map((l) => textoDe(l.items)).join('\n');
  if (/extrato\s+mensal/i.test(texto1) && /\bag\s+\d+\s+cc\s+[\d-]+/i.test(texto1)) return interpretarItauMensal(paginas);

  const avisos = [];
  const lanc = [];
  let nome = null;
  let cnpj = null;
  let agencia = null;
  let contaDig = null;
  let periodo = { inicio: null, fim: null };
  let saldoInicial = null;
  let saldoFinalInformado = null;
  let xSaldo = null; // coluna "saldo (R$)"
  let xValor = null;
  let xRazao = null; // layout (b): "Razão Social"
  let xCnpj = null; // layout (b): "CNPJ/CPF"
  let ano = null;
  let mesAtual = null;
  let parou = false;
  let aguardaCabecalhoDados = false;

  for (const pg of paginas) {
    if (parou) break;
    for (const linha of agruparLinhas(pg.items)) {
      const txt = textoDe(linha.items);
      if (!txt) continue;
      const up = semAcento(txt).toUpperCase().replace(/#/g, '');
      let m;

      // (b) "NOME CNPJ 33.592.092/0001-03 Agência 6530 Conta 0039046-4"
      if (!nome && /\bCNPJ\b/.test(up) && /AGENCIA/.test(up) && /\bCONTA\b/.test(up)) {
        const cnpjIt = linha.items.find((it) => /^CNPJ/i.test(limpar(it.s)));
        nome = limpar(linha.items.filter((it) => cnpjIt && it.x < cnpjIt.x).map((it) => it.s).join(' ')) || null;
        const doc = txt.match(/(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|\d{3}\.\d{3}\.\d{3}-\d{2})/);
        if (doc) cnpj = soDigitos(doc[1]);
        const ag = txt.match(/Ag[êe]ncia\s+(\d+)/i);
        const cc = txt.match(/Conta\s+([\d-]+)/i);
        if (ag) agencia = ag[1].padStart(4, '0');
        if (cc) contaDig = soDigitos(cc[1]);
        continue;
      }
      // (a) cabeçalho do titular: "NOME … agência conta corrente" e, na linha seguinte, "CNPJ ag conta"
      if (/AGENCIA/.test(up) && /CONTA CORRENTE/.test(up) && !nome) {
        nome = limpar(linha.items.filter((it) => it.x < 250).map((it) => it.s).join(' ')) || null;
        aguardaCabecalhoDados = true;
        continue;
      }
      if (aguardaCabecalhoDados) {
        aguardaCabecalhoDados = false;
        const doc = txt.match(/(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|\d{3}\.\d{3}\.\d{3}-\d{2})/);
        if (doc) cnpj = soDigitos(doc[1]);
        const resto = txt.replace(doc?.[1] || '', '').trim();
        const ag = resto.match(/(\d{3,5})\s+(\d{3,}-?\w)/);
        if (ag) {
          agencia = ag[1].padStart(4, '0');
          contaDig = soDigitos(ag[2]);
        }
        continue;
      }
      if ((m = txt.match(/per[íi]odo:?\s*(\d{2}\/\d{2}\/\d{4})\s*(?:at[ée]|a)\s*(\d{2}\/\d{2}\/\d{4})/i))) {
        periodo = { inicio: dataIso4(m[1]), fim: dataIso4(m[2]) };
        ano = ano || Number(m[1].slice(-4));
        continue;
      }
      if (/^DATA\b/.test(up) && /LANCAMENTOS/.test(up) && /VALOR/.test(up)) {
        const s = linha.items.find((it) => /^saldo/i.test(limpar(it.s)));
        const v = linha.items.find((it) => /^valor/i.test(limpar(it.s)));
        const r = linha.items.find((it) => /^raz[ãa]o/i.test(limpar(it.s)));
        const c = linha.items.find((it) => /^CNPJ/i.test(limpar(it.s)));
        if (s) xSaldo = s.x;
        if (v) xValor = v.x;
        if (r) xRazao = r.x;
        if (c) xCnpj = c.x;
        continue;
      }
      if (/^SALDO DA CONTA CORRENTE|^OUTROS LANCAMENTOS|^LANCAMENTOS PARA O DIA|^LANCAMENTOS FUTUROS/.test(up)) {
        parou = true;
        break;
      }
      if ((m = up.match(/^([A-Z]+)\s+(\d{4})$/)) && MESES_NOME[m[1]]) {
        mesAtual = MESES_NOME[m[1]];
        ano = Number(m[2]);
        continue;
      }

      const primeiro = limpar(linha.items[0].s);
      let data = null;
      const md = primeiro.match(RE_ITAU_DATA);
      if (md) {
        const dia = Number(md[1]);
        const mes = MESES[md[2].toLowerCase()];
        if (!mes) continue;
        let anoLanc = ano || Number(periodo.inicio?.slice(0, 4)) || new Date().getFullYear();
        if (periodo.inicio && mesAtual == null && mes < Number(periodo.inicio.slice(5, 7))) anoLanc += 1;
        data = `${anoLanc}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
      } else if (RE_DATA4.test(primeiro)) {
        data = dataIso4(primeiro);
      } else continue;

      const x0 = linha.items[0].x;
      const limDesc = xRazao ? xRazao - 5 : xSaldo ? xSaldo - 150 : 320;
      const desc = limpar(linha.items.filter((it) => it.x > x0 + 30 && it.x < limDesc && parseNumBr(it.s) == null).map((it) => it.s).join(' '));
      const razao = xRazao ? limpar(linha.items.filter((it) => it.x >= xRazao - 5 && it.x < (xCnpj ? xCnpj - 5 : (xValor || 460) - 10)).map((it) => it.s).join(' ')) : '';
      const cnpjIt = xCnpj ? linha.items.find((it) => it.x >= xCnpj - 5 && it.x < (xValor || 460) - 10 && /\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|\d{3}\.\d{3}\.\d{3}-\d{2}/.test(it.s)) : null;
      const nums = linha.items.filter((it) => it.x > (xValor ? xValor - 40 : 300) && parseNumBr(it.s) != null);
      const saldoIt = nums.find((it) => xSaldo != null && it.x >= xSaldo - 15) || (nums.length === 2 ? nums[1] : null);
      const valorIt = nums.find((it) => it !== saldoIt);
      const upDesc = semAcento(desc).toUpperCase().replace(/#/g, '');

      if (/^SALDO ANTERIOR/.test(upDesc)) {
        const v = parseNumBr((saldoIt || valorIt)?.s);
        if (v != null) saldoInicial = v;
        continue;
      }
      if (/^SALDO (TOTAL )?DISPON.?VEL( DIA)?$|^SALDO DO DIA|^SALDO FINAL/.test(upDesc)) {
        const v = parseNumBr((saldoIt || valorIt)?.s);
        if (v != null) {
          const u = lanc.at(-1);
          if (u && u.saldoApos == null) u.saldoApos = v;
          saldoFinalInformado = v;
        }
        continue;
      }
      if (!valorIt) {
        avisos.push(`pág. ${pg.numero} ${primeiro}: linha sem valor ("${desc}")`);
        continue;
      }
      lanc.push({ pagina: pg.numero, data, hora: null, memo: desc, descricao: desc, documento: null, valor: parseNumBr(valorIt.s), saldoApos: saldoIt && saldoIt !== valorIt ? parseNumBr(saldoIt.s) : null, razao: razao || null, cnpjCol: cnpjIt ? soDigitos(cnpjIt.s) : null });
    }
  }
  if (!lanc.length) avisos.push('Itaú: nenhum lançamento reconhecido no extrato.');

  const lancamentos = lanc.map((l) => {
    const cls = classificarItau(l.descricao, l.valor);
    const { razao, cnpjCol, ...resto } = l;
    return { ...resto, ...cls, memo: razao ? `${l.memo} | ${razao}` : l.memo, contraparteNome: razao || cls.contraparteNome || null, contraparteDoc: cnpjCol || cls.contraparteDoc || null };
  });
  return {
    titular: { nome, cnpj, agencia, conta: contaDig ? String(Number(contaDig.slice(0, -1))) : null, contaDv: contaDig ? contaDig.slice(-1) : null },
    periodo,
    saldoInicial,
    saldoFinalInformado,
    lancamentos,
    avisos,
  };
}

export default { interpretarBb, interpretarItau };
