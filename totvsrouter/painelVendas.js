import express from 'express';
import axios from 'axios';
import {
  asyncHandler,
  successResponse,
  errorResponse,
} from '../utils/errorHandler.js';
import { getToken, getTokenInfo } from '../utils/totvsTokenManager.js';
import {
  httpsAgent,
  httpAgent,
  TOTVS_BASE_URL,
  TOTVS_AUTH_ENDPOINT,
} from './totvsHelper.js';

const router = express.Router();


// =============================================================================
// PAINEL DE VENDAS — Sale Panel & Seller Panel (Analytics)
// =============================================================================

async function callTotvsAnalytics(endpoint, body, res) {
  try {
    const tokenData = await getToken();
    if (!tokenData?.access_token) {
      return errorResponse(
        res,
        'Não foi possível obter token TOTVS',
        503,
        'TOKEN_UNAVAILABLE',
      );
    }

    const url = `${TOTVS_BASE_URL}${endpoint}`;
    console.log(`📊 [PainelVendas] ${url}`, JSON.stringify(body));

    const response = await axios.post(url, body, {
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${tokenData.access_token}`,
      },
      httpsAgent,
      httpAgent,
      timeout: 60000,
    });

    return successResponse(res, response.data, 'Dados obtidos com sucesso');
  } catch (error) {
    // Retry on 401
    if (error.response?.status === 401) {
      try {
        const newToken = await getToken(true);
        const url = `${TOTVS_BASE_URL}${endpoint}`;
        const retry = await axios.post(url, body, {
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Bearer ${newToken.access_token}`,
          },
          httpsAgent,
          httpAgent,
          timeout: 60000,
        });
        return successResponse(res, retry.data, 'Dados obtidos com sucesso');
      } catch (retryErr) {
        return errorResponse(
          res,
          retryErr.response?.data?.message || 'Erro após renovar token',
          retryErr.response?.status || 500,
          'TOTVS_API_ERROR',
        );
      }
    }

    if (error.response) {
      console.error(
        `❌ [PainelVendas] ${endpoint} → ${error.response.status}`,
        JSON.stringify(error.response.data),
      );
      return errorResponse(
        res,
        error.response.data?.message ||
          JSON.stringify(error.response.data) ||
          'Erro na API TOTVS',
        error.response.status || 500,
        'TOTVS_API_ERROR',
      );
    }

    if (error.request) {
      return errorResponse(
        res,
        'Não foi possível conectar à API TOTVS',
        503,
        'TOTVS_CONNECTION_ERROR',
      );
    }

    throw error;
  }
}

router.post(
  '/sale-panel/totals',
  asyncHandler(async (req, res) => {
    await callTotvsAnalytics('/sale-panel/v2/totals/search', req.body, res);
  }),
);

router.post(
  '/sale-panel/hours',
  asyncHandler(async (req, res) => {
    await callTotvsAnalytics('/sale-panel/v2/hours/search', req.body, res);
  }),
);

router.post(
  '/sale-panel/weekdays',
  asyncHandler(async (req, res) => {
    await callTotvsAnalytics('/sale-panel/v2/weekdays/search', req.body, res);
  }),
);

router.post(
  '/sale-panel/sellers',
  asyncHandler(async (req, res) => {
    await callTotvsAnalytics('/sale-panel/v2/sellers/search', req.body, res);
  }),
);

router.post(
  '/sale-panel/sellers-list',
  asyncHandler(async (req, res) => {
    await callTotvsAnalytics(
      '/sale-panel/v2/sellers-list/search',
      req.body,
      res,
    );
  }),
);

router.post(
  '/sale-panel/totals-seller',
  asyncHandler(async (req, res) => {
    await callTotvsAnalytics(
      '/sale-panel/v2/totals-seller/search',
      req.body,
      res,
    );
  }),
);

router.post(
  '/sale-panel/totals-branch',
  asyncHandler(async (req, res) => {
    await callTotvsAnalytics(
      '/sale-panel/v2/totals-branch/search',
      req.body,
      res,
    );
  }),
);

router.post(
  '/sale-panel/totals-branch-type',
  asyncHandler(async (req, res) => {
    await callTotvsAnalytics(
      '/sale-panel/v2/totals-branch-type/search',
      req.body,
      res,
    );
  }),
);

router.post(
  '/sale-panel/document-types',
  asyncHandler(async (req, res) => {
    await callTotvsAnalytics(
      '/sale-panel/v2/document-types/search',
      req.body,
      res,
    );
  }),
);

router.post(
  '/sale-panel/product-classifications',
  asyncHandler(async (req, res) => {
    await callTotvsAnalytics(
      '/sale-panel/v2/product-classifications/search',
      req.body,
      res,
    );
  }),
);

router.get(
  '/sale-panel/product-classification-types',
  asyncHandler(async (req, res) => {
    try {
      const tokenData = await getToken();
      if (!tokenData?.access_token) {
        return errorResponse(
          res,
          'Não foi possível obter token TOTVS',
          503,
          'TOKEN_UNAVAILABLE',
        );
      }
      const url = `${TOTVS_BASE_URL}/sale-panel/v2/product-classification-types`;
      const response = await axios.get(url, {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${tokenData.access_token}`,
        },
        httpsAgent,
        httpAgent,
        timeout: 60000,
      });
      return successResponse(
        res,
        response.data,
        'Tipos de classificação obtidos',
      );
    } catch (error) {
      if (error.response) {
        return errorResponse(
          res,
          error.response.data?.message || 'Erro TOTVS',
          error.response.status || 500,
          'TOTVS_API_ERROR',
        );
      }
      throw error;
    }
  }),
);

router.post(
  '/sale-panel/branch-ranking',
  asyncHandler(async (req, res) => {
    await callTotvsAnalytics(
      '/sale-panel/v2/branch-ranking/search',
      req.body,
      res,
    );
  }),
);

// --- SellerPanel ---

router.post(
  '/seller-panel/totals',
  asyncHandler(async (req, res) => {
    await callTotvsAnalytics(
      '/analytics/v2/seller-panel/totals/search',
      req.body,
      res,
    );
  }),
);

router.post(
  '/seller-panel/sales-vs-returns',
  asyncHandler(async (req, res) => {
    await callTotvsAnalytics(
      '/analytics/v2/seller-panel/sales-vs-returns/search',
      req.body,
      res,
    );
  }),
);

router.post(
  '/seller-panel/weekdays',
  asyncHandler(async (req, res) => {
    await callTotvsAnalytics(
      '/analytics/v2/seller-panel/weekdays/search',
      req.body,
      res,
    );
  }),
);

router.post(
  '/seller-panel/product-classification',
  asyncHandler(async (req, res) => {
    await callTotvsAnalytics(
      '/analytics/v2/seller-panel/product-classification/search',
      req.body,
      res,
    );
  }),
);

router.post(
  '/seller-panel/sales-target',
  asyncHandler(async (req, res) => {
    await callTotvsAnalytics(
      '/analytics/v2/seller-panel/sales-target/search',
      req.body,
      res,
    );
  }),
);

router.post(
  '/seller-panel/top-customers',
  asyncHandler(async (req, res) => {
    await callTotvsAnalytics(
      '/analytics/v2/seller-panel/seller/top-customers',
      req.body,
      res,
    );
  }),
);
export default router;
