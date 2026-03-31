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

router.post(
  '/best-selling-products',
  asyncHandler(async (req, res) => {
    const { branchs, datemin, datemax } = req.body;

    if (!branchs || !Array.isArray(branchs) || branchs.length === 0) {
      return errorResponse(
        res,
        'O campo branchs é obrigatório e deve ser um array de números',
        400,
        'MISSING_BRANCHS',
      );
    }

    if (!datemin || !datemax) {
      return errorResponse(
        res,
        'Os campos datemin e datemax são obrigatórios',
        400,
        'MISSING_DATES',
      );
    }

    try {
      const tokenData = await getToken();

      if (!tokenData || !tokenData.access_token) {
        return errorResponse(
          res,
          'Não foi possível obter token de autenticação TOTVS',
          503,
          'TOKEN_UNAVAILABLE',
        );
      }

      const endpoint = `${TOTVS_BASE_URL}/ecommerce-sales-order/v2/best-selling-products/search`;

      console.log('🏆 Buscando ranking de produtos mais vendidos:', {
        endpoint,
        branchs,
        datemin,
        datemax,
      });

      const response = await axios.post(
        endpoint,
        { branchs, datemin, datemax },
        {
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Bearer ${tokenData.access_token}`,
          },
          httpsAgent,
          httpAgent,
          timeout: 60000,
        },
      );

      console.log('✅ Ranking de produtos obtido com sucesso');

      successResponse(
        res,
        response.data,
        'Ranking de produtos mais vendidos obtido com sucesso',
      );
    } catch (error) {
      console.error('❌ Erro ao buscar ranking de produtos:', {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data,
      });

      if (error.response?.status === 401) {
        try {
          const newTokenData = await getToken(true);
          const endpoint = `${TOTVS_BASE_URL}/ecommerce-sales-order/v2/best-selling-products/search`;

          const retryResponse = await axios.post(
            endpoint,
            { branchs, datemin, datemax },
            {
              headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                Authorization: `Bearer ${newTokenData.access_token}`,
              },
              httpsAgent,
              httpAgent,
              timeout: 60000,
            },
          );

          return successResponse(
            res,
            retryResponse.data,
            'Ranking de produtos mais vendidos obtido com sucesso',
          );
        } catch (retryError) {
          return errorResponse(
            res,
            retryError.response?.data?.message ||
              'Erro ao buscar ranking após renovar token',
            retryError.response?.status || 500,
            'TOTVS_API_ERROR',
          );
        }
      }

      if (error.response) {
        return errorResponse(
          res,
          error.response.data?.message ||
            'Erro ao buscar ranking de produtos na API TOTVS',
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
  }),
);

// =============================================================================
// SALDO DE PRODUTO (ESTOQUE) - /api/totvsmoda/product/v2/balances/search
// =============================================================================

/**
 * @route POST /totvs/product-balances
 * @desc Busca saldos de produtos na API TOTVS (estoque)
 * @access Protegido via API Key
 * @body {
 *   filter: {
 *     productCodeList?: number[],
 *     referenceCodeList?: string[],
 *     productName?: string,
 *     groupCodeList?: string[],
 *     barCodeList?: string[],
 *     branchInfo?: { branchCode: number, isActive?: boolean },
 *     classifications?: [{ type: number, codeList: string[] }],
 *     hasStock?: boolean,
 *     branchStockCode?: number,
 *     stockCode?: number
 *   },
 *   option: {
 *     balances: [{
 *       branchCode: number (obrigatório),
 *       stockCodeList: number[] (obrigatório),
 *       isSalesOrder?: boolean,
 *       isTransaction?: boolean,
 *       isPurchaseOrder?: boolean,
 *       isProductionOrder?: boolean,
 *       isProductionPlanning?: boolean
 *     }]
 *   },
 *   page?: number,
 *   pageSize?: number,
 *   order?: string,
 *   expand?: string
 * }
 */
router.post(
  '/product-balances',
  asyncHandler(async (req, res) => {
    try {
      const tokenData = await getToken();
      if (!tokenData || !tokenData.access_token) {
        return errorResponse(
          res,
          'Não foi possível obter token de autenticação TOTVS',
          503,
          'TOKEN_ERROR',
        );
      }

      const { filter, option, page, pageSize, order, expand } = req.body;

      if (
        !filter ||
        !option ||
        !option.balances ||
        !Array.isArray(option.balances)
      ) {
        return errorResponse(
          res,
          'Campos obrigatórios: filter, option.balances (array com branchCode e stockCodeList)',
          400,
          'MISSING_PARAMS',
        );
      }

      // Validar cada item de balance
      for (const balance of option.balances) {
        if (
          !balance.branchCode ||
          !balance.stockCodeList ||
          !Array.isArray(balance.stockCodeList)
        ) {
          return errorResponse(
            res,
            'Cada item em option.balances deve ter branchCode (number) e stockCodeList (number[])',
            400,
            'INVALID_BALANCE_OPTION',
          );
        }
      }

      const body = {
        filter: filter || {},
        option,
        page: page || 1,
        pageSize: Math.min(pageSize || 100, 1000),
      };

      if (order) body.order = order;
      if (expand) body.expand = expand;

      const url = `${TOTVS_BASE_URL}/product/v2/balances/search`;
      console.log('📦 Buscando saldos de produtos TOTVS:', url);
      console.log('📦 Body:', JSON.stringify(body, null, 2));

      const response = await axios.post(url, body, {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        timeout: 120000,
        httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      });

      const data = response.data;

      console.log(
        `✅ Saldos encontrados: ${data.items?.length || 0} itens (total: ${data.totalItems || 0})`,
      );

      return successResponse(
        res,
        {
          data: data.items || [],
          total: data.totalItems || 0,
          count: data.count || 0,
          totalPages: data.totalPages || 0,
          hasNext: data.hasNext || false,
          page: body.page,
          pageSize: body.pageSize,
        },
        `${data.items?.length || 0} saldos de produtos encontrados`,
      );
    } catch (error) {
      console.error('❌ Erro ao buscar saldos de produtos TOTVS:', {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data,
      });

      if (error.response) {
        return errorResponse(
          res,
          error.response.data?.message ||
            error.response.data?.errors?.[0]?.message ||
            'Erro ao buscar saldos na API TOTVS',
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
  }),
);
export default router;
