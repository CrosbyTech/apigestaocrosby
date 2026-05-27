import express from 'express';
import axios from 'axios';
import {
  asyncHandler,
  successResponse,
  errorResponse,
} from '../utils/errorHandler.js';
import { getToken } from '../utils/totvsTokenManager.js';
import { TOTVS_BASE_URL } from './totvsHelper.js';

const router = express.Router();

/**
 * Sanitiza recursivamente o payload removendo strings vazias / null / undefined / NaN
 * e remove arrays vazios. Mantém objetos vazios? -> remove também.
 */
function sanitizePayload(value) {
  if (Array.isArray(value)) {
    const arr = value
      .map((v) => sanitizePayload(v))
      .filter((v) => v !== undefined);
    return arr.length ? arr : undefined;
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      const cleaned = sanitizePayload(v);
      if (cleaned !== undefined) out[k] = cleaned;
    }
    return Object.keys(out).length ? out : undefined;
  }
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string' && value.trim() === '') return undefined;
  if (typeof value === 'number' && Number.isNaN(value)) return undefined;
  return value;
}

async function postToTotvs(endpointPath, payload) {
  const tokenData = await getToken();
  if (!tokenData || !tokenData.access_token) {
    const err = new Error('Não foi possível obter token TOTVS');
    err.status = 503;
    throw err;
  }

  const endpoint = `${TOTVS_BASE_URL}${endpointPath}`;
  const doRequest = (accessToken) =>
    axios.post(endpoint, payload, {
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      timeout: 60000,
    });

  try {
    return await doRequest(tokenData.access_token);
  } catch (error) {
    if (error.response?.status === 401) {
      const newToken = await getToken(true);
      return await doRequest(newToken.access_token);
    }
    throw error;
  }
}

function handleTotvsError(res, error, payload) {
  console.error('❌ Erro TOTVS cadastro cliente:', {
    message: error.message,
    code: error.code,
    status: error.response?.status,
    data: error.response?.data,
  });
  if (error.response) {
    const data = error.response.data;
    let msg = 'Erro ao cadastrar cliente na API TOTVS';
    if (typeof data === 'string') msg = data || msg;
    else if (data && typeof data === 'object') {
      msg =
        data.message ||
        data.error ||
        data.error_description ||
        data.title ||
        data.detailedMessage ||
        msg;
    }
    return res.status(error.response.status || 400).json({
      success: false,
      message: msg,
      error: 'TOTVS_API_ERROR',
      details: data || null,
      status: error.response.status,
      payload,
      timestamp: new Date().toISOString(),
    });
  }
  if (error.status === 503) {
    return errorResponse(res, error.message, 503, 'TOKEN_UNAVAILABLE');
  }
  return errorResponse(
    res,
    `Não foi possível conectar à API TOTVS (${error.code || error.message})`,
    503,
    'TOTVS_CONNECTION_ERROR',
  );
}

/**
 * @route POST /api/totvs/cliente/individual-customer
 * @desc Cria ou altera um cliente PESSOA FÍSICA na TOTVS
 */
router.post(
  '/cliente/individual-customer',
  asyncHandler(async (req, res) => {
    const raw = req.body || {};
    const payload = sanitizePayload(raw) || {};

    if (!payload.cpf) {
      return errorResponse(res, 'CPF é obrigatório', 400, 'MISSING_CPF');
    }
    if (!payload.name) {
      return errorResponse(res, 'Nome é obrigatório', 400, 'MISSING_NAME');
    }
    if (!payload.branchInsertCode) {
      return errorResponse(
        res,
        'branchInsertCode (empresa de cadastro) é obrigatório',
        400,
        'MISSING_BRANCH',
      );
    }
    if (!payload.insertDate) {
      payload.insertDate = new Date().toISOString();
    }

    try {
      const response = await postToTotvs(
        '/person/v2/individual-customers',
        payload,
      );
      return successResponse(
        res,
        response.data,
        'Cliente pessoa física cadastrado com sucesso',
      );
    } catch (error) {
      return handleTotvsError(res, error, payload);
    }
  }),
);

/**
 * @route POST /api/totvs/cliente/legal-customer
 * @desc Cria ou altera um cliente PESSOA JURÍDICA na TOTVS
 */
router.post(
  '/cliente/legal-customer',
  asyncHandler(async (req, res) => {
    const raw = req.body || {};
    const payload = sanitizePayload(raw) || {};

    if (!payload.cnpj) {
      return errorResponse(res, 'CNPJ é obrigatório', 400, 'MISSING_CNPJ');
    }
    if (!payload.name) {
      return errorResponse(res, 'Nome é obrigatório', 400, 'MISSING_NAME');
    }
    if (!payload.branchInsertCode) {
      return errorResponse(
        res,
        'branchInsertCode (empresa de cadastro) é obrigatório',
        400,
        'MISSING_BRANCH',
      );
    }
    if (!payload.insertDate) {
      payload.insertDate = new Date().toISOString();
    }

    try {
      const response = await postToTotvs('/person/v2/legal-customers', payload);
      return successResponse(
        res,
        response.data,
        'Cliente pessoa jurídica cadastrado com sucesso',
      );
    } catch (error) {
      return handleTotvsError(res, error, payload);
    }
  }),
);

export default router;
