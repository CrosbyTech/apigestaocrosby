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

export default router;
