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
} from './totvsHelper.js';

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

    let token = tokenData.access_token;

    let resolvedBranchs;
    if (Array.isArray(branchs) && branchs.length > 0) {
      resolvedBranchs = branchs
        .map((b) => parseInt(b))
        .filter((b) => !isNaN(b) && b > 0);
    } else {
      resolvedBranchs = await getBranchCodes(token);
    }

    // Filiais que recebem filtro de operações específico
    const SPECIAL_BRANCH_CODES = [
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 31, 41, 45, 50, 55,
      65, 75, 85, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101,
      105, 106, 107, 108, 109, 111, 200, 300, 311, 351, 400, 411, 450, 500, 550,
      551, 600, 650, 700, 750, 800, 850, 870, 880, 890, 891, 900, 910, 920, 930,
      940, 950, 960, 970, 980, 990,
    ]; // CASCAVEL, JOAO PESSOA, BREJINHO, TACARUNA
    const SPECIAL_OPERATIONS = [
      1, 2, 55, 510, 511, 1511, 521, 1521, 522, 960, 9001, 9009, 9027, 9017,
      9400, 9401, 9402, 9403, 9404, 9005, 545, 546, 555, 548, 1210, 9405, 1205,
      1101, 9065, 9064, 9063, 9062, 9061, 9420, 9026, 9067,
    ];

    const specialBranchs = resolvedBranchs.filter((b) =>
      SPECIAL_BRANCH_CODES.includes(b),
    );
    const otherBranchs = resolvedBranchs.filter(
      (b) => !SPECIAL_BRANCH_CODES.includes(b),
    );

    const endpoint = `${TOTVS_BASE_URL}/sale-panel/v2/totals-branch/search`;

    console.log(
      `🏆 [RankingFaturamento] ${endpoint}`,
      JSON.stringify({
        datemin,
        datemax,
        specialBranchs: specialBranchs.length,
        otherBranchs: otherBranchs.length,
      }),
    );

    const callTotvs = async (accessToken, body) =>
      axios.post(endpoint, body, {
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        httpsAgent,
        httpAgent,
        timeout: 60000,
      });

    const safeCall = async (body) => {
      try {
        return await callTotvs(token, body);
      } catch (error) {
        if (error.response?.status === 401) {
          console.log('🔄 [RankingFaturamento] Token expirado, renovando...');
          const newTokenData = await getToken(true);
          token = newTokenData.access_token;
          return callTotvs(token, body);
        }
        throw error;
      }
    };

    // Executa as chamadas (em paralelo quando há dois grupos)
    const callPromises = [];
    if (specialBranchs.length > 0) {
      callPromises.push(
        safeCall({
          branchs: specialBranchs,
          datemin,
          datemax,
          operations: SPECIAL_OPERATIONS,
        }),
      );
    }
    if (otherBranchs.length > 0) {
      callPromises.push(safeCall({ branchs: otherBranchs, datemin, datemax }));
    }

    const responses = await Promise.all(callPromises);
    const datasets = responses.map((r) => r.data);

    // Mescla dataRow e dataRowLastYear das duas respostas
    const mergedDataRow = datasets.flatMap((d) => d.dataRow || []);
    const mergedDataRowLastYear = datasets.flatMap(
      (d) => d.dataRowLastYear || [],
    );

    // Soma os totais e recalcula TM e PA
    const sumTotals = (totalsArr) => {
      const valid = totalsArr.filter(Boolean);
      if (valid.length === 0) return null;
      const summed = valid.reduce(
        (acc, t) => ({
          invoice_qty: acc.invoice_qty + (t.invoice_qty || 0),
          invoice_value: acc.invoice_value + (t.invoice_value || 0),
          itens_qty: acc.itens_qty + (t.itens_qty || 0),
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
    };

    const mergedData = {
      dataRow: mergedDataRow,
      dataRowLastYear: mergedDataRowLastYear,
      total: sumTotals(datasets.map((d) => d.total)),
      totalLastYear: sumTotals(datasets.map((d) => d.totalLastYear)),
    };

    return successResponse(
      res,
      mergedData,
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

export default router;
