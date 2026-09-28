// ============================================================
// Stone Conciliação — download, parse e cache do arquivo diário
//
// Fluxo (cliente Stone):
//   1. GET https://conciliation.stone.com.br/v2/merchant/{stonecode}/conciliation-file/{AAAAMMDD}?layout=XML2_2
//      Authorization: Basic base64("sk_...:")  +  x-user-type: client
//   2. 307 → Location = blob Azure com SAS token (baixar SEM Authorization)
//   3. Conteúdo XML (às vezes gzipado em repouso) → parse → JSON normalizado
//
// Regras da Stone que moldam este módulo:
//   • Arquivo é POR DIA e POR STONECODE; fica disponível a partir das ~5h
//     do dia seguinte (503 antes disso).
//   • Rate limit: 7 requisições por HORA por combinação StoneCode + data
//     (429 quando estoura). Por isso TUDO passa por cache:
//       - memória do processo (sempre)
//       - Supabase `stone_conciliacao_arquivos` (quando a tabela existir)
//     Um dia baixado com sucesso nunca é baixado de novo, salvo `force`.
//
// Seções do arquivo (layout 2.2):
//   FinancialTransactions          → vendas CAPTURADAS / canceladas no dia
//   FinancialTransactionsAccounts  → parcelas LIQUIDADAS (pagas) no dia
//   FinancialEvents / *Accounts    → eventos (aluguel, ajustes...) e liquidação
//   Payments                       → depósitos feitos ao lojista no dia
//   Trailer                        → contadores
// ============================================================
import axios from 'axios';
import zlib from 'zlib';
import { XMLParser } from 'fast-xml-parser';
import supabase from '../config/supabase.js';

const STONE_BASE = 'https://conciliation.stone.com.br';
const TABELA_ARQUIVOS = 'stone_conciliacao_arquivos';
const LAYOUT_PADRAO = 'XML2_2';

const xmlParser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false, // tudo string: preserva zeros à esquerda e precisão
  trimValues: true,
});

// ─── helpers ────────────────────────────────────────────────────
export const toArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

export const num = (v) => {
  if (v == null || v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;

// "20260605" → "2026-06-05" | "20260605131754" → "2026-06-05 13:17:54"
export const fmtStoneDate = (s) => {
  if (!s) return null;
  const str = String(s);
  if (str.length < 8) return str;
  const base = `${str.slice(0, 4)}-${str.slice(4, 6)}-${str.slice(6, 8)}`;
  if (str.length >= 14) {
    return `${base} ${str.slice(8, 10)}:${str.slice(10, 12)}:${str.slice(12, 14)}`;
  }
  return base;
};

// "2026-06-05" → "20260605"
export const toStoneDate = (iso) => String(iso || '').replace(/-/g, '').slice(0, 8);

// Códigos → rótulos. BrandId 1/2 e AccountType 1/2 confirmados contra o
// TOTVS (portador STONE - VISA/MASTERCARD (C|D)); demais são best-effort.
export const BRANDS = {
  1: 'Visa',
  2: 'Mastercard',
  3: 'Amex',
  4: 'Elo',
  5: 'Hipercard',
  6: 'Hiper',
  9: 'Outros',
  1033: 'Boleto',
};
// AccountType 3 aparece em cartões pré-pagos/voucher; o TOTVS lança como débito.
export const ACCOUNT_TYPES = { 1: 'Débito', 2: 'Crédito', 3: 'Pré-pago', 10: 'Boleto' };
export const ENTRY_MODES = {
  1: 'Chip',
  2: 'Tarja',
  3: 'Digitado',
  4: 'Contactless',
  7: 'E-commerce',
};
export const FEE_TYPES = {
  1: 'Taxa antecip. + MDR',
  2: 'Taxa única',
  255: 'Default',
};
export const INSTALLMENT_TYPES = { 1: 'À vista', 2: 'Lojista', 3: 'Emissor' };
export const WALLET_TYPES = {
  1: 'Visa Crédito',
  2: 'Visa Débito',
  3: 'Mastercard Crédito',
  4: 'Mastercard Débito',
  5: 'Elo Crédito',
  6: 'Elo Débito',
  7: 'Antecipação',
  8: 'Hipercard Crédito',
  9: 'Amex Crédito',
};
export const label = (map, code) =>
  map[Number(code)] || (code != null && code !== '' ? `Cód. ${code}` : '—');

// ─── erros tipados ─────────────────────────────────────────────
export class StoneError extends Error {
  constructor(message, { status, codigo, retryable = false } = {}) {
    super(message);
    this.name = 'StoneError';
    this.status = status;
    this.codigo = codigo;
    this.retryable = retryable;
  }
}

// ─── download ──────────────────────────────────────────────────
async function baixarXml(loja, dataStone, layout = LAYOUT_PADRAO) {
  if (!loja?.apiKey) {
    throw new StoneError(
      `Loja ${loja?.nome || loja?.stonecode} sem chave de API da Stone configurada.`,
      { status: 0, codigo: 'SEM_CHAVE' },
    );
  }
  const url = `${STONE_BASE}/v2/merchant/${loja.stonecode}/conciliation-file/${dataStone}?layout=${layout}`;
  const basic = Buffer.from(`${loja.apiKey}:`).toString('base64');

  const resp = await axios.get(url, {
    headers: {
      Authorization: `Basic ${basic}`,
      'x-user-type': 'client',
      'Accept-Encoding': 'gzip',
    },
    maxRedirects: 0,
    validateStatus: () => true,
    responseType: 'arraybuffer',
    timeout: 30000,
  });

  const st = resp.status;
  if (st === 200) return decodificar(Buffer.from(resp.data));
  if (st === 307 || st === 302) {
    const location = resp.headers?.location;
    if (!location) throw new StoneError('Stone redirecionou sem Location.', { status: st });
    const blob = await axios.get(location, { responseType: 'arraybuffer', timeout: 60000 });
    return decodificar(Buffer.from(blob.data));
  }
  const corpo = Buffer.from(resp.data || '').toString('utf-8').slice(0, 300);
  if (st === 401)
    throw new StoneError('Falha de autenticação na Stone (401). Verifique a chave sk_.', {
      status: 401,
      codigo: 'AUTH',
    });
  if (st === 403)
    throw new StoneError(
      `Chave sem permissão para o StoneCode ${loja.stonecode} (403). A chave deve ser gerada no Portal Stone deste estabelecimento.`,
      { status: 403, codigo: 'FORBIDDEN' },
    );
  if (st === 429)
    throw new StoneError(
      'Limite da Stone atingido (7 downloads/hora por loja+dia). Tente novamente mais tarde.',
      { status: 429, codigo: 'RATE_LIMIT', retryable: true },
    );
  if (st === 503)
    throw new StoneError(
      'Arquivo ainda não disponível na Stone (fica pronto a partir das 5h do dia seguinte).',
      { status: 503, codigo: 'INDISPONIVEL', retryable: true },
    );
  throw new StoneError(`Stone respondeu ${st}: ${corpo || 'sem detalhes'}`, {
    status: st,
    retryable: st >= 500,
  });
}

function decodificar(buf) {
  if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
    return zlib.gunzipSync(buf).toString('utf-8');
  }
  return buf.toString('utf-8');
}

// ─── parse ─────────────────────────────────────────────────────
function parseInstallment(p) {
  return {
    numero: num(p.InstallmentNumber),
    bruto: round2(num(p.GrossAmount)),
    liquido: round2(num(p.NetAmount)),
    taxa: round2(num(p.SaleFee) || num(p.GrossAmount) - num(p.NetAmount)),
    mdr: p.MdrAmount != null ? round2(num(p.MdrAmount)) : null,
    previsaoPagamento: fmtStoneDate(p.PrevisionPaymentDate),
    dataPagamento: fmtStoneDate(p.PaymentDate),
    dataOriginal: fmtStoneDate(
      p.OriginalPaymentDate || p.AdvancedReceivableOriginalPaymentDate,
    ),
    antecipada: !!p.AdvancedReceivableOriginalPaymentDate,
    paymentId: p.PaymentId || null,
    suspensaChargeback: String(p.SuspendedByChargeback).toLowerCase() === 'true',
  };
}

function parseTransacao(t, dataArquivo) {
  const installments = toArray(t.Installments?.Installment).map(parseInstallment);
  const cancelamentos = toArray(t.Cancellations?.Cancellation).map((c) => ({
    paymentId: c.PaymentId || null,
    operationKey: c.OperationKey || null,
    parcela: c.InstallmentNumber != null ? num(c.InstallmentNumber) : null,
    dataHora: fmtStoneDate(c.CancellationDateTime),
    valorDevolvido: round2(num(c.ReturnedAmount)),
  }));
  const ev = t.Events || {};
  const eventos = {
    capturas: num(ev.Captures),
    cancelamentos: num(ev.Cancellations),
    cobrancasCancelamento: num(ev.CancellationCharges),
    chargebacks: num(ev.Chargebacks),
    estornosChargeback: num(ev.ChargebackRefunds),
    pagamentos: num(ev.Payments),
  };
  const bruto = round2(num(t.CapturedAmount) || num(t.AuthorizedAmount));
  const liquido = round2(installments.reduce((s, p) => s + p.liquido, 0));
  const cancelado = round2(
    num(t.CanceledAmount) ||
      cancelamentos.reduce((s, c) => s + c.valorDevolvido, 0),
  );
  const captura = fmtStoneDate(t.CaptureLocalDateTime);
  const autorizacao = fmtStoneDate(t.AuthorizationDateTime);
  return {
    nsu: t.AcquirerTransactionKey || null,
    chaveIniciador: t.InitiatorTransactionKey || null,
    dataArquivo,
    // data da venda = data local da captura (fallback: autorização, arquivo)
    dataVenda: (captura || autorizacao || dataArquivo || '').slice(0, 10) || null,
    dataAutorizacao: autorizacao,
    dataCaptura: captura,
    bandeira: label(BRANDS, t.BrandId),
    bandeiraId: t.BrandId != null ? Number(t.BrandId) : null,
    tipoConta: label(ACCOUNT_TYPES, t.AccountType),
    tipoContaId: t.AccountType != null ? Number(t.AccountType) : null,
    tipoParcelamento: label(INSTALLMENT_TYPES, t.InstallmentType),
    formaEntrada: label(ENTRY_MODES, t.EntryMode),
    tipoTaxa: label(FEE_TYPES, t.FeeType),
    cartao: t.CardNumber || null,
    codAutorizacao: t.IssuerAuthorizationCode || null,
    parcelas: num(t.NumberOfInstallments) || installments.length || 1,
    internacional: String(t.International).toLowerCase() === 'true',
    serialPos: t.Poi?.SerialNumber || null,
    valorAutorizado: round2(num(t.AuthorizedAmount)),
    valorBruto: bruto,
    valorLiquido: liquido,
    valorCancelado: cancelado,
    taxa: round2(bruto - liquido),
    cancelada: cancelado > 0 || eventos.cancelamentos > 0,
    eventos,
    cancelamentos,
    installments,
  };
}

export function parseArquivoStone(xml, dataStone) {
  const parsed = xmlParser.parse(xml);
  const conc = parsed?.Conciliation || {};
  const header = conc.Header || {};
  const trailer = conc.Trailer || {};
  const dataArquivo = fmtStoneDate(header.ReferenceDate || dataStone);

  const transacoes = toArray(conc.FinancialTransactions?.Transaction).map((t) =>
    parseTransacao(t, dataArquivo),
  );

  // Parcelas liquidadas no dia (o que a Stone efetivamente pagou)
  const liquidacoes = toArray(conc.FinancialTransactionsAccounts?.Transaction).flatMap(
    (t) => {
      const base = {
        nsu: t.AcquirerTransactionKey || null,
        dataCaptura: fmtStoneDate(t.CaptureLocalDateTime),
        formaEntrada: label(ENTRY_MODES, t.EntryMode),
      };
      return toArray(t.Installments?.Installment).map((p) => ({
        ...base,
        ...parseInstallment(p),
      }));
    },
  );

  const eventosFinanceiros = toArray(conc.FinancialEvents?.Event).map((e) => ({
    tipo: e.EventType || e.Type || null,
    descricao: e.Description || null,
    valor: round2(num(e.Amount) || num(e.GrossAmount)),
    data: fmtStoneDate(e.EventDateTime || e.PaymentDate),
    paymentId: e.PaymentId || null,
  }));

  const pagamentos = toArray(conc.Payments?.Payment).map((p) => ({
    id: p.Id || null,
    carteira: label(WALLET_TYPES, p.WalletTypeId),
    carteiraId: p.WalletTypeId != null ? Number(p.WalletTypeId) : null,
    valorTotal: round2(num(p.TotalAmount)),
    valorTransacoes: round2(num(p.TotalFinancialAccountsAmount)),
    valorEventos: round2(num(p.TotalFinancialEventsAmount)),
    saldoNegativoAnterior: round2(num(p.LastNegativeAmount)),
    banco: p.FavoredBankAccount?.BankCode || null,
    agencia: p.FavoredBankAccount?.BankBranch || null,
    conta: p.FavoredBankAccount?.BankAccountNumber || null,
  }));

  return {
    dataStone,
    data: dataArquivo,
    header: {
      stonecode: header.StoneCode || null,
      geradoEm: fmtStoneDate(header.GenerationDateTime),
      layout: header.LayoutVersion || null,
      fileId: header.FileId || null,
    },
    trailer: {
      capturadas: num(trailer.CapturedTransactionsQuantity),
      canceladas: num(trailer.CanceledTransactionsQuantity),
      parcelasPagas: num(trailer.PaidInstallmentsQuantity),
      chargebacks: num(trailer.ChargebacksQuantity),
      cobrancasCancelamento: num(trailer.ChargedCancellationsQuantity),
      eventosPagos: num(trailer.PaidEventsQuantity),
      eventosCobrados: num(trailer.ChargedEventsQuantity),
    },
    transacoes,
    liquidacoes,
    eventosFinanceiros,
    pagamentos,
  };
}

// ─── cache ─────────────────────────────────────────────────────
const memCache = new Map(); // `${stonecode}|${dataStone}|${layout}` → dia
let tabelaIndisponivel = false; // evita log repetido quando a migration não rodou
const inflight = new Map(); // dedup de downloads simultâneos do mesmo dia

const isMissingTable = (error) =>
  !!error &&
  (error.code === '42P01' ||
    error.code === 'PGRST205' ||
    /does not exist|Could not find the table|schema cache/i.test(error.message || ''));

const chaveCache = (stonecode, dataStone, layout) => `${stonecode}|${dataStone}|${layout}`;

async function lerCacheDb(stonecode, dataIso, layout) {
  if (tabelaIndisponivel) return null;
  try {
    const { data, error } = await supabase
      .from(TABELA_ARQUIVOS)
      .select('conteudo, baixado_em')
      .eq('stonecode', String(stonecode))
      .eq('data_ref', dataIso)
      .eq('layout', layout)
      .maybeSingle();
    if (error) {
      if (isMissingTable(error)) {
        tabelaIndisponivel = true;
        console.warn(
          `[stone] tabela ${TABELA_ARQUIVOS} não existe — cache só em memória. Rode migrations/stone_conciliacao.sql.`,
        );
        return null;
      }
      throw error;
    }
    if (!data?.conteudo) return null;
    return { ...data.conteudo, _cache: 'db', _baixadoEm: data.baixado_em };
  } catch (e) {
    console.warn(`[stone] falha lendo cache DB (${stonecode}/${dataIso}): ${e.message}`);
    return null;
  }
}

async function gravarCacheDb(stonecode, dataIso, layout, dia) {
  if (tabelaIndisponivel) return;
  try {
    const { error } = await supabase.from(TABELA_ARQUIVOS).upsert(
      {
        stonecode: String(stonecode),
        data_ref: dataIso,
        layout,
        conteudo: dia,
        qtd_transacoes: dia.transacoes.length,
        qtd_pagamentos: dia.pagamentos.length,
        valor_bruto: round2(dia.transacoes.reduce((s, t) => s + t.valorBruto, 0)),
        gerado_em: dia.header.geradoEm ? dia.header.geradoEm.replace(' ', 'T') : null,
        baixado_em: new Date().toISOString(),
      },
      { onConflict: 'stonecode,data_ref,layout' },
    );
    if (error) {
      if (isMissingTable(error)) {
        tabelaIndisponivel = true;
        return;
      }
      throw error;
    }
  } catch (e) {
    console.warn(`[stone] falha gravando cache DB (${stonecode}/${dataIso}): ${e.message}`);
  }
}

// Data ISO de hoje/ontem no fuso de Brasília (arquivo sai às 5h BRT do dia seguinte)
const hojeBrasilia = () => {
  const d = new Date(Date.now() - 3 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
};

/**
 * Obtém o arquivo de UM dia (cache → Stone).
 * @returns dia normalizado (ver parseArquivoStone) com `_cache` = 'mem'|'db'|null
 */
export async function obterDiaStone(loja, dataIso, { force = false, layout = LAYOUT_PADRAO } = {}) {
  const dataStone = toStoneDate(dataIso);
  const key = chaveCache(loja.stonecode, dataStone, layout);

  if (!force) {
    if (memCache.has(key)) return { ...memCache.get(key), _cache: 'mem' };
    const db = await lerCacheDb(loja.stonecode, dataIso, layout);
    if (db) {
      memCache.set(key, db);
      return db;
    }
  }

  if (dataIso >= hojeBrasilia()) {
    throw new StoneError(
      'Arquivo de hoje ainda não existe — a Stone gera o arquivo a partir das 5h do dia seguinte.',
      { status: 0, codigo: 'FUTURO' },
    );
  }

  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    try {
      const xml = await baixarXml(loja, dataStone, layout);
      const dia = parseArquivoStone(xml, dataStone);
      memCache.set(key, dia);
      await gravarCacheDb(loja.stonecode, dataIso, layout, dia);
      return { ...dia, _cache: null };
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

// Lista de datas ISO entre inicio e fim (inclusive)
export function rangeDatasIso(inicioIso, fimIso) {
  const out = [];
  const ini = new Date(`${inicioIso}T00:00:00Z`);
  const fim = new Date(`${fimIso}T00:00:00Z`);
  if (isNaN(ini) || isNaN(fim) || ini > fim) return out;
  for (let d = new Date(ini); d <= fim; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

// Executa tarefas com concorrência limitada (não estoura a Stone nem o Node)
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let idx = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * Obtém todos os dias de um período para uma loja.
 * Dias com erro não derrubam a consulta: vão em `erros`.
 */
export async function obterPeriodoStone(
  loja,
  inicioIso,
  fimIso,
  { force = false, concorrencia = 4 } = {},
) {
  const datas = rangeDatasIso(inicioIso, fimIso);
  const dias = [];
  const erros = [];
  await mapLimit(datas, concorrencia, async (dataIso) => {
    try {
      dias.push(await obterDiaStone(loja, dataIso, { force }));
    } catch (err) {
      erros.push({
        data: dataIso,
        erro: err.message,
        codigo: err.codigo || null,
        retryable: !!err.retryable,
      });
    }
  });
  dias.sort((a, b) => (a.data < b.data ? -1 : 1));
  erros.sort((a, b) => (a.data < b.data ? -1 : 1));
  return { datas, dias, erros };
}

export const _internals = { memCache, baixarXml };
