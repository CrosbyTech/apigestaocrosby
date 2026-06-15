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

/**
 * @route POST /api/totvs/cliente/update-limit
 * @desc Atualiza limite de crédito de um cliente PF ou PJ no TOTVS.
 *       Endpoint TOTVS: POST /person/v2/legal-customers (PJ) ou
 *       POST /person/v2/individual-customers (PF) com array "limits".
 *
 *       Estratégia adaptativa de retry: TOTVS pode rejeitar campos do array
 *       "limits" quando os parâmetros IN_USA_LIMITE_COMERCIAL ou
 *       IN_USA_LIMITE_MENSAL estão desabilitados. O backend tenta enviar
 *       todos os campos e, em caso de erro "parameterValueField", remove
 *       dinamicamente o campo recusado e tenta novamente.
 */
router.post(
  '/cliente/update-limit',
  asyncHandler(async (req, res) => {
    const {
      personType,
      cpf,
      cnpj,
      name,
      branchInsertCode,
      branchCode,
      saleLimitValue,
      monthlyLimitValue,
      financialLimitValue,
    } = req.body || {};

    const isPJ = personType === 'PJ' || !!cnpj;
    const docField = isPJ ? 'cnpj' : 'cpf';
    const docValue = isPJ ? cnpj : cpf;

    if (!docValue) {
      return errorResponse(
        res,
        `${docField.toUpperCase()} é obrigatório`,
        400,
        `MISSING_${docField.toUpperCase()}`,
      );
    }
    if (!name) {
      return errorResponse(res, 'Nome é obrigatório', 400, 'MISSING_NAME');
    }
    if (!branchInsertCode) {
      return errorResponse(res, 'branchInsertCode é obrigatório', 400, 'MISSING_BRANCH');
    }
    if (!saleLimitValue || Number(saleLimitValue) <= 0) {
      return errorResponse(
        res,
        'saleLimitValue deve ser maior que zero',
        400,
        'MISSING_LIMIT',
      );
    }

    const endpoint = isPJ
      ? '/person/v2/legal-customers'
      : '/person/v2/individual-customers';

    const branchCodeNum = parseInt(branchCode || branchInsertCode, 10);
    const saleLimitNum = parseFloat(saleLimitValue);
    const monthlyLimitNum =
      monthlyLimitValue != null && !isNaN(parseFloat(monthlyLimitValue))
        ? parseFloat(monthlyLimitValue)
        : saleLimitNum;
    const financialLimitNum =
      financialLimitValue != null && !isNaN(parseFloat(financialLimitValue))
        ? parseFloat(financialLimitValue)
        : saleLimitNum;

    const buildPayload = (limitObj) =>
      sanitizePayload({
        [docField]: String(docValue).replace(/\D/g, ''),
        name,
        branchInsertCode: parseInt(branchInsertCode, 10),
        insertDate: new Date().toISOString(),
        limits: [limitObj],
      });

    // Detecta quais campos do limit o TOTVS recusou e retorna o conjunto válido
    const removerCamposRecusados = (errorData, limitObj) => {
      const items = Array.isArray(errorData) ? errorData : [];
      const novo = { ...limitObj };
      let removeu = false;
      for (const e of items) {
        if (e.code !== 'parameterValueField') continue;
        const msg = e.message || '';
        if (
          (msg.includes('IN_USA_LIMITE_COMERCIAL') ||
            msg.toLowerCase().includes('salelimit') ||
            msg.toLowerCase().includes('limite comercial')) &&
          'saleLimitValue' in novo
        ) {
          delete novo.saleLimitValue;
          removeu = true;
        }
        if (
          (msg.includes('IN_USA_LIMITE_MENSAL') ||
            msg.toLowerCase().includes('monthlylimit') ||
            msg.toLowerCase().includes('limite mensal')) &&
          'monthlyLimitValue' in novo
        ) {
          delete novo.monthlyLimitValue;
          removeu = true;
        }
        if (
          (msg.includes('IN_USA_LIMITE_FINANCEIRO') ||
            msg.toLowerCase().includes('financiallimit') ||
            msg.toLowerCase().includes('limite financeiro')) &&
          'financialLimitValue' in novo
        ) {
          delete novo.financialLimitValue;
          removeu = true;
        }
      }
      return removeu ? novo : null;
    };

    // Tentativa 1: todos os campos
    let limitObj = {
      branchCode: branchCodeNum,
      saleLimitValue: saleLimitNum,
      monthlyLimitValue: monthlyLimitNum,
      financialLimitValue: financialLimitNum,
    };

    const camposPulados = [];

    for (let tentativa = 1; tentativa <= 3; tentativa++) {
      try {
        const payload = buildPayload(limitObj);
        console.log(
          `[update-limit] tentativa ${tentativa} → endpoint=${endpoint} payload=`,
          JSON.stringify(payload),
        );
        const response = await postToTotvs(endpoint, payload);
        const camposEnviados = Object.keys(limitObj).filter(
          (k) =>
            k === 'saleLimitValue' ||
            k === 'monthlyLimitValue' ||
            k === 'financialLimitValue',
        );
        return res.status(200).json({
          success: true,
          message:
            camposPulados.length > 0
              ? `Limite atualizado parcialmente. Campos enviados: ${camposEnviados.join(', ')}. Campos não suportados pelo servidor TOTVS: ${camposPulados.join(', ')}.`
              : 'Limite atualizado no TOTVS com sucesso',
          camposEnviados,
          camposPulados,
          data: response.data,
        });
      } catch (error) {
        const data = error.response?.data;
        console.error(
          `[update-limit] tentativa ${tentativa} falhou (${error.response?.status}):`,
          JSON.stringify(data),
        );
        const ajustado = removerCamposRecusados(data, limitObj);
        if (ajustado) {
          // Registra campos que serão pulados
          for (const k of ['saleLimitValue', 'monthlyLimitValue', 'financialLimitValue']) {
            if (k in limitObj && !(k in ajustado) && !camposPulados.includes(k)) {
              camposPulados.push(k);
            }
          }
          // Se sobrou pelo menos algum valor de limite, tenta novamente
          const aindaTemLimite =
            'saleLimitValue' in ajustado ||
            'monthlyLimitValue' in ajustado ||
            'financialLimitValue' in ajustado;
          if (aindaTemLimite) {
            limitObj = ajustado;
            continue;
          }
          // Não sobrou nenhum limite válido — TOTVS bloqueia totalmente
          return res.status(422).json({
            success: false,
            error: 'TOTVS_PARAM_DISABLED',
            message:
              'Não foi possível atualizar o limite no TOTVS: o servidor recusou tanto saleLimitValue ' +
              'quanto monthlyLimitValue. Peça ao administrador TOTVS para habilitar os parâmetros ' +
              'IN_USA_LIMITE_COMERCIAL=1 e IN_USA_LIMITE_MENSAL=1.',
            details: data,
          });
        }
        return handleTotvsError(res, error, buildPayload(limitObj));
      }
    }

    return errorResponse(
      res,
      'Não foi possível atualizar o limite no TOTVS após múltiplas tentativas',
      500,
      'TOTVS_RETRY_EXHAUSTED',
    );
  }),
);

export default router;
