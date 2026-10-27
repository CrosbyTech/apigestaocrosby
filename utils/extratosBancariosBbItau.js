// ============================================================
// Extratos bancários — Banco do Brasil e Itaú (Extrato Bancário / Dr Ygor)
//
//   BB   — "Consultas - Extrato de conta corrente" (internet banking PJ):
//          "Agência 22-1" / "Conta corrente 37051-7IRMAOS C V LTDA" (nome colado
//          no número) / "Período do extrato 01 / 2025". Linhas:
//          Dt. balancete | Dt. movimento | Ag. origem | Lote | Histórico |
//          Documento | Valor R$ | Saldo — tudo em texto corrido:
//            02/01/2025 0000 13128 500 BB GIRO PRONAMPE 2.228.246.000.098 1.926,10 D 2.882,28 C
//          valor e saldo com sufixo C/D; "Saldo Anterior" abre e "S A L D O"
//          fecha; texto complementar do histórico vem na linha de baixo
//          (x ≥ 240). "*** A CONTA NAO FOI MOVIMENTADA ***" = sem lançamentos.
//
//   ITAU — extrato PJ do app/site: titular à esquerda, "agência 6530" /
//          "conta corrente 39046-4", "período: 01/01/2025 até 31/01/2025".
//          Tabela data | lançamentos | ag/origem | valor (R$) | saldo (R$):
//          a data vem como "02 / jan" (ano pelo cabeçalho "janeiro 2025" ou
//          pelo período); "SALDO ANTERIOR" (31 / dez) abre; cada dia fecha com
//          "SALDO TOTAL DISPONÍVEL DIA" (saldo do último lançamento do dia);
//          valores negativos com "-"; fonte troca acentos por "#"
//          ("DISPON#VEL"). Termina em "saldo da conta corrente" /
//          "outros lançamentos" (lançamentos futuros, ignorados).
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
  TRANSFERENCIA: 'TRANSFERÊNCIA',
  OUTROS: 'OUTROS',
};

// ─── Banco do Brasil ───────────────────────────────────────────
const RE_BB_ROW = /^(\d{2}\/\d{2}\/\d{4})\s+(?:(\d{2}\/\d{2}\/\d{4})\s+)?(\d{4})\s+(\d{5})\s+(\d{3})\s+(.*?)\s+(?:([\d.]{3,})\s+)?(-?[\d.]*\d,\d{2})\s*([CD])\s+(-?[\d.]*\d,\d{2})\s*([CD])$/i;
const RE_BB_SALDO = /^(\d{2}\/\d{2}\/\d{4})\s+(?:(\d{2}\/\d{2}\/\d{4})\s+)?(\d{4})\s+(\d{5})\s+(\d{3})\s+(Saldo Anterior|S A L D O)\s+(-?[\d.]*\d,\d{2})\s*([CD])$/i;
const dataIso4 = (s) => {
  const m = limpar(s).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

function classificarBb(desc, valor) {
  const up = semAcento(desc).toUpperCase();
  if (/BB GIRO|PRONAMPE|BB CREDITO|CAPITAL DE GIRO|EMPRESTIMO|FINANCIAMENTO|PARC\.? OPER/.test(up)) return { forma: F.EMPRESTIMO, categoria: 'emprestimo', descricao: up };
  if (/SEGURO/.test(up)) return { forma: F.OUTROS, categoria: 'outros', descricao: up };
  if (/TARIFA|PACOTE DE SERVICOS|IOF|JUROS|ENCARGO/.test(up)) return { forma: F.TARIFA, categoria: 'tarifa', descricao: up };
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
      if ((m = txt.match(/Ag[êe]ncia\s+(\d+)(?:-(\w))?\s*$/i))) {
        agencia = m[1].padStart(4, '0');
        continue;
      }
      if ((m = txt.match(/Conta corrente\s+(\d+)-(\w)\s*(.*)$/i))) {
        conta = String(Number(m[1]));
        contaDv = m[2];
        titularNome = limpar(m[3]) || titularNome;
        continue;
      }
      if ((m = txt.match(/Per[íi]odo do extrato\s+(\d{2})\s*\/\s*(\d{4})/i))) {
        const mes = Number(m[1]);
        const ano = Number(m[2]);
        periodo = { inicio: `${ano}-${String(mes).padStart(2, '0')}-01`, fim: `${ano}-${String(mes).padStart(2, '0')}-${String(new Date(ano, mes, 0).getDate()).padStart(2, '0')}` };
        continue;
      }
      if ((m = txt.match(/Per[íi]odo do extrato\s+(\d{2}\/\d{2}\/\d{4})\s*(?:a|at[ée])\s*(\d{2}\/\d{2}\/\d{4})/i))) {
        periodo = { inicio: dataIso4(m[1]), fim: dataIso4(m[2]) };
        continue;
      }
      if (/A CONTA NAO FOI MOVIMENTADA/.test(up)) {
        semMovimento = true;
        continue;
      }
      if ((m = txt.match(RE_BB_SALDO))) {
        const v = parseNumBr(`${m[7]}${m[8]}`);
        if (/ANTERIOR/i.test(m[6])) saldoInicial = v;
        else saldoFinalInformado = v;
        continue;
      }
      if ((m = txt.match(RE_BB_ROW))) {
        const valor = parseNumBr(`${m[8]}${m[9]}`);
        const saldo = parseNumBr(`${m[10]}${m[11]}`);
        const desc = limpar(m[6]);
        lanc.push({ pagina: pg.numero, data: dataIso4(m[1]), hora: null, memo: desc, descricao: desc, documento: m[7] || null, valor, saldoApos: saldo, lote: m[4], codHist: m[5] });
        continue;
      }
      // complemento do histórico (linha abaixo, deslocada para a direita)
      const x0 = linha.items[0]?.x ?? 0;
      if (lanc.length && x0 >= 200 && !/^(OBSERVA|Transa[çc][ãa]o efetuada|Servi[çc]o de Atendimento|Ouvidoria|Para deficientes|----)/i.test(txt) && !/^Dt\. balancete/i.test(txt)) {
        const u = lanc.at(-1);
        u.memo = `${u.memo} | ${txt}`;
      }
    }
  }
  // o PDF imprime "*** A CONTA NAO FOI MOVIMENTADA ***" mesmo com lançamentos de tarifa/empréstimo
  if (!lanc.length) avisos.push(semMovimento ? 'BB informa que a conta não foi movimentada no período.' : 'BB: nenhum lançamento reconhecido no extrato.');

  const lancamentos = lanc.map((l) => {
    const cls = classificarBb(l.descricao, l.valor);
    return { ...l, ...cls, memo: l.memo, documento: l.documento, contraparteNome: cls.contraparteNome || null, contraparteDoc: cls.contraparteDoc || null };
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
const BANDEIRA = { ELO: 'ELO', MAST: 'MASTERCARD', MASTER: 'MASTERCARD', VISA: 'VISA', AMEX: 'AMEX', HIPER: 'HIPERCARD' };

function classificarItau(desc, valor) {
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
    if (/PIX/.test(up)) return { ...base, forma: F.PIX, categoria: 'pix', descricao: deb ? 'PAGAMENTO PIX (SISPAG)' : 'RECEBIMENTO PIX (SISPAG)' };
    if (/PAG TIT|TITULO|BOLETO/.test(up)) return { ...base, forma: F.BOLETO, categoria: 'boleto', descricao: 'PAGAMENTO BOLETO (SISPAG)' };
    if (/FORNECEDOR/.test(up)) return { ...base, forma: F.TED, categoria: 'transferencia', descricao: deb ? 'PAGAMENTO FORNECEDOR (SISPAG)' : 'RECEBIMENTO (SISPAG)' };
    const nome = limpar(up.replace(/^SISPAG\s*/, '').replace(/\.\.\.$/, '')) || null;
    return { ...base, forma: F.TED, categoria: 'transferencia', contraparteNome: nome, descricao: deb ? 'TRANSFERÊNCIA ENVIADA (SISPAG)' : 'TRANSFERÊNCIA RECEBIDA (SISPAG)' };
  }
  if (/^TED\b|^DOC\b|^TEF\b|TRANSF/.test(up)) return { ...base, forma: F.TED, categoria: 'transferencia', descricao: deb ? 'TRANSFERÊNCIA ENVIADA' : 'TRANSFERÊNCIA RECEBIDA' };
  if (/DESC DP|DESC DUPL|TIT DESC|DESCONTO DE/.test(up)) return { ...base, forma: F.EMPRESTIMO, categoria: 'emprestimo', descricao: up };
  if (/REND PAGO|APLIC|RESGATE|CDB|FUNDO/.test(up)) return { ...base, forma: F.APLICACAO, categoria: 'aplicacao', descricao: up };
  if (/^IOF|JUROS|JR MORA|TAR\b|TARIFA|CUSTAS|ENCARGO|MULTA|CESTA|MANUT/.test(up)) return { ...base, forma: F.TARIFA, categoria: 'tarifa', descricao: up };
  if (/EMPREST|FINANC|PARC|CAPITAL DE GIRO|LIS\b|LIMITE/.test(up)) return { ...base, forma: F.EMPRESTIMO, categoria: 'emprestimo', descricao: up };
  if (/BOLETO|TITULO|COBRANCA|PAGTO|PAGAMENTO/.test(up)) return { ...base, forma: F.BOLETO, categoria: 'boleto', descricao: deb ? 'PAGAMENTO BOLETO' : 'RECEBIMENTO BOLETO' };
  return { ...base, ...classificarGenerico(up, valor) };
}

export function interpretarItau(paginas) {
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
  let ano = null;
  let mesAtual = null;
  let parou = false;
  let aguardaCabecalhoDados = false;

  for (const pg of paginas) {
    if (parou) break;
    const linhas = agruparLinhas(pg.items);
    for (let i = 0; i < linhas.length; i++) {
      const linha = linhas[i];
      const txt = textoDe(linha.items);
      if (!txt) continue;
      const up = semAcento(txt).toUpperCase().replace(/#/g, '');
      let m;

      // cabeçalho do titular: "NOME … agência conta corrente" e, na linha seguinte, "CNPJ ag conta"
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
      if ((m = txt.match(/per[íi]odo:\s*(\d{2}\/\d{2}\/\d{4})\s*(?:at[ée]|a)\s*(\d{2}\/\d{2}\/\d{4})/i))) {
        periodo = { inicio: dataIso4(m[1]), fim: dataIso4(m[2]) };
        ano = ano || Number(m[1].slice(-4));
        continue;
      }
      if (/^DATA\b/.test(up) && /LANCAMENTOS/.test(up) && /VALOR/.test(up)) {
        const s = linha.items.find((it) => /^saldo/i.test(limpar(it.s)));
        if (s) xSaldo = s.x;
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
      const md = primeiro.match(RE_ITAU_DATA);
      if (!md) continue;
      const dia = Number(md[1]);
      const mes = MESES[md[2].toLowerCase()];
      if (!mes) continue;
      const desc = limpar(linha.items.filter((it) => it.x > linha.items[0].x + 30 && it.x < (xSaldo ? xSaldo - 150 : 320) && parseNumBr(it.s) == null).map((it) => it.s).join(' '));
      const nums = linha.items.filter((it) => it.x > 300 && parseNumBr(it.s) != null);
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
      // ano: cabeçalho "janeiro 2025" → ano; se o mês andou para trás (dez→jan), vira o ano
      let anoLanc = ano || Number(periodo.inicio?.slice(0, 4)) || new Date().getFullYear();
      if (periodo.inicio && mesAtual == null) {
        const mesIni = Number(periodo.inicio.slice(5, 7));
        if (mes < mesIni) anoLanc += 1;
      }
      const data = `${anoLanc}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
      lanc.push({ pagina: pg.numero, data, hora: null, memo: desc, descricao: desc, documento: null, valor: parseNumBr(valorIt.s), saldoApos: saldoIt && saldoIt !== valorIt ? parseNumBr(saldoIt.s) : null });
    }
  }
  if (!lanc.length) avisos.push('Itaú: nenhum lançamento reconhecido no extrato.');

  const lancamentos = lanc.map((l) => ({ ...l, ...classificarItau(l.descricao, l.valor), memo: l.memo }));
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
