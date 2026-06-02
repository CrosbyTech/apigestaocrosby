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

    const mergedData = await fetchBranchTotalsFromTotvs({
      initialToken: token,
      branchs: resolvedBranchs,
      datemin,
      datemax,
      refreshToken: async () => {
        const data = await getToken(true);
        return data.access_token;
      },
      logTag: 'RankingFaturamento',
    });

    return successResponse(
      res,
      mergedData,
      'Ranking de faturamento por filial obtido com sucesso',
    );
  }),
);

// =============================================================================
// FATURAMENTO POR CANAL — via TOTVS (sem Supabase)
// POST /api/totvs/sale-panel/faturamento-por-canal
// Body: { datemin, datemax }
// Retorna: { segmentos, segmentosQty, segmentosItens, total }
// Critério por canal:
//   varejo      → branches [2,5,55,65,87,88,90,93,94,95,97] s/ ops override (SPECIAL_OPERATIONS)
//   revenda     → branch [99] s/ ops override (SPECIAL_OPERATIONS)
//   franquia    → todas as branches + ops franquia
//   multimarcas → todas as branches + ops multimarcas
//   bazar       → todas as branches + op bazar
//   showroom    → todas as branches + ops showroom
//   novidades   → todas as branches + op novidadesfranquia
//   business    → todas as branches + ops business
//   ricardoeletro → branches [11,111] s/ ops override
// =============================================================================
const CANAL_OP_CODES_FC = {
  franquia: [7234, 7240, 7802, 9124, 7259],
  multimarcas: [7235, 7241],
  bazar: [887],
  showroom: [7254, 7007],
  novidadesfranquia: [7255],
  business: [7237, 7269, 7279, 7277],
};
// Operações B2B/revenda que a filial 99 usa — inclui todas as ops de revenda
// mapeadas em crm.routes.js (OPERACOES_REVENDA). Não inclui ops de varejo.
const REVENDA_OP_CODES_FC = [
  5102, 5202, 1407, 9120, 9121, 9122, 9113, 9111, 9001, 9009, 9061, 9067, 9400,
  9401, 9420, 9404, 7806, 7809, 7236, 7242, 512,
];
const VAREJO_BRANCHES_FC = [2, 5, 55, 65, 87, 88, 90, 93, 94, 95, 97];
const REVENDA_BRANCHES_FC = [99];
const RE_BRANCHES_FC = [11, 111];

router.post(
  '/sale-panel/faturamento-por-canal',
  asyncHandler(async (req, res) => {
    const { datemin, datemax } = req.body;
    if (!datemin || !datemax) {
      return errorResponse(
        res,
        'datemin e datemax são obrigatórios',
        400,
        'MISSING_DATES',
      );
    }

    const tokenData = await getToken();
    if (!tokenData?.access_token) {
      return errorResponse(
        res,
        'Token TOTVS indisponível',
        503,
        'TOKEN_UNAVAILABLE',
      );
    }
    const token = tokenData.access_token;
    const allBranchs = await getBranchCodes(token);
    const refreshToken = async () => {
      const d = await getToken(true);
      return d.access_token;
    };

    const callCanal = async (branchs, operations, tag) => {
      if (!branchs || branchs.length === 0) {
        return { invoice_value: 0, invoice_qty: 0, itens_qty: 0 };
      }
      try {
        const data = await fetchBranchTotalsFromTotvs({
          initialToken: token,
          branchs,
          datemin,
          datemax,
          refreshToken,
          operations, // undefined = usa SPECIAL_OPERATIONS para branches especiais
          logTag: `FC-${tag}`,
        });
        const t = data.total ?? {};
        return {
          invoice_value: Number(t.invoice_value ?? 0),
          invoice_qty: Number(t.invoice_qty ?? 0),
          itens_qty: Number(t.itens_qty ?? 0),
        };
      } catch (err) {
        console.error(`[FC-${tag}] Erro:`, err.message);
        return { invoice_value: 0, invoice_qty: 0, itens_qty: 0 };
      }
    };

    // Ricardo Eletro — branches 11/111 SÃO especiais (estão em SPECIAL_BRANCH_CODES),
    // então fetchBranchTotalsFromTotvs aplicaria SPECIAL_OPERATIONS por padrão, e
    // SPECIAL_OPERATIONS NÃO inclui ops como 512 (B2C marketplace). Pra esse canal
    // chamamos sale-panel/v2/totals-branch DIRETO sem filtro de operations —
    // ricardoeletro fatura em CFOPs variados (5102, 512, ...) e o filtro de op
    // só excluiria vendas legítimas.
    const callRicardoEletro = async () => {
      try {
        const endpoint = `${TOTVS_BASE_URL}/sale-panel/v2/totals-branch/search`;
        const doCall = async (accessToken) =>
          axios.post(
            endpoint,
            { branchs: RE_BRANCHES_FC, datemin, datemax }, // ← sem operations
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
        let resp;
        try {
          resp = await doCall(token);
        } catch (err) {
          if (err.response?.status === 401) {
            const newTok = await refreshToken();
            resp = await doCall(newTok);
          } else {
            throw err;
          }
        }
        const t = resp.data?.total ?? {};
        return {
          invoice_value: Number(t.invoice_value ?? 0),
          invoice_qty: Number(t.invoice_qty ?? 0),
          itens_qty: Number(t.itens_qty ?? 0),
        };
      } catch (err) {
        console.error(`[FC-ricardoeletro] Erro:`, err.message);
        return { invoice_value: 0, invoice_qty: 0, itens_qty: 0 };
      }
    };

    // Chamadas paralelas por canal
    const [
      varejR,
      revendaR,
      franqR,
      multiR,
      bazarR,
      showroomR,
      novidadesR,
      businessR,
      reR,
    ] = await Promise.all([
      callCanal(VAREJO_BRANCHES_FC, undefined, 'varejo'),
      callCanal(REVENDA_BRANCHES_FC, REVENDA_OP_CODES_FC, 'revenda'),
      callCanal(allBranchs, CANAL_OP_CODES_FC.franquia, 'franquia'),
      callCanal(allBranchs, CANAL_OP_CODES_FC.multimarcas, 'multimarcas'),
      callCanal(allBranchs, CANAL_OP_CODES_FC.bazar, 'bazar'),
      callCanal(allBranchs, CANAL_OP_CODES_FC.showroom, 'showroom'),
      callCanal(
        allBranchs,
        CANAL_OP_CODES_FC.novidadesfranquia,
        'novidadesfranquia',
      ),
      callCanal(allBranchs, CANAL_OP_CODES_FC.business, 'business'),
      callRicardoEletro(), // chamada dedicada — sem SPECIAL_OPERATIONS filter
    ]);

    const segmentos = {
      varejo: varejR.invoice_value,
      revenda: revendaR.invoice_value,
      franquia: franqR.invoice_value,
      multimarcas: multiR.invoice_value,
      bazar: bazarR.invoice_value,
      showroom: showroomR.invoice_value,
      novidadesfranquia: novidadesR.invoice_value,
      business: businessR.invoice_value,
      ricardoeletro: reR.invoice_value,
    };
    const segmentosQty = {
      varejo: varejR.invoice_qty,
      revenda: revendaR.invoice_qty,
      franquia: franqR.invoice_qty,
      multimarcas: multiR.invoice_qty,
      bazar: bazarR.invoice_qty,
      showroom: showroomR.invoice_qty,
      novidadesfranquia: novidadesR.invoice_qty,
      business: businessR.invoice_qty,
      ricardoeletro: reR.invoice_qty,
    };
    const segmentosItens = {
      varejo: varejR.itens_qty,
      revenda: revendaR.itens_qty,
      franquia: franqR.itens_qty,
      multimarcas: multiR.itens_qty,
      bazar: bazarR.itens_qty,
      showroom: showroomR.itens_qty,
      novidadesfranquia: novidadesR.itens_qty,
      business: businessR.itens_qty,
      ricardoeletro: reR.itens_qty,
    };
    const total = Object.values(segmentos).reduce((s, v) => s + v, 0);

    console.log(`✅ [FaturamentoPorCanal] Total: R$ ${total.toFixed(2)}`);

    return successResponse(
      res,
      { segmentos, segmentosQty, segmentosItens, total },
      'Faturamento por canal obtido com sucesso',
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
          if (p.code) personNames[p.code] = p.fantasyName || p.name || '';
        }
        for (const p of result.value.pf) {
          if (p.code) personNames[p.code] = p.name || '';
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
        const dates = [...(c.purchaseDates || [])].sort();
        c.purchaseCount = dates.length;
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
// Ops de compra franquia ATUAL (2026+): 7234, 7240, 7802, 9124, 7259
const FRANQUIA_OP_CODES = [7234, 7240, 7802, 9124, 7259];
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
