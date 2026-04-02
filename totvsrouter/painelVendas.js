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
    const SPECIAL_BRANCH_CODES = [92, 2, 99, 89]; // CASCAVEL, JOAO PESSOA, BREJINHO, TACARUNA
    const SPECIAL_OPERATIONS = [1, 2, 55, 510, 511];

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

export default router;
