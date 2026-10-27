// ============================================================
// Extratos bancários em PDF → lançamentos normalizados (Fluxo de Caixa Ext)
//
// Lê o PDF do extrato de qualquer um dos bancos usados pelo grupo e devolve
// a mesma estrutura, independente do banco:
//
//   STONE   — "Extrato de conta corrente" do app (parser já existente em
//             utils/extratoStonePdf.js; aqui só é normalizado)
//   SICREDI — extrato do internet banking (Associado / Cooperativa / Conta;
//             tabela Data | Descrição | Documento | Valor | Saldo, N páginas,
//             termina em "Saldo da conta"; depois vêm "Lançamentos Futuros",
//             que são ignorados)
//   CAIXA   — extrato impresso do internet banking (paisagem; Data / Data
//             Efetiva | Documento | Histórico (várias linhas) | Valor | Saldo
//             com sufixo C/D; linhas "SALDO DIA" não são lançamentos)
//   MENTORE — Mêntore Instituição de Pagamento (folha de pagamento); ordem
//             decrescente, linha "dd/mm/aaaa Saldo final do dia" abre o dia e
//             as linhas "hh:mm:ss histórico crédito|débito" são os lançamentos
//
// Todos são lidos com pdfjs por coordenada (extrairPaginasPdf), porque o
// texto corrido desses PDFs embaralha as colunas.
//
// Cada lançamento sai como:
//   { data, hora, valor (assinado), natureza C|D, tipo ENTRADA|SAIDA,
//     forma, categoria, descricao, memo, documento,
//     contraparteNome, contraparteDoc (CNPJ/CPF só dígitos), contraparteBanco,
//     bandeira, loja, saldoApos, pagina }
// ============================================================
import { extrairPaginasPdf, interpretarPaginas as interpretarStone } from './extratoStonePdf.js';
import { classificarLancamento as classificarStone } from './ofxParaCnab240.js';
import {
  interpretarBnb,
  interpretarSantander,
  interpretarUnicred,
  interpretarDaycoval,
  interpretarPagbank,
  interpretarPagarme,
  ehXlsx,
} from './extratosBancariosExtra.js';
import { interpretarBb, interpretarItau } from './extratosBancariosBbItau.js';

const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');
const semAcento = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const limpar = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const direita = (it) => it.x + (it.w || 0);
const textoDe = (items) => limpar(items.map((i) => i.s).join(' '));

export const BANCOS = {
  STONE: { codigo: '197', nome: 'Stone' },
  SICREDI: { codigo: '748', nome: 'Sicredi' },
  CAIXA: { codigo: '104', nome: 'Caixa Econômica Federal' },
  MENTORE: { codigo: 'MENTORE', nome: 'Mêntore' },
  BNB: { codigo: '004', nome: 'Banco do Nordeste' },
  SANTANDER: { codigo: '033', nome: 'Santander' },
  UNICRED: { codigo: '136', nome: 'Unicred' },
  DAYCOVAL: { codigo: '707', nome: 'Daycoval' },
  PAGBANK: { codigo: '290', nome: 'PagBank' },
  PAGARME: { codigo: 'PAGARME', nome: 'Pagar.me' },
  BB: { codigo: '001', nome: 'Banco do Brasil' },
  ITAU: { codigo: '341', nome: 'Itaú' },
};

// formas de pagamento (gerencial) — valores livres, mas padronizados aqui
export const FORMAS = {
  PIX: 'PIX',
  TED: 'TED/DOC',
  BOLETO: 'BOLETO',
  CARTAO_CREDITO: 'CARTÃO CRÉDITO',
  CARTAO_DEBITO: 'CARTÃO DÉBITO',
  ANTECIPACAO: 'ANTECIPAÇÃO CARTÃO',
  DEBITO_AUTOMATICO: 'DÉBITO AUTOMÁTICO',
  TARIFA: 'TARIFA/ENCARGO',
  FOLHA: 'FOLHA/SALÁRIO',
  FATURA_CARTAO: 'FATURA CARTÃO',
  COMPRA_CARTAO: 'COMPRA CARTÃO',
  APLICACAO: 'APLICAÇÃO/RESGATE',
  EMPRESTIMO: 'EMPRÉSTIMO/LIMITE',
  DINHEIRO: 'DINHEIRO',
  TRANSFERENCIA: 'TRANSFERÊNCIA',
  OUTROS: 'OUTROS',
};

const RE_DATA4 = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const dataIso4 = (s) => {
  const m = limpar(s).match(RE_DATA4);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

// "R$ 1.234,56" | "- R$ 0,20" | "-1.440,17" | "-R$ 0,01" | "R$ 274,35 C" | "R$ 10,00 D"
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

// agrupa itens em linhas (mesma y ± tol), itens ordenados por x
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

// texto à direita de um rótulo, na mesma linha, até o próximo rótulo ("xxx:")
function valorAoLado(items, re) {
  const r = achar(items, re);
  if (!r) return null;
  const mesmaLinha = items
    .filter((it) => it !== r && Math.abs(it.y - r.y) <= 2.5 && it.x > r.x)
    .sort((a, b) => a.x - b.x);
  const out = [];
  for (const it of mesmaLinha) {
    if (/:$/.test(limpar(it.s)) && out.length) break;
    if (/:$/.test(limpar(it.s))) break;
    out.push(it);
  }
  return textoDe(out) || null;
}

// ─── detecção do banco ─────────────────────────────────────────
export function detectarBanco(paginas) {
  const texto = semAcento(paginas.map((p) => p.items.map((i) => i.s).join(' ')).join(' ')).toUpperCase();
  if (/STONE INSTITUICAO DE PAGAMENTO/.test(texto)) return 'STONE';
  if (/MENTORE INSTITUICAO DE PAGAMENTO|MENTORE\.CO/.test(texto)) return 'MENTORE';
  if (/ASSOCIADO:/.test(texto) && /COOPERATIVA:/.test(texto)) return 'SICREDI';
  if (/SICREDI FONE|SICREDI/.test(texto) && /COOPERATIVA/.test(texto)) return 'SICREDI';
  if (/SALDO ANTERIOR AO PERIODO SOLICITADO|SAC CAIXA|ALO CAIXA/.test(texto)) return 'CAIXA';
  if (/DETALHAMENTO DO EXTRATO/.test(texto) && /EXTRATO DE CONTA CORRENTE - NO PERIODO/.test(texto)) return 'BNB';
  if (/SANTANDER EMPRESAS|SANTANDER EMPRESARIAL/.test(texto)) return 'SANTANDER';
  if (/COOP: \d+ - AG: \d+ - CONTA:/.test(texto) || /UNICRED/.test(texto)) return 'UNICRED';
  if (/DAYCOVAL|DAYCONNECT/.test(texto)) return 'DAYCOVAL';
  if (/PAGSEGURO INTERNET|PAGBANK/.test(texto) && /EXTRATO DA CONTA/.test(texto)) return 'PAGBANK';
  if (/OUVIDORIA BB|SAC 0800 729 0722|BANCO DO BRASIL/.test(texto) && /EXTRATO DE CONTA CORRENTE/.test(texto)) return 'BB';
  if (/ITAU\.COM\.BR|BANCO ITAU|SISPAG/.test(texto) && /AG\/ORIGEM|LANCAMENTOS/.test(texto)) return 'ITAU';
  return null;
}

// ─── classificação por banco ───────────────────────────────────
const BANDEIRAS = { MASTER: 'MASTERCARD', MASTERCARD: 'MASTERCARD', VISA: 'VISA', ELO: 'ELO', AMEX: 'AMEX', HIPER: 'HIPERCARD', HIPERCARD: 'HIPERCARD' };

function classificarSicredi(desc, valor) {
  const up = semAcento(desc).toUpperCase().replace(/\s+/g, ' ').trim();
  const deb = valor < 0;
  let m;
  if ((m = up.match(/^RECEBIMENTO PIX\s*(\d{14}|\d{11})?\s*(.*)$/)))
    return { forma: FORMAS.PIX, categoria: 'pix', descricao: 'RECEBIMENTO PIX', contraparteDoc: m[1] || null, contraparteNome: m[2] || null };
  if ((m = up.match(/^(?:PAGAMENTO|ENVIO|TRANSFERENCIA|TRANSF) PIX\s*(\d{14}|\d{11})?\s*(.*)$/)))
    return { forma: FORMAS.PIX, categoria: 'pix', descricao: deb ? 'PAGAMENTO PIX' : 'RECEBIMENTO PIX', contraparteDoc: m[1] || null, contraparteNome: m[2] || null };
  if ((m = up.match(/^DEVOLUCAO PIX\s*(\d{14}|\d{11})?\s*(.*)$/)))
    return { forma: FORMAS.PIX, categoria: 'pix', descricao: deb ? 'DEVOLUÇÃO PIX ENVIADA' : 'DEVOLUÇÃO PIX RECEBIDA', contraparteDoc: m[1] || null, contraparteNome: m[2] || null };
  if ((m = up.match(/^(?:TED|DOC)(?:\s+(?:TED|DOC))*\s+(\d{14}|\d{11})?\d*\s*(.*)$/)))
    return { forma: FORMAS.TED, categoria: 'transferencia', descricao: deb ? 'TED ENVIADA' : 'TED RECEBIDA', contraparteDoc: m[1] || null, contraparteNome: m[2] || null };
  if (/^LIQ\.?\s*COBRANCA/.test(up))
    return { forma: FORMAS.BOLETO, categoria: 'boleto', descricao: 'LIQUIDAÇÃO COBRANÇA (BOLETO EMITIDO)', contraparteNome: null, documento: (up.match(/COB\d+/) || [])[0] || null };
  if ((m = up.match(/^(?:LIQUIDACAO|PAGAMENTO|PAGTO|PAG)\.?\s*(?:DE\s+)?(?:BOLETO|TITULO)S?\s*(\d{14}|\d{11})?\s*(.*)$/)))
    return { forma: FORMAS.BOLETO, categoria: 'boleto', descricao: 'PAGAMENTO BOLETO', contraparteDoc: m[1] || null, contraparteNome: m[2] || null };
  if ((m = up.match(/^DEBITO CONVENIOS?\s*(\d{14}|\d{11})?\s*(.*)$/)))
    return { forma: FORMAS.DEBITO_AUTOMATICO, categoria: 'debito_automatico', descricao: 'DÉBITO CONVÊNIO', contraparteDoc: m[1] || null, contraparteNome: m[2] || null };
  if ((m = up.match(/^(?:REDE|CIELO|GETNET|STONE)\s+(DEBITO|CREDITO|ANTEC\w*)\s+(\w+)\s*\|?\s*([\d-]+)?/))) {
    const tipo = m[1];
    const bandeira = BANDEIRAS[m[2]] || m[2];
    const antecip = tipo.startsWith('ANTEC');
    const forma = tipo === 'DEBITO' ? FORMAS.CARTAO_DEBITO : tipo === 'CREDITO' ? FORMAS.CARTAO_CREDITO : FORMAS.ANTECIPACAO;
    return {
      forma,
      categoria: antecip ? 'antecipacao' : 'cartao',
      descricao: antecip ? `ANTECIPAÇÃO ${bandeira}` : `VENDAS ${bandeira} ${tipo === 'DEBITO' ? 'DÉBITO' : 'CRÉDITO'}`,
      contraparteNome: up.split(' ')[0],
      bandeira,
      loja: m[3] || null,
    };
  }
  if (/^(TARIFA|CUSTAS|IOF|JUROS|ENCARGO|MULTA|CESTA|ANUIDADE|MANUTENCAO|TAXA)/.test(up))
    return { forma: FORMAS.TARIFA, categoria: 'tarifa', descricao: up.replace(/\s*COB\d+$/, ''), documento: (up.match(/COB\d+/) || [])[0] || null };
  if (/^DEB\.?\s*CTA\.?\s*FATURA|^PAGAMENTO FATURA|^PGTO FATURA/.test(up))
    return { forma: FORMAS.FATURA_CARTAO, categoria: 'cartao_fatura', descricao: 'DÉBITO FATURA CARTÃO' };
  if ((m = up.match(/^COMPRAS? (?:NACIONAIS|INTERNACIONAIS)\s*(?:IFD\s*)?(.*)$/)))
    return { forma: FORMAS.COMPRA_CARTAO, categoria: 'cartao_compra', descricao: 'COMPRA NO CARTÃO', contraparteNome: m[1] || null };
  if (/^(APLICACAO|RESGATE)/.test(up)) return { forma: FORMAS.APLICACAO, categoria: 'aplicacao', descricao: up };
  if (/^(TRANSFERENCIA|TRANSF)/.test(up)) return { forma: FORMAS.TRANSFERENCIA, categoria: 'transferencia', descricao: up };
  if (/^SAQUE|^DEPOSITO|^DEP\b/.test(up)) return { forma: FORMAS.DINHEIRO, categoria: 'dinheiro', descricao: up };
  return { forma: FORMAS.OUTROS, categoria: 'outros', descricao: up };
}

function classificarCaixa(linhas, valor) {
  const [h0 = '', ...resto] = linhas;
  const up = semAcento(h0).toUpperCase().trim();
  const deb = valor < 0;
  const e2e = resto.find((l) => /^E\d{8,}/i.test(limpar(l)));
  const nomeLinha = resto.find((l) => l !== e2e && /[A-Z]{3,}/i.test(l));
  const mask = nomeLinha?.match(/\*{3}\.\d{3}\.\d{3}-\*{2}|\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|\d{3}\.\d{3}\.\d{3}-\d{2}/)?.[0] || null;
  const nome = nomeLinha ? limpar(nomeLinha.replace(mask || '', '')) : null;
  const doc = mask && !mask.includes('*') ? soDigitos(mask) : null;
  const base = { contraparteNome: nome || null, contraparteDoc: doc, documento: e2e || null, docMascara: mask };

  if (/^TAR|TARIFA|^CESTA|^IOF|^JUROS|^MULTA|^ENCARGO/.test(up)) return { ...base, forma: FORMAS.TARIFA, categoria: 'tarifa', descricao: up };
  if (/PIX/.test(up)) return { ...base, forma: FORMAS.PIX, categoria: 'pix', descricao: deb ? 'PAGAMENTO PIX' : 'RECEBIMENTO PIX' };
  if (/BOLETO|^PAG TIT|^PGTO TIT|CONV/.test(up)) return { ...base, forma: /CONV|^DEB AUT/.test(up) ? FORMAS.DEBITO_AUTOMATICO : FORMAS.BOLETO, categoria: /CONV|^DEB AUT/.test(up) ? 'debito_automatico' : 'boleto', descricao: up };
  if (/\bTED\b|\bDOC\b/.test(up)) return { ...base, forma: FORMAS.TED, categoria: 'transferencia', descricao: deb ? 'TED ENVIADA' : 'TED RECEBIDA' };
  if (/^AZCX|APLIC|RESG|^CDB|^POUP|^LCI|^LCA|^FUNDO/.test(up)) return { ...base, forma: FORMAS.APLICACAO, categoria: 'aplicacao', descricao: deb ? 'APLICAÇÃO AUTOMÁTICA' : 'RESGATE AUTOMÁTICO' };
  if (/SAQUE|^DEP\b|DEPOSITO|DINHEIRO/.test(up)) return { ...base, forma: FORMAS.DINHEIRO, categoria: 'dinheiro', descricao: up };
  if (/^CRED|^DEB/.test(up)) return { ...base, forma: FORMAS.TRANSFERENCIA, categoria: 'transferencia', descricao: up };
  return { ...base, forma: FORMAS.OUTROS, categoria: 'outros', descricao: up };
}

function classificarMentore(desc, valor) {
  let t = limpar(desc);
  let documento = null;
  const m = t.match(/^(\d{4,})\s*\|\s*(.*)$/);
  if (m) {
    documento = m[1];
    t = m[2];
  }
  const [tipoTxt, ...nomeParts] = t.split(/\s+-\s+/);
  const nome = limpar(nomeParts.join(' - ')) || null;
  const up = semAcento(tipoTxt).toUpperCase().trim();
  const deb = valor < 0;
  const base = { contraparteNome: nome, documento };
  if (/SALARIO|FOLHA|RESCIS|FERIAS|13|ADIANTAMENTO|PRO-?LABORE|BENEFICIO|VALE/.test(up))
    return { ...base, forma: FORMAS.FOLHA, categoria: 'folha', descricao: up };
  if (/PIX/.test(up)) return { ...base, forma: FORMAS.PIX, categoria: 'pix', descricao: deb ? 'PAGAMENTO PIX' : 'RECEBIMENTO PIX' };
  if (/BOLETO/.test(up)) return { ...base, forma: FORMAS.BOLETO, categoria: 'boleto', descricao: deb ? 'PAGAMENTO BOLETO' : 'RECEBIMENTO BOLETO' };
  if (/\bTED\b|\bDOC\b/.test(up)) return { ...base, forma: FORMAS.TED, categoria: 'transferencia', descricao: deb ? 'TED ENVIADA' : 'TED RECEBIDA' };
  if (/TARIFA|TAXA|MENSALIDADE/.test(up)) return { ...base, forma: FORMAS.TARIFA, categoria: 'tarifa', descricao: up };
  if (/TRANSFER/.test(up)) return { ...base, forma: FORMAS.TRANSFERENCIA, categoria: 'transferencia', descricao: up };
  return { ...base, forma: FORMAS.OUTROS, categoria: 'outros', descricao: up };
}

// Stone: reaproveita classificarLancamento (grupo/bandeira) e traduz para forma
export function classificarStoneNormalizado(l) {
  const c = classificarStone(l);
  const mapa = {
    cartao: c.tipoCartao === 'Débito' ? FORMAS.CARTAO_DEBITO : FORMAS.CARTAO_CREDITO,
    antecipacao: FORMAS.ANTECIPACAO,
    pix: FORMAS.PIX,
    transferencia: FORMAS.TED,
    boleto: FORMAS.BOLETO,
    pagamento: FORMAS.BOLETO,
    tarifa: FORMAS.TARIFA,
    outros: FORMAS.OUTROS,
  };
  const contraparteNome = c.contraparte || (c.grupo === 'cartao' || c.grupo === 'antecipacao' ? 'STONE' : null);
  let forma = mapa[c.grupo] || FORMAS.OUTROS;
  let categoria = c.grupo;
  let descricao = c.descricao;
  let nome = contraparteNome;
  if (c.grupo === 'outros') {
    // memos do "Extrato de conta corrente" que o classificador do OFX não conhece
    const up = semAcento(l.memo).toUpperCase();
    let m;
    if ((m = up.match(/^(.*?)\s*-\s*(CREDITO|DEBITO)\s*\|\s*PRE-?PAGO$/))) {
      forma = FORMAS.COMPRA_CARTAO; categoria = 'cartao_compra'; descricao = 'COMPRA CARTÃO STONE (PRÉ-PAGO)'; nome = m[1].trim();
    } else if ((m = up.match(/^(.*?)\s*-\s*ESTORNO\s*\|\s*CARTAO$/))) {
      forma = FORMAS.COMPRA_CARTAO; categoria = 'cartao_compra'; descricao = 'ESTORNO COMPRA CARTÃO STONE'; nome = m[1].trim();
    } else if (/^COBRANCA DE TARIFA|\s-\s*TARIFA\s*\|/.test(up)) {
      forma = FORMAS.TARIFA; categoria = 'tarifa'; descricao = `TARIFA STONE${(m = up.match(/TARIFA\s*\|\s*(.+)$/)) ? ` ${m[1].trim()}` : ''}`; nome = 'STONE';
    } else if (/^MENSALIDADE/.test(up)) {
      forma = FORMAS.TARIFA; categoria = 'tarifa'; descricao = 'MENSALIDADE MAQUININHA STONE'; nome = 'STONE';
    } else if (/DINHEIRO RESGATADO|MAIS LIMITE|EMPRESTIMO|CAPITAL DE GIRO/.test(up)) {
      forma = FORMAS.EMPRESTIMO; categoria = 'emprestimo'; descricao = l.valor < 0 ? 'PAGAMENTO LIMITE/EMPRÉSTIMO STONE' : 'RESGATE LIMITE/EMPRÉSTIMO STONE'; nome = 'STONE';
    } else if (/RENDIMENTO|APLICACAO|RESGATE/.test(up)) {
      forma = FORMAS.APLICACAO; categoria = 'aplicacao';
    } else if ((m = up.match(/^(.*?)\s*-\s*(TRANSFERENCIA|DEVOLUCAO)\s*\|\s*(PIX|TED|DOC|CONTA STONE)$/))) {
      const meio = m[3];
      nome = m[1].trim();
      categoria = meio === 'PIX' ? 'pix' : 'transferencia';
      forma = meio === 'PIX' ? FORMAS.PIX : meio === 'CONTA STONE' ? FORMAS.TRANSFERENCIA : FORMAS.TED;
      const rot = meio === 'CONTA STONE' ? 'TRANSFERÊNCIA ENTRE CONTAS STONE' : meio;
      descricao = meio === 'CONTA STONE' ? rot : l.valor < 0 ? `PAGAMENTO ${rot}` : `RECEBIMENTO ${rot}`;
    }
  }
  return {
    forma,
    categoria,
    descricao,
    contraparteNome: nome,
    contraparteDoc: null,
    contraparteBanco: l.bancoContraparte || null,
    documento: null,
    bandeira: c.bandeira || null,
  };
}

// ─── SICREDI ───────────────────────────────────────────────────
function interpretarSicredi(paginas) {
  const p1 = paginas[0].items;
  const avisos = [];
  const titularNome = valorAoLado(p1, /^Associado:$/i);
  const cooperativa = soDigitos(valorAoLado(p1, /^Cooperativa:$/i));
  const contaTxt = soDigitos(valorAoLado(p1, /^Conta:$/i));
  const per = textoDe(p1).match(/Per[íi]odo de (\d{2}\/\d{2}\/\d{4}) a (\d{2}\/\d{2}\/\d{4})/i);

  const docCab = achar(p1, /^Documento$/i);
  if (!docCab && /N[ãa]o h[áa] lan[çc]amentos no per[íi]odo/i.test(textoDe(p1))) {
    return {
      titular: { nome: titularNome, cnpj: null, agencia: cooperativa || null, conta: contaTxt ? contaTxt.slice(0, -1) : null, contaDv: contaTxt ? contaTxt.slice(-1) : null },
      periodo: { inicio: dataIso4(per?.[1]), fim: dataIso4(per?.[2]) },
      saldoInicial: null,
      saldoFinalInformado: null,
      lancamentos: [],
      avisos: ['Sicredi informa que não há lançamentos no período.'],
    };
  }
  if (!docCab) throw new Error('Sicredi: cabeçalho da tabela (Data/Descrição/Documento/Valor/Saldo) não encontrado.');
  const cab = p1.filter((it) => Math.abs(it.y - docCab.y) <= 2.5);
  const cDesc = achar(cab, /^Descri[çc][ãa]o$/i);
  const cValor = achar(cab, /^Valor/i);
  const cSaldo = achar(cab, /^Saldo/i);
  if (!cDesc || !cValor || !cSaldo) throw new Error('Sicredi: colunas da tabela não reconhecidas.');
  const xDesc = cDesc.x;
  const xDoc = docCab.x;
  const rValor = direita(cValor);
  const rSaldo = direita(cSaldo);

  const lanc = [];
  let saldoAnterior = null;
  let fim = false;
  for (const pg of paginas) {
    if (fim) break;
    const stop = pg.items.find((it) => /^Saldo da conta$/i.test(limpar(it.s)) && it.x < 80);
    const yMin = pg.numero === 1 ? docCab.y + 3 : 0;
    const yMax = stop ? stop.y - 3 : Infinity;
    const corpo = pg.items.filter((it) => it.y > yMin && it.y < yMax);
    for (const linha of agruparLinhas(corpo)) {
      const its = linha.items;
      const dataIt = its.find((it) => it.x < xDesc - 5 && RE_DATA4.test(limpar(it.s)));
      const nums = its.filter((it) => it.x >= xDoc - 5 && ehNumero(it.s));
      const valorIt = nums.find((it) => Math.abs(direita(it) - rValor) <= 8);
      const saldoIt = nums.find((it) => it !== valorIt && Math.abs(direita(it) - rSaldo) <= 8);
      const descIts = its.filter((it) => it.x >= xDesc - 5 && it.x < xDoc - 5);
      const docIts = its.filter((it) => it.x >= xDoc - 5 && it !== valorIt && it !== saldoIt && it.x < rValor - 45);
      const desc = textoDe(descIts);
      const doc = textoDe(docIts);
      if (!dataIt) {
        if (/^SALDO ANTERIOR$/i.test(desc)) {
          saldoAnterior = saldoIt ? parseNumBr(saldoIt.s) : null;
          continue;
        }
        if (!valorIt && lanc.length && (desc || doc)) {
          const u = lanc.at(-1);
          if (desc) u.descricao = limpar(`${u.descricao} ${desc}`);
          if (doc) u.documento = limpar(`${u.documento || ''} ${doc}`) || null;
        }
        continue;
      }
      if (!valorIt) {
        if (desc) avisos.push(`pág. ${pg.numero} ${limpar(dataIt.s)}: linha sem valor ("${desc}")`);
        continue;
      }
      lanc.push({
        pagina: pg.numero,
        data: dataIso4(dataIt.s),
        hora: null,
        descricao: desc,
        documento: doc || null,
        valor: parseNumBr(valorIt.s),
        saldoApos: saldoIt ? parseNumBr(saldoIt.s) : null,
      });
    }
    if (stop) fim = true;
  }

  const lancamentos = lanc.map((l) => {
    const c = classificarSicredi(l.descricao, l.valor);
    return { ...l, memo: l.descricao, ...c, documento: c.documento || l.documento || null };
  });

  return {
    titular: { nome: titularNome, cnpj: null, agencia: cooperativa || null, conta: contaTxt ? contaTxt.slice(0, -1) : null, contaDv: contaTxt ? contaTxt.slice(-1) : null },
    periodo: { inicio: dataIso4(per?.[1]), fim: dataIso4(per?.[2]) },
    saldoInicial: saldoAnterior,
    saldoFinalInformado: null,
    lancamentos, // já em ordem cronológica
    avisos,
  };
}

// ─── CAIXA ─────────────────────────────────────────────────────
function interpretarCaixa(paginas) {
  const p1 = paginas[0].items;
  const avisos = [];
  const linhas1 = agruparLinhas(p1);
  const texto1 = linhas1.map((l) => textoDe(l.items)).join('\n');
  const idxCnpj = linhas1.findIndex((l) => /^CNPJ:/i.test(textoDe(l.items)));
  const nome = idxCnpj > 0 ? textoDe(linhas1[idxCnpj - 1].items) : null;
  const cnpj = soDigitos(texto1.match(/CNPJ:\s*([\d./-]+)/i)?.[1]);
  const agCc = texto1.match(/Ag[êe]ncia:\s*(\d+)\s*(?:Produto:\s*\d+\s*)?Conta:\s*([\d-]+)/i);
  const contaDig = soDigitos(agCc?.[2]);
  const per =
    texto1.match(/Extrato no per[íi]odo de (\d{2}\/\d{2}\/\d{4}) [àa] (\d{2}\/\d{2}\/\d{4})/i) ||
    texto1.match(/Lan[çc]amentos de (\d{2}\/\d{2}\/\d{4}) [àa] (\d{2}\/\d{2}\/\d{4})/i);
  const semLancamentos = /N[ÃA]O CONSTA LAN[ÇC]AMENTO/i.test(semAcento(texto1).toUpperCase().replace(/[ÇC]/g, 'C'));

  // saldo anterior: valor na linha do rótulo (pode vir fragmentado "R", "$ 146,99", "C")
  let saldoAnterior = null;
  const rotSaldoAnt = achar(p1, /^Saldo anterior ao per[íi]odo/i);
  if (rotSaldoAnt) {
    const frag = p1.filter((it) => Math.abs(it.y - rotSaldoAnt.y) <= 3 && it.x > rotSaldoAnt.x + 200);
    saldoAnterior = parseNumBr(textoDe(frag));
  }

  const lanc = [];
  let cab = null;
  for (const pg of paginas) {
    const hist = achar(pg.items, /^Hist[óo]rico$/i);
    if (hist) {
      const linhaCab = pg.items.filter((it) => Math.abs(it.y - hist.y) <= 2.5);
      const doc = achar(linhaCab, /^Documento$/i);
      const val = achar(linhaCab, /^Valor$/i);
      const sal = achar(linhaCab, /^Saldo$/i);
      if (doc && val && sal) cab = { y: hist.y, xDoc: doc.x, xHist: hist.x, rValor: direita(val), rSaldo: direita(sal) };
    }
    if (!cab) continue;
    const rodape = achar(pg.items, /^SAC CAIXA$/i) || achar(pg.items, /^Ouvidoria$/i);
    const yMin = hist ? cab.y + 8 : 0;
    const yMax = rodape ? rodape.y - 4 : pg.altura;
    const corpo = pg.items.filter((it) => it.y > yMin && it.y < yMax);
    const datas = corpo.filter((it) => it.x < cab.xDoc - 5 && RE_DATA4.test(limpar(it.s))).sort((a, b) => a.y - b.y);
    const xMeio = (cab.rValor + cab.rSaldo) / 2;
    datas.forEach((d, i) => {
      const topo = d.y - 10;
      const base = i + 1 < datas.length ? datas[i + 1].y - 10 : yMax;
      const its = corpo.filter((it) => it.y >= topo && it.y < base);
      const horaIt = its.find((it) => it.x < cab.xDoc - 5 && /^\d{2}\/\d{2} \d{2}:\d{2}$/.test(limpar(it.s)));
      const doc = textoDe(its.filter((it) => it.x >= cab.xDoc - 5 && it.x < cab.xHist - 5));
      const histLinhas = agruparLinhas(its.filter((it) => it.x >= cab.xHist - 5 && it.x < cab.rValor - 120)).map((l) => textoDe(l.items));
      const numIts = its.filter((it) => it.x >= cab.rValor - 120);
      const valorTxt = textoDe(numIts.filter((it) => direita(it) <= xMeio));
      const saldoTxt = textoDe(numIts.filter((it) => direita(it) > xMeio));
      const valor = parseNumBr(valorTxt);
      const saldo = parseNumBr(saldoTxt);
      if (valor == null) {
        if (!/^SALDO DIA/i.test(histLinhas[0] || '')) avisos.push(`pág. ${pg.numero} ${limpar(d.s)}: valor não reconhecido ("${valorTxt}")`);
        return;
      }
      lanc.push({
        pagina: pg.numero,
        data: dataIso4(d.s),
        hora: horaIt ? limpar(horaIt.s).split(' ')[1] : null,
        documento: doc || null,
        descricaoLinhas: histLinhas,
        valor,
        saldoApos: saldo,
      });
    });
  }
  if (!cab && !semLancamentos) throw new Error('Caixa: cabeçalho da tabela (Documento/Histórico/Valor/Saldo) não encontrado.');
  if (semLancamentos) avisos.push('Caixa informa que não consta lançamento no período.');

  const lancamentos = lanc.map((l) => {
    const c = classificarCaixa(l.descricaoLinhas, l.valor);
    const { descricaoLinhas, ...resto } = l;
    return { ...resto, memo: descricaoLinhas.join(' | '), ...c, documento: c.documento || l.documento || null };
  });

  return {
    titular: { nome, cnpj: cnpj.length === 14 ? cnpj : null, agencia: agCc?.[1] || null, conta: contaDig ? contaDig.slice(0, -1) : null, contaDv: contaDig ? contaDig.slice(-1) : null },
    periodo: { inicio: dataIso4(per?.[1]), fim: dataIso4(per?.[2]) },
    saldoInicial: saldoAnterior,
    saldoFinalInformado: null,
    lancamentos,
    avisos,
  };
}

// ─── MÊNTORE ───────────────────────────────────────────────────
function interpretarMentore(paginas) {
  const p1 = paginas[0].items;
  const avisos = [];
  const linhas1 = agruparLinhas(p1);
  const idxDados = linhas1.findIndex((l) => /^DADOS DA CONTA$/i.test(textoDe(l.items)));
  const nome = idxDados >= 0 && linhas1[idxDados + 1] ? textoDe(linhas1[idxDados + 1].items) : null;
  const cnpj = soDigitos(valorAoLado(p1, /^CNPJ:$/i));
  const contaDig = soDigitos(valorAoLado(p1, /^Conta:$/i));
  const agencia = soDigitos(valorAoLado(p1, /^Ag[êe]ncia:$/i)) || null;
  const texto1 = linhas1.map((l) => textoDe(l.items)).join('\n');
  const ini = texto1.match(/Saldo Inicial no dia (\d{2}\/\d{2}\/\d{4})\s*:?\s*(-?\s*R\$\s*[\d.]+,\d{2})/i);
  const fimM = texto1.match(/Saldo Final no dia (\d{2}\/\d{2}\/\d{4})\s*:?\s*(-?\s*R\$\s*[\d.]+,\d{2})/i);

  const cHist = achar(p1, /^Hist[óo]rico$/i);
  if (!cHist) throw new Error('Mêntore: cabeçalho da tabela (Data/Histórico/Crédito/Débito/Saldo) não encontrado.');
  const cab = p1.filter((it) => Math.abs(it.y - cHist.y) <= 2.5);
  const cDeb = achar(cab, /^D[ée]bito$/i);
  const cSaldo = achar(cab, /^Saldo$/i);
  if (!cDeb || !cSaldo) throw new Error('Mêntore: colunas Débito/Saldo não reconhecidas.');
  const colDe = (it) => (direita(it) < cDeb.x - 2 ? 'cred' : direita(it) < cSaldo.x - 2 ? 'deb' : 'saldo');

  const lanc = []; // ordem do PDF (decrescente)
  const dias = [];
  let dataAtual = null;
  for (const pg of paginas) {
    const yMin = pg.numero === 1 ? cHist.y + 3 : 0;
    const rodape = pg.items.find((it) => /M[êe]ntore Institui/i.test(it.s) || /^SAC:$/i.test(limpar(it.s)));
    const yMax = rodape ? rodape.y - 2 : pg.altura;
    const corpo = pg.items.filter((it) => it.y > yMin && it.y < yMax);
    for (const linha of agruparLinhas(corpo)) {
      const its = linha.items;
      const primeiro = its[0];
      const t0 = limpar(primeiro.s);
      const nums = its.filter((it) => it.x > 250 && ehNumero(it.s));
      if (primeiro.x < 60 && RE_DATA4.test(t0)) {
        dataAtual = dataIso4(t0);
        const s = nums.find((it) => colDe(it) === 'saldo');
        dias.push({ data: dataAtual, rotulo: textoDe(its.filter((it) => it !== primeiro && !nums.includes(it))), saldo: s ? parseNumBr(s.s) : null });
        continue;
      }
      if (primeiro.x < 60 && /^\d{2}:\d{2}:\d{2}$/.test(t0)) {
        const textos = its.filter((it) => it !== primeiro && !nums.includes(it));
        const cred = nums.find((it) => colDe(it) === 'cred');
        const deb = nums.find((it) => colDe(it) === 'deb');
        const valor = cred ? Math.abs(parseNumBr(cred.s)) : deb ? -Math.abs(parseNumBr(deb.s)) : null;
        if (valor == null) {
          avisos.push(`pág. ${pg.numero} ${dataAtual} ${t0}: valor não reconhecido`);
          continue;
        }
        lanc.push({ pagina: pg.numero, data: dataAtual, hora: t0, descricao: textoDe(textos), valor, saldoApos: null });
        continue;
      }
      if (lanc.length && !nums.length && its.every((it) => it.x > 80)) {
        lanc.at(-1).descricao = limpar(`${lanc.at(-1).descricao} ${textoDe(its)}`);
      }
    }
  }

  const cron = [...lanc].reverse();
  const saldoInicial = ini ? parseNumBr(ini[2]) : null;
  // saldo corrente calculado (o PDF só traz saldo por dia)
  let corrente = saldoInicial;
  const lancamentos = cron.map((l) => {
    if (corrente != null) corrente = round2(corrente + l.valor);
    const c = classificarMentore(l.descricao, l.valor);
    return { ...l, memo: l.descricao, ...c, saldoApos: corrente };
  });

  return {
    titular: { nome, cnpj: cnpj.length === 14 ? cnpj : null, agencia, conta: contaDig ? contaDig.slice(0, -1) : null, contaDv: contaDig ? contaDig.slice(-1) : null },
    periodo: { inicio: dataIso4(ini?.[1]), fim: dataIso4(fimM?.[1]) },
    saldoInicial,
    saldoFinalInformado: fimM ? parseNumBr(fimM[2]) : null,
    lancamentos,
    avisos,
    dias,
  };
}

// ─── STONE (normalização do parser existente) ──────────────────
function interpretarStoneNormalizado(paginas) {
  const { titular, lancamentos, avisos, conferencia } = interpretarStone(paginas);
  const vazio = /n[ãa]o tem transa[çc][õo]es no per[íi]odo/i.test(paginas.map((p) => p.items.map((i) => i.s).join(' ')).join(' '));
  if (!lancamentos.length && !vazio) throw new Error('Stone: nenhum lançamento encontrado no PDF.');
  return {
    titular: { nome: titular.nome, cnpj: titular.cnpj, agencia: titular.agencia, conta: titular.conta, contaDv: titular.contaDv },
    periodo: { inicio: titular.periodoInicio, fim: titular.periodoFim },
    saldoInicial: conferencia.saldoInicial ?? (vazio ? null : null),
    saldoFinalInformado: lancamentos.at(-1)?.saldoApos ?? null,
    lancamentos: lancamentos.map((l) => ({
      pagina: l.pagina,
      data: l.data,
      hora: null,
      valor: l.valor,
      saldoApos: l.saldoApos,
      memo: l.memo,
      ...classificarStoneNormalizado(l),
    })),
    avisos: vazio ? ['Stone informa que não há transações no período.'] : avisos,
    conferenciaStone: conferencia,
  };
}

// ─── conferência do saldo corrente ─────────────────────────────
function conferirSaldo(lancamentos, saldoInicial) {
  if (saldoInicial == null) return { saldoInicial: null, inconsistencias: 0, conferido: false };
  let corrente = saldoInicial;
  let inconsistencias = 0;
  for (let i = 0; i < lancamentos.length; i++) {
    const l = lancamentos[i];
    corrente = round2(corrente + l.valor);
    const prox = lancamentos[i + 1];
    if (prox && prox.saldoApos != null && prox.saldoApos === l.saldoApos) continue; // saldo repetido em pares (Stone)
    if (l.saldoApos != null && Math.abs(corrente - l.saldoApos) > 0.009) {
      inconsistencias += 1;
      corrente = l.saldoApos;
    }
  }
  return { saldoInicial, inconsistencias, conferido: true, saldoFinalCalculado: corrente };
}

// ─── API pública ───────────────────────────────────────────────
/**
 * @param {Buffer} buffer PDF
 * @param {{nomeArquivo?: string, banco?: string}} opts banco força o parser
 */
export async function lerExtratoBancario(buffer, opts = {}) {
  let banco;
  let r;
  let paginas = [];
  if (ehXlsx(buffer)) {
    // planilha: hoje só o export do painel Pagar.me
    banco = 'PAGARME';
    r = interpretarPagarme(buffer, { nomeArquivo: opts.nomeArquivo });
  } else {
    paginas = await extrairPaginasPdf(buffer);
    if (!paginas.length) throw new Error('PDF vazio ou ilegível.');
    banco = (opts.banco || detectarBanco(paginas) || '').toUpperCase();
    if (!BANCOS[banco]) {
      const legivel = paginas.some((p) => p.items.some((it) => /[A-Za-z]{4,}/.test(it.s)));
      throw new Error(
        legivel
          ? 'Banco não reconhecido no PDF (esperado: Stone, Sicredi, Caixa, Mêntore, BNB, Santander, Unicred, Daycoval, PagBank, Banco do Brasil, Itaú ou planilha Pagar.me).'
          : 'PDF sem texto legível (fonte sem mapa de caracteres — comum no Bradesco). Exporte o extrato em OFX/CSV/TXT ou use outro formato de PDF.',
      );
    }
    const parsers = {
      STONE: interpretarStoneNormalizado,
      SICREDI: interpretarSicredi,
      CAIXA: interpretarCaixa,
      MENTORE: interpretarMentore,
      BNB: interpretarBnb,
      SANTANDER: interpretarSantander,
      UNICRED: interpretarUnicred,
      DAYCOVAL: interpretarDaycoval,
      PAGBANK: interpretarPagbank,
      BB: interpretarBb,
      ITAU: interpretarItau,
    };
    r = parsers[banco](paginas);
  }
  return montarExtrato(banco, r, { nomeArquivo: opts.nomeArquivo, paginas: paginas.length });
}

/**
 * Normaliza o resultado "cru" de um interpretador (titular, periodo,
 * saldoInicial, saldoFinalInformado, lancamentos, avisos) no formato final do
 * extrato: ordena, classifica natureza/tipo, confere o saldo corrente e
 * calcula totais. Usado pelo PDF/XLSX e também pelo extrato Stone vindo da
 * API do portal (bot Stone, utils/extratoStoneApi.js).
 */
export function montarExtrato(banco, r, opts = {}) {
  if (!BANCOS[banco]) throw new Error(`Banco desconhecido: ${banco}`);
  const paginas = opts.paginas || 0;
  // ordena cronologicamente preservando a ordem do extrato dentro do dia
  const lancamentos = r.lancamentos.map((l, i) => ({ ...l, ordem: i }));
  lancamentos.sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : a.ordem - b.ordem));

  const normalizados = lancamentos.map((l, i) => {
    const valor = round2(l.valor);
    return {
      seq: i + 1,
      data: l.data,
      hora: l.hora || null,
      valor,
      natureza: valor < 0 ? 'D' : 'C',
      tipo: valor < 0 ? 'SAIDA' : 'ENTRADA',
      forma: l.forma || FORMAS.OUTROS,
      categoria: l.categoria || 'outros',
      descricao: limpar(l.descricao || l.memo || ''),
      memo: limpar(l.memo || ''),
      documento: l.documento || null,
      contraparteNome: l.contraparteNome ? limpar(l.contraparteNome) : null,
      contraparteDoc: l.contraparteDoc ? soDigitos(l.contraparteDoc) : null,
      contraparteBanco: l.contraparteBanco || null,
      bandeira: l.bandeira || null,
      loja: l.loja || null,
      saldoApos: l.saldoApos ?? null,
      pagina: l.pagina ?? null,
    };
  });

  const creditos = round2(normalizados.filter((l) => l.valor > 0).reduce((s, l) => s + l.valor, 0));
  const debitos = round2(normalizados.filter((l) => l.valor < 0).reduce((s, l) => s - l.valor, 0));
  const conferencia = banco === 'MENTORE' || banco === 'PAGARME' || banco === 'DAYCOVAL'
    ? (() => {
        const calc = r.saldoInicial != null ? round2(r.saldoInicial + creditos - debitos) : null;
        const ok = calc != null && r.saldoFinalInformado != null && Math.abs(calc - r.saldoFinalInformado) < 0.009;
        return { saldoInicial: r.saldoInicial, inconsistencias: calc != null && r.saldoFinalInformado != null && !ok ? 1 : 0, conferido: calc != null, saldoFinalCalculado: calc };
      })()
    : conferirSaldo(normalizados, r.saldoInicial);
  const avisos = [...(r.avisos || [])];
  if (conferencia.inconsistencias) avisos.push(`${conferencia.inconsistencias} lançamento(s) com saldo que não fecha com o anterior.`);

  const ultimo = normalizados.at(-1);
  const saldoFinal = r.saldoFinalInformado ?? ultimo?.saldoApos ?? (r.saldoInicial != null ? round2(r.saldoInicial + creditos - debitos) : null);
  const periodo = {
    inicio: r.periodo?.inicio || normalizados[0]?.data || null,
    fim: r.periodo?.fim || ultimo?.data || null,
    primeiroLancamento: normalizados[0]?.data || null,
    ultimoLancamento: ultimo?.data || null,
  };

  return {
    banco,
    bancoCodigo: BANCOS[banco].codigo,
    bancoNome: BANCOS[banco].nome,
    arquivo: opts.nomeArquivo || null,
    titular: r.titular,
    periodo,
    saldo: { inicial: r.saldoInicial ?? null, final: saldoFinal, creditos, debitos },
    conferencia,
    avisos,
    paginas,
    qtd: normalizados.length,
    lancamentos: normalizados,
  };
}

export default { lerExtratoBancario, montarExtrato, detectarBanco, parseNumBr, BANCOS, FORMAS };
