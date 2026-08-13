import express from 'express';
import axios from 'axios';
import {
  asyncHandler,
  successResponse,
  errorResponse,
} from '../utils/errorHandler.js';
import { getToken } from '../utils/totvsTokenManager.js';
import { TOTVS_BASE_URL, getFilialBranchCodes } from './totvsHelper.js';
import { validarCPF, validarCNPJ } from '../utils/docValidator.js';

const router = express.Router();

/**
 * Sanitiza recursivamente o payload removendo strings vazias / null / undefined / NaN
 * e remove arrays vazios. Mantém objetos vazios? -> remove também.
 */
export function sanitizePayload(value) {
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

export async function postToTotvs(endpointPath, payload) {
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
    // Não devolve o payload completo no response — contém PII (CPF/CNPJ + dados
    // pessoais) que podem vazar pra logs do browser. Mantemos só no console.
    return res.status(error.response.status || 400).json({
      success: false,
      message: msg,
      error: 'TOTVS_API_ERROR',
      details: data || null,
      status: error.response.status,
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
    // Validação local de CPF (dígito verificador) — evita roundtrip ao TOTVS
    // em casos de typo. Mensagem mais clara que o 400 genérico do TOTVS.
    const cpfCheck = validarCPF(payload.cpf);
    if (!cpfCheck.ok) {
      return errorResponse(res, cpfCheck.error, 400, 'INVALID_CPF');
    }
    payload.cpf = cpfCheck.cpf; // garante só dígitos
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
    const cnpjCheck = validarCNPJ(payload.cnpj);
    if (!cnpjCheck.ok) {
      return errorResponse(res, cnpjCheck.error, 400, 'INVALID_CNPJ');
    }
    payload.cnpj = cnpjCheck.cnpj;
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
 *
 *       Filiais: o TOTVS guarda o limite POR FILIAL — gravar só numa filial
 *       deixa o PDV das demais lojas travado. Por isso o padrão (igual ao
 *       crediário BlueCard) é gravar em TODAS as filiais próprias numa única
 *       chamada. Controle pelo body:
 *         applyAllBranches: true      → todas as filiais CROSBY (regra FILIAL)
 *         branchCodes: [2, 5, 6]      → lista explícita
 *         branchCode / branchInsertCode → filial única (comportamento antigo)
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
      branchCodes,
      applyAllBranches,
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
    if (
      saleLimitValue === undefined ||
      saleLimitValue === null ||
      saleLimitValue === '' ||
      isNaN(parseFloat(saleLimitValue)) ||
      parseFloat(saleLimitValue) < 0
    ) {
      return errorResponse(
        res,
        'saleLimitValue é obrigatório e não pode ser negativo',
        400,
        'MISSING_LIMIT',
      );
    }

    const endpoint = isPJ
      ? '/person/v2/legal-customers'
      : '/person/v2/individual-customers';

    // ─── Filiais onde o limite será gravado ────────────────────────────────
    let branchList = [];
    if (applyAllBranches) {
      try {
        const tokenData = await getToken();
        branchList = await getFilialBranchCodes(tokenData?.access_token);
      } catch (e) {
        return errorResponse(
          res,
          `Não foi possível listar as filiais para aplicar o limite: ${e.message}`,
          502,
          'BRANCH_LIST_FAILED',
        );
      }
    } else if (Array.isArray(branchCodes) && branchCodes.length > 0) {
      branchList = branchCodes
        .map((b) => parseInt(b, 10))
        .filter((b) => !isNaN(b) && b > 0);
    } else {
      const unico = parseInt(branchCode || branchInsertCode, 10);
      if (!isNaN(unico) && unico > 0) branchList = [unico];
    }
    if (branchList.length === 0) {
      return errorResponse(
        res,
        'Informe applyAllBranches, branchCodes[] ou branchInsertCode',
        400,
        'MISSING_BRANCH',
      );
    }
    const insertBranch = parseInt(branchInsertCode, 10) || branchList[0];

    // ─── Nome: obrigatório no payload TOTVS; busca no ERP se não vier ──────
    let nomeCliente = name;
    if (!nomeCliente) {
      try {
        const buscaEndpoint = isPJ
          ? '/person/v2/legal-entities/search'
          : '/person/v2/individuals/search';
        const filtro = isPJ
          ? { cnpjList: [String(docValue).replace(/\D/g, '')] }
          : { cpfList: [String(docValue).replace(/\D/g, '')] };
        const busca = await postToTotvs(buscaEndpoint, {
          filter: filtro,
          page: 1,
          pageSize: 1,
        });
        nomeCliente = busca.data?.items?.[0]?.name || null;
      } catch (e) {
        console.error('[update-limit] falha ao buscar nome no TOTVS:', e.message);
      }
    }
    if (!nomeCliente) {
      return errorResponse(
        res,
        'Nome é obrigatório e não foi encontrado no TOTVS para este CPF/CNPJ',
        400,
        'MISSING_NAME',
      );
    }

    const saleLimitNum = parseFloat(saleLimitValue);
    const monthlyLimitNum =
      monthlyLimitValue != null && !isNaN(parseFloat(monthlyLimitValue))
        ? parseFloat(monthlyLimitValue)
        : saleLimitNum;
    const financialLimitNum =
      financialLimitValue != null && !isNaN(parseFloat(financialLimitValue))
        ? parseFloat(financialLimitValue)
        : saleLimitNum;

    // Uma entrada de "limits" por filial — o TOTVS aceita o array inteiro numa
    // única chamada (validado no crediário BlueCard com 64 filiais).
    const buildPayload = (limitObj) =>
      sanitizePayload({
        [docField]: String(docValue).replace(/\D/g, ''),
        name: nomeCliente,
        branchInsertCode: insertBranch,
        insertDate: new Date().toISOString(),
        limits: branchList.map((bc) => ({ ...limitObj, branchCode: bc })),
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

    // Tentativa 1: todos os campos (branchCode entra por filial em buildPayload)
    let limitObj = {
      saleLimitValue: saleLimitNum,
      monthlyLimitValue: monthlyLimitNum,
      financialLimitValue: financialLimitNum,
    };

    const camposPulados = [];

    for (let tentativa = 1; tentativa <= 3; tentativa++) {
      try {
        const payload = buildPayload(limitObj);
        console.log(
          `[update-limit] tentativa ${tentativa} → endpoint=${endpoint} filiais=${branchList.length} payload=`,
          JSON.stringify(payload),
        );
        const response = await postToTotvs(endpoint, payload);
        const camposEnviados = Object.keys(limitObj).filter(
          (k) =>
            k === 'saleLimitValue' ||
            k === 'monthlyLimitValue' ||
            k === 'financialLimitValue',
        );
        const filiaisMsg =
          branchList.length === 1
            ? `filial ${branchList[0]}`
            : `${branchList.length} filiais`;
        return res.status(200).json({
          success: true,
          parcial: camposPulados.length > 0,
          message:
            camposPulados.length > 0
              ? `Limite atualizado parcialmente em ${filiaisMsg}. Campos enviados: ${camposEnviados.join(', ')}. Campos não suportados pelo servidor TOTVS: ${camposPulados.join(', ')}.`
              : `Limite atualizado no TOTVS em ${filiaisMsg}`,
          camposEnviados,
          camposPulados,
          branchCodes: branchList,
          branchesAplicadas: branchList.length,
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
