// ============================================================
// TOTVS — títulos de cartão lançados com portador STONE
//
// No TOTVS Moda cada venda no cartão vira um TÍTULO no contas a receber
// (accounts-receivable/v2/documents/search), com uma linha por PARCELA:
//   documentType 4 = cartão de crédito · 5 = cartão de débito
//   bearerCode 6000..6099 / bearerName "STONE - VISA (C)", "STONE - MASTERCARD (D)"...
//   receivableCode = nº do título · installmentCode = nº da parcela
//   issueDate = data da venda · invoice[] = NF vinculada
// Não existe NSU no título, então o batimento com a Stone é feito por
// filial + data + valor + parcelas + bandeira/tipo (ver stoneBatimento.js).
// ============================================================
import axios from 'axios';
import { getToken } from '../utils/totvsTokenManager.js';
import { TOTVS_BASE_URL, httpsAgent } from '../totvsrouter/totvsHelper.js';

const PAGE_SIZE = 200;
const DOC_TYPES_CARTAO = [4, 5];
const DOC_TIPO = { 4: 'Crédito', 5: 'Débito' };
const STATUS = { 1: 'Normal', 2: 'Devolvido', 3: 'Cancelado', 4: 'Quebrada' };

const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;

// "STONE - VISA (C)" → { adquirente:'STONE', bandeira:'Visa', tipo:'Crédito' }
const BANDEIRA_CANONICA = [
  [/MASTER/i, 'Mastercard'],
  [/VISA/i, 'Visa'],
  [/\bELO\b/i, 'Elo'],
  [/AMEX|AMERICAN/i, 'Amex'],
  [/HIPER/i, 'Hipercard'],
  [/MAESTRO/i, 'Mastercard'],
  [/ELECTRON/i, 'Visa'],
];
export function interpretarPortador(nome = '') {
  const up = String(nome).toUpperCase();
  const adquirente = up.split(/\s|-/).filter(Boolean)[0] || null;
  let bandeira = null;
  for (const [re, b] of BANDEIRA_CANONICA) {
    if (re.test(up)) {
      bandeira = b;
      break;
    }
  }
  const tipo = /\(D\)|DEBITO|DÉBITO/.test(up)
    ? 'Débito'
    : /\(C\)|CREDITO|CRÉDITO/.test(up)
      ? 'Crédito'
      : null;
  return { adquirente, bandeira, tipo };
}

export const isPortadorStone = (item) =>
  /^STONE\b/i.test(String(item?.bearerName || '')) ||
  (Number(item?.bearerCode) >= 6000 && Number(item?.bearerCode) < 6100);

async function buscarPagina({ token, filter, page }) {
  return axios.post(
    `${TOTVS_BASE_URL}/accounts-receivable/v2/documents/search`,
    {
      filter,
      expand: 'invoice',
      page,
      pageSize: PAGE_SIZE,
      order: 'issueDate',
    },
    {
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
      timeout: 60000,
      httpsAgent,
    },
  );
}

/**
 * Busca as PARCELAS de cartão (docs 4/5) das filiais no período de EMISSÃO.
 * Retorna só as de portador STONE, já deduplicadas.
 */
export async function buscarParcelasCartaoStone({ branchCodes, inicioIso, fimIso }) {
  const tokenData = await getToken();
  if (!tokenData?.access_token) throw new Error('Token TOTVS indisponível.');
  let token = tokenData.access_token;

  const filter = {
    branchCodeList: branchCodes.map(Number),
    startIssueDate: `${inicioIso}T00:00:00`,
    endIssueDate: `${fimIso}T23:59:59`,
    documentTypeList: DOC_TYPES_CARTAO,
  };

  const vistos = new Set();
  const parcelas = [];
  const absorver = (items) => {
    for (const it of items || []) {
      const k = `${it.branchCode}|${it.receivableCode}|${it.installmentCode}`;
      if (vistos.has(k)) continue; // paginação do TOTVS pode repetir linhas
      vistos.add(k);
      parcelas.push(it);
    }
  };

  let first;
  try {
    first = await buscarPagina({ token, filter, page: 1 });
  } catch (err) {
    if (err.response?.status !== 401) throw err;
    token = (await getToken(true)).access_token;
    first = await buscarPagina({ token, filter, page: 1 });
  }
  absorver(first.data?.items);
  const totalPages = Number(first.data?.totalPages) || 1;

  // Páginas restantes em lotes de 5 (TOTVS aguenta; não precisa de mais)
  for (let start = 2; start <= totalPages; start += 5) {
    const lote = [];
    for (let p = start; p <= Math.min(start + 4, totalPages); p++) {
      lote.push(buscarPagina({ token, filter, page: p }));
    }
    const results = await Promise.all(lote);
    for (const r of results) absorver(r.data?.items);
  }

  return parcelas.filter(isPortadorStone);
}

/**
 * Agrupa parcelas em TÍTULOS (1 título = 1 venda no cartão).
 */
export function agruparTitulos(parcelas) {
  const map = new Map();
  for (const p of parcelas) {
    const chave = `${p.branchCode}|${p.receivableCode}`;
    let t = map.get(chave);
    if (!t) {
      const { bandeira, tipo } = interpretarPortador(p.bearerName);
      t = {
        chave,
        filial: Number(p.branchCode),
        titulo: Number(p.receivableCode),
        cliente: p.customerCode ?? null,
        cpfCnpj: p.customerCpfCnpj || null,
        nf: p.invoice?.[0]?.invoiceCode ?? null,
        nfData: p.invoice?.[0]?.invoiceDate ?? null,
        dataEmissao: p.issueDate ? String(p.issueDate).slice(0, 10) : null,
        portador: p.bearerName || null,
        portadorCodigo: p.bearerCode ?? null,
        bandeira: bandeira || 'Outros',
        tipoConta: tipo || DOC_TIPO[p.documentType] || '—',
        tipoDocumento: Number(p.documentType),
        status: STATUS[p.status] || `Cód. ${p.status}`,
        statusId: Number(p.status),
        cancelado: Number(p.status) === 3,
        parcelas: 0,
        valor: 0,
        valorPago: 0,
        primeiroVencimento: null,
        ultimoVencimento: null,
        dataPagamento: null,
        parcelasDetalhe: [],
      };
      map.set(chave, t);
    }
    t.parcelas += 1;
    t.valor = round2(t.valor + Number(p.installmentValue || 0));
    t.valorPago = round2(t.valorPago + Number(p.paidValue || 0));
    const venc = p.expiredDate ? String(p.expiredDate).slice(0, 10) : null;
    if (venc) {
      if (!t.primeiroVencimento || venc < t.primeiroVencimento) t.primeiroVencimento = venc;
      if (!t.ultimoVencimento || venc > t.ultimoVencimento) t.ultimoVencimento = venc;
    }
    const pag = p.paymentDate || p.settlementDate;
    if (pag && (!t.dataPagamento || pag > t.dataPagamento)) {
      t.dataPagamento = String(pag).slice(0, 10);
    }
    t.parcelasDetalhe.push({
      numero: Number(p.installmentCode),
      valor: round2(Number(p.installmentValue || 0)),
      valorPago: round2(Number(p.paidValue || 0)),
      vencimento: venc,
      pagamento: pag ? String(pag).slice(0, 10) : null,
      baixa: p.dischargeType ?? null,
    });
  }
  const titulos = [...map.values()];
  for (const t of titulos) t.parcelasDetalhe.sort((a, b) => a.numero - b.numero);
  titulos.sort((a, b) =>
    a.dataEmissao === b.dataEmissao ? a.titulo - b.titulo : a.dataEmissao < b.dataEmissao ? -1 : 1,
  );
  return titulos;
}

export async function buscarTitulosCartaoStone(params) {
  const parcelas = await buscarParcelasCartaoStone(params);
  return agruparTitulos(parcelas);
}

// ─── Empresas do TOTVS por CNPJ ───────────────────────────────
// Mesma fonte do FiltroEmpresa do HeadCoach (person/v2/branchesList).
// Liga cada StoneCode (CNPJ informado pela Stone) à empresa do TOTVS.
let _filiaisCache = null;
let _filiaisCacheAt = 0;
const FILIAIS_TTL = 30 * 60 * 1000;

export async function mapearFiliaisTotvsPorCnpj() {
  if (_filiaisCache && Date.now() - _filiaisCacheAt < FILIAIS_TTL) return _filiaisCache;
  const tokenData = await getToken();
  if (!tokenData?.access_token) throw new Error('Token TOTVS indisponível.');
  const map = new Map();
  let page = 1;
  for (;;) {
    const r = await axios.get(
      `${TOTVS_BASE_URL}/person/v2/branchesList?BranchCodePool=1&Page=${page}&PageSize=1000`,
      {
        headers: { Accept: 'application/json', Authorization: `Bearer ${tokenData.access_token}` },
        timeout: 20000,
        httpsAgent,
      },
    );
    const items = r.data?.items || [];
    for (const b of items) {
      const cnpj = String(b.cnpj || '').replace(/\D/g, '');
      const code = parseInt(b.code);
      if (!cnpj || Number.isNaN(code)) continue;
      // um CNPJ pode ter mais de uma empresa no TOTVS (ex.: 98/980) — guarda todas
      if (!map.has(cnpj)) map.set(cnpj, []);
      map.get(cnpj).push({
        code,
        nome: b.branchGroupName || b.fantasyName || b.description || `Filial ${code}`,
      });
    }
    if (!r.data?.hasNext || items.length === 0) break;
    page += 1;
  }
  _filiaisCache = map;
  _filiaisCacheAt = Date.now();
  return map;
}

/**
 * Resolve as filiais TOTVS de uma loja Stone: empresas do TOTVS com o mesmo
 * CNPJ + as extras do config (StoneCode compartilhado). Cai no config se o
 * TOTVS estiver fora.
 */
export function resolverFiliaisLoja(loja, mapaCnpj) {
  const doTotvs = (mapaCnpj?.get(loja.cnpj) || []).map((f) => f.code);
  const codes = [...new Set([...doTotvs, ...(loja.filiais || [])])];
  const nomes = {};
  for (const [, lista] of mapaCnpj || []) for (const f of lista) nomes[f.code] = f.nome;
  return {
    filiais: codes.length ? codes : loja.filiais || [],
    filialTotvs: doTotvs.length
      ? { code: doTotvs[0], nome: nomes[doTotvs[0]] || null, encontrada: true }
      : { code: loja.filiais?.[0] ?? null, nome: null, encontrada: false },
    nomesFiliais: Object.fromEntries(codes.map((c) => [c, nomes[c] || null])),
  };
}
