import express from 'express';
import axios from 'axios';
import {
  asyncHandler,
  successResponse,
  errorResponse,
} from '../utils/errorHandler.js';
import { getToken } from '../utils/totvsTokenManager.js';
import {
  httpsAgent,
  httpAgent,
  TOTVS_BASE_URL,
  getBranchCodes,
  getBranchesWithNames,
  fetchBranchTotalsFromTotvs,
} from './totvsHelper.js';
import supabase from '../config/supabase.js';
import supabaseFiscal from '../config/supabaseFiscal.js';

// Operações que o TOTVS NÃO classifica como operationModel "Sales", então
// não retornam no /sale-panel/v2/totals-branch/search mesmo passando elas
// em `operations`. Precisam ser somadas manualmente do Supabase fiscal.
// Adicione aqui novas ops que o gestor pedir para incluir no Ranking.
const RANKING_NON_SALES_OPS = [5919]; // 5919 = REMESSA DE BONIFICACAO - ELITE

// Busca no Supabase fiscal o agregado por filial das operações fora do
// universo "Sales" do TOTVS, no período. Retorna mapa { branchCode: {invoice_qty, invoice_value, itens_qty} }
async function fetchNonSalesAgg({ branchs, datemin, datemax }) {
  if (!RANKING_NON_SALES_OPS.length || !branchs?.length) return {};
  try {
    const { data, error } = await supabaseFiscal
      .from('notas_fiscais')
      .select('branch_code, total_value, quantity, invoice_status')
      .in('operation_code', RANKING_NON_SALES_OPS)
      .in('branch_code', branchs)
      .eq('operation_type', 'Output')
      .gte('issue_date', datemin)
      .lte('issue_date', datemax)
      .limit(50000);
    if (error) {
      console.error('[Ranking/NonSales] supabase erro:', error.message);
      return {};
    }
    const agg = {};
    for (const r of data || []) {
      if (r.invoice_status === 'Canceled' || r.invoice_status === 'Deleted') continue;
      const code = Number(r.branch_code);
      if (!agg[code]) agg[code] = { invoice_qty: 0, invoice_value: 0, itens_qty: 0 };
      agg[code].invoice_qty += 1;
      agg[code].invoice_value += Number(r.total_value || 0);
      agg[code].itens_qty += Number(r.quantity || 0);
    }
    console.log(
      `[Ranking/NonSales] +${Object.keys(agg).length} filiais com ops ${RANKING_NON_SALES_OPS.join(',')}`,
    );
    return agg;
  } catch (e) {
    console.error('[Ranking/NonSales] fetch falhou:', e.message);
    return {};
  }
}

// Variante do fetchNonSalesAgg com quebra por VENDEDOR (dealer_code da NF).
// Usada pelo Painel de Vendas pra atribuir a 5919 ao vendedor real (ex: NF
// de bonificação emitida pela vendedora da loja). Retorna
// Map branchCode → Map dealerCode|null → { qtd, valor }
async function fetchNonSalesPorVendedor({ branchs, datemin, datemax }) {
  if (!RANKING_NON_SALES_OPS.length || !branchs?.length) return new Map();
  try {
    const { data, error } = await supabaseFiscal
      .from('notas_fiscais')
      .select('branch_code, dealer_code, total_value, invoice_status')
      .in('operation_code', RANKING_NON_SALES_OPS)
      .in('branch_code', branchs)
      .eq('operation_type', 'Output')
      .gte('issue_date', datemin)
      .lte('issue_date', datemax)
      .limit(50000);
    if (error) {
      console.error('[PainelVendas/NonSales] supabase erro:', error.message);
      return new Map();
    }
    const porBranch = new Map();
    for (const r of data || []) {
      if (r.invoice_status === 'Canceled' || r.invoice_status === 'Deleted') continue;
      const bc = Number(r.branch_code);
      const dealer = r.dealer_code != null ? Number(r.dealer_code) : null;
      if (!porBranch.has(bc)) porBranch.set(bc, new Map());
      const porDealer = porBranch.get(bc);
      const cur = porDealer.get(dealer) || { qtd: 0, valor: 0 };
      cur.qtd += 1;
      cur.valor += Number(r.total_value || 0);
      porDealer.set(dealer, cur);
    }
    return porBranch;
  } catch (e) {
    console.error('[PainelVendas/NonSales] fetch falhou:', e.message);
    return new Map();
  }
}

// Mescla o agregado non-sales no dataRow TOTVS por filial.
function mergeNonSalesIntoDataRow(dataRow, agg) {
  if (!agg || !Object.keys(agg).length) return dataRow;
  const map = new Map();
  for (const row of dataRow || []) {
    const code = Number(row.branch_code);
    map.set(code, { ...row });
  }
  for (const [code, extra] of Object.entries(agg)) {
    const codeNum = Number(code);
    const existing = map.get(codeNum);
    if (existing) {
      existing.invoice_qty = (existing.invoice_qty || 0) + extra.invoice_qty;
      existing.invoice_value =
        Number(existing.invoice_value || 0) + extra.invoice_value;
      existing.itens_qty = (existing.itens_qty || 0) + extra.itens_qty;
      existing.tm =
        existing.invoice_qty > 0
          ? existing.invoice_value / existing.invoice_qty
          : 0;
      existing.pa =
        existing.invoice_qty > 0
          ? existing.itens_qty / existing.invoice_qty
          : 0;
      existing.pmpv =
        existing.itens_qty > 0
          ? existing.invoice_value / existing.itens_qty
          : 0;
      map.set(codeNum, existing);
    }
    // Se a filial não estava no dataRow (sem vendas Sales), criamos uma entrada
    // só com a 5919 — assim ela aparece no ranking.
    else {
      map.set(codeNum, {
        branch_code: String(codeNum),
        branch_name: '',
        invoice_qty: extra.invoice_qty,
        invoice_value: extra.invoice_value,
        itens_qty: extra.itens_qty,
        tm: extra.invoice_qty > 0 ? extra.invoice_value / extra.invoice_qty : 0,
        pa: extra.invoice_qty > 0 ? extra.itens_qty / extra.invoice_qty : 0,
        pmpv: extra.itens_qty > 0 ? extra.invoice_value / extra.itens_qty : 0,
      });
    }
  }
  return Array.from(map.values());
}

// Re-soma os totais agregados (header) a partir do dataRow final.
function recalcTotal(dataRow) {
  if (!Array.isArray(dataRow) || dataRow.length === 0) return null;
  const summed = dataRow.reduce(
    (acc, r) => ({
      invoice_qty: acc.invoice_qty + Number(r.invoice_qty || 0),
      invoice_value: acc.invoice_value + Number(r.invoice_value || 0),
      itens_qty: acc.itens_qty + Number(r.itens_qty || 0),
    }),
    { invoice_qty: 0, invoice_value: 0, itens_qty: 0 },
  );
  summed.tm =
    summed.invoice_qty > 0 ? summed.invoice_value / summed.invoice_qty : 0;
  summed.pa =
    summed.invoice_qty > 0 ? summed.itens_qty / summed.invoice_qty : 0;
  summed.pmpv =
    summed.itens_qty > 0 ? summed.invoice_value / summed.itens_qty : 0;
  return summed;
}

const router = express.Router();

// =============================================================================
// PAINEL DE VENDAS — Faturamento Total
// POST /api/totvs/sale-panel/totals
// Body: { filtroempresa?: number[], datemin, datemax, operations?, sellers? }
// filtroempresa → lista de branchCodes do FiltroEmpresa; se omitido, usa todos.
// =============================================================================
router.post(
  '/sale-panel/totals',
  asyncHandler(async (req, res) => {
    const { filtroempresa, datemin, datemax, operations, sellers } = req.body;

    if (!datemin || !datemax) {
      return errorResponse(
        res,
        'Os campos datemin e datemax são obrigatórios',
        400,
        'MISSING_DATES',
      );
    }

    const tokenData = await getToken();
    if (!tokenData?.access_token) {
      return errorResponse(
        res,
        'Não foi possível obter token de autenticação TOTVS',
        503,
        'TOKEN_UNAVAILABLE',
      );
    }

    let token = tokenData.access_token;

    // Resolver branchs: usa filtroempresa do frontend ou busca todas do cache
    let branchs;
    if (Array.isArray(filtroempresa) && filtroempresa.length > 0) {
      branchs = filtroempresa
        .map((b) => parseInt(b))
        .filter((b) => !isNaN(b) && b > 0);
    }
    if (!branchs || branchs.length === 0) {
      branchs = await getBranchCodes(token);
    }

    const payload = {
      branchs,
      datemin,
      datemax,
      ...(Array.isArray(operations) && operations.length > 0 && { operations }),
      ...(Array.isArray(sellers) && sellers.length > 0 && { sellers }),
    };

    const endpoint = `${TOTVS_BASE_URL}/sale-panel/v2/totals/search`;

    console.log(`📊 [PainelVendas] ${endpoint}`, JSON.stringify(payload));

    const doRequest = async (accessToken) =>
      axios.post(endpoint, payload, {
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        httpsAgent,
        httpAgent,
        timeout: 60000,
      });

    let response;
    try {
      response = await doRequest(token);
    } catch (error) {
      if (error.response?.status === 401) {
        console.log('🔄 [PainelVendas] Token expirado, renovando...');
        const newTokenData = await getToken(true);
        response = await doRequest(newTokenData.access_token);
      } else {
        throw error;
      }
    }

    return successResponse(
      res,
      response.data,
      'Faturamento total obtido com sucesso',
    );
  }),
);

// =============================================================================
// RANKING DE FATURAMENTO POR FILIAL
// POST /api/totvs/sale-panel/ranking-faturamento
// Body: { datemin, datemax, operations?, branchs? }
// Se branchs não informado, busca todos via getBranchCodes()
// =============================================================================
router.post(
  '/sale-panel/ranking-faturamento',
  asyncHandler(async (req, res) => {
    const { datemin, datemax, operations, branchs } = req.body;

    if (!datemin || !datemax) {
      return errorResponse(
        res,
        'Os campos datemin e datemax são obrigatórios',
        400,
        'MISSING_DATES',
      );
    }

    const tokenData = await getToken();
    if (!tokenData?.access_token) {
      return errorResponse(
        res,
        'Não foi possível obter token de autenticação TOTVS',
        503,
        'TOKEN_UNAVAILABLE',
      );
    }

    const token = tokenData.access_token;

    let resolvedBranchs;
    if (Array.isArray(branchs) && branchs.length > 0) {
      resolvedBranchs = branchs
        .map((b) => parseInt(b))
        .filter((b) => !isNaN(b) && b > 0);
    } else {
      resolvedBranchs = await getBranchCodes(token);
    }

    const [mergedData, nonSalesAgg] = await Promise.all([
      fetchBranchTotalsFromTotvs({
        initialToken: token,
        branchs: resolvedBranchs,
        datemin,
        datemax,
        refreshToken: async () => {
          const data = await getToken(true);
          return data.access_token;
        },
        logTag: 'RankingFaturamento',
      }),
      // Operações fora de "Sales" do TOTVS (ex: 5919 REMESSA DE BONIFICACAO ELITE)
      // não voltam no totals-branch/search, somamos manualmente do Supabase.
      fetchNonSalesAgg({
        branchs: resolvedBranchs,
        datemin,
        datemax,
      }),
    ]);

    // Mescla as ops non-sales no resultado, mantém ordenação por invoice_value
    const augmentedDataRow = mergeNonSalesIntoDataRow(
      mergedData.dataRow,
      nonSalesAgg,
    ).sort(
      (a, b) => Number(b.invoice_value || 0) - Number(a.invoice_value || 0),
    );

    const augmented = {
      ...mergedData,
      dataRow: augmentedDataRow,
      total: recalcTotal(augmentedDataRow) || mergedData.total,
    };

    return successResponse(
      res,
      augmented,
      'Ranking de faturamento por filial obtido com sucesso',
    );
  }),
);

// =============================================================================
// VENDEDORES DO PAINEL DE VENDAS (por filial)
// POST /api/totvs/sale-panel/sellers
// Body: { filtroempresa?: number[], datemin, datemax }
// Retorna: { branches: [{ branch_code, branch_name, dataRow, invoiceQuantity, invoiceValue, itemQuantity }] }
// =============================================================================
router.post(
  '/sale-panel/sellers',
  asyncHandler(async (req, res) => {
    const { filtroempresa, datemin, datemax } = req.body;

    if (!datemin || !datemax) {
      return errorResponse(
        res,
        'Os campos datemin e datemax são obrigatórios',
        400,
        'MISSING_DATES',
      );
    }

    const tokenData = await getToken();
    if (!tokenData?.access_token) {
      return errorResponse(
        res,
        'Não foi possível obter token de autenticação TOTVS',
        503,
        'TOKEN_UNAVAILABLE',
      );
    }

    let token = tokenData.access_token;

    // Resolver filiais com nomes
    const allBranches = await getBranchesWithNames(token);
    let branches;
    if (Array.isArray(filtroempresa) && filtroempresa.length > 0) {
      const filterSet = new Set(
        filtroempresa.map((b) => parseInt(b)).filter((b) => !isNaN(b) && b > 0),
      );
      branches = allBranches.filter((b) => filterSet.has(b.code));
    } else {
      branches = allBranches;
    }

    const endpoint = `${TOTVS_BASE_URL}/sale-panel/v2/sellers/search`;

    // Mesmas filiais e operações especiais usadas no ranking-faturamento
    const SPECIAL_BRANCH_CODES = new Set([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 31, 41, 45, 50, 55,
      65, 75, 85, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101,
      105, 106, 107, 108, 109, 111, 200, 300, 311, 351, 400, 411, 450, 500, 550,
      551, 600, 650, 700, 750, 800, 850, 870, 880, 890, 891, 900, 910, 920, 930,
      940, 950, 960, 970, 980, 990,
    ]);
    const SPECIAL_OPERATIONS = [
      1, 2, 55, 510, 511, 1511, 521, 1521, 522, 960, 9001, 9009, 9027, 9017,
      9400, 9401, 9402, 9403, 9404, 9005, 545, 546, 555, 548, 1210, 9405, 1205,
      1101, 9065, 9064, 9063, 9062, 9061, 9420, 9026, 9067, 7234, 7236, 7240,
      7241, 7242, 7234, 7235, 7236, 7237, 7240, 7254, 7259, 7255, 7243, 7245,
      7244,
      5919, // adicionada em 2026-06 — entra também em PainelVendas/Sellers
    ];

    console.log(
      `👤 [PainelVendas/Sellers] ${endpoint} — ${branches.length} filiais`,
    );

    const doRequest = async (accessToken, branchCode) => {
      const body = { branchs: [branchCode], datemin, datemax };
      if (SPECIAL_BRANCH_CODES.has(branchCode)) {
        body.operations = SPECIAL_OPERATIONS;
      }
      return axios.post(endpoint, body, {
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        httpsAgent,
        httpAgent,
        timeout: 60000,
      });
    };

    // Chamar por filial em lotes de 5 para não sobrecarregar
    const BATCH_SIZE = 5;
    const results = [];
    for (let i = 0; i < branches.length; i += BATCH_SIZE) {
      const batch = branches.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(async (branch) => {
          try {
            let response;
            try {
              response = await doRequest(token, branch.code);
            } catch (error) {
              if (error.response?.status === 401) {
                const newTokenData = await getToken(true);
                token = newTokenData.access_token;
                response = await doRequest(token, branch.code);
              } else {
                throw error;
              }
            }
            const data = response.data;
            if (data.dataRow && data.dataRow.length > 0) {
              return {
                branch_code: branch.code,
                branch_name: branch.name,
                dataRow: data.dataRow,
                invoiceQuantity: data.invoiceQuantity || 0,
                invoiceValue: data.invoiceValue || 0,
                itemQuantity: data.itemQuantity || 0,
              };
            }
            return null;
          } catch (err) {
            console.log(
              `⚠️ [Sellers] Erro filial ${branch.code}: ${err.message}`,
            );
            return null;
          }
        }),
      );
      results.push(...batchResults);
    }

    const branchesData = results.filter(Boolean);

    return successResponse(
      res,
      { branches: branchesData },
      'Vendedores por filial obtidos com sucesso',
    );
  }),
);

// =============================================================================
// TOP CUSTOMERS via fiscal-movement/search
// =============================================================================
// POST /api/totvs/seller-panel/sellers-detalhado
// Híbrido: combina /sale-panel/v2/sellers/search (lista de vendedoras + valor)
// com /sale-panel/v2/totals/search (TM, PA, PMPV por vendedor via sellers filter).
// Retorna { dataRow: [{ seller_code, seller_name, branch_code, branch_name,
//   invoice_value, invoice_qty, itens_qty, tm, pa, pmpv }] }
// Body: { branchs: number[], datemin, datemax, operations?: number[] }
//
// Por padrão, aplica filtro de operations VAREJO (venda direta ao consumidor):
// só vendas atendidas pra cliente, excluindo transferências entre lojas,
// remessas, devoluções etc.
// =============================================================================
// Operations de venda VAREJO ao cliente final (mesmo conjunto do OP_SEGMENTO_MAP
// com canal='varejo' em crm.routes.js).
const VAREJO_SALE_OPERATIONS = [
  510, 511, 521, 522, 545, 546, 548,
  9009, 9017, 9027, 9033,
  9400, 9401, 9420, 9067, 9404,
  5919, // adicionada em 2026-06 — entra no Ranking de Faturamento por loja
];

// Mapa de nomes amigáveis das filiais varejo (alinha com VAREJO_STORE_MAP)
const VAREJO_BRANCH_NAMES = {
  2: { name: 'João Pessoa',     short: 'João Pessoa' },
  5: { name: 'Nova Cruz',       short: 'Nova Cruz' },
  55: { name: 'Parnamirim',     short: 'Parnamirim' },
  65: { name: 'Canguaretama',   short: 'Canguaretama' },
  87: { name: 'Cidade Jardim',  short: 'Cidade Jardim' },
  88: { name: 'Guararapes',     short: 'Guararapes' },
  90: { name: 'Ayrton Senna',   short: 'Ayrton Senna' },
  93: { name: 'Imperatriz',     short: 'Imperatriz' },
  94: { name: 'Patos',          short: 'Patos' },
  95: { name: 'Midway',         short: 'Midway' },
  97: { name: 'Teresina',       short: 'Teresina' },
  98: { name: 'Shopping Recife', short: 'Recife' },
};

router.post(
  '/seller-panel/sellers-detalhado',
  asyncHandler(async (req, res) => {
    const { branchs, datemin, datemax, operations } = req.body || {};
    // Se operations não vier, usa o set padrão de venda varejo ao cliente
    const opList = Array.isArray(operations) && operations.length > 0
      ? operations.filter(Boolean)
      : VAREJO_SALE_OPERATIONS;
    if (!datemin || !datemax) {
      return errorResponse(res, 'datemin e datemax obrigatórios', 400, 'MISSING_DATES');
    }
    const tokenData = await getToken();
    if (!tokenData?.access_token) {
      return errorResponse(res, 'Token TOTVS indisponível', 503, 'TOKEN_UNAVAILABLE');
    }
    let token = tokenData.access_token;

    const branchList = Array.isArray(branchs) && branchs.length > 0 ? branchs.filter(Boolean) : [];
    if (branchList.length === 0) {
      return errorResponse(res, 'branchs obrigatório (array de códigos de filial)', 400);
    }

    const SELLERS_URL = `${TOTVS_BASE_URL}/sale-panel/v2/sellers/search`;
    const TOTALS_URL  = `${TOTVS_BASE_URL}/sale-panel/v2/totals/search`;

    const baseAxiosCfg = (t) => ({
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${t}` },
      httpsAgent, httpAgent, timeout: 60000,
    });

    const fetchWithRetry = async (url, payload) => {
      try {
        const r = await axios.post(url, payload, baseAxiosCfg(token));
        return r.data;
      } catch (err) {
        if (err.response?.status === 401) {
          const nt = await getToken(true); token = nt.access_token;
          const r2 = await axios.post(url, payload, baseAxiosCfg(token));
          return r2.data;
        }
        throw err;
      }
    };

    // 1) Lista vendedores por filial (em lotes de 5) — filtrado por operations
    const branchInfo = {}; // branch_code → { branch_name, sellers: [{code, name, qty, value}] }
    const BATCH = 5;
    for (let i = 0; i < branchList.length; i += BATCH) {
      const slice = branchList.slice(i, i + BATCH);
      const results = await Promise.all(
        slice.map(async (bc) => {
          try {
            const d = await fetchWithRetry(SELLERS_URL, {
              branchs: [bc],
              datemin,
              datemax,
              operations: opList,
            });
            return { bc, dataRow: d?.dataRow || [], invoiceQuantity: d?.invoiceQuantity || 0, invoiceValue: d?.invoiceValue || 0, itemQuantity: d?.itemQuantity || 0 };
          } catch (e) {
            console.warn(`[sellers-detalhado] sellers filial ${bc} falhou: ${e.message}`);
            return { bc, dataRow: [], invoiceQuantity: 0, invoiceValue: 0, itemQuantity: 0 };
          }
        }),
      );
      for (const r of results) {
        branchInfo[r.bc] = {
          dataRow: r.dataRow,
          invoiceQuantity: r.invoiceQuantity,
          invoiceValue: r.invoiceValue,
          itemQuantity: r.itemQuantity,
        };
      }
    }

    // 2) Constrói mapa vendedor → branch dominante (maior valor)
    const sellerMap = new Map();
    for (const [bc, info] of Object.entries(branchInfo)) {
      for (const s of info.dataRow) {
        const key = s.seller_code;
        const val = Number(s.seller_sale_value || 0);
        if (!sellerMap.has(key)) {
          sellerMap.set(key, {
            seller_code: s.seller_code,
            seller_name: s.seller_name,
            branchAgg: {}, // branch_code → value
          });
        }
        const cur = sellerMap.get(key);
        cur.branchAgg[bc] = (cur.branchAgg[bc] || 0) + val;
      }
    }

    if (sellerMap.size === 0) {
      return successResponse(res, { dataRow: [], total_branches: branchList.length });
    }

    // 3) Chama /totals/search por vendedor (lotes de 10 em paralelo) — c/ operations
    const sellerCodes = Array.from(sellerMap.keys());
    const sellerTotals = new Map(); // code → totals
    const PARALLEL = 10;
    for (let i = 0; i < sellerCodes.length; i += PARALLEL) {
      const chunk = sellerCodes.slice(i, i + PARALLEL);
      const results = await Promise.all(
        chunk.map(async (code) => {
          try {
            const d = await fetchWithRetry(TOTALS_URL, {
              branchs: branchList,
              datemin,
              datemax,
              sellers: [Number(code)],
              operations: opList,
            });
            return { code, totals: d?.dataRow?.[0] || null };
          } catch (e) {
            return { code, totals: null, err: e.message };
          }
        }),
      );
      for (const r of results) {
        sellerTotals.set(r.code, r.totals);
      }
    }

    // 4) Combina tudo
    const dataRow = [];
    for (const [code, info] of sellerMap.entries()) {
      const t = sellerTotals.get(code) || {};
      const dom = Object.entries(info.branchAgg).sort(([, a], [, b]) => b - a)[0];
      const dominantBranchCode = dom ? Number(dom[0]) : null;
      const branchInfoLocal = dominantBranchCode ? VAREJO_BRANCH_NAMES[dominantBranchCode] : null;
      dataRow.push({
        seller_code: code,
        seller_name: info.seller_name,
        branch_code: dominantBranchCode,
        branch_name: branchInfoLocal?.name || (dominantBranchCode ? `Filial ${dominantBranchCode}` : null),
        branch_short: branchInfoLocal?.short || (dominantBranchCode ? `#${dominantBranchCode}` : null),
        invoice_value: Number(t.invoice_value) || 0,
        invoice_qty:   Number(t.invoice_qty)   || 0,
        itens_qty:     Number(t.itens_qty)     || 0,
        tm:   Number(t.tm)   || 0,
        pa:   Number(t.pa)   || 0,
        pmpv: Number(t.pmpv) || 0,
        // Detalhamento por filial (útil pra entender em qual loja a vendedora vende mais)
        branches_por_valor: info.branchAgg,
      });
    }

    // Ordena por faturamento desc
    dataRow.sort((a, b) => b.invoice_value - a.invoice_value);

    // Totais agregados
    const totalsAgg = Object.values(branchInfo).reduce(
      (acc, b) => ({
        invoiceValue: acc.invoiceValue + Number(b.invoiceValue || 0),
        invoiceQuantity: acc.invoiceQuantity + Number(b.invoiceQuantity || 0),
        itemQuantity: acc.itemQuantity + Number(b.itemQuantity || 0),
      }),
      { invoiceValue: 0, invoiceQuantity: 0, itemQuantity: 0 },
    );

    return successResponse(res, {
      dataRow,
      branches: Object.fromEntries(
        Object.entries(branchInfo).map(([bc, info]) => [bc, {
          invoiceQuantity: info.invoiceQuantity,
          invoiceValue: info.invoiceValue,
          itemQuantity: info.itemQuantity,
        }]),
      ),
      totals: {
        invoice_value: totalsAgg.invoiceValue,
        invoice_qty: totalsAgg.invoiceQuantity,
        itens_qty: totalsAgg.itemQuantity,
        tm: totalsAgg.invoiceQuantity > 0 ? totalsAgg.invoiceValue / totalsAgg.invoiceQuantity : 0,
        pa: totalsAgg.invoiceQuantity > 0 ? totalsAgg.itemQuantity / totalsAgg.invoiceQuantity : 0,
        pmpv: totalsAgg.itemQuantity > 0 ? totalsAgg.invoiceValue / totalsAgg.itemQuantity : 0,
      },
    });
  }),
);

// =============================================================================
// POST /api/totvs/sale-panel/sellers-canal
// Agrega o faturamento por vendedor (campo seller_sale_value do painel oficial
// TOTVS /sale-panel/v2/sellers/search) somando as filiais informadas, com filtro
// de operations. É EXATAMENTE a fonte do relatório "Faturamento por Vendedor"
// do TOTVS (Vl. Faturado), líquido. Consulta leve (painel agregado, sem varrer
// itens). Usado pelo Forecast (tabela por vendedor semanal/mensal).
// Body: { branchs: number[], operations?: number[], datemin, datemax }
// Retorna: { sellers: [{ seller_code, seller_name, value }], total }
// =============================================================================
router.post(
  '/sale-panel/sellers-canal',
  asyncHandler(async (req, res) => {
    const { branchs, operations, datemin, datemax } = req.body || {};
    if (!datemin || !datemax) {
      return errorResponse(res, 'datemin e datemax obrigatórios', 400, 'MISSING_DATES');
    }
    const branchList = Array.isArray(branchs) ? branchs.filter(Boolean) : [];
    if (branchList.length === 0) {
      return errorResponse(res, 'branchs obrigatório (array de filiais)', 400);
    }
    const tokenData = await getToken();
    let token = tokenData?.access_token;
    if (!token) {
      return errorResponse(res, 'Token TOTVS indisponível', 503, 'TOKEN_UNAVAILABLE');
    }
    const SELLERS_URL = `${TOTVS_BASE_URL}/sale-panel/v2/sellers/search`;
    const opList =
      Array.isArray(operations) && operations.length > 0
        ? operations.filter(Boolean)
        : null;
    const axiosCfg = (t) => ({
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${t}`,
      },
      httpsAgent,
      httpAgent,
      timeout: 60000,
    });
    const fetchBranch = async (bc) => {
      const body = { branchs: [bc], datemin, datemax };
      if (opList) body.operations = opList;
      try {
        const r = await axios.post(SELLERS_URL, body, axiosCfg(token));
        return r.data?.dataRow || [];
      } catch (err) {
        if (err.response?.status === 401) {
          const nt = await getToken(true);
          token = nt.access_token;
          try {
            const r2 = await axios.post(SELLERS_URL, body, axiosCfg(token));
            return r2.data?.dataRow || [];
          } catch (e2) {
            console.warn(`[sellers-canal] filial ${bc} (retry): ${e2.message}`);
            return [];
          }
        }
        console.warn(`[sellers-canal] filial ${bc}: ${err.message}`);
        return [];
      }
    };

    const bySeller = new Map();
    const BATCH = 5;
    for (let i = 0; i < branchList.length; i += BATCH) {
      const slice = branchList.slice(i, i + BATCH);
      const rows = await Promise.all(slice.map(fetchBranch));
      for (const dataRow of rows) {
        for (const s of dataRow) {
          const code = String(s.seller_code ?? '');
          if (!code) continue;
          const val = Number(s.seller_sale_value || 0);
          const prev = bySeller.get(code) || {
            seller_code: code,
            seller_name: s.seller_name || '',
            value: 0,
          };
          prev.value += val;
          if (!prev.seller_name && s.seller_name) prev.seller_name = s.seller_name;
          bySeller.set(code, prev);
        }
      }
    }

    const sellers = [...bySeller.values()]
      .map((s) => ({ ...s, value: Math.round(s.value * 100) / 100 }))
      .filter((s) => s.value > 0)
      .sort((a, b) => b.value - a.value);
    const total = Math.round(sellers.reduce((a, s) => a + s.value, 0) * 100) / 100;

    return successResponse(res, { sellers, total });
  }),
);

// =============================================================================
// FATURAMENTO POR VENDEDOR — réplica da query SQL do ERP (VR_FCR_FATURAI)
// POST /api/totvs/sale-panel/faturamento-vendedor
// Body: { filtroempresa?: number[], datemin, datemax }
//
// Reproduz via API a query Oracle:
//   SUM(CASE WHEN TP_DOCUMENTO='9' THEN VL_FATURA*-1 ELSE VL_FATURA END)
//   por CD_COMPVEND (vendedor da transação de origem da fatura).
//
// Mapeamento SQL → API:
//   VR_FCR_FATURAI + DT_EMISSAO      → accounts-receivable/v2/documents/search
//                                      (startIssueDate/endIssueDate)
//   TP_SITUACAO='1'                  → statusList:[1] + filtro local
//   TP_FATURAMENTO NOT IN ('3')      → filtro local billingType !== 3
//   TP_DOCUMENTO NOT IN ('20')       → filtro local documentType !== 20
//   TP_COBRANCA <> '14'              → filtro local chargeType !== 14
//   TP_DOCUMENTO='9' → negativo      → sinal invertido local
//   join LIQUIDACAO→TRANSACAO        → analytics/v2/fiscal-movement/search:
//     (CD_COMPVEND)                    mapa (branchCode|invoiceNumber) → seller
//   CD_OPERACAO NOT IN (lista)       → operationCode do movimento
//   CD_CLIENTE NOT IN (clas tipo 2)  → person/v2/{individuals,legal-entities}
//                                      expand=classifications, typeCode=2
//   VR_PES_VENDEDOR (nome)           → analytics/v2/seller-panel/totals/search
// =============================================================================
const FAT_VEND_EXCLUDED_OPS = new Set([
  1, 2, 1002, 15, 16, 1016, 510, 511, 1511, 521, 1521, 522, 9001, 9009, 9027,
  8750, 9017, 600, 1600, 2009, 3335, 3401, 200, 300,
]);
// NOTA: a query original excluía clientes com VR_PES_PESSOACLAS CD_TIPOCLAS=2,
// mas o "tipo 2" da API TOTVS é outro domínio (flag SIM presente em todas as
// franquias) — hoje não há exclusão de cliente (ver passo 5).

// EXPEDIÇÃO: toda venda nestas operações (showroom, novidades, bazar) —
// independente do vendedor — vai pro card EXPEDIÇÃO como pseudo-vendedor -50.
// No New Forecast os recortes são: 7255 → NOVIDADES · 887/888/889 → BAZAR ·
// demais → SHOWROOM/FÁBRICAS.
const FAT_VEND_EXPEDICAO_OPS = new Set([
  7254, 7276, 7255, 7237, 7299, 7007,
  887, 888, 889, // bazar
]);
const FAT_VEND_BAZAR_OPS = new Set([887, 888, 889]);
const FAT_VEND_EXPEDICAO_CODE = -50;

// RICARDO ELETRO: card próprio no Painel (pseudo-vendedor -512) e canal
// automático no New Forecast. Diferente da expedição, a op 512 NÃO gera NF
// fiscal (checado: zero NFs em 2026) — a venda existe só como movimento +
// fatura. Por isso ela segue o fluxo normal do contas a receber; só o
// vendedor é trocado pelo pseudo-código no casamento (passo 4.2).
const FAT_VEND_RICARDO_OPS = new Set([512]);
const FAT_VEND_RICARDO_CODE = -512;

// BLUECRED: clientes com contrato na tabela bluecred_contratos (mesma lista
// da página /clientes-bluecred, identificada por CPF) que compraram no
// CREDIÁRIO — faturas com documentType=1 (Fatura). Card próprio no Painel e
// canal automático no New Forecast.
// ⚠️ São vendas de LOJA: o mesmo valor também está dentro do card VAREJO
// (que vem do painel oficial do TOTVS, sem separar forma de pagamento).
const FAT_VEND_BLUECRED_CODE = -1000;
const FAT_VEND_BLUECRED_DOC = 1; // 1 = Fatura (crediário)
// Filiais fora do BlueCred (pedido do gestor): 551 = PARNAMIRIM TEMPORARIA
const FAT_VEND_BLUECRED_FILIAIS_FORA = new Set([551]);

// CPF → personCode dos clientes BlueCred (lista muda pouco: cache de 30min)
let BLUECRED_CODES_CACHE = { codes: [], ts: 0 };
const BLUECRED_CODES_TTL = 30 * 60 * 1000;

async function getBlueCredPersonCodes(token) {
  if (
    BLUECRED_CODES_CACHE.codes.length > 0 &&
    Date.now() - BLUECRED_CODES_CACHE.ts < BLUECRED_CODES_TTL
  ) {
    return BLUECRED_CODES_CACHE.codes;
  }
  try {
    const { data, error } = await supabase
      .from('bluecred_contratos')
      .select('cliente_cpf');
    if (error) throw new Error(error.message);
    const cpfs = [
      ...new Set(
        (data || [])
          .map((c) => String(c.cliente_cpf || '').replace(/\D/g, ''))
          .filter((c) => c.length >= 11),
      ),
    ];
    if (cpfs.length === 0) return [];
    const codes = [];
    for (let i = 0; i < cpfs.length; i += 50) {
      const chunk = cpfs.slice(i, i + 50);
      try {
        const r = await axios.post(
          `${TOTVS_BASE_URL}/person/v2/individuals/search`,
          { filter: { cpfList: chunk }, page: 1, pageSize: chunk.length },
          {
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
              Authorization: `Bearer ${token}`,
            },
            httpsAgent,
            httpAgent,
            timeout: 30000,
          },
        );
        for (const p of r.data?.items || []) {
          if (p.code) codes.push(Number(p.code));
        }
      } catch (e) {
        console.warn(`[bluecred] lookup CPF falhou: ${e.message}`);
      }
    }
    BLUECRED_CODES_CACHE = { codes, ts: Date.now() };
    console.log(
      `[bluecred] ${codes.length}/${cpfs.length} clientes resolvidos no TOTVS`,
    );
    return codes;
  } catch (e) {
    console.warn(`[bluecred] lista de clientes falhou: ${e.message}`);
    return [];
  }
}

// Docs que são MEIO DE PAGAMENTO: quando a fatura inteira não tem NF
// vinculada, é pagamento avulso (ex: cartões da entrada de um pedido grande),
// não venda — descartar pra não contar em dobro com a fatura da transação.
// (2 cheque, 3 dinheiro, 4/5 cartão, 7/8 TEF, 16 TED, 17/19/22 TEF, 27-30 apps)
const FAT_VEND_PAGTO_DOCS = new Set([2, 3, 4, 5, 7, 8, 16, 17, 19, 22, 27, 28, 29, 30]);

// FILIAL = mesmo critério do botão "Filial" do FiltroEmpresa (frontend):
// cd_empresa < 5999 e fora das franquias (98/980; acima de 6000 é franquia).
// Usado como default quando o filtroempresa não vem preenchido.
const FAT_VEND_FRANQUIA_CODES = new Set([98, 980]);
const onlyFiliais = (codes) =>
  (codes || []).filter((c) => c < 5999 && !FAT_VEND_FRANQUIA_CODES.has(c));

// ─── VAREJO: mesma fonte do Ranking de Faturamento ──────────────────────────
// O ranking usa o painel oficial TOTVS (sale-panel) com estas operações para
// as filiais "especiais". O card VAREJO do Painel de Vendas lê daqui para
// bater com o Ranking (a query SQL do contas a receber EXCLUI as ops de
// varejo 510/511/521/522..., então ela só serve pro atacado).
const PANEL_SPECIAL_BRANCHES = new Set([
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 31, 41, 45, 50, 55,
  65, 75, 85, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101,
  105, 106, 107, 108, 109, 111, 200, 300, 311, 351, 400, 411, 450, 500, 550,
  551, 600, 650, 700, 750, 800, 850, 870, 880, 890, 891, 900, 910, 920, 930,
  940, 950, 960, 970, 980, 990,
]);
const PANEL_OPERATIONS = [
  1, 2, 55, 510, 511, 1511, 521, 1521, 522, 960, 9001, 9009, 9027, 9017,
  9400, 9401, 9402, 9403, 9404, 9005, 545, 546, 555, 548, 1210, 9405, 1205,
  1101, 9065, 9064, 9063, 9062, 9061, 9420, 9026, 9067, 7234, 7236, 7240,
  7241, 7242, 7235, 7237, 7254, 7259, 7255, 7243, 7245, 7244, 5919,
];
const PANEL_OPERATIONS_SET = new Set(PANEL_OPERATIONS);
// Vendedores de ATACADO (grupos FRANQUIA/REVENDA/MTM do frontend — manter em
// sincronia com GRUPOS_FIXOS do PainelVendas.jsx). Ficam FORA do painel
// varejo: as vendas deles já aparecem nos cards do atacado (contas a
// receber) e entrariam duplicadas aqui.
const PANEL_ATACADO_SELLERS = new Set([40, 161, 241, 165, 259, 21, 26]);

// Cache: rota pesada (AR paginado + fiscal-movement paginado). 30min —
// também serve o drill-down por vendedor sem recomputar.
const FAT_VEND_CACHE = new Map();
const FAT_VEND_TTL = 30 * 60 * 1000;

router.post(
  '/sale-panel/faturamento-vendedor',
  asyncHandler(async (req, res) => {
    req.setTimeout(600000);
    res.setTimeout(600000);
    const startTime = Date.now();
    const { filtroempresa, datemin, datemax } = req.body || {};
    if (!datemin || !datemax) {
      return errorResponse(res, 'datemin e datemax obrigatórios', 400, 'MISSING_DATES');
    }

    const tokenData = await getToken();
    if (!tokenData?.access_token) {
      return errorResponse(res, 'Token TOTVS indisponível', 503, 'TOKEN_UNAVAILABLE');
    }
    let token = tokenData.access_token;

    // Resolver filiais (@CD_EMPRESA da query). Sem seleção explícita, usa
    // apenas as empresas FILIAL (critério do botão "Filial" do FiltroEmpresa).
    let branchs;
    if (Array.isArray(filtroempresa) && filtroempresa.length > 0) {
      branchs = filtroempresa
        .map((b) => parseInt(b))
        .filter((b) => !isNaN(b) && b > 0);
    }
    if (!branchs || branchs.length === 0) {
      branchs = onlyFiliais(await getBranchCodes(token));
    }

    const dateOnlyKey = (s) => String(s).split('T')[0];
    const cacheKey = `${dateOnlyKey(datemin)}|${dateOnlyKey(datemax)}|${[...branchs].sort((a, b) => a - b).join(',')}`;
    const cached = FAT_VEND_CACHE.get(cacheKey);
    if (cached && Date.now() - cached.ts < FAT_VEND_TTL) {
      return successResponse(res, { ...cached.data, cached: true }, 'OK (cache)');
    }

    const axiosCfg = (t, timeout = 60000) => ({
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${t}`,
      },
      httpsAgent,
      httpAgent,
      timeout,
    });
    const postWithRetry = async (url, payload, timeout) => {
      try {
        const r = await axios.post(url, payload, axiosCfg(token, timeout));
        return r.data;
      } catch (err) {
        if (err.response?.status === 401) {
          const nt = await getToken(true);
          token = nt.access_token;
          const r2 = await axios.post(url, payload, axiosCfg(token, timeout));
          return r2.data;
        }
        throw err;
      }
    };

    const dateOnly = (s) => String(s).split('T')[0];
    const dmin = dateOnly(datemin);
    const dmax = dateOnly(datemax);

    // ─── 1) Contas a receber do período (VR_FCR_FATURAI) ────────────────────
    // RÉGUA DO PERÍODO = DATA DA TRANSAÇÃO (data da NF vinculada à fatura),
    // igual ao TRAR008. A busca no AR é por emissão da FATURA com folga de
    // ±7 dias (fatura pode ser emitida dias antes/depois da NF — ex: fatura
    // 30/06, transação 01/07); o filtro fino pela data da NF acontece no
    // passo 4. Exclusões de tipo aplicadas localmente porque a API só
    // aceita listas de INCLUSÃO nesses campos.
    const addDaysIso = (iso, n) => {
      const d = new Date(`${iso}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() + n);
      return d.toISOString().slice(0, 10);
    };
    const fetchFaturas = async () => {
      const AR_URL = `${TOTVS_BASE_URL}/accounts-receivable/v2/documents/search`;
      const PAGE_SIZE = 100;
      const MAX_PAGES = 400;
      const filter = {
        branchCodeList: branchs,
        statusList: [1], // TP_SITUACAO='1'
        startIssueDate: `${addDaysIso(dmin, -7)}T00:00:00`,
        endIssueDate: `${addDaysIso(dmax, 7)}T23:59:59`,
      };
      const fetchPage = async (page) => {
        // 3 tentativas — perder página do AR = perder faturas silenciosamente
        for (let tent = 1; tent <= 3; tent++) {
          try {
            return await postWithRetry(AR_URL, {
              filter,
              expand: 'invoice',
              page,
              pageSize: PAGE_SIZE,
            });
          } catch (err) {
            console.warn(
              `[fat-vendedor/AR] pág ${page} tent ${tent}/3: ${err.message}`,
            );
            if (tent < 3) await new Promise((r) => setTimeout(r, 3000 * tent));
          }
        }
        return { items: [], hasNext: false };
      };
      const out = [];
      let page = 1;
      let hasNext = true;
      const CONC = 5;
      while (hasNext && page <= MAX_PAGES) {
        const batch = Array.from(
          { length: Math.min(CONC, MAX_PAGES - page + 1) },
          (_, i) => page + i,
        );
        const results = await Promise.all(batch.map(fetchPage));
        for (const r of results) {
          out.push(...(r?.items || []));
        }
        const last = results[results.length - 1];
        hasNext =
          (last?.hasNext ?? false) ||
          (last?.items || []).length === PAGE_SIZE;
        page += batch.length;
      }
      return out;
    };

    // ─── 2) fiscal-movement → mapa (filial|cliente|data) → movimentos ───────
    // Substitui o join TRALIQUIDACAO→TRANSACAO da query: é daqui que vem o
    // CD_COMPVEND e o CD_OPERACAO da transação de origem de cada fatura.
    // O fiscal-movement NÃO expõe o nº da NF, então o vínculo com a parcela
    // do contas a receber é feito por (filial, cliente, data de emissão).
    const fetchMovementMap = async () => {
      const FM_URL = `${TOTVS_BASE_URL}/analytics/v2/fiscal-movement/search`;
      const PAGE_SIZE = 1000;
      const map = new Map(); // `${branch}|${person}|${yyyy-mm-dd}` → [{sellerCode, operationCode, netValue}]
      let pg = 1;
      let hasNext = true;
      while (hasNext && pg <= 200) {
        // 3 tentativas por página — sem o fiscal-movement completo a
        // atribuição de vendedor colapsa (tudo cai em sem_vinculo).
        let data = null;
        for (let tent = 1; tent <= 3 && !data; tent++) {
          try {
            data = await postWithRetry(
              FM_URL,
              {
                filter: {
                  branchCodeList: branchs,
                  startMovementDate: dmin,
                  endMovementDate: dmax,
                },
                page: pg,
                pageSize: PAGE_SIZE,
              },
              150000,
            );
          } catch (err) {
            console.warn(
              `[fat-vendedor/FM] pág ${pg} tent ${tent}/3: ${err.message}`,
            );
            if (tent < 3) await new Promise((r) => setTimeout(r, 3000 * tent));
          }
        }
        if (!data) {
          console.error(
            `[fat-vendedor/FM] pág ${pg} perdida após 3 tentativas — mapa incompleto`,
          );
          break;
        }
        for (const item of data?.items || []) {
          const bc = item.branchCode;
          const pc = item.personCode;
          const dt = item.movementDate ? String(item.movementDate).slice(0, 10) : null;
          if (!bc || !pc || !dt) continue;
          const key = `${bc}|${pc}|${dt}`;
          let arr = map.get(key);
          if (!arr) {
            arr = [];
            map.set(key, arr);
          }
          arr.push({
            sellerCode: item.sellerCode ?? null,
            operationCode: Number(item.operationCode),
            netValue: Number(item.netValue || 0),
            model: item.operationModel || null,
          });
        }
        hasNext = data?.hasNext ?? false;
        pg++;
      }
      return map;
    };

    // ─── 3) Nomes de vendedor (VR_PES_VENDEDOR) via Supabase ────────────────
    // forecast_painel_vendas é sincronizada do Painel de Vendas TOTVS pelo
    // cron painel-vendas-sync e traz seller_code + seller_name. O endpoint
    // analytics/seller-panel/totals só devolve agregado, sem nomes.
    const fetchSellerNames = async () => {
      const names = new Map();
      try {
        const { data, error } = await supabase
          .from('forecast_painel_vendas')
          .select('seller_code, seller_name, data')
          .order('data', { ascending: false })
          .limit(5000);
        if (error) throw new Error(error.message);
        for (const r of data || []) {
          const code = Number(r.seller_code);
          if (Number.isFinite(code) && r.seller_name && !names.has(code)) {
            names.set(code, r.seller_name);
          }
        }
      } catch (err) {
        console.warn(`[fat-vendedor/nomes] ${err.message}`);
      }
      return names;
    };

    // ─── 3.5) Painel VAREJO — mesma fonte do Ranking de Faturamento ─────────
    // sale-panel/v2/sellers/search por filial (exceto 99/atacado), com as
    // operações do ranking. É o número oficial da tela do TOTVS.
    const fetchVarejoPainel = async () => {
      const SELLERS_URL = `${TOTVS_BASE_URL}/sale-panel/v2/sellers/search`;
      const alvo = branchs.filter((b) => b !== 99);
      const out = [];
      const BATCH = 5;
      for (let i = 0; i < alvo.length; i += BATCH) {
        const slice = alvo.slice(i, i + BATCH);
        const results = await Promise.all(
          slice.map(async (bc) => {
            try {
              const body = { branchs: [bc], datemin: dmin, datemax: dmax };
              if (PANEL_SPECIAL_BRANCHES.has(bc)) {
                body.operations = PANEL_OPERATIONS;
              }
              let d = null;
              for (let tent = 1; tent <= 3 && !d; tent++) {
                try {
                  d = await postWithRetry(SELLERS_URL, body);
                } catch (err) {
                  if (tent === 3) throw err;
                  await new Promise((r) => setTimeout(r, 2000 * tent));
                }
              }
              const sellersRows = (d?.dataRow || [])
                .map((s) => ({
                  seller_code: Number(s.seller_code),
                  seller_name: s.seller_name || null,
                  qtd: Number(s.seller_sale_qty || 0),
                  valor:
                    Math.round(Number(s.seller_sale_value || 0) * 100) / 100,
                }))
                .filter(
                  (s) =>
                    Number.isFinite(s.seller_code) &&
                    s.valor !== 0 &&
                    // atacado não entra no varejo (evita duplicar com os cards)
                    !PANEL_ATACADO_SELLERS.has(s.seller_code),
                )
                .sort((a, b) => b.valor - a.valor);
              if (sellersRows.length === 0) return null;
              return {
                branch_code: bc,
                qtd: sellersRows.reduce((a, s) => a + s.qtd, 0),
                valor:
                  Math.round(
                    sellersRows.reduce((a, s) => a + s.valor, 0) * 100,
                  ) / 100,
                sellers: sellersRows,
              };
            } catch (e) {
              console.warn(`[fat-vendedor/varejo] filial ${bc}: ${e.message}`);
              return null;
            }
          }),
        );
        out.push(...results.filter(Boolean));
      }
      out.sort((a, b) => b.valor - a.valor);
      return out;
    };

    // ─── 3.6) NFs de EXPEDIÇÃO (régua TRAR008: transação do período) ────────
    // fiscal/v2/invoices/search com operationCodeList — o totalValue da NF
    // inclui FRETE, que o fiscal-movement (linhas de produto) não traz
    // (a diferença de R$820 vs TRAR008 era exatamente o frete das 7299/MTM),
    // e a data de emissão da NF é a data da transação.
    const fetchExpedicaoNFs = async () => {
      const NF_URL = `${TOTVS_BASE_URL}/fiscal/v2/invoices/search`;
      const pageSize = 100;
      const out = [];
      let page = 1;
      for (;;) {
        let d = null;
        for (let tent = 1; tent <= 3 && !d; tent++) {
          try {
            d = await postWithRetry(NF_URL, {
              filter: {
                branchCodeList: branchs,
                operationCodeList: [...FAT_VEND_EXPEDICAO_OPS],
                operationType: 'Output',
                startIssueDate: `${dmin}T00:00:00`,
                endIssueDate: `${dmax}T23:59:59`,
              },
              page,
              pageSize,
            });
          } catch (err) {
            console.warn(
              `[fat-vendedor/expedicao] pág ${page} tent ${tent}/3: ${err.message}`,
            );
            if (tent < 3) await new Promise((r) => setTimeout(r, 2000 * tent));
          }
        }
        if (!d) break;
        out.push(...(d.items || []));
        const hasNext = d.hasNext ?? (d.items || []).length === pageSize;
        if (!hasNext || page >= 100) break;
        page++;
      }
      return out;
    };

    const [
      faturas,
      movMap,
      sellerNames,
      varejoPainel,
      expedicaoNFs,
      bluecredCodes,
      nonSalesVarejo,
    ] = await Promise.all([
        fetchFaturas(),
        fetchMovementMap(),
        fetchSellerNames(),
        fetchVarejoPainel(),
        fetchExpedicaoNFs(),
        getBlueCredPersonCodes(token),
        // Mesmo merge do Ranking: ops fora do universo "Sales" (5919 —
        // Remessa Bonificação Elite) somadas do Supabase fiscal, com quebra
        // por vendedor (dealer_code da NF).
        fetchNonSalesPorVendedor({
          branchs: branchs.filter((b) => b !== 99),
          datemin: dmin,
          datemax: dmax,
        }),
      ]);

    // Mescla as non-sales no painel varejo. NF com dealer_code soma no
    // vendedor real (ex: 5919 da NETO na Midway); sem dealer vira linha
    // "BONIFICAÇÃO ELITE". Assim card e drill batem com o Ranking.
    for (const [bc, porDealer] of nonSalesVarejo.entries()) {
      let row = varejoPainel.find((b) => b.branch_code === bc);
      for (const [dealer, agg] of porDealer.entries()) {
        // vendedor de atacado não entra no varejo (já conta nos cards)
        if (dealer != null && PANEL_ATACADO_SELLERS.has(dealer)) continue;
        const valor = Math.round(agg.valor * 100) / 100;
        if (!valor && !agg.qtd) continue;
        if (!row) {
          row = { branch_code: bc, qtd: 0, valor: 0, sellers: [] };
          varejoPainel.push(row);
        }
        const sellerRow =
          dealer != null
            ? row.sellers.find((s) => s.seller_code === dealer)
            : null;
        if (sellerRow) {
          sellerRow.qtd += agg.qtd;
          sellerRow.valor = Math.round((sellerRow.valor + valor) * 100) / 100;
        } else {
          row.sellers.push({
            seller_code: dealer ?? -5919,
            seller_name:
              dealer != null
                ? sellerNames.get(dealer) || `Vend. ${dealer}`
                : 'BONIFICAÇÃO ELITE (5919)',
            qtd: agg.qtd,
            valor,
          });
        }
        row.qtd += agg.qtd;
        row.valor = Math.round((row.valor + valor) * 100) / 100;
      }
      if (row) row.sellers.sort((a, b) => b.valor - a.valor);
    }
    varejoPainel.sort((a, b) => b.valor - a.valor);
    console.log(
      `[fat-vendedor] ${faturas.length} parcelas AR · ${movMap.size} NFs no fiscal-movement (${Date.now() - startTime}ms)`,
    );

    // ─── 4) Filtros da fatura + vínculo com o vendedor ──────────────────────
    // Tipos de documento (TP_DOCUMENTO) descartados: 20 = CREDEV, 26 = PIX.
    // CREDEV fica fora por REGRA INTERNA: a parte da venda paga com crédito
    // do cliente não conta no faturado do vendedor (TRAR008 − credev).
    // PIX fica fora porque no fluxo atacado a venda gera a fatura de
    // Adiantamento (valor faturado real) e o PIX é só a entrada do dinheiro.
    // Desconto financeiro (11) CONTA — o ERP soma essas parcelas no faturado.
    const FAT_VEND_EXCLUDED_DOCS = new Set([20, 26]);
    const porFatura = new Map(); // `${branch}|${receivable}` → fatura agregada
    let semVinculo = { qtd: 0, valor: 0 };
    let opExcluida = { qtd: 0, valor: 0 };
    let foraPeriodo = { qtd: 0, valor: 0 }; // NF fora do período (régua transação)
    for (const item of faturas) {
      // TP_SITUACAO='1' (reforço local — a API pode ignorar statusList)
      if (item.status !== undefined && Number(item.status) !== 1) continue;
      // TP_FATURAMENTO NOT IN ('3')
      if (Number(item.billingType) === 3) continue;
      // TP_DOCUMENTO fora: 20 CREDEV (query original) + 11 Desconto financeiro
      if (FAT_VEND_EXCLUDED_DOCS.has(Number(item.documentType))) continue;
      // TP_COBRANCA <> '14'
      if (Number(item.chargeType) === 14) continue;

      const bruto = Number(item.installmentValue || 0);
      if (!bruto) continue;
      // TP_DOCUMENTO='9' → VL_FATURA * -1
      const valor = Number(item.documentType) === 9 ? -bruto : bruto;

      // Data da NF de origem (expand=invoice), senão data de emissão da fatura
      const inv = Array.isArray(item.invoice) ? item.invoice[0] : item.invoice;
      const dtNf = String(inv?.invoiceDate || item.issueDate || '').slice(0, 10);
      // RÉGUA: só conta se a DATA DA TRANSAÇÃO (NF) cai no período pedido —
      // a busca do AR veio com folga de ±7 dias justamente pra isso.
      if (dtNf < dmin || dtNf > dmax) {
        foraPeriodo.qtd += 1;
        foraPeriodo.valor += valor;
        continue;
      }
      const movs = dtNf
        ? movMap.get(`${item.branchCode}|${item.customerCode}|${dtNf}`)
        : null;
      if (!movs || movs.length === 0) {
        // Sem transação localizada → equivale a não passar no join da query
        semVinculo.qtd += 1;
        semVinculo.valor += valor;
        continue;
      }
      // CD_OPERACAO NOT IN (lista): se TODOS os movimentos do dia são de
      // operação excluída, a fatura fica fora (ex: venda varejo 510/521).
      const validos = movs.filter(
        (m) => !FAT_VEND_EXCLUDED_OPS.has(m.operationCode),
      );
      if (validos.length === 0) {
        opExcluida.qtd += 1;
        opExcluida.valor += valor;
        continue;
      }
      // Agrega as parcelas por fatura (receivableCode). O vendedor é
      // atribuído DEPOIS da dedup, por grupo cliente/dia (ver passo 4.2).
      const fatKey = `${item.branchCode}|${item.receivableCode}`;
      let fat = porFatura.get(fatKey);
      if (!fat) {
        fat = {
          sellerCode: null,
          customerCode: Number(item.customerCode),
          branchCode: item.branchCode,
          receivableCode: item.receivableCode,
          issueDate: dtNf,
          docType: Number(item.documentType),
          valor: 0,
          temNf: false,
        };
        porFatura.set(fatKey, fat);
      }
      fat.valor += valor;
      if (inv) fat.temNf = true; // alguma parcela com NF vinculada
    }

    // ─── 4.0) Pagamentos avulsos: meio de pagamento SEM NF vinculada ────────
    // Ex: entrada de pedido grande paga em 3 cartões (COLLYER 24/07: cartões
    // 15.000 + 13.217,46 + 14.300,50 sem NF, além da fatura real da venda
    // com NF). Contá-los dobraria a venda.
    // Só descarta quando existe OUTRA fatura COM NF no mesmo cliente/dia/
    // filial — aí o pagamento é espelho da venda já contada. Sem nenhuma NF
    // no grupo, a própria fatura É a venda (ex: op 512/Ricardo Eletro, que
    // não gera NF fiscal) e precisa contar.
    const grupoComNf = new Set();
    for (const f of porFatura.values()) {
      if (f.temNf) {
        grupoComNf.add(`${f.branchCode}|${f.customerCode}|${f.issueDate}`);
      }
    }
    let pagamentoSemNf = { qtd: 0, valor: 0 };
    for (const [k, f] of porFatura.entries()) {
      const gk = `${f.branchCode}|${f.customerCode}|${f.issueDate}`;
      if (!f.temNf && FAT_VEND_PAGTO_DOCS.has(f.docType) && grupoComNf.has(gk)) {
        pagamentoSemNf.qtd += 1;
        pagamentoSemNf.valor += f.valor;
        porFatura.delete(k);
      }
    }

    // ─── 4.1) Dedup pagamento × Adiantamento ────────────────────────────────
    // Mesmo com PIX (26) já excluído, outros meios (TED, dinheiro etc.) podem
    // gerar fatura em par com o Adiantamento no mesmo valor/dia. A dedup SÓ
    // age quando o grupo tem Adiantamento (10) + outro documento: fica o
    // Adiantamento (valor faturado real) e o espelho do pagamento sai.
    // Dois documentos comuns de mesmo valor são vendas DISTINTAS e ficam
    // (ex: cliente compra duas peças iguais em transações separadas).
    const porDup = new Map(); // `${branch}|${cliente}|${data}|${valor}` → [faturas]
    for (const f of porFatura.values()) {
      const dk = `${f.branchCode}|${f.customerCode}|${f.issueDate}|${f.valor.toFixed(2)}`;
      if (!porDup.has(dk)) porDup.set(dk, []);
      porDup.get(dk).push(f);
    }
    const vendasFinais = [];
    let duplicadas = { qtd: 0, valor: 0 };
    for (const grupo of porDup.values()) {
      const adiantamentos = grupo.filter((f) => f.docType === 10);
      const outros = grupo.filter((f) => f.docType !== 10);
      if (adiantamentos.length > 0 && outros.length > 0) {
        vendasFinais.push(...adiantamentos);
        for (const f of outros) {
          duplicadas.qtd += 1;
          duplicadas.valor += f.valor;
        }
      } else {
        vendasFinais.push(...grupo);
      }
    }

    // ─── 4.2) Atribuição de vendedor por CASAMENTO DE VALOR ─────────────────
    // Quando o cliente compra de 2+ vendedores no mesmo dia (ex: vendedor da
    // franquia + showroom/GERAL), cada fatura vai pro vendedor cuja soma de
    // vendas do dia mais se aproxima do valor dela — guloso, maiores faturas
    // primeiro, descontando a soma restante do vendedor escolhido.
    // (Caso Vitor 15/07: cartões 227,66+58,25 → vendedor 40, cuja soma era
    // 285,92; adiantamento 1.039,53 → showroom GERAL, soma exata.)
    // Com um único vendedor no dia, tudo vai pra ele, como antes.
    // PREFERE movimentos "Sales" (devolução não rouba a fatura — caso Juliane).
    const porGrupoDia = new Map();
    for (const f of vendasFinais) {
      const gk = `${f.branchCode}|${f.customerCode}|${f.issueDate}`;
      if (!porGrupoDia.has(gk)) porGrupoDia.set(gk, []);
      porGrupoDia.get(gk).push(f);
    }
    for (const [gk, fats] of porGrupoDia.entries()) {
      const movs = movMap.get(gk) || [];
      const validos = movs.filter(
        (m) => !FAT_VEND_EXCLUDED_OPS.has(m.operationCode),
      );
      const vendasMovs = validos.filter((m) => m.model === 'Sales');
      const pool = vendasMovs.length > 0 ? vendasMovs : validos;
      const restante = new Map(); // sellerCode → soma ainda não "consumida"
      for (const m of pool) {
        let sc = m.sellerCode != null ? Number(m.sellerCode) : null;
        // Operações de expedição/ricardo → pseudo-vendedor (qualquer vendedor);
        // essas faturas são descartadas no passo 6 — o card vem das NFs.
        if (FAT_VEND_EXPEDICAO_OPS.has(m.operationCode)) {
          sc = FAT_VEND_EXPEDICAO_CODE;
        } else if (FAT_VEND_RICARDO_OPS.has(m.operationCode)) {
          sc = FAT_VEND_RICARDO_CODE;
        }
        restante.set(sc, (restante.get(sc) || 0) + (m.netValue || 0));
      }
      if (restante.size === 0) continue; // não deveria ocorrer (já filtrado)
      for (const f of [...fats].sort(
        (a, b) => Math.abs(b.valor) - Math.abs(a.valor),
      )) {
        let melhor = null;
        let melhorDiff = Infinity;
        for (const [sc, rem] of restante.entries()) {
          const diff = Math.abs(rem - f.valor);
          if (diff < melhorDiff) {
            melhorDiff = diff;
            melhor = sc;
          }
        }
        f.sellerCode = melhor;
        if (melhor !== null) {
          restante.set(melhor, (restante.get(melhor) || 0) - f.valor);
        }
      }
    }

    // ─── 4.3) EXPEDIÇÃO / RICARDO ELETRO pela régua de TRANSAÇÃO (NFs) ──────
    // Espelha o TRAR008: uma linha por NF (= transação), totalValue com
    // frete, data de emissão = data da transação. Cobre faturamento
    // antecipado (fatura de maio, transação em julho — CYRO/MARANGUAPE) e
    // ignora pagamentos avulsos por construção. As faturas que o casamento
    // atribuiu a esses pseudo-vendedores saem do contas a receber (passo 6).
    const vendasExp = [];
    let expedicaoTotal = 0;
    const expPorOp = {}; // operação → valor (integração New Forecast)
    for (const nf of expedicaoNFs) {
      if (nf.invoiceStatus === 'Canceled' || nf.invoiceStatus === 'Deleted') continue;
      const valor = Number(nf.totalValue || 0);
      if (!valor) continue;
      const opNf = Number(nf.operationCode);
      expedicaoTotal += valor;
      expPorOp[opNf] = Math.round(((expPorOp[opNf] || 0) + valor) * 100) / 100;
      vendasExp.push({
        data: nf.issueDate ? String(nf.issueDate).slice(0, 10) : null,
        branch_code: Number(nf.branchCode),
        fatura: nf.invoiceCode ?? null, // nº da NF
        cliente_code: Number(nf.personCode),
        cliente_nome: nf.personName || null,
        valor: Math.round(valor * 100) / 100,
        op: opNf, // operação — o New Forecast separa novidades/bazar/showroom
      });
    }
    vendasExp.sort(
      (a, b) =>
        String(b.data).localeCompare(String(a.data)) || b.valor - a.valor,
    );

    // ─── 4.4) BLUECRED: vendas no crediário dos clientes com contrato ───────
    // Reaproveita as parcelas já baixadas do contas a receber (sem request
    // extra), com a mesma régua de período (data da NF/transação).
    // Critério por VENDA (não por documento): a venda entra se tiver ao menos
    // uma parcela de FATURA (doc 1 = crediário); nesse caso contam TAMBÉM as
    // outras formas de pagamento da mesma venda (entrada em dinheiro, cartão
    // etc.). Venda sem nenhuma fatura fica inteira de fora, mesmo sendo do
    // cliente BlueCred. CREDEV e PIX seguem excluídos como no resto do painel.
    // Venda = NF (quando existe) ou filial+cliente+dia.
    // Não colide com os cards de atacado: vendas de loja caem em op excluída.
    const bluecredSet = new Set(bluecredCodes);
    const vendasBluecred = [];
    let bluecredTotal = 0;
    if (bluecredSet.size > 0) {
      const porVendaBc = new Map(); // chave da venda → { temFatura, parcelas }
      for (const item of faturas) {
        if (!bluecredSet.has(Number(item.customerCode))) continue;
        if (FAT_VEND_BLUECRED_FILIAIS_FORA.has(Number(item.branchCode))) continue;
        if (item.status !== undefined && Number(item.status) !== 1) continue;
        const docType = Number(item.documentType);
        if (FAT_VEND_EXCLUDED_DOCS.has(docType)) continue; // credev/PIX
        const valor = Number(item.installmentValue || 0);
        if (!valor) continue;
        const inv = Array.isArray(item.invoice) ? item.invoice[0] : item.invoice;
        const dtNf = String(inv?.invoiceDate || item.issueDate || '').slice(0, 10);
        if (dtNf < dmin || dtNf > dmax) continue;
        const chave = inv?.invoiceCode
          ? `nf|${item.branchCode}|${inv.invoiceCode}`
          : `dia|${item.branchCode}|${item.customerCode}|${dtNf}`;
        let venda = porVendaBc.get(chave);
        if (!venda) {
          venda = { temFatura: false, parcelas: [] };
          porVendaBc.set(chave, venda);
        }
        if (docType === FAT_VEND_BLUECRED_DOC) venda.temFatura = true;
        venda.parcelas.push({
          data: dtNf,
          branch_code: Number(item.branchCode),
          fatura: item.receivableCode,
          cliente_code: Number(item.customerCode),
          cliente_nome: null, // preenchido no lookup (passo 5)
          valor: Math.round(valor * 100) / 100,
        });
      }
      for (const venda of porVendaBc.values()) {
        if (!venda.temFatura) continue; // sem crediário: fora do BlueCred
        for (const p of venda.parcelas) {
          bluecredTotal += p.valor;
          vendasBluecred.push(p);
        }
      }
      vendasBluecred.sort(
        (a, b) =>
          String(b.data).localeCompare(String(a.data)) || b.valor - a.valor,
      );
    }

    // ─── 5) Lookup de nomes dos clientes (pro drill-down) ───────────────────
    // ⚠️ SEM exclusão de cliente por classificação ou nome:
    //  - classificationTypeCode=2 da API ≠ CD_TIPOCLAS=2 do ERP (o "tipo 2"
    //    da API é um flag SIM presente em todas as franquias — excluía o
    //    vendedor 40 inteiro);
    //  - nome começando com "CROSBY" também NÃO serve: franquias legítimas
    //    têm razão social CROSBY (ex: CROSBY SÃO JOÃO, CROSBY AREIA BRANCA).
    // Transferências internas já ficam de fora pelo NOT IN de operações.
    const customerCodes = [
      ...new Set([
        ...vendasFinais.map((p) => p.customerCode),
        // clientes da EXPEDIÇÃO (podem não ter fatura no período — ex: CYRO)
        ...vendasExp.map((v) => v.cliente_code),
        ...vendasBluecred.map((v) => v.cliente_code),
      ]),
    ].filter(Boolean);
    const excludedCustomers = new Set(); // mantido vazio (ver nota acima)
    const personNames = new Map();
    if (customerCodes.length > 0) {
      const BATCH = 50;
      const chunks = [];
      for (let i = 0; i < customerCodes.length; i += BATCH) {
        chunks.push(customerCodes.slice(i, i + BATCH));
      }
      const lookupChunk = async (chunk) => {
        const payload = {
          filter: { personCodeList: chunk },
          page: 1,
          pageSize: chunk.length,
        };
        const [pj, pf] = await Promise.all([
          postWithRetry(`${TOTVS_BASE_URL}/person/v2/legal-entities/search`, payload, 30000)
            .then((d) => d?.items || [])
            .catch(() => []),
          postWithRetry(`${TOTVS_BASE_URL}/person/v2/individuals/search`, payload, 30000)
            .then((d) => d?.items || [])
            .catch(() => []),
        ]);
        for (const p of [...pj, ...pf]) {
          if (!p.code) continue;
          const nome = p.fantasyName || p.name;
          if (nome) personNames.set(Number(p.code), nome);
        }
      };
      const CONC = 4;
      for (let i = 0; i < chunks.length; i += CONC) {
        await Promise.all(chunks.slice(i, i + CONC).map(lookupChunk));
      }
    }

    // ─── 6) GROUP BY vendedor (com detalhe por fatura pro drill-down) ───────
    const bySeller = new Map();
    for (const p of vendasFinais) {
      if (excludedCustomers.has(p.customerCode)) continue;
      // Faturas casadas com a EXPEDIÇÃO saem daqui — aquele card vem das NFs
      // (passo 4.3), contá-las seria dobrar. RICARDO (op 512) fica: não há
      // NF pra essas vendas, o contas a receber é a única fonte.
      if (p.sellerCode === FAT_VEND_EXPEDICAO_CODE) continue;
      const code = p.sellerCode ?? 0; // 0 = sem vendedor na transação
      const cur = bySeller.get(code) || {
        seller_code: code,
        seller_name:
          code === FAT_VEND_RICARDO_CODE
            ? 'RICARDO ELETRO'
            : sellerNames.get(code) || null,
        valor: 0,
        faturas: new Map(), // receivableKey → venda (fatura)
        porFilial: {}, // branchCode → { qtd, valor }
      };
      const pf = cur.porFilial[p.branchCode] || { qtd: 0, valor: 0 };
      pf.qtd += 1;
      pf.valor += p.valor;
      cur.porFilial[p.branchCode] = pf;
      cur.faturas.set(`${p.branchCode}|${p.receivableCode}`, {
        data: p.issueDate,
        branch_code: p.branchCode,
        fatura: p.receivableCode,
        cliente_code: p.customerCode,
        cliente_nome: null, // preenchido abaixo (personNames)
        valor: p.valor,
      });
      cur.valor += p.valor;
      bySeller.set(code, cur);
    }

    const dataRow = [...bySeller.values()]
      .map((s) => ({
        seller_code: s.seller_code,
        seller_name:
          s.seller_name || (s.seller_code === 0 ? 'SEM VENDEDOR' : `Vend. ${s.seller_code}`),
        qtd: s.faturas.size,
        valor: Math.round(s.valor * 100) / 100,
        // Filiais onde o vendedor tem vendas no período (99 = atacado/matriz)
        branch_codes: [
          ...new Set([...s.faturas.values()].map((f) => Number(f.branch_code))),
        ].sort((a, b) => a - b),
        // Quebra por filial: { branchCode: { qtd, valor } } — usado no drill
        por_filial: Object.fromEntries(
          Object.entries(s.porFilial).map(([bc, v]) => [
            bc,
            { qtd: v.qtd, valor: Math.round(v.valor * 100) / 100 },
          ]),
        ),
      }))
      .sort((a, b) => b.valor - a.valor);

    // Detalhe por vendedor: lista de vendas (faturas), mais recentes primeiro
    const detalhes = {};
    for (const s of bySeller.values()) {
      detalhes[s.seller_code] = [...s.faturas.values()]
        .map((f) => ({
          ...f,
          cliente_nome: personNames.get(f.cliente_code) || null,
          valor: Math.round(f.valor * 100) / 100,
        }))
        .sort(
          (a, b) =>
            String(b.data).localeCompare(String(a.data)) || b.valor - a.valor,
        );
    }

    // Pseudo-vendedores (EXPEDIÇÃO / RICARDO ELETRO) no dataRow e detalhes —
    // uma linha por NF (régua TRAR008).
    const pushPseudoVendedor = (code, nome, vendas, total) => {
      if (vendas.length === 0) return;
      // nome fantasia do lookup quando disponível (senão o personName da NF)
      const porFilial = {};
      for (const v of vendas) {
        v.cliente_nome = personNames.get(v.cliente_code) || v.cliente_nome;
        const pf = porFilial[v.branch_code] || { qtd: 0, valor: 0 };
        pf.qtd += 1;
        pf.valor = Math.round((pf.valor + v.valor) * 100) / 100;
        porFilial[v.branch_code] = pf;
      }
      dataRow.push({
        seller_code: code,
        seller_name: nome,
        qtd: vendas.length,
        valor: Math.round(total * 100) / 100,
        branch_codes: Object.keys(porFilial)
          .map(Number)
          .sort((a, b) => a - b),
        por_filial: porFilial,
      });
      detalhes[code] = vendas;
    };
    pushPseudoVendedor(
      FAT_VEND_EXPEDICAO_CODE,
      'EXPEDIÇÃO',
      vendasExp,
      expedicaoTotal,
    );
    pushPseudoVendedor(
      FAT_VEND_BLUECRED_CODE,
      'BLUECRED',
      vendasBluecred,
      bluecredTotal,
    );
    dataRow.sort((a, b) => b.valor - a.valor);

    // Detalhe dos vendedores do VAREJO: montado do fiscal-movement (já em
    // memória), agregado por cliente/dia/filial com as operações do painel.
    // Aproxima as vendas da tela oficial (líquido de devoluções).
    const varejoSellerSet = new Set(
      varejoPainel.flatMap((b) => b.sellers.map((s) => s.seller_code)),
    );
    const varejoAgg = new Map(); // `${seller}|${branch}|${person}|${date}` → valor
    for (const [key, movs] of movMap.entries()) {
      const [bcStr, pcStr, dt] = key.split('|');
      const bc = Number(bcStr);
      if (bc === 99) continue;
      for (const m of movs) {
        const sc = m.sellerCode != null ? Number(m.sellerCode) : null;
        if (sc === null || !varejoSellerSet.has(sc)) continue;
        if (!PANEL_OPERATIONS_SET.has(m.operationCode)) continue;
        if (m.model === 'Purchases') continue;
        const sign = m.model === 'SaleReturns' ? -1 : 1;
        const k = `${sc}|${bc}|${pcStr}|${dt}`;
        varejoAgg.set(k, (varejoAgg.get(k) || 0) + sign * (m.netValue || 0));
      }
    }
    const varejoDetalhes = {};
    for (const [k, valor] of varejoAgg.entries()) {
      const [sc, bc, pc, dt] = k.split('|');
      if (!varejoDetalhes[sc]) varejoDetalhes[sc] = [];
      varejoDetalhes[sc].push({
        data: dt,
        branch_code: Number(bc),
        fatura: null, // venda de painel — sem nº de fatura
        cliente_code: Number(pc),
        cliente_nome: null,
        valor: Math.round(valor * 100) / 100,
      });
    }
    for (const arr of Object.values(varejoDetalhes)) {
      arr.sort(
        (a, b) =>
          String(b.data).localeCompare(String(a.data)) || b.valor - a.valor,
      );
    }

    const responseData = {
      dataRow,
      // VAREJO oficial (mesma fonte/ops do Ranking de Faturamento), por filial
      varejo: varejoPainel,
      // EXPEDIÇÃO por operação (7255=novidades etc.) — usado pelo New Forecast
      expedicao_por_op: expPorOp,
      total: Math.round(dataRow.reduce((a, s) => a + s.valor, 0) * 100) / 100,
      // Parcelas cuja transação não foi localizada no fiscal-movement (fora do join)
      sem_vinculo_nf: {
        qtd: semVinculo.qtd,
        valor: Math.round(semVinculo.valor * 100) / 100,
      },
      // Parcelas descartadas porque a operação está no NOT IN da query
      op_excluida: {
        qtd: opExcluida.qtd,
        valor: Math.round(opExcluida.valor * 100) / 100,
      },
      // Faturas removidas na dedup PIX × Adiantamento (mesmo valor/dia/cliente)
      duplicadas_removidas: {
        qtd: duplicadas.qtd,
        valor: Math.round(duplicadas.valor * 100) / 100,
      },
      // Meios de pagamento sem NF vinculada (entrada de pedido etc.)
      pagamento_sem_nf: {
        qtd: pagamentoSemNf.qtd,
        valor: Math.round(pagamentoSemNf.valor * 100) / 100,
      },
      // Faturas cuja NF (data da transação) caiu fora do período pedido
      fora_periodo: {
        qtd: foraPeriodo.qtd,
        valor: Math.round(foraPeriodo.valor * 100) / 100,
      },
      period: { datemin: dmin, datemax: dmax },
      branchs_used: branchs,
      stats: { fm_chaves: movMap.size, ar_parcelas: faturas.length },
    };
    // Não cachear resultado suspeito: sem_vinculo dominando o total indica
    // que o fiscal-movement veio incompleto (atribuição colapsada).
    const totalBruto =
      Math.abs(responseData.total) + Math.abs(semVinculo.valor);
    const colapsado =
      totalBruto > 0 && Math.abs(semVinculo.valor) / totalBruto > 0.5;
    if (colapsado) {
      console.error(
        `[fat-vendedor] ⚠️ resultado colapsado (sem_vinculo ${semVinculo.valor.toFixed(2)} > 50% do bruto) — NÃO cacheado`,
      );
    }
    if (!colapsado && (dataRow.length > 0 || varejoPainel.length > 0)) {
      // detalhes fica só no cache (drill-down) — não infla a resposta da lista
      FAT_VEND_CACHE.set(cacheKey, {
        data: responseData,
        detalhes,
        varejoDetalhes,
        ts: Date.now(),
      });
      if (FAT_VEND_CACHE.size > 20) {
        const oldest = [...FAT_VEND_CACHE.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
        FAT_VEND_CACHE.delete(oldest[0]);
      }
    }
    console.log(
      `[fat-vendedor] ${dataRow.length} vendedores · R$ ${responseData.total.toFixed(2)} · ${Date.now() - startTime}ms`,
    );
    return successResponse(
      res,
      responseData,
      `${dataRow.length} vendedores no período`,
    );
  }),
);

// =============================================================================
// DRILL-DOWN: vendas (faturas) de um vendedor no período
// POST /api/totvs/sale-panel/faturamento-vendedor-detalhe
// Body: { seller_code, datemin, datemax, filtroempresa? }
// Lê do cache do faturamento-vendedor; se expirado, recomputa chamando a
// própria rota internamente (mesmo padrão do painel-vendas-sync).
// =============================================================================
router.post(
  '/sale-panel/faturamento-vendedor-detalhe',
  asyncHandler(async (req, res) => {
    req.setTimeout(600000);
    res.setTimeout(600000);
    const { seller_code, filtroempresa, datemin, datemax } = req.body || {};
    if (seller_code === undefined || seller_code === null || !datemin || !datemax) {
      return errorResponse(
        res,
        'seller_code, datemin e datemax obrigatórios',
        400,
        'MISSING_PARAMS',
      );
    }
    const dateOnly = (s) => String(s).split('T')[0];
    const dmin = dateOnly(datemin);
    const dmax = dateOnly(datemax);

    // Resolve branchs do mesmo jeito da rota principal → mesma cacheKey
    let branchs;
    if (Array.isArray(filtroempresa) && filtroempresa.length > 0) {
      branchs = filtroempresa
        .map((b) => parseInt(b))
        .filter((b) => !isNaN(b) && b > 0);
    }
    if (!branchs || branchs.length === 0) {
      const tokenData = await getToken();
      if (!tokenData?.access_token) {
        return errorResponse(res, 'Token TOTVS indisponível', 503, 'TOKEN_UNAVAILABLE');
      }
      branchs = onlyFiliais(await getBranchCodes(tokenData.access_token));
    }
    const cacheKey = `${dmin}|${dmax}|${[...branchs].sort((a, b) => a - b).join(',')}`;

    let cached = FAT_VEND_CACHE.get(cacheKey);
    if (!cached || Date.now() - cached.ts >= FAT_VEND_TTL) {
      try {
        await axios.post(
          `http://localhost:${process.env.PORT || 4100}/api/totvs/sale-panel/faturamento-vendedor`,
          { filtroempresa: branchs, datemin: dmin, datemax: dmax },
          { timeout: 600000 },
        );
      } catch (err) {
        return errorResponse(res, `Falha ao computar faturamento: ${err.message}`, 502);
      }
      cached = FAT_VEND_CACHE.get(cacheKey);
      if (!cached) {
        return successResponse(
          res,
          { seller_code: Number(seller_code), seller_name: null, vendas: [], total: 0 },
          'Sem dados no período',
        );
      }
    }

    const code = Number(seller_code);
    // Atacado (contas a receber) primeiro; senão, vendas do painel varejo
    const vendas =
      (cached.detalhes?.[code]?.length
        ? cached.detalhes[code]
        : cached.varejoDetalhes?.[code]) || [];
    const row = (cached.data?.dataRow || []).find(
      (r) => Number(r.seller_code) === code,
    );
    return successResponse(
      res,
      {
        seller_code: code,
        seller_name: row?.seller_name || null,
        vendas,
        total:
          row?.valor ??
          Math.round(vendas.reduce((a, v) => a + v.valor, 0) * 100) / 100,
      },
      `${vendas.length} vendas`,
    );
  }),
);

// =============================================================================
// FATURAMENTO POR VENDEDOR — SEMANAL (integração New Forecast)
// POST /api/totvs/sale-panel/faturamento-vendedor-semanal
// Body: { mes: 'YYYY-MM', filtroempresa? }
//
// Roda o faturamento-vendedor para cada semana do mês (S1=1-7, S2=8-14,
// S3=15-21, S4=22-28, S5=29+ — mesma régua do PlanejamentoMensalModal) via
// chamada interna (aproveita o cache de 30min de cada semana) e devolve os
// canais do New Forecast já mapeados:
//   FRANQUIAS(40) · REVENDA(161/241/165) · MTM_RAFAEL(21) · MTM_DAVID(26)
//   MTM_ARTHUR(259) · VAREJO(painel oficial) · NOVIDADES(exp op 7255)
//   SHOWROOM(demais ops de expedição)
// =============================================================================
router.post(
  '/sale-panel/faturamento-vendedor-semanal',
  asyncHandler(async (req, res) => {
    req.setTimeout(600000);
    res.setTimeout(600000);
    const { mes, datemin, datemax, filtroempresa, semanas } = req.body || {};
    const isYmd = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
    // Período: datemin/datemax livres; `mes` ('YYYY-MM') aceito como atalho.
    let dminP;
    let dmaxP;
    if (isYmd(datemin) && isYmd(datemax) && datemin <= datemax) {
      dminP = datemin;
      dmaxP = datemax;
    } else if (/^\d{4}-\d{2}$/.test(String(mes || ''))) {
      const [y, m] = String(mes).split('-').map(Number);
      dminP = `${mes}-01`;
      dmaxP = `${mes}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
    } else {
      return errorResponse(
        res,
        "Informe datemin/datemax ('YYYY-MM-DD') ou mes ('YYYY-MM')",
        400,
        'MISSING_PERIOD',
      );
    }
    // Semanas customizadas do frontend (o gestor ajusta as datas);
    // sem elas, quebra o período em blocos de 7 dias a partir do início.
    const custom = Array.isArray(semanas)
      ? semanas
          .filter((w) => w && isYmd(w.datemin) && isYmd(w.datemax) && w.datemin <= w.datemax)
          .map((w, i) => ({ s: Number(w.s) || i + 1, datemin: w.datemin, datemax: w.datemax }))
      : [];
    const addDays = (iso, n) => {
      const d = new Date(`${iso}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() + n);
      return d.toISOString().slice(0, 10);
    };
    const SEMANAS_DEF =
      custom.length > 0
        ? custom
        : (() => {
            const out = [];
            let ini = dminP;
            let s = 1;
            while (ini <= dmaxP && s <= 10) {
              const fimBloco = addDays(ini, 6);
              out.push({
                s,
                datemin: ini,
                datemax: fimBloco <= dmaxP ? fimBloco : dmaxP,
              });
              ini = addDays(out[out.length - 1].datemax, 1);
              s++;
            }
            return out;
          })();

    const INTERNAL = `http://localhost:${process.env.PORT || 4100}/api/totvs/sale-panel/faturamento-vendedor`;
    const canais = {}; // CANAL → { s1..s5 }
    const put = (key, s, valor) => {
      if (!canais[key]) canais[key] = {};
      canais[key][`s${s}`] =
        Math.round(((canais[key][`s${s}`] || 0) + (valor || 0)) * 100) / 100;
    };

    // Vendedores dos canais do Forecast — o drill deles vai JUNTO na resposta
    // (o clique na célula não refaz busca nenhuma: as vendas já foram
    // computadas pra chegar no total da célula).
    const CANAL_SELLER_CODES = [
      40, 161, 241, 165, 21, 26, 259,
      FAT_VEND_RICARDO_CODE, // -512 (Ricardo Eletro, op 512)
      FAT_VEND_BLUECRED_CODE, // -1000 (BlueCred, crediário)
    ];
    // Lê o cache da rota principal (mesmo processo) pra extrair as vendas
    const harvestDrill = (w, data) => {
      let cached = null;
      for (const [k, v] of FAT_VEND_CACHE.entries()) {
        if (k.startsWith(`${w.datemin}|${w.datemax}|`)) {
          cached = v;
          break;
        }
      }
      const vendedores = {};
      for (const code of CANAL_SELLER_CODES) {
        const row = (data.dataRow || []).find(
          (x) => Number(x.seller_code) === code,
        );
        if (!row) continue;
        vendedores[code] = {
          seller_code: code,
          seller_name: row.seller_name,
          qtd: row.qtd,
          valor: row.valor,
          vendas: cached?.detalhes?.[code] || [],
        };
      }
      return {
        vendedores,
        varejo: data.varejo || [], // lojas + vendedores (clientes sob demanda)
        expedicao: cached?.detalhes?.[FAT_VEND_EXPEDICAO_CODE] || [],
      };
    };

    // 2 semanas em paralelo: corta o tempo frio pela metade sem sobrecarregar
    const drill = {};
    let idxSem = 0;
    const worker = async () => {
      for (;;) {
        const i = idxSem++;
        if (i >= SEMANAS_DEF.length) return;
        const w = SEMANAS_DEF[i];
        let data;
        try {
          const r = await axios.post(
            INTERNAL,
            { filtroempresa: filtroempresa || [], datemin: w.datemin, datemax: w.datemax },
            { timeout: 600000 },
          );
          data = r.data?.data || r.data || {};
        } catch (err) {
          console.warn(`[fat-vend-semanal] S${w.s} falhou: ${err.message}`);
          continue;
        }
        const rowVal = (code) =>
          Number(
            (data.dataRow || []).find((x) => Number(x.seller_code) === code)
              ?.valor || 0,
          );
        put('FRANQUIAS', w.s, rowVal(40));
        put('REVENDA', w.s, rowVal(161) + rowVal(241) + rowVal(165));
        put('MTM_RAFAEL', w.s, rowVal(21));
        put('MTM_DAVID', w.s, rowVal(26));
        put('MTM_ARTHUR', w.s, rowVal(259));
        put(
          'VAREJO',
          w.s,
          (data.varejo || []).reduce((a, b) => a + (b.valor || 0), 0),
        );
        let novidades = 0;
        let showroom = 0;
        let bazar = 0;
        for (const [op, v] of Object.entries(data.expedicao_por_op || {})) {
          const opNum = Number(op);
          if (opNum === 7255) novidades += v;
          else if (FAT_VEND_BAZAR_OPS.has(opNum)) bazar += v;
          else showroom += v;
        }
        put('NOVIDADES', w.s, novidades);
        put('SHOWROOM', w.s, showroom);
        put('BAZAR', w.s, bazar);
        put('RICARDO_ELETRO', w.s, rowVal(FAT_VEND_RICARDO_CODE));
        put('BLUECRED', w.s, rowVal(FAT_VEND_BLUECRED_CODE));
        drill[`s${w.s}`] = harvestDrill(w, data);
      }
    };
    await Promise.all([worker(), worker()]);

    return successResponse(
      res,
      { datemin: dminP, datemax: dmaxP, semanas: SEMANAS_DEF, canais, drill },
      `Semanal de ${dminP} a ${dmaxP} (${SEMANAS_DEF.length} semanas)`,
    );
  }),
);

// =============================================================================
// NEW FORECAST — configuração persistida por período
// Tabela Supabase new_forecast_config (migrations/new_forecast_config.sql):
// semanas ajustadas, metas, valores manuais e overrides — compartilhados
// entre navegadores/usuários.
// GET  /api/totvs/new-forecast/config?datemin=&datemax=
// POST /api/totvs/new-forecast/config { datemin, datemax, semanas?, metas?, manual?, overrides? }
// =============================================================================
router.get(
  '/new-forecast/config',
  asyncHandler(async (req, res) => {
    const { datemin, datemax } = req.query || {};
    if (!datemin || !datemax) {
      return errorResponse(res, 'datemin e datemax obrigatórios', 400, 'MISSING_PERIOD');
    }
    const key = `${datemin}|${datemax}`;
    const { data, error } = await supabase
      .from('new_forecast_config')
      .select('*')
      .eq('period_key', key)
      .limit(1);
    if (error) {
      return errorResponse(res, `Supabase: ${error.message}`, 500);
    }
    return successResponse(res, data?.[0] || null);
  }),
);

router.post(
  '/new-forecast/config',
  asyncHandler(async (req, res) => {
    const { datemin, datemax, semanas, metas, manual, overrides } = req.body || {};
    const isYmdCfg = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
    if (!isYmdCfg(datemin) || !isYmdCfg(datemax)) {
      return errorResponse(res, 'datemin e datemax obrigatórios (YYYY-MM-DD)', 400, 'MISSING_PERIOD');
    }
    const row = {
      period_key: `${datemin}|${datemax}`,
      datemin,
      datemax,
      semanas: Array.isArray(semanas) && semanas.length ? semanas : null,
      metas: metas && typeof metas === 'object' ? metas : {},
      manual: manual && typeof manual === 'object' ? manual : {},
      overrides: overrides && typeof overrides === 'object' ? overrides : {},
      atualizado_em: new Date().toISOString(),
    };
    const { error } = await supabase
      .from('new_forecast_config')
      .upsert(row, { onConflict: 'period_key' });
    if (error) {
      return errorResponse(res, `Supabase: ${error.message}`, 500);
    }
    return successResponse(res, row, 'Config salva');
  }),
);

// =============================================================================
// POST /api/totvs/seller-panel/totals
// Proxy direto pra TOTVS Analytics v2: /seller-panel/totals/search
// Retorna faturamento agregado por vendedor (TM, PA, PMPV) já calculado.
// Body: { branchs?: number[], datemin, datemax, operations?: number[] }
//   branchs = [] ou [0] → todas as branches
//   operations = [] ou [0] → todas as operações
// =============================================================================
router.post(
  '/seller-panel/totals',
  asyncHandler(async (req, res) => {
    const { branchs, datemin, datemax, operations } = req.body || {};
    if (!datemin || !datemax) {
      return errorResponse(res, 'datemin e datemax obrigatórios', 400, 'MISSING_DATES');
    }

    const tokenData = await getToken();
    if (!tokenData?.access_token) {
      return errorResponse(res, 'Token TOTVS indisponível', 503, 'TOKEN_UNAVAILABLE');
    }
    let accessToken = tokenData.access_token;

    // Branches: se vazio/0, busca todas
    let branchList = Array.isArray(branchs) ? branchs.filter((b) => b && b !== 0) : [];
    if (branchList.length === 0) {
      try {
        branchList = await getBranchCodes(accessToken);
      } catch (e) {
        // Fallback amplo
        branchList = [
          1, 2, 5, 6, 11, 50, 55, 65, 75, 85, 87, 88, 89, 90, 91, 92, 93, 94, 95,
          96, 97, 98, 99, 100, 101, 111, 200, 300, 351, 400, 500, 550, 600, 650,
          700, 750, 800, 850, 870, 880, 890, 891, 900, 910, 920, 930, 940, 950,
          960, 970, 980, 990,
        ];
      }
    }

    // Operations: passa apenas se veio (TOTVS lida com vazio)
    const opList = Array.isArray(operations) ? operations.filter((o) => o && o !== 0) : [];

    const endpoint = `${TOTVS_BASE_URL}/analytics/v2/seller-panel/totals/search`;

    const doRequest = async (token, payload) =>
      axios.post(endpoint, payload, {
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
        httpsAgent,
        httpAgent,
        timeout: 180000,
      });

    const payload = {
      branchs: branchList,
      datemin,
      datemax,
      ...(opList.length > 0 ? { operations: opList } : {}),
    };

    try {
      let response;
      try {
        response = await doRequest(accessToken, payload);
      } catch (err) {
        if (err.response?.status === 401) {
          const nt = await getToken(true);
          accessToken = nt.access_token;
          response = await doRequest(accessToken, payload);
        } else {
          throw err;
        }
      }
      return successResponse(res, response.data, 'OK');
    } catch (err) {
      const detail = err.response?.data;
      return errorResponse(
        res,
        `TOTVS seller-panel/totals: ${typeof detail === 'string' ? detail : err.message}`,
        err.response?.status || 500,
      );
    }
  }),
);

// POST /api/totvs/seller-panel/top-customers
// Body: { branchs: number[], datemin, datemax, orderByQuantity, returnItensQuantity }
// =============================================================================
router.post(
  '/seller-panel/top-customers',
  asyncHandler(async (req, res) => {
    // Rota pesada — aumentar timeout do request para 10 min
    req.setTimeout(600000);
    res.setTimeout(600000);
    const startTime = Date.now();
    const { branchs, datemin, datemax, orderByQuantity, returnItensQuantity } =
      req.body;

    if (!datemin || !datemax) {
      return errorResponse(
        res,
        'Os campos datemin e datemax são obrigatórios',
        400,
        'MISSING_DATES',
      );
    }

    const tokenData = await getToken();
    if (!tokenData?.access_token) {
      return errorResponse(
        res,
        'Não foi possível obter token TOTVS',
        503,
        'TOKEN_UNAVAILABLE',
      );
    }

    let accessToken = tokenData.access_token;

    // Lojas de varejo permitidas
    const VAREJO_BRANCHES = [
      2, 200, 5, 500, 55, 550, 65, 650, 87, 870, 88, 880, 89, 890, 90, 891, 91,
      910, 92, 920, 93, 930, 94, 940, 95, 950, 96, 960, 97, 970, 98, 980,
    ];

    // Resolver branchCodes — filtrar apenas varejo
    let branchCodeList;
    if (Array.isArray(branchs) && branchs.length > 0 && branchs[0] !== 0) {
      branchCodeList = branchs.filter((b) => VAREJO_BRANCHES.includes(b));
    } else {
      branchCodeList = VAREJO_BRANCHES;
    }

    if (branchCodeList.length === 0) {
      return successResponse(res, [], 'Nenhuma loja de varejo selecionada');
    }

    const endpoint = `${TOTVS_BASE_URL}/analytics/v2/fiscal-movement/search`;
    const PAGE_SIZE = 1000;

    const doRequest = async (token, payload) =>
      axios.post(endpoint, payload, {
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
        httpsAgent,
        httpAgent,
        timeout: 120000,
      });

    // ======== Mesmas regras de operações do ranking-faturamento ========
    const SPECIAL_BRANCH_CODES = new Set([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 31, 41, 45, 50, 55,
      65, 75, 85, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101,
      105, 106, 107, 108, 109, 111, 200, 300, 311, 351, 400, 411, 450, 500, 550,
      551, 600, 650, 700, 750, 800, 850, 870, 880, 890, 891, 900, 910, 920, 930,
      940, 950, 960, 970, 980, 990,
    ]);
    const SPECIAL_OPERATIONS = new Set([
      1, 2, 55, 510, 511, 1511, 521, 1521, 522, 960, 9001, 9009, 9027, 9017,
      9400, 9401, 9402, 9403, 9404, 9005, 545, 546, 555, 548, 1210, 9405, 1205,
      1101, 9065, 9064, 9063, 9062, 9061, 9420, 9026, 9067,
    ]);

    // Separar branches especiais (com filtro de operações) dos demais
    const specialBranches = branchCodeList.filter((b) =>
      SPECIAL_BRANCH_CODES.has(b),
    );
    const otherBranches = branchCodeList.filter(
      (b) => !SPECIAL_BRANCH_CODES.has(b),
    );

    // Para filtrar operações no código: quais branches precisam do filtro
    const specialBranchSet = new Set(specialBranches);

    // Set de todas as branches válidas (para filtrar no código — API pode ignorar branchCodeList)
    const validBranchSet = new Set(branchCodeList);

    console.log(
      `🏆 [TopCustomers] Buscando fiscal-movement | ${branchCodeList.length} branches (${specialBranches.length} special + ${otherBranches.length} other) | ${datemin} a ${datemax}`,
    );

    // Função para buscar todas as páginas — agrega on-the-fly (fetch único, sem chunks)
    const fetchAllAggregated = async (brMap) => {
      let pg = 1;
      let hasNext = true;
      let totalItems = 0;
      // Dedup: operações complementares (ex: 545 remessa + 555 venda) geram 2 registros
      // para a mesma mercadoria. Usar chave composta para contar apenas uma vez.
      const seenMovements = new Set();
      while (hasNext) {
        const payload = {
          filter: {
            branchCodeList,
            startMovementDate: datemin,
            endMovementDate: datemax,
          },
          page: pg,
          pageSize: PAGE_SIZE,
        };
        let response;
        try {
          response = await doRequest(accessToken, payload);
        } catch (error) {
          if (error.response?.status === 401) {
            const newToken = await getToken(true);
            accessToken = newToken.access_token;
            response = await doRequest(accessToken, payload);
          } else {
            throw error;
          }
        }
        const pageItems = response.data?.items || [];
        // Agregar direto em memória — filtrar operações como ranking-faturamento
        for (const item of pageItems) {
          if (
            !item.operationModel ||
            item.operationModel === 'Purchases' ||
            item.operationModel === 'SaleReturns'
          )
            continue;
          const bc = item.branchCode;
          const pc = item.personCode;
          if (!bc || !pc) continue;
          // Filtrar branchCode no código (API pode ignorar branchCodeList)
          if (!validBranchSet.has(bc)) continue;
          // Filiais especiais: só aceitar operações do SPECIAL_OPERATIONS
          if (
            specialBranchSet.has(bc) &&
            !SPECIAL_OPERATIONS.has(item.operationCode)
          )
            continue;
          // Dedup: mesma pessoa+filial+data+produto+valores = mesmo movimento (operações complementares)
          const dedupKey = `${bc}|${pc}|${item.movementDate}|${item.productCode || ''}|${item.quantity || 0}|${item.grossValue || 0}|${item.netValue || 0}`;
          if (seenMovements.has(dedupKey)) continue;
          seenMovements.add(dedupKey);
          if (!brMap[bc]) brMap[bc] = {};
          if (!brMap[bc][pc]) {
            brMap[bc][pc] = {
              code: String(pc),
              personCode: pc,
              name: '',
              quantity: 0,
              grossValue: 0,
              discountValue: 0,
              netValue: 0,
              purchaseDates: new Set(),
            };
          }
          brMap[bc][pc].quantity += item.quantity || 0;
          brMap[bc][pc].grossValue += item.grossValue || 0;
          brMap[bc][pc].discountValue += item.discountValue || 0;
          brMap[bc][pc].netValue += item.netValue || 0;
          if (item.movementDate) {
            brMap[bc][pc].purchaseDates.add(
              String(item.movementDate).split('T')[0],
            );
          }
        }
        totalItems += pageItems.length;
        hasNext = response.data?.hasNext ?? false;
        console.log(
          `🏆 [TopCustomers] Pág ${pg}: +${pageItems.length} (total: ${totalItems}) hasNext: ${hasNext}`,
        );
        pg++;
        if (pg > 200) break;
      }
      return totalItems;
    };

    // ======== Ranking + branch info (definir antes para rodar em paralelo) ========
    let branchInfo = {};
    let rankingDataRow = [];

    const rankingEndpoint = `${TOTVS_BASE_URL}/sale-panel/v2/totals-branch/search`;
    const callRankingTotvs = async (token, body) =>
      axios.post(rankingEndpoint, body, {
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
        httpsAgent,
        httpAgent,
        timeout: 60000,
      });

    const fetchRankingData = async () => {
      const callPromises = [];
      if (specialBranches.length > 0) {
        callPromises.push(
          callRankingTotvs(accessToken, {
            branchs: specialBranches,
            datemin,
            datemax,
            operations: [...SPECIAL_OPERATIONS],
          }),
        );
      }
      if (otherBranches.length > 0) {
        callPromises.push(
          callRankingTotvs(accessToken, {
            branchs: otherBranches,
            datemin,
            datemax,
          }),
        );
      }
      const responses = await Promise.all(callPromises);
      return responses.flatMap((r) => r.data?.dataRow || []);
    };

    // ======== FASE 1: fiscal-movement (fetch único) + branch info + ranking — SIMULTÂNEO ========
    const branchMap = {};
    const [totalFetched, brRankResults] = await Promise.all([
      fetchAllAggregated(branchMap),
      Promise.allSettled([
        getBranchesWithNames(accessToken),
        fetchRankingData(),
      ]),
    ]);

    // Processar branch info + ranking
    if (brRankResults[0].status === 'fulfilled') {
      for (const b of brRankResults[0].value) {
        branchInfo[b.code] = {
          name: b.name || `Filial ${b.code}`,
          groupName: b.groupName || b.name || `Filial ${b.code}`,
        };
      }
    }
    if (brRankResults[1].status === 'fulfilled') {
      rankingDataRow = brRankResults[1].value;
    } else {
      console.log(
        '⚠️ [TopCustomers] Erro ranking:',
        brRankResults[1].reason?.message,
      );
    }

    const totalClientes = Object.values(branchMap).reduce(
      (s, m) => s + Object.keys(m).length,
      0,
    );
    console.log(
      `🏆 [TopCustomers] ${totalFetched} movimentos → ${totalClientes} clientes únicos (${Date.now() - startTime}ms)`,
    );

    // ======== Agrupar por empresa e PRÉ-LIMITAR antes de buscar nomes ========
    const limit = returnItensQuantity || 50;
    const PRE_LIMIT = limit * 3; // margem para filtrar CROSBY/TESTE depois
    const groupMap = {};

    for (const [bc, customers] of Object.entries(branchMap)) {
      const branchCode = Number(bc);
      const info = branchInfo[branchCode] || {
        name: `Filial ${branchCode}`,
        groupName: `Filial ${branchCode}`,
      };
      const groupKey = info.groupName;

      if (!groupMap[groupKey]) {
        groupMap[groupKey] = {
          groupName: groupKey,
          branchCodes: [],
          customerMap: {},
        };
      }
      groupMap[groupKey].branchCodes.push(branchCode);

      for (const [pc, data] of Object.entries(customers)) {
        if (!groupMap[groupKey].customerMap[pc]) {
          groupMap[groupKey].customerMap[pc] = {
            ...data,
            purchaseDates: new Set(data.purchaseDates),
          };
        } else {
          groupMap[groupKey].customerMap[pc].quantity += data.quantity;
          groupMap[groupKey].customerMap[pc].grossValue += data.grossValue;
          groupMap[groupKey].customerMap[pc].discountValue +=
            data.discountValue;
          groupMap[groupKey].customerMap[pc].netValue += data.netValue;
          for (const d of data.purchaseDates) {
            groupMap[groupKey].customerMap[pc].purchaseDates.add(d);
          }
        }
      }
    }

    // Pré-ordenar cada grupo e pegar só os top PRE_LIMIT para buscar nomes
    const needNameCodes = new Set();
    for (const group of Object.values(groupMap)) {
      const arr = Object.values(group.customerMap);
      if (orderByQuantity) {
        arr.sort((a, b) => b.quantity - a.quantity);
      } else {
        arr.sort((a, b) => b.netValue - a.netValue);
      }
      const top = arr.slice(0, PRE_LIMIT);
      for (const c of top) needNameCodes.add(c.personCode);
    }

    console.log(
      `🏆 [TopCustomers] Pré-limitado: buscando nomes de ${needNameCodes.size} clientes (de ${totalClientes} total)`,
    );

    // ======== FASE 2: buscar nomes — SÓ DOS TOP CLIENTES, EM PARALELO ========
    const personNames = {};
    const personPhones = {};
    // Extrai o 1º telefone válido (>= 8 dígitos) de um item de pessoa do TOTVS
    const extractPhone = (item) => {
      if (!Array.isArray(item?.phones)) return null;
      for (const ph of item.phones) {
        const num = String(ph.number || '').replace(/\D/g, '');
        if (num.length < 8) continue;
        const area = String(ph.areaCode || '').replace(/\D/g, '');
        return area && !num.startsWith(area) ? area + num : num;
      }
      return null;
    };
    const codesToLookup = [...needNameCodes];
    if (codesToLookup.length > 0) {
      const BATCH = 50;

      const doPersonReq = async (url, payload, token) =>
        axios.post(url, payload, {
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Bearer ${token}`,
          },
          httpsAgent,
          httpAgent,
          timeout: 30000,
        });

      const nameBatches = [];
      for (let i = 0; i < codesToLookup.length; i += BATCH) {
        nameBatches.push(codesToLookup.slice(i, i + BATCH));
      }

      const nameResults = await Promise.allSettled(
        nameBatches.map(async (batch) => {
          const payload = {
            filter: { personCodeList: batch },
            expand: 'phones',
            page: 1,
            pageSize: batch.length,
          };
          const [pjRes, pfRes] = await Promise.allSettled([
            doPersonReq(
              `${TOTVS_BASE_URL}/person/v2/legal-entities/search`,
              payload,
              accessToken,
            )
              .then((r) => r.data?.items || [])
              .catch(() => []),
            doPersonReq(
              `${TOTVS_BASE_URL}/person/v2/individuals/search`,
              payload,
              accessToken,
            )
              .then((r) => r.data?.items || [])
              .catch(() => []),
          ]);
          return {
            pj: pjRes.status === 'fulfilled' ? pjRes.value : [],
            pf: pfRes.status === 'fulfilled' ? pfRes.value : [],
          };
        }),
      );

      for (const result of nameResults) {
        if (result.status !== 'fulfilled') continue;
        for (const p of result.value.pj) {
          if (p.code) {
            personNames[p.code] = p.fantasyName || p.name || '';
            const tel = extractPhone(p);
            if (tel) personPhones[p.code] = tel;
          }
        }
        for (const p of result.value.pf) {
          if (p.code) {
            personNames[p.code] = p.name || '';
            const tel = extractPhone(p);
            if (tel) personPhones[p.code] = tel;
          }
        }
      }

      console.log(
        `🏆 [TopCustomers] Nomes obtidos: ${Object.keys(personNames).length}/${codesToLookup.length} (${Date.now() - startTime}ms)`,
      );
    }

    // Mapear ranking de faturamento por branchCode
    const rankingByBranch = {};
    for (const row of rankingDataRow) {
      const code = row.branch_code ?? 0;
      rankingByBranch[code] = row;
    }

    // Montar resultado final por grupo
    const branches = Object.values(groupMap).map((group) => {
      let clientList = Object.values(group.customerMap);
      // Enriquecer com nomes e calcular métricas de compra
      for (const c of clientList) {
        c.name = personNames[c.personCode] || `Cliente ${c.personCode}`;
        c.telefone = personPhones[c.personCode] || null;
        const dates = [...(c.purchaseDates || [])].sort();
        c.purchaseCount = dates.length;
        c.lastPurchase = dates.length > 0 ? dates[dates.length - 1] : null;
        if (dates.length >= 2) {
          const first = new Date(dates[0]).getTime();
          const last = new Date(dates[dates.length - 1]).getTime();
          const diffMs = last - first;
          const diffMonths = diffMs / (1000 * 60 * 60 * 24 * 30.44);
          c.avgPurchaseIntervalMonths = parseFloat(
            (diffMonths / (dates.length - 1)).toFixed(1),
          );
        } else {
          c.avgPurchaseIntervalMonths = 0;
        }
        delete c.purchaseDates;
      }
      // Remover lojas próprias CROSBY e registros de TESTE
      clientList = clientList.filter((c) => {
        const upper = c.name.toUpperCase();
        return !upper.startsWith('CROSBY') && !upper.startsWith('TESTE');
      });
      // Ordenar e limitar
      if (orderByQuantity) {
        clientList.sort((a, b) => b.quantity - a.quantity);
      } else {
        clientList.sort((a, b) => b.netValue - a.netValue);
      }
      clientList = clientList.slice(0, limit);

      const totalNetValue = clientList.reduce((s, c) => s + c.netValue, 0);
      const totalGrossValue = clientList.reduce((s, c) => s + c.grossValue, 0);
      const totalQuantity = clientList.reduce((s, c) => s + c.quantity, 0);

      // Agregar ranking faturamento para o grupo (somar filiais do mesmo grupo)
      let rankingInvoiceQty = 0;
      let rankingInvoiceValue = 0;
      let rankingItensQty = 0;
      for (const bc of group.branchCodes) {
        const r = rankingByBranch[bc];
        if (r) {
          rankingInvoiceQty += Number(r.invoice_qty || 0);
          rankingInvoiceValue += Number(r.invoice_value || 0);
          rankingItensQty += Number(r.itens_qty || 0);
        }
      }
      const rankingTM =
        rankingInvoiceQty > 0 ? rankingInvoiceValue / rankingInvoiceQty : 0;
      const rankingPA =
        rankingInvoiceQty > 0 ? rankingItensQty / rankingInvoiceQty : 0;
      const rankingPMPV =
        rankingItensQty > 0 ? rankingInvoiceValue / rankingItensQty : 0;

      return {
        branchCode: group.branchCodes[0],
        branchCodes: group.branchCodes.sort((a, b) => a - b),
        branchName: group.groupName,
        totalClients: clientList.length,
        totalNetValue,
        totalGrossValue,
        totalQuantity,
        ranking: {
          invoiceQty: rankingInvoiceQty,
          invoiceValue: rankingInvoiceValue,
          itensQty: rankingItensQty,
          tm: rankingTM,
          pa: rankingPA,
          pmpv: rankingPMPV,
        },
        clients: clientList,
      };
    });

    // Ordenar branches por faturamento líquido
    branches.sort((a, b) => b.totalNetValue - a.totalNetValue);

    const totalTime = Date.now() - startTime;
    console.log(
      `🏆 [TopCustomers] Concluído: ${branches.length} filiais em ${totalTime}ms`,
    );

    return successResponse(
      res,
      { branches },
      `Top clientes de ${branches.length} filiais obtidos em ${totalTime}ms`,
    );
  }),
);

// =============================================================================
// TRANSAÇÕES DE UM CLIENTE — detalhe por fiscal-movement
// POST /api/totvs/seller-panel/top-customers/transactions
// Body: { personCode, branchCodes, datemin, datemax }
// =============================================================================
router.post(
  '/seller-panel/top-customers/transactions',
  asyncHandler(async (req, res) => {
    req.setTimeout(300000);
    res.setTimeout(300000);
    const { personCode, branchCodes, datemin, datemax } = req.body;

    if (!personCode || !datemin || !datemax) {
      return errorResponse(
        res,
        'personCode, datemin e datemax são obrigatórios',
        400,
        'MISSING_PARAMS',
      );
    }

    const tokenData = await getToken();
    if (!tokenData?.access_token) {
      return errorResponse(
        res,
        'Não foi possível obter token TOTVS',
        503,
        'TOKEN_UNAVAILABLE',
      );
    }

    let accessToken = tokenData.access_token;
    const endpoint = `${TOTVS_BASE_URL}/analytics/v2/fiscal-movement/search`;
    const PAGE_SIZE = 500;

    const SPECIAL_BRANCH_CODES = new Set([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 31, 41, 45, 50, 55,
      65, 75, 85, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101,
      105, 106, 107, 108, 109, 111, 200, 300, 311, 351, 400, 411, 450, 500, 550,
      551, 600, 650, 700, 750, 800, 850, 870, 880, 890, 891, 900, 910, 920, 930,
      940, 950, 960, 970, 980, 990,
    ]);
    const SPECIAL_OPERATIONS = new Set([
      1, 2, 55, 510, 511, 1511, 521, 1521, 522, 960, 9001, 9009, 9027, 9017,
      9400, 9401, 9402, 9403, 9404, 9005, 545, 546, 555, 548, 1210, 9405, 1205,
      1101, 9065, 9064, 9063, 9062, 9061, 9420, 9026, 9067,
    ]);

    const specialBranchSet = new Set(
      (branchCodes || []).filter((b) => SPECIAL_BRANCH_CODES.has(b)),
    );

    const doRequest = async (token, payload) =>
      axios.post(endpoint, payload, {
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
        httpsAgent,
        httpAgent,
        timeout: 60000,
      });

    const targetPersonCode = Number(personCode);

    const transactions = [];
    const txSeenSet = new Set();
    let pg = 1;
    let hasNext = true;

    while (hasNext) {
      const payload = {
        filter: {
          branchCodeList: branchCodes || [],
          personCodeList: [targetPersonCode],
          startMovementDate: datemin,
          endMovementDate: datemax,
        },
        page: pg,
        pageSize: PAGE_SIZE,
      };

      let response;
      try {
        response = await doRequest(accessToken, payload);
      } catch (error) {
        if (error.response?.status === 401) {
          const newToken = await getToken(true);
          accessToken = newToken.access_token;
          response = await doRequest(accessToken, payload);
        } else {
          throw error;
        }
      }

      const items = response.data?.items || [];
      // Log temporário — inspecionar campos disponíveis
      if (pg === 1 && items.length > 0) {
        console.log(
          '🔍 [Transactions] Sample item keys:',
          Object.keys(items[0]),
        );
        console.log(
          '🔍 [Transactions] Sample item:',
          JSON.stringify(items[0], null, 2),
        );
      }
      for (const item of items) {
        // Filtrar por personCode no código (API ignora personCodeList)
        if (item.personCode !== targetPersonCode) continue;
        if (
          !item.operationModel ||
          item.operationModel === 'Purchases' ||
          item.operationModel === 'SaleReturns'
        )
          continue;
        const bc = item.branchCode;
        if (
          specialBranchSet.has(bc) &&
          !SPECIAL_OPERATIONS.has(item.operationCode)
        )
          continue;

        // Dedup: operações complementares (545/555) geram registros duplicados
        const dedupKey = `${bc}|${targetPersonCode}|${item.movementDate}|${item.productCode || ''}|${item.quantity || 0}|${item.grossValue || 0}|${item.netValue || 0}`;
        if (txSeenSet.has(dedupKey)) continue;
        txSeenSet.add(dedupKey);

        transactions.push({
          movementDate: item.movementDate,
          invoiceNumber: item.invoiceNumber || item.documentNumber || '',
          invoiceSeries: item.invoiceSeries || item.documentSeries || '',
          operationCode: item.operationCode,
          operationName: item.operationName || '',
          operationModel: item.operationModel || '',
          branchCode: bc,
          quantity: item.quantity || 0,
          grossValue: item.grossValue || 0,
          discountValue: item.discountValue || 0,
          netValue: item.netValue || 0,
          productCode: item.productCode || '',
          productName: item.productName || '',
        });
      }

      hasNext = response.data?.hasNext ?? false;
      pg++;
      if (pg > 50) break;
    }

    // Ordenar por data desc
    transactions.sort(
      (a, b) => new Date(b.movementDate) - new Date(a.movementDate),
    );

    return successResponse(
      res,
      { transactions, total: transactions.length },
      `${transactions.length} transações encontradas`,
    );
  }),
);

// =============================================================================
// COMPRAS DAS FRANQUIAS — quanto cada franquia comprou da matriz (empresa 99)
// ⚠️ Cache pra reduzir carga TOTVS (compras-franquias faz 3 fetches paginados).
//   - Realtime (datemax >= hoje):  30min
//   - Passado:                     12h
const COMPRAS_FRANQUIAS_CACHE = new Map();
const COMPRAS_FRANQUIAS_TTL = 30 * 60 * 1000;
const COMPRAS_FRANQUIAS_TTL_PAST = 12 * 60 * 60 * 1000;

// POST /api/totvs/sale-panel/compras-franquias
// Body: { datemin, datemax }
// Retorna: array de { person_code, fantasy_name, nm_pessoa, totalValue, qty }
//
// Lógica:
//   1. Busca NFs em fiscal/v2/invoices/search com filtros:
//      - branchCodeList: [99] (matriz é a vendedora)
//      - operationCodeList: [7234, 7240, 7802, 9124, 7259] (ops de venda → franquia)
//      - operationType: 'Output'
//   2. Agrega por personCode (= cliente franquia)
//   3. Enriquece com fantasy_name + nm_pessoa via pes_pessoa
// =============================================================================
// Ops de compra franquia ATUAL (2026+): 7234, 7240, 7802, 9124, 7259, 7279
// 7279 adicionada em 2026-06: op compartilhada (franquia=dealer 40, business=20, revenda=161/241/165).
// Como compras-franquias filtra por personCode (cliente franquia), pegar tudo é correto.
const FRANQUIA_OP_CODES = [7234, 7240, 7802, 9124, 7259, 7279];
// Ops adicionais usadas APENAS em anos anteriores (matriz antiga). Somadas
// às atuais quando busca dados LY (não usadas em 2026 para evitar varejo).
const FRANQUIA_OP_CODES_LY_EXTRA = [
  1711,
  7807, 5111, 5102, 512, 5106, 400, 1400, 1410, 1407,
  7109, 9110,
];
const FRANQUIA_OP_CODES_LY = [
  ...FRANQUIA_OP_CODES,
  ...FRANQUIA_OP_CODES_LY_EXTRA,
];
// Op codes considerados credev/devolução de franquia (entradas na matriz).
// Inclui ops específicas de devolução de franquia (7243, 8888, 8889) além
// das genéricas. O filtro final aceita apenas pessoas que compraram no
// período (op franquia), evitando capturar devoluções de consumidor varejo.
const FRANQUIA_CREDEV_OP_CODES = [
  7243, 7244, 7245, 7247, 8888, 8889,
  1, 2, 555, 9073, 9402, 9065, 9403, 9062, 9005, 7790, 20, 1214,
];

router.post(
  '/sale-panel/compras-franquias',
  asyncHandler(async (req, res) => {
    const { datemin, datemax } = req.body;
    if (!datemin || !datemax) {
      return errorResponse(
        res,
        'datemin e datemax obrigatórios',
        400,
        'MISSING_DATES',
      );
    }

    // Cache check
    const cacheKey = `${datemin}|${datemax}`;
    const todayIso = new Date().toISOString().split('T')[0];
    const isRealtime = datemax >= todayIso;
    const cacheTTL = isRealtime ? COMPRAS_FRANQUIAS_TTL : COMPRAS_FRANQUIAS_TTL_PAST;
    const cached = COMPRAS_FRANQUIAS_CACHE.get(cacheKey);
    if (cached && Date.now() - cached.ts < cacheTTL) {
      console.log(
        `[compras-franquias] CACHE HIT ${cacheKey} (idade ${Math.floor((Date.now() - cached.ts) / 1000)}s)`,
      );
      return successResponse(
        res,
        { ...cached.data, cached: true },
        'OK (cache)',
      );
    }

    const tokenData = await getToken();
    if (!tokenData?.access_token) {
      return errorResponse(res, 'Token TOTVS indisponível', 503, 'TOKEN_OFF');
    }
    const accessToken = tokenData.access_token;

    // Período do mesmo intervalo no ANO ANTERIOR (para taxa de crescimento)
    const subtractYear = (iso) => {
      const d = new Date(`${iso}T12:00:00`);
      d.setFullYear(d.getFullYear() - 1);
      return d.toISOString().slice(0, 10);
    };
    const datemin_ly = subtractYear(datemin);
    const datemax_ly = subtractYear(datemax);

    // ─── Busca paginada das NFs (compras + credev) em paralelo ──────────────
    const endpoint = `${TOTVS_BASE_URL}/fiscal/v2/invoices/search`;
    const pageSize = 100;

    // Helper: paginação completa para um filtro
    const fetchAllPages = async (filter, tag) => {
      const fetchPage = async (page) => {
        try {
          const r = await axios.post(
            endpoint,
            { filter, page, pageSize },
            {
              headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                Authorization: `Bearer ${accessToken}`,
              },
              httpsAgent,
              timeout: 60000,
            },
          );
          return r.data || {};
        } catch (err) {
          console.warn(`[compras-franquias/${tag}] pág ${page}: ${err.message}`);
          return { items: [] };
        }
      };
      const first = await fetchPage(1);
      const out = [...(first.items || [])];
      const totalPages =
        first.totalPages ||
        (first.totalItems ? Math.ceil(first.totalItems / pageSize) : 1);
      if (totalPages > 1) {
        const rem = Array.from({ length: totalPages - 1 }, (_, i) => i + 2);
        // CONC reduzido 8→2 pra reduzir carga simultânea no TOTVS Analytics
        const CONC = 2;
        for (let i = 0; i < rem.length; i += CONC) {
          const batch = rem.slice(i, i + CONC);
          const results = await Promise.all(batch.map(fetchPage));
          for (const pd of results) out.push(...(pd?.items || []));
        }
      }
      return out;
    };

    // Filiais da matriz: atual = 99, legadas (anos anteriores) inclui:
    //   75, 750, 85, 850 — matrizes antigas
    //   1, 100, 2, 200   — também usadas em períodos anteriores
    const MATRIZ_BRANCHES_ATUAL = [99];
    const MATRIZ_BRANCHES_LEGACY = [75, 750, 85, 850, 1, 100, 2, 200];
    const MATRIZ_BRANCHES_ALL = [
      ...MATRIZ_BRANCHES_ATUAL,
      ...MATRIZ_BRANCHES_LEGACY,
    ];

    // ─── 1) Compras: saídas da matriz com ops franquia (busca em todas filiais)
    const filterCompras = {
      branchCodeList: MATRIZ_BRANCHES_ALL,
      operationCodeList: FRANQUIA_OP_CODES,
      operationType: 'Output',
      startIssueDate: `${datemin}T00:00:00`,
      endIssueDate: `${datemax}T23:59:59`,
    };
    // ─── 2) Credev: entradas na matriz com ops de devolução/credev ──
    const filterCredev = {
      branchCodeList: MATRIZ_BRANCHES_ALL,
      operationCodeList: FRANQUIA_CREDEV_OP_CODES,
      operationType: 'Input',
      startIssueDate: `${datemin}T00:00:00`,
      endIssueDate: `${datemax}T23:59:59`,
    };

    // ─── Filtros para o MESMO PERÍODO no ANO ANTERIOR ──
    // Em períodos passados, a matriz estava nas filiais legadas e usava ops
    // diferentes. Usamos lista expandida FRANQUIA_OP_CODES_LY que inclui
    // ops antigas (1711, 7807, 5102, etc.) além das atuais.
    const filterComprasLy = {
      ...filterCompras,
      operationCodeList: FRANQUIA_OP_CODES_LY,
      startIssueDate: `${datemin_ly}T00:00:00`,
      endIssueDate: `${datemax_ly}T23:59:59`,
    };

    const [compras, credevs, comprasLy] = await Promise.all([
      fetchAllPages(filterCompras, 'compras'),
      fetchAllPages(filterCredev, 'credev'),
      fetchAllPages(filterComprasLy, 'compras-ly'),
    ]);
    console.log(
      `[compras-franquias] atual: ${compras.length} compras + ${credevs.length} credev · ano anterior: ${comprasLy.length} compras`,
    );

    // Utilitários de normalização de nome (usados pra match LY ↔ 2026)
    const normName = (s) =>
      String(s || '')
        .toUpperCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^A-Z0-9 ]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    const stripVariantsLy = (s) => {
      // Gera múltiplas variações para match flexível com fantasy_name 2026
      const v = new Set();
      const base = normName(s);
      if (!base) return v;
      v.add(base);
      // Remove prefixos comuns
      const semPrefix = base
        .replace(/^F?\d{2,4}\s*-?\s*/, '')
        .replace(/\bFRANQUIA\b/g, '')
        .replace(/\bCROSBY\b/g, '')
        .replace(/\b(LTDA|ME|EPP|EIRELI|SA)\b/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (semPrefix) v.add(semPrefix);
      return v;
    };
    // Filtro: aceita apenas pessoas com nome de franquia (contém CROSBY ou
    // começa com F###). Sem isso, ops legadas como 5102/5111 capturariam
    // muito varejo de 2025, inflando o total.
    const looksLikeFranquia = (name) => {
      const n = String(name || '').toUpperCase();
      if (!n) return false;
      // Exclui claramente não-franquia (multimarcas / internos)
      if (/\bMTM\b|MULTIMARCAS/.test(n)) return false;
      if (/\b(SETOR|TESTE|MATRIZ|DEPARTAMENTO|DEPTO|RH|MARKETING|FINANCEIRO|EXPEDICAO|EXPEDIÇÃO|CD|CENTRO DE DISTRIBUI)\b/.test(n)) return false;
      return /\bCROSBY\b|^F\d{2,4}\s*-?\s*/.test(n);
    };

    // ─── Agrega COMPRAS por personCode ──
    const byPerson = new Map();
    const ensureEntry = (personCode, sampleName) => {
      if (!byPerson.has(personCode)) {
        byPerson.set(personCode, {
          person_code: personCode,
          total_compras: 0,
          total_credev: 0,
          qty: 0,
          credev_qty: 0,
          sample_name: sampleName || null,
        });
      }
      return byPerson.get(personCode);
    };
    for (const nf of compras) {
      if (nf.invoiceStatus === 'Canceled' || nf.invoiceStatus === 'Deleted') continue;
      const personCode = parseInt(nf.personCode);
      if (!personCode || personCode >= 100000000) continue;
      const total = parseFloat(nf.totalValue) || 0;
      if (total <= 0) continue;
      const e = ensureEntry(personCode, nf.personName);
      e.total_compras += total;
      e.qty += 1;
    }

    // ─── Agrega LY (ano anterior) por personCode E por NOME ──────────────
    // IMPORTANTE: este loop roda DEPOIS de byPerson ser construído.
    // Se o personCode da NF 2025 já é um comprador conhecido em 2026
    // (byPerson.has), aceitamos sem aplicar `looksLikeFranquia` — afinal
    // a entidade JÁ FOI VALIDADA como franquia pela combinação op_code+matriz
    // do ano atual. Isso resolve casos como "SAMARCOS EMPREENDIMENTOS LTDA"
    // (F121 - CROSBY PETROLINA em 2026) que tinha nome sem "CROSBY" em 2025.
    const lyByPerson = new Map();
    const lyByName = new Map();
    let totalRawLy = 0;
    let ignoradosLy = 0;
    let aceitosPorCode2026 = 0;
    for (const nf of comprasLy) {
      if (nf.invoiceStatus === 'Canceled' || nf.invoiceStatus === 'Deleted') continue;
      const personCode = parseInt(nf.personCode);
      if (!personCode || personCode >= 100000000) continue;
      const total = parseFloat(nf.totalValue) || 0;
      if (total <= 0) continue;
      const isKnown2026 = byPerson.has(personCode);
      if (!isKnown2026 && !looksLikeFranquia(nf.personName)) {
        ignoradosLy++;
        continue;
      }
      if (isKnown2026) aceitosPorCode2026++;
      totalRawLy += total;
      lyByPerson.set(personCode, (lyByPerson.get(personCode) || 0) + total);
      // Index pelo nome com TODAS as variações
      for (const v of stripVariantsLy(nf.personName)) {
        if (v) lyByName.set(v, (lyByName.get(v) || 0) + total);
      }
    }
    console.log(
      `[compras-franquias] LY: ${comprasLy.length} NFs · totalRawLy=R$${totalRawLy.toFixed(2)} · ${lyByPerson.size} personCodes (${aceitosPorCode2026} herdados de 2026) · ${ignoradosLy} ignoradas`,
    );

    // ─── Agrega CREDEV — APENAS para pessoas que compraram ─────────────
    // As ops [7245, 7244, etc.] são genéricas e capturam devoluções de
    // consumidores finais do varejo também. Para evitar contar credev de
    // não-franquias, só aceitamos credev de pessoas presentes em `byPerson`
    // (que receberam NFs com ops EXCLUSIVAS de franquia — 7234/7240/...).
    let credevIgnorados = 0;
    let credevContados = 0;
    for (const nf of credevs) {
      if (nf.invoiceStatus === 'Canceled' || nf.invoiceStatus === 'Deleted') continue;
      const personCode = parseInt(nf.personCode);
      if (!personCode || personCode >= 100000000) continue;
      if (!byPerson.has(personCode)) {
        credevIgnorados++;
        continue;
      }
      const total = parseFloat(nf.totalValue) || 0;
      if (total <= 0) continue;
      const e = byPerson.get(personCode);
      e.total_credev += total;
      e.credev_qty += 1;
      credevContados++;
    }
    console.log(
      `[compras-franquias] credev: ${credevContados} atribuído a franquia · ${credevIgnorados} ignorado (consumidor final)`,
    );

    if (byPerson.size === 0) {
      return successResponse(res, { franquias: [], total: 0 }, 'OK');
    }

    // ─── Enriquece com fantasy_name + nm_pessoa via pes_pessoa ─────────────
    // Como o filtro é pelo op_code (FRANQUIA_OP_CODES, exclusivos de franquia),
    // todas as NFs já são por definição de clientes franquia. Não usamos
    // classifications porque na prática o campo está NULL no banco.
    const personCodes = [...byPerson.keys()];
    const PAGE = 500;
    const pessoasMap = new Map();
    for (let i = 0; i < personCodes.length; i += PAGE) {
      const chunk = personCodes.slice(i, i + PAGE);
      const { data, error } = await supabase
        .from('pes_pessoa')
        .select('code, nm_pessoa, fantasy_name')
        .in('code', chunk);
      if (error) {
        console.warn(`[compras-franquias] supabase erro: ${error.message}`);
        break;
      }
      for (const p of data || []) {
        pessoasMap.set(Number(p.code), {
          nm_pessoa: p.nm_pessoa || null,
          fantasy_name: p.fantasy_name || null,
        });
      }
    }

    // ─── Detector de "não-franquia" pelo nome ─────────────────────────────
    // Alguns clientes multimarcas (fantasy_name começa com "MTM") podem
    // comprar com ops de franquia por erro de cadastro. Excluímos pelo nome.
    const isNaoFranquiaPorNome = (fantasy, nome) => {
      const blob = `${fantasy || ''} ${nome || ''}`.toUpperCase();
      // Aceita franquia legítima: nome começa com F### ou contém CROSBY
      const isFranquiaLegit = /\bCROSBY\b|^F\d{2,4}\s*-?\s*/.test(blob);
      if (isFranquiaLegit) return false;
      // Caso contrário, é não-franquia
      return true;
    };

    // ─── Busca SELLOUT (vendas próprias) atual + ano anterior ─────────────
    let sellouTByName = new Map();
    let sellouTByNameLy = new Map();
    try {
      const allBranchCodes = await getBranchCodes(accessToken);
      const refreshTk = async () => {
        const d = await getToken(true);
        return d.access_token;
      };
      const [rankingData, rankingDataLy] = await Promise.all([
        fetchBranchTotalsFromTotvs({
          initialToken: accessToken,
          branchs: allBranchCodes,
          datemin,
          datemax,
          refreshToken: refreshTk,
          logTag: 'compras-franquias/sellout',
        }),
        fetchBranchTotalsFromTotvs({
          initialToken: accessToken,
          branchs: allBranchCodes,
          datemin: datemin_ly,
          datemax: datemax_ly,
          refreshToken: refreshTk,
          logTag: 'compras-franquias/sellout-ly',
        }).catch(() => ({ dataRow: [] })),
      ]);
      const norm = (s) =>
        String(s || '')
          .toUpperCase()
          .normalize('NFD')
          .replace(/[̀-ͯ]/g, '')
          .replace(/[^A-Z0-9 ]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
      const stripPrefix = (s) =>
        s
          .replace(/^F?\d{2,4}\s*-?\s*/i, '')
          .replace(/\bFRANQUIA\b/g, '')
          .replace(/\bCROSBY\b/g, '')
          .replace(/\b(LTDA|ME|EPP|EIRELI|SA)\b/g, '')
          .replace(/\s+/g, ' ')
          .trim();
      const indexBranchRows = (rows, target) => {
        for (const row of rows) {
          const name =
            row.branch_name || row.branchName || `Filial ${row.branch_code}`;
          const key = norm(name);
          const value = Number(row.invoice_value || 0);
          if (!value) continue;
          const variants = new Set([key, stripPrefix(key)]);
          for (const v of variants) {
            if (v) target.set(v, (target.get(v) || 0) + value);
          }
        }
      };
      indexBranchRows(
        Array.isArray(rankingData.dataRow) ? rankingData.dataRow : [],
        sellouTByName,
      );
      indexBranchRows(
        Array.isArray(rankingDataLy.dataRow) ? rankingDataLy.dataRow : [],
        sellouTByNameLy,
      );
      console.log(
        `[compras-franquias] sellout atual: ${sellouTByName.size} keys · LY: ${sellouTByNameLy.size} keys`,
      );
    } catch (err) {
      console.warn(`[compras-franquias] sellout fetch falhou: ${err.message}`);
    }
    // Helper para localizar sellout de uma franquia
    const norm2 = (s) =>
      String(s || '')
        .toUpperCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^A-Z0-9 ]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    const stripPrefix2 = (s) =>
      s
        .replace(/^F?\d{2,4}\s*-?\s*/i, '')
        .replace(/\bFRANQUIA\b/g, '')
        .replace(/\bCROSBY\b/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    const findInMap = (m, fantasy, nome) => {
      const candidates = new Set();
      if (fantasy) {
        candidates.add(norm2(fantasy));
        candidates.add(stripPrefix2(norm2(fantasy)));
      }
      if (nome) {
        candidates.add(norm2(nome));
        candidates.add(stripPrefix2(norm2(nome)));
      }
      for (const c of candidates) {
        if (c && m.has(c)) return m.get(c);
      }
      return 0;
    };
    const findSellout = (fantasy, nome) => findInMap(sellouTByName, fantasy, nome);
    const findSelloutLy = (fantasy, nome) => findInMap(sellouTByNameLy, fantasy, nome);

    // Calcula % de crescimento (atual vs anterior). null se não há base.
    const calcGrowthPct = (atual, anterior) => {
      const a = Number(atual || 0);
      const b = Number(anterior || 0);
      if (b <= 0) return a > 0 ? null : 0; // sem base → "novo" (null) ou 0
      return Number((((a - b) / b) * 100).toFixed(2));
    };

    // Helper para achar compras LY por NOME (quando person_code mudou)
    const findComprasLyByName = (fantasy, nome) => {
      const candidates = new Set();
      if (fantasy) {
        candidates.add(normName(fantasy));
        candidates.add(stripPrefix2(normName(fantasy)));
      }
      if (nome) {
        candidates.add(normName(nome));
        candidates.add(stripPrefix2(normName(nome)));
      }
      for (const c of candidates) {
        if (c && lyByName.has(c)) return lyByName.get(c);
      }
      return 0;
    };

    // ─── Monta resposta ordenada por LÍQUIDO ──────────────────────────────
    const franquias = [...byPerson.values()]
      .map((entry) => {
        const meta = pessoasMap.get(entry.person_code) || {};
        const liquido = entry.total_compras - entry.total_credev;
        const sellout = findSellout(meta.fantasy_name, meta.nm_pessoa);
        const selloutLy = findSelloutLy(meta.fantasy_name, meta.nm_pessoa);
        // Primeiro tenta por personCode. Se 0, fallback por nome.
        let comprasLyVal = lyByPerson.get(entry.person_code) || 0;
        if (comprasLyVal === 0) {
          comprasLyVal = findComprasLyByName(meta.fantasy_name, meta.nm_pessoa);
        }
        return {
          person_code: entry.person_code,
          nm_pessoa: meta.nm_pessoa || entry.sample_name || null,
          fantasy_name: meta.fantasy_name || null,
          total_compras: Math.round(entry.total_compras * 100) / 100,
          total_credev: Math.round(entry.total_credev * 100) / 100,
          // total_value = líquido (compras - credev) — usado no ranking principal
          total_value: Math.round(liquido * 100) / 100,
          // sellout = vendas próprias da franquia (sale-panel/totals-branch da filial)
          total_sellout: Math.round(sellout * 100) / 100,
          // Ano anterior (mesmo intervalo de dias 1 ano antes)
          total_compras_ly: Math.round(comprasLyVal * 100) / 100,
          total_sellout_ly: Math.round(selloutLy * 100) / 100,
          // Taxas de crescimento (%) — null se sem base no ano anterior
          crescimento_compras_pct: calcGrowthPct(entry.total_compras, comprasLyVal),
          crescimento_sellout_pct: calcGrowthPct(sellout, selloutLy),
          qty: entry.qty,
          credev_qty: entry.credev_qty,
        };
      })
      // Remove franquias com compras = 0 (só credev, sem compra)
      .filter((f) => f.total_compras > 0)
      // Remove clientes não-franquia (MTM/multimarcas/outros)
      .filter((f) => !isNaoFranquiaPorNome(f.fantasy_name, f.nm_pessoa))
      .sort((a, b) => b.total_value - a.total_value);

    const total = franquias.reduce((s, f) => s + f.total_value, 0);
    const total_compras = franquias.reduce((s, f) => s + f.total_compras, 0);
    const total_credev = franquias.reduce((s, f) => s + f.total_credev, 0);
    const total_sellout = franquias.reduce((s, f) => s + (f.total_sellout || 0), 0);
    // Total LY: usa soma BRUTA do período anterior (independente de match por franquia)
    // Match por franquia é difícil porque os person_codes podem ter mudado.
    // O sellout LY usa branches normais (consistentes), então o per-franquia funciona.
    const total_compras_ly = totalRawLy;
    const total_sellout_ly = franquias.reduce((s, f) => s + (f.total_sellout_ly || 0), 0);
    const crescimento_compras_pct = calcGrowthPct(total_compras, total_compras_ly);
    const crescimento_sellout_pct = calcGrowthPct(total_sellout, total_sellout_ly);

    const responseData = {
      franquias,
      total: Math.round(total * 100) / 100, // líquido
      total_compras: Math.round(total_compras * 100) / 100,
      total_credev: Math.round(total_credev * 100) / 100,
      total_sellout: Math.round(total_sellout * 100) / 100,
      total_compras_ly: Math.round(total_compras_ly * 100) / 100,
      total_sellout_ly: Math.round(total_sellout_ly * 100) / 100,
      crescimento_compras_pct,
      crescimento_sellout_pct,
      count: franquias.length,
      period: { datemin, datemax },
      period_ly: { datemin: datemin_ly, datemax: datemax_ly },
    };
    // Salva no cache se tem dados
    if (franquias.length > 0) {
      COMPRAS_FRANQUIAS_CACHE.set(cacheKey, { data: responseData, ts: Date.now() });
      if (COMPRAS_FRANQUIAS_CACHE.size > 20) {
        const oldest = [...COMPRAS_FRANQUIAS_CACHE.entries()].sort(
          (a, b) => a[1].ts - b[1].ts,
        )[0];
        COMPRAS_FRANQUIAS_CACHE.delete(oldest[0]);
      }
    }
    return successResponse(
      res,
      responseData,
      `${franquias.length} franquias · líquido R$ ${total.toFixed(2)} · sellout R$ ${total_sellout.toFixed(2)}`,
    );
  }),
);

// =============================================================================
// COMPRAS-FRANQUIA-DETALHE — NFs individuais (compras + credev) por franquia
// POST /api/totvs/sale-panel/compras-franquia-detalhe
// Body: { datemin, datemax, person_code }
//
// Retorna lista de NFs envolvendo essa franquia no período:
//   - SAÍDAS da matriz (branch 99) para a franquia → COMPRAS
//   - ENTRADAS na matriz vindas da franquia (devoluções, vale-troca) → CREDEV
//
// Cada NF é marcada com is_credev=true se for devolução/credev.
// =============================================================================
router.post(
  '/sale-panel/compras-franquia-detalhe',
  asyncHandler(async (req, res) => {
    const { datemin, datemax, person_code } = req.body;
    if (!datemin || !datemax || !person_code) {
      return errorResponse(
        res,
        'datemin, datemax e person_code obrigatórios',
        400,
        'MISSING_PARAMS',
      );
    }

    const tokenData = await getToken();
    if (!tokenData?.access_token) {
      return errorResponse(res, 'Token TOTVS indisponível', 503, 'TOKEN_OFF');
    }
    const accessToken = tokenData.access_token;

    const endpoint = `${TOTVS_BASE_URL}/fiscal/v2/invoices/search`;
    const pageSize = 100;

    // Helper para paginar uma busca específica
    const fetchAll = async (filter) => {
      const out = [];
      const fetchPage = async (page) => {
        try {
          const r = await axios.post(
            endpoint,
            { filter, expand: 'items,payments', page, pageSize },
            {
              headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                Authorization: `Bearer ${accessToken}`,
              },
              httpsAgent,
              timeout: 60000,
            },
          );
          return r.data || {};
        } catch (err) {
          console.warn(
            `[compras-franquia-detalhe] pág ${page}: ${err.message}`,
          );
          return { items: [] };
        }
      };
      const first = await fetchPage(1);
      out.push(...(first.items || []));
      const totalPages =
        first.totalPages ||
        (first.totalItems ? Math.ceil(first.totalItems / pageSize) : 1);
      if (totalPages > 1) {
        const rem = Array.from({ length: totalPages - 1 }, (_, i) => i + 2);
        const CONC = 5;
        for (let i = 0; i < rem.length; i += CONC) {
          const batch = rem.slice(i, i + CONC);
          const results = await Promise.all(batch.map(fetchPage));
          for (const pd of results) out.push(...(pd?.items || []));
        }
      }
      return out;
    };

    // Op codes adicionais por SEGMENTO (matriz vende para franquia tb por
    // estes canais). Vamos juntar tudo numa só lista para reduzir requests.
    const SHOWROOM_OP_CODES = [7254, 7007];
    const NOVIDADES_OP_CODES = [7255];
    const ALL_COMPRA_OP_CODES = [
      ...FRANQUIA_OP_CODES,
      ...SHOWROOM_OP_CODES,
      ...NOVIDADES_OP_CODES,
    ];

    // Filiais da matriz (atual 99 + legadas 75/750/85/850/1/100/2/200
    // para captura completa em períodos antigos)
    const MATRIZ_BRANCHES = [99, 75, 750, 85, 850, 1, 100, 2, 200];

    // ─── 1) COMPRAS: NFs Output da matriz para essa franquia ─────
    const personFilterField = 'personCodeList';
    const filterCompras = {
      branchCodeList: MATRIZ_BRANCHES,
      operationCodeList: ALL_COMPRA_OP_CODES,
      operationType: 'Output',
      [personFilterField]: [Number(person_code)],
      startIssueDate: `${datemin}T00:00:00`,
      endIssueDate: `${datemax}T23:59:59`,
    };
    const compras = await fetchAll(filterCompras);

    // ─── 2) CREDEV: NFs Input na matriz vindas dessa franquia (devolução) ─
    const filterCredev = {
      branchCodeList: MATRIZ_BRANCHES,
      operationCodeList: FRANQUIA_CREDEV_OP_CODES,
      operationType: 'Input',
      [personFilterField]: [Number(person_code)],
      startIssueDate: `${datemin}T00:00:00`,
      endIssueDate: `${datemax}T23:59:59`,
    };
    const credevs = await fetchAll(filterCredev);

    // Helper: classifica o segmento pela operação de venda
    const SHOWROOM_SET = new Set(SHOWROOM_OP_CODES);
    const NOVIDADES_SET = new Set(NOVIDADES_OP_CODES);
    const FRANQUIA_SET = new Set(FRANQUIA_OP_CODES);
    const classifySegmento = (opCode) => {
      const op = Number(opCode);
      if (NOVIDADES_SET.has(op)) return 'novidades';
      if (SHOWROOM_SET.has(op)) return 'showroom';
      if (FRANQUIA_SET.has(op)) return 'franquia';
      return 'outro';
    };

    // ─── Mapeia para formato padronizado ────────────────────────────────
    const mapNf = (nf, isCredev) => {
      if (nf.invoiceStatus === 'Canceled' || nf.invoiceStatus === 'Deleted') {
        return null;
      }
      const total = parseFloat(nf.totalValue) || 0;
      if (total <= 0) return null;
      const opCode = parseInt(nf.operationCode);
      const segmento = isCredev ? 'credev' : classifySegmento(opCode);
      return {
        branch_code: parseInt(nf.branchCode),
        invoice_code: nf.invoiceCode,
        transaction_code: nf.transactionCode,
        serial_code: nf.serialCode,
        issue_date: nf.issueDate ? String(nf.issueDate).slice(0, 10) : null,
        person_code: parseInt(nf.personCode),
        person_name: nf.personName,
        operation_code: opCode,
        operation_name: nf.operationName,
        operation_type: nf.operationType,
        is_credev: !!isCredev,
        // Segmento: 'franquia' | 'showroom' | 'novidades' | 'credev'
        segmento,
        total_value: Math.round(total * 100) / 100,
        payment_condition: nf.paymentConditionName || null,
      };
    };
    const transacoes = [
      ...compras.map((n) => mapNf(n, false)),
      ...credevs.map((n) => mapNf(n, true)),
    ]
      .filter(Boolean)
      .sort((a, b) => String(b.issue_date).localeCompare(String(a.issue_date)));

    const total_compras = transacoes
      .filter((t) => !t.is_credev)
      .reduce((s, t) => s + t.total_value, 0);
    const total_credev = transacoes
      .filter((t) => t.is_credev)
      .reduce((s, t) => s + t.total_value, 0);
    const total_liquido = total_compras - total_credev;

    // Totais por segmento (compras only — não inclui credev)
    const totaisPorSegmento = {
      franquia: 0,
      showroom: 0,
      novidades: 0,
      outro: 0,
    };
    for (const t of transacoes) {
      if (t.is_credev) continue;
      totaisPorSegmento[t.segmento] =
        (totaisPorSegmento[t.segmento] || 0) + t.total_value;
    }
    for (const k of Object.keys(totaisPorSegmento)) {
      totaisPorSegmento[k] = Math.round(totaisPorSegmento[k] * 100) / 100;
    }

    return successResponse(
      res,
      {
        person_code: Number(person_code),
        period: { datemin, datemax },
        transacoes,
        count: transacoes.length,
        total_compras: Math.round(total_compras * 100) / 100,
        total_credev: Math.round(total_credev * 100) / 100,
        total_liquido: Math.round(total_liquido * 100) / 100,
        totais_por_segmento: totaisPorSegmento,
      },
      `${transacoes.length} NFs (${compras.length} compras, ${credevs.length} credev)`,
    );
  }),
);

export default router;
