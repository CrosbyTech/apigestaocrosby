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

// Helper: resolve branchs do filtro ou busca todas
async function resolveBranchs(filtroempresa, token) {
  if (Array.isArray(filtroempresa) && filtroempresa.length > 0) {
    const codes = filtroempresa
      .map((b) => parseInt(b))
      .filter((b) => !isNaN(b) && b > 0);
    if (codes.length > 0) return codes;
  }
  return getBranchCodes(token);
}

// Helper: POST com retry automático em 401
async function totvsPost(endpoint, payload, token) {
  const doRequest = (accessToken) =>
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

  try {
    return await doRequest(token);
  } catch (error) {
    if (error.response?.status === 401) {
      console.log('🔄 [CRM Vendas] Token expirado, renovando...');
      const newTokenData = await getToken(true);
      return doRequest(newTokenData.access_token);
    }
    throw error;
  }
}

// =============================================================================
// VENDAS POR HORA
// POST /api/totvs/crm-vendas/hours
// =============================================================================
router.post(
  '/crm-vendas/hours',
  asyncHandler(async (req, res) => {
    const { filtroempresa, datemin, datemax } = req.body;
    if (!datemin || !datemax)
      return errorResponse(
        res,
        'datemin e datemax obrigatórios',
        400,
        'MISSING_DATES',
      );

    const tokenData = await getToken();
    if (!tokenData?.access_token)
      return errorResponse(
        res,
        'Token TOTVS indisponível',
        503,
        'TOKEN_UNAVAILABLE',
      );

    const branchs = await resolveBranchs(filtroempresa, tokenData.access_token);
    const endpoint = `${TOTVS_BASE_URL}/sale-panel/v2/hours/search`;
    const response = await totvsPost(
      endpoint,
      { branchs, datemin, datemax },
      tokenData.access_token,
    );

    return successResponse(res, response.data, 'Vendas por hora obtidas');
  }),
);

// =============================================================================
// VENDAS POR DIA DA SEMANA
// POST /api/totvs/crm-vendas/weekdays
// =============================================================================
router.post(
  '/crm-vendas/weekdays',
  asyncHandler(async (req, res) => {
    const { filtroempresa, datemin, datemax } = req.body;
    if (!datemin || !datemax)
      return errorResponse(
        res,
        'datemin e datemax obrigatórios',
        400,
        'MISSING_DATES',
      );

    const tokenData = await getToken();
    if (!tokenData?.access_token)
      return errorResponse(
        res,
        'Token TOTVS indisponível',
        503,
        'TOKEN_UNAVAILABLE',
      );

    const branchs = await resolveBranchs(filtroempresa, tokenData.access_token);
    const endpoint = `${TOTVS_BASE_URL}/sale-panel/v2/weekdays/search`;
    const response = await totvsPost(
      endpoint,
      { branchs, datemin, datemax },
      tokenData.access_token,
    );

    return successResponse(
      res,
      response.data,
      'Vendas por dia da semana obtidas',
    );
  }),
);

// =============================================================================
// VENDAS POR FORMA DE PAGAMENTO
// POST /api/totvs/crm-vendas/payment-types
// =============================================================================
router.post(
  '/crm-vendas/payment-types',
  asyncHandler(async (req, res) => {
    const { filtroempresa, datemin, datemax } = req.body;
    if (!datemin || !datemax)
      return errorResponse(
        res,
        'datemin e datemax obrigatórios',
        400,
        'MISSING_DATES',
      );

    const tokenData = await getToken();
    if (!tokenData?.access_token)
      return errorResponse(
        res,
        'Token TOTVS indisponível',
        503,
        'TOKEN_UNAVAILABLE',
      );

    const branchs = await resolveBranchs(filtroempresa, tokenData.access_token);
    const endpoint = `${TOTVS_BASE_URL}/sale-panel/v2/document-types/search`;
    const response = await totvsPost(
      endpoint,
      { branchs, datemin, datemax },
      tokenData.access_token,
    );

    return successResponse(
      res,
      response.data,
      'Vendas por forma de pagamento obtidas',
    );
  }),
);

// =============================================================================
// RANKING DE LOJAS
// POST /api/totvs/crm-vendas/branch-ranking
// =============================================================================
router.post(
  '/crm-vendas/branch-ranking',
  asyncHandler(async (req, res) => {
    const { filtroempresa, datemin, datemax } = req.body;
    if (!datemin || !datemax)
      return errorResponse(
        res,
        'datemin e datemax obrigatórios',
        400,
        'MISSING_DATES',
      );

    const tokenData = await getToken();
    if (!tokenData?.access_token)
      return errorResponse(
        res,
        'Token TOTVS indisponível',
        503,
        'TOKEN_UNAVAILABLE',
      );

    const branchs = await resolveBranchs(filtroempresa, tokenData.access_token);
    const endpoint = `${TOTVS_BASE_URL}/sale-panel/v2/branch-ranking/search`;
    const response = await totvsPost(
      endpoint,
      { branchs, datemin, datemax },
      tokenData.access_token,
    );

    return successResponse(res, response.data, 'Ranking de lojas obtido');
  }),
);

// =============================================================================
// VENDEDORES (totais por vendedor)
// POST /api/totvs/crm-vendas/sellers-totals
// =============================================================================
router.post(
  '/crm-vendas/sellers-totals',
  asyncHandler(async (req, res) => {
    const { filtroempresa, datemin, datemax, operations } = req.body;
    if (!datemin || !datemax)
      return errorResponse(
        res,
        'datemin e datemax obrigatórios',
        400,
        'MISSING_DATES',
      );

    const tokenData = await getToken();
    if (!tokenData?.access_token)
      return errorResponse(
        res,
        'Token TOTVS indisponível',
        503,
        'TOKEN_UNAVAILABLE',
      );

    const branchs = await resolveBranchs(filtroempresa, tokenData.access_token);
    const endpoint = `${TOTVS_BASE_URL}/sale-panel/v2/totals-seller/search`;
    const payload = { branchs, datemin, datemax };
    if (Array.isArray(operations) && operations.length > 0) {
      payload.operations = operations;
    }
    const response = await totvsPost(endpoint, payload, tokenData.access_token);

    return successResponse(res, response.data, 'Totais por vendedor obtidos');
  }),
);

// =============================================================================
// LISTA DE VENDEDORES (detalhada)
// POST /api/totvs/crm-vendas/sellers-list
// =============================================================================
router.post(
  '/crm-vendas/sellers-list',
  asyncHandler(async (req, res) => {
    const { filtroempresa, datemin, datemax } = req.body;
    if (!datemin || !datemax)
      return errorResponse(
        res,
        'datemin e datemax obrigatórios',
        400,
        'MISSING_DATES',
      );

    const tokenData = await getToken();
    if (!tokenData?.access_token)
      return errorResponse(
        res,
        'Token TOTVS indisponível',
        503,
        'TOKEN_UNAVAILABLE',
      );

    const branchs = await resolveBranchs(filtroempresa, tokenData.access_token);
    const endpoint = `${TOTVS_BASE_URL}/sale-panel/v2/sellers-list/search`;
    const response = await totvsPost(
      endpoint,
      { branchs, datemin, datemax },
      tokenData.access_token,
    );

    return successResponse(res, response.data, 'Lista de vendedores obtida');
  }),
);

// =============================================================================
// TOP CLIENTES POR VENDEDOR
// POST /api/totvs/crm-vendas/seller-top-customers
// Body: { filtroempresa?, datemin, datemax, sellers: [seller_code] }
// =============================================================================
router.post(
  '/crm-vendas/seller-top-customers',
  asyncHandler(async (req, res) => {
    const { filtroempresa, datemin, datemax, sellers } = req.body;
    if (!datemin || !datemax)
      return errorResponse(
        res,
        'datemin e datemax obrigatórios',
        400,
        'MISSING_DATES',
      );

    const tokenData = await getToken();
    if (!tokenData?.access_token)
      return errorResponse(
        res,
        'Token TOTVS indisponível',
        503,
        'TOKEN_UNAVAILABLE',
      );

    const branchs = await resolveBranchs(filtroempresa, tokenData.access_token);
    const endpoint = `${TOTVS_BASE_URL}/analytics/v2/seller-panel/seller/top-customers`;
    const payload = {
      branchs,
      datemin,
      datemax,
      orderByQuantity: false,
      returnItensQuantity: 100,
    };
    if (Array.isArray(sellers) && sellers.length > 0) {
      payload.sellers = sellers
        .map((s) => parseInt(s))
        .filter((s) => !isNaN(s));
    }
    const response = await totvsPost(endpoint, payload, tokenData.access_token);

    return successResponse(
      res,
      response.data,
      'Top clientes por vendedor obtidos',
    );
  }),
);

// =============================================================================
// CONDIÇÃO DE PAGAMENTO (movimento fiscal analítico)
// POST /api/totvs/crm-vendas/payment-conditions
// Body: { filtroempresa?, datemin, datemax, page?, pageSize? }
// =============================================================================
router.post(
  '/crm-vendas/payment-conditions',
  asyncHandler(async (req, res) => {
    const { filtroempresa, datemin, datemax, page = 1, pageSize = 1000 } = req.body;
    if (!datemin || !datemax)
      return errorResponse(
        res,
        'datemin e datemax obrigatórios',
        400,
        'MISSING_DATES',
      );

    const tokenData = await getToken();
    if (!tokenData?.access_token)
      return errorResponse(
        res,
        'Token TOTVS indisponível',
        503,
        'TOKEN_UNAVAILABLE',
      );

    let token = tokenData.access_token;
    const branchs = await resolveBranchs(filtroempresa, token);
    const endpoint = `${TOTVS_BASE_URL}/analytics/v2/payment-fiscal-movement/search`;
    const reqPageSize = Math.min(Number(pageSize) || 1000, 1000);

    const buildPayload = (pg) => ({
      filter: {
        branchCodeList: branchs,
        startMovementDate: `${datemin}T00:00:00.000Z`,
        endMovementDate: `${datemax}T23:59:59.000Z`,
      },
      page: pg,
      pageSize: reqPageSize,
    });

    const doRequest = async (accessToken, payload) =>
      axios.post(endpoint, payload, {
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        httpsAgent,
        timeout: 60000,
      });

    let response;
    try {
      response = await doRequest(token, buildPayload(page));
    } catch (err) {
      if (err.response?.status === 401) {
        const newTokenData = await getToken(true);
        token = newTokenData.access_token;
        response = await doRequest(token, buildPayload(page));
      } else {
        throw err;
      }
    }

    let allItems = response.data?.items || response.data?.data || [];
    let hasNext = response.data?.hasNext ?? false;
    let currentPage = page + 1;

    while (hasNext) {
      try {
        const next = await doRequest(token, buildPayload(currentPage));
        const nextItems = next.data?.items || next.data?.data || [];
        allItems = [...allItems, ...nextItems];
        hasNext = next.data?.hasNext ?? false;
        currentPage++;
        if (currentPage > 200) break;
      } catch {
        break;
      }
    }

    return successResponse(
      res,
      { items: allItems, total: allItems.length },
      `${allItems.length} condições de pagamento obtidas`,
    );
  }),
);

export default router;
