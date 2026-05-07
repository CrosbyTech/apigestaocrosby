import express from 'express';
import axios from 'axios';
import https from 'https';
import http from 'http';
import {
  asyncHandler,
  successResponse,
  errorResponse,
} from '../utils/errorHandler.js';
import { getToken, getTokenInfo } from '../utils/totvsTokenManager.js';
import {
  syncFullPesPessoa,
  syncIncrementalPesPessoa,
  fetchAndMapPersons,
  mapPersonToRow,
  upsertBatch,
} from '../utils/syncPesPessoa.js';
import supabase from '../config/supabase.js';
import supabaseFiscal from '../config/supabaseFiscal.js';

// ==========================================
// AGENTS keep-alive para reutilizar conexões TCP/TLS
// Evita handshake SSL a cada request (economia ~200-500ms/chamada)
// ==========================================
const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 20,
  maxFreeSockets: 10,
  timeout: 60000,
  rejectUnauthorized: false,
});

const httpAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 20,
  maxFreeSockets: 10,
  timeout: 60000,
});

const router = express.Router();

// URL base da nossa API (Render)
// Configurar via variável de ambiente API_BASE_URL no Render
// Exemplo: https://sua-api.onrender.com
const API_BASE_URL =
  process.env.API_BASE_URL ||
  process.env.RENDER_EXTERNAL_URL ||
  'http://localhost:4100';

/**
 * @route GET /totvs/token
 * @desc Obtém o token TOTVS atual (gerado automaticamente a cada 6 horas)
 * @access Public
 * @example GET ${API_BASE_URL}/api/totvs/token
 */
router.get(
  '/token',
  asyncHandler(async (req, res) => {
    // Obter token atual (ou gerar novo se necessário)
    const tokenData = await getToken();

    // Obter informações adicionais
    const tokenInfo = getTokenInfo();

    successResponse(
      res,
      {
        access_token: tokenData.access_token,
        token_type: tokenData.token_type,
        expires_in: tokenInfo?.expires_in || tokenData.expires_in,
        refresh_token: tokenData.refresh_token,
        expires_at: tokenInfo?.expires_at,
        is_valid: tokenInfo?.is_valid ?? true,
        // Incluir outras propriedades se existirem
        branches: tokenData.branches,
        sub: tokenData.sub,
      },
      'Token obtido com sucesso',
    );
  }),
);

// URL da API TOTVS Moda - baseado na documentação Swagger
// Documentação: https://www30.bhan.com.br:9443/api/totvsmoda/authorization/v2/swagger/index.html
// Pode ser configurada via variável de ambiente TOTVS_AUTH_ENDPOINT
const TOTVS_AUTH_ENDPOINT =
  process.env.TOTVS_AUTH_ENDPOINT ||
  'https://www30.bhan.com.br:9443/api/totvsmoda/authorization/v2/token';

// URL base da API TOTVS Moda
const TOTVS_BASE_URL =
  process.env.TOTVS_BASE_URL || 'https://www30.bhan.com.br:9443/api/totvsmoda';

/**
 * @route POST /totvs/auth
 * @desc Gera token de autenticação da API TOTVS Moda
 * @access Public
 * @docs https://www30.bhan.com.br:9443/api/totvsmoda/authorization/v2/swagger/index.html
 * @example POST ${API_BASE_URL}/api/totvs/auth
 * @body {
 *   grant_type: 'password' | 'client_credentials' | 'refresh_token',
 *   client_id: string (obrigatório),
 *   client_secret: string (obrigatório),
 *   username: string (obrigatório se grant_type = 'password'),
 *   password: string (obrigatório se grant_type = 'password'),
 *   refresh_token: string (obrigatório se grant_type = 'refresh_token')
 * }
 */
router.post(
  '/auth',
  asyncHandler(async (req, res) => {
    const {
      grant_type,
      client_id,
      client_secret,
      username,
      password,
      refresh_token,
    } = req.body;

    // Validação de campos obrigatórios baseado no grant_type
    if (!grant_type) {
      return errorResponse(
        res,
        'O campo grant_type é obrigatório',
        400,
        'MISSING_GRANT_TYPE',
      );
    }

    if (
      !['password', 'client_credentials', 'refresh_token'].includes(grant_type)
    ) {
      return errorResponse(
        res,
        'grant_type inválido. Valores válidos: password, client_credentials, refresh_token',
        400,
        'INVALID_GRANT_TYPE',
      );
    }

    // Preparar payload conforme grant_type
    // A API TOTVS espera application/x-www-form-urlencoded com nomes de campos específicos
    const formData = new URLSearchParams();

    // Campos obrigatórios baseados no grant_type
    formData.append('Grant_type', grant_type);

    if (grant_type === 'refresh_token') {
      if (!refresh_token) {
        return errorResponse(
          res,
          'O campo refresh_token é obrigatório quando grant_type é "refresh_token"',
          400,
          'MISSING_REFRESH_TOKEN',
        );
      }
      formData.append('Refresh_token', refresh_token);
    } else {
      // Para 'password' e 'client_credentials', client_id e client_secret são obrigatórios
      if (!client_id || !client_secret) {
        return errorResponse(
          res,
          'Os campos client_id e client_secret são obrigatórios',
          400,
          'MISSING_CREDENTIALS',
        );
      }
      formData.append('Client_id', client_id);
      formData.append('Client_secret', client_secret);

      // Para 'password', username e password também são obrigatórios
      if (grant_type === 'password') {
        if (!username || !password) {
          return errorResponse(
            res,
            'Os campos username e password são obrigatórios quando grant_type é "password"',
            400,
            'MISSING_USER_CREDENTIALS',
          );
        }
        formData.append('Username', username);
        formData.append('Password', password);
      }
    }

    // Campos opcionais (podem ser vazios conforme exemplo do curl)
    if (req.body.branch) {
      formData.append('Branch', req.body.branch);
    } else {
      formData.append('Branch', '');
    }

    if (req.body.mfa_totvs) {
      formData.append('Mfa_totvs', req.body.mfa_totvs);
    } else {
      formData.append('Mfa_totvs', '');
    }

    // Campos adicionais opcionais (conforme documentação)
    if (req.body.validationResult) {
      formData.append(
        'ValidationResult.IsValid',
        req.body.validationResult.isValid || '',
      );
    } else {
      formData.append('ValidationResult.IsValid', '');
    }

    try {
      console.log('🔐 Tentando autenticar na API TOTVS Moda:', {
        endpoint: TOTVS_AUTH_ENDPOINT,
        grant_type: grant_type,
        client_id: client_id,
      });

      // A API TOTVS requer application/x-www-form-urlencoded
      const response = await axios.post(
        TOTVS_AUTH_ENDPOINT,
        formData.toString(), // Convertendo URLSearchParams para string
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
          },
          timeout: 30000, // 30 segundos de timeout
          // Pode ser necessário ignorar erros de certificado SSL em ambiente de desenvolvimento
          // httpsAgent: new https.Agent({ rejectUnauthorized: false }) // Descomente se necessário
        },
      );

      console.log('✅ Token gerado com sucesso');

      // Retornar o token e dados da resposta
      // A API TOTVS pode retornar claims adicionais como 'sub' e 'branches' para grant_type 'password'
      successResponse(
        res,
        {
          access_token: response.data.access_token,
          token_type: response.data.token_type,
          expires_in: response.data.expires_in,
          refresh_token: response.data.refresh_token,
          // Incluir outras propriedades que a API retornar (sub, branches, etc.)
          ...response.data,
        },
        'Token gerado com sucesso',
      );
    } catch (error) {
      // Tratamento de erros da API TOTVS com mais detalhes
      console.error('❌ Erro ao chamar API TOTVS Moda:', {
        message: error.message,
        code: error.code,
        endpoint: TOTVS_AUTH_ENDPOINT,
        response: error.response?.data,
        status: error.response?.status,
      });

      if (error.response) {
        // A API respondeu com um erro
        return errorResponse(
          res,
          error.response.data?.error_description ||
            error.response.data?.error ||
            error.response.data?.message ||
            'Erro ao gerar token na API TOTVS',
          error.response.status || 400,
          'TOTVS_API_ERROR',
        );
      } else if (error.request) {
        // A requisição foi feita mas não houve resposta
        const errorMessage =
          error.code === 'ENOTFOUND'
            ? `URL da API TOTVS não encontrada: ${TOTVS_AUTH_ENDPOINT}. Verifique se a URL está correta.`
            : error.code === 'ECONNREFUSED'
              ? `Conexão recusada pela API TOTVS: ${TOTVS_AUTH_ENDPOINT}. O servidor pode estar offline ou a porta está incorreta.`
              : error.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
                  error.code === 'CERT_HAS_EXPIRED'
                ? `Erro de certificado SSL. Verifique a configuração do certificado da API TOTVS.`
                : `Não foi possível conectar à API TOTVS (${error.code || 'Erro desconhecido'})`;

        return errorResponse(res, errorMessage, 503, 'TOTVS_CONNECTION_ERROR');
      } else {
        // Erro ao configurar a requisição
        throw new Error(`Erro ao chamar API TOTVS: ${error.message}`);
      }
    }
  }),
);

/**
 * @route POST /totvs/bank-slip
 * @desc Gera base64 do boleto bancário do cliente
 * @access Public
 * @example POST ${API_BASE_URL}/api/totvs/bank-slip
 * @body {
 *   branchCode: number (obrigatório, máx 4 caracteres),
 *   customerCode: number (obrigatório se customerCpfCnpj não informado, máx 9 caracteres),
 *   customerCpfCnpj: string (obrigatório se customerCode não informado, máx 14 caracteres, apenas números),
 *   receivableCode: number (obrigatório, máx 10 caracteres),
 *   installmentNumber: number (obrigatório, máx 3 caracteres)
 * }
 */
router.post(
  '/bank-slip',
  asyncHandler(async (req, res) => {
    const {
      branchCode,
      customerCode,
      customerCpfCnpj,
      receivableCode,
      installmentNumber,
    } = req.body;

    // Validação de campos obrigatórios
    if (branchCode === undefined || branchCode === null || branchCode === '') {
      return errorResponse(
        res,
        'O campo branchCode é obrigatório',
        400,
        'MISSING_BRANCH_CODE',
      );
    }

    // Converter para número se vier como string
    const branchCodeNum =
      typeof branchCode === 'string' ? parseInt(branchCode, 10) : branchCode;

    if (
      isNaN(branchCodeNum) ||
      branchCodeNum < 0 ||
      branchCodeNum.toString().length > 4
    ) {
      return errorResponse(
        res,
        'O campo branchCode deve ser um número inteiro com máximo de 4 caracteres',
        400,
        'INVALID_BRANCH_CODE',
      );
    }

    // Validar que customerCode OU customerCpfCnpj seja informado (mas não ambos)
    if (!customerCode && !customerCpfCnpj) {
      return errorResponse(
        res,
        'É obrigatório informar customerCode OU customerCpfCnpj (não ambos)',
        400,
        'MISSING_CUSTOMER_IDENTIFIER',
      );
    }

    if (customerCode && customerCpfCnpj) {
      return errorResponse(
        res,
        'Não é possível informar customerCode e customerCpfCnpj ao mesmo tempo. Informe apenas um deles.',
        400,
        'INVALID_CUSTOMER_IDENTIFIERS',
      );
    }

    if (
      customerCode !== undefined &&
      customerCode !== null &&
      customerCode !== ''
    ) {
      // Converter para número se vier como string
      const customerCodeNum =
        typeof customerCode === 'string'
          ? parseInt(customerCode, 10)
          : customerCode;

      if (
        isNaN(customerCodeNum) ||
        customerCodeNum < 0 ||
        customerCodeNum.toString().length > 9
      ) {
        return errorResponse(
          res,
          'O campo customerCode deve ser um número inteiro com máximo de 9 caracteres',
          400,
          'INVALID_CUSTOMER_CODE',
        );
      }
    }

    if (customerCpfCnpj) {
      // Validar que customerCpfCnpj contenha apenas números e tenha máximo 14 caracteres
      if (
        typeof customerCpfCnpj !== 'string' ||
        !/^\d+$/.test(customerCpfCnpj)
      ) {
        return errorResponse(
          res,
          'O campo customerCpfCnpj deve conter apenas números',
          400,
          'INVALID_CUSTOMER_CPF_CNPJ_FORMAT',
        );
      }

      if (customerCpfCnpj.length > 14) {
        return errorResponse(
          res,
          'O campo customerCpfCnpj deve ter no máximo 14 caracteres',
          400,
          'INVALID_CUSTOMER_CPF_CNPJ_LENGTH',
        );
      }
    }

    if (
      receivableCode === undefined ||
      receivableCode === null ||
      receivableCode === ''
    ) {
      return errorResponse(
        res,
        'O campo receivableCode é obrigatório',
        400,
        'MISSING_RECEIVABLE_CODE',
      );
    }

    // Converter para número se vier como string
    const receivableCodeNum =
      typeof receivableCode === 'string'
        ? parseInt(receivableCode, 10)
        : receivableCode;

    if (
      isNaN(receivableCodeNum) ||
      receivableCodeNum < 0 ||
      receivableCodeNum.toString().length > 10
    ) {
      return errorResponse(
        res,
        'O campo receivableCode deve ser um número inteiro com máximo de 10 caracteres',
        400,
        'INVALID_RECEIVABLE_CODE',
      );
    }

    if (
      installmentNumber === undefined ||
      installmentNumber === null ||
      installmentNumber === ''
    ) {
      return errorResponse(
        res,
        'O campo installmentNumber é obrigatório',
        400,
        'MISSING_INSTALLMENT_NUMBER',
      );
    }

    // Converter para número se vier como string
    const installmentNumberNum =
      typeof installmentNumber === 'string'
        ? parseInt(installmentNumber, 10)
        : installmentNumber;

    if (
      isNaN(installmentNumberNum) ||
      installmentNumberNum < 0 ||
      installmentNumberNum.toString().length > 3
    ) {
      return errorResponse(
        res,
        'O campo installmentNumber deve ser um número inteiro com máximo de 3 caracteres',
        400,
        'INVALID_INSTALLMENT_NUMBER',
      );
    }

    try {
      // Obter token atual (ou gerar novo se necessário)
      const tokenData = await getToken();

      if (!tokenData || !tokenData.access_token) {
        return errorResponse(
          res,
          'Não foi possível obter token de autenticação TOTVS',
          503,
          'TOKEN_UNAVAILABLE',
        );
      }

      // Preparar o payload para a requisição
      const payload = {
        branchCode: branchCodeNum,
        receivableCode: receivableCodeNum,
        installmentNumber: installmentNumberNum,
      };

      // Adicionar customerCode OU customerCpfCnpj (não ambos)
      if (
        customerCode !== undefined &&
        customerCode !== null &&
        customerCode !== ''
      ) {
        const customerCodeNum =
          typeof customerCode === 'string'
            ? parseInt(customerCode, 10)
            : customerCode;
        payload.customerCode = customerCodeNum;
      } else {
        payload.customerCpfCnpj = customerCpfCnpj;
      }

      console.log('🧾 Gerando boleto bancário na API TOTVS:', {
        endpoint: `${TOTVS_BASE_URL}/accounts-receivable/v2/bank-slip`,
        branchCode: payload.branchCode,
        receivableCode: payload.receivableCode,
        installmentNumber: payload.installmentNumber,
        customerIdentifier: payload.customerCode
          ? `Code: ${payload.customerCode}`
          : `CPF/CNPJ: ${payload.customerCpfCnpj}`,
      });

      // Fazer requisição para a API TOTVS
      const response = await axios.post(
        `${TOTVS_BASE_URL}/accounts-receivable/v2/bank-slip`,
        payload,
        {
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Bearer ${tokenData.access_token}`,
          },
          timeout: 30000, // 30 segundos de timeout
        },
      );

      console.log('✅ Boleto bancário gerado com sucesso');

      // A API TOTVS retorna o base64 do boleto
      // Pode vir como string direto ou em uma propriedade base64
      let base64Data = null;

      if (typeof response.data === 'string') {
        base64Data = response.data;
      } else if (response.data?.base64) {
        base64Data = response.data.base64;
      } else if (response.data?.data) {
        base64Data = response.data.data;
      } else if (typeof response.data === 'object') {
        // Se for objeto, tentar pegar qualquer propriedade que possa ser o base64
        base64Data = response.data;
      }

      successResponse(
        res,
        {
          base64: base64Data,
          // Incluir outras propriedades que a API retornar
          ...(typeof response.data === 'object' && response.data?.base64
            ? Object.keys(response.data)
                .filter((k) => k !== 'base64')
                .reduce((acc, k) => {
                  acc[k] = response.data[k];
                  return acc;
                }, {})
            : {}),
        },
        'Boleto bancário gerado com sucesso',
      );
    } catch (error) {
      // Tratamento de erros da API TOTVS
      console.error(
        '❌ Falha ao gerar boleto. Confira se já foi pago; se persistir, contate o suporte.',
        {
          message: error.message,
          code: error.code,
          response: error.response?.data,
          status: error.response?.status,
        },
      );

      if (error.response) {
        // A API respondeu com um erro
        if (error.response.status === 401) {
          // Token inválido - tentar gerar novo e repetir
          console.log('🔄 Token inválido. Tentando gerar novo token...');
          try {
            const newTokenData = await getToken(true); // Forçar geração de novo token

            // Preparar payload novamente
            const payload = {
              branchCode: parseInt(branchCode, 10),
              receivableCode: parseInt(receivableCode, 10),
              installmentNumber: parseInt(installmentNumber, 10),
            };

            if (customerCode !== undefined && customerCode !== null) {
              payload.customerCode = parseInt(customerCode, 10);
            } else {
              payload.customerCpfCnpj = customerCpfCnpj;
            }

            // Tentar novamente com o novo token
            const retryResponse = await axios.post(
              `${TOTVS_BASE_URL}/accounts-receivable/v2/bank-slip`,
              payload,
              {
                headers: {
                  'Content-Type': 'application/json',
                  Accept: 'application/json',
                  Authorization: `Bearer ${newTokenData.access_token}`,
                },
                timeout: 30000,
              },
            );

            console.log(
              '✅ Boleto bancário gerado com sucesso após renovar token',
            );

            // Processar base64 da mesma forma que o primeiro try
            let retryBase64Data = null;

            if (typeof retryResponse.data === 'string') {
              retryBase64Data = retryResponse.data;
            } else if (retryResponse.data?.base64) {
              retryBase64Data = retryResponse.data.base64;
            } else if (retryResponse.data?.data) {
              retryBase64Data = retryResponse.data.data;
            } else if (typeof retryResponse.data === 'object') {
              retryBase64Data = retryResponse.data;
            }

            return successResponse(
              res,
              {
                base64: retryBase64Data,
                ...(typeof retryResponse.data === 'object' &&
                retryResponse.data?.base64
                  ? Object.keys(retryResponse.data)
                      .filter((k) => k !== 'base64')
                      .reduce((acc, k) => {
                        acc[k] = retryResponse.data[k];
                        return acc;
                      }, {})
                  : {}),
              },
              'Boleto bancário gerado com sucesso',
            );
          } catch (retryError) {
            return errorResponse(
              res,
              retryError.response?.data?.message ||
                retryError.response?.data?.error ||
                'Erro ao gerar boleto bancário na API TOTVS após renovar token',
              retryError.response?.status || 500,
              'TOTVS_API_ERROR',
            );
          }
        }

        // Retornar erro detalhado da API TOTVS
        const errorMessage =
          error.response.data?.message ||
          error.response.data?.error ||
          error.response.data?.error_description ||
          (typeof error.response.data === 'string'
            ? error.response.data
            : 'Erro ao gerar boleto bancário na API TOTVS');

        // Retornar resposta de erro com detalhes adicionais
        res.status(error.response.status || 400).json({
          success: false,
          message: errorMessage,
          error: 'TOTVS_API_ERROR',
          timestamp: new Date().toISOString(),
          details: error.response.data,
          payload: {
            branchCode: branchCodeNum,
            receivableCode: receivableCodeNum,
            installmentNumber: installmentNumberNum,
            customerIdentifier: customerCode
              ? `Code: ${customerCode}`
              : `CPF/CNPJ: ${customerCpfCnpj}`,
          },
        });
        return;
      } else if (error.request) {
        // A requisição foi feita mas não houve resposta
        const errorMessage =
          error.code === 'ENOTFOUND'
            ? `URL da API TOTVS não encontrada. Verifique se a URL está correta.`
            : error.code === 'ECONNREFUSED'
              ? `Conexão recusada pela API TOTVS. O servidor pode estar offline.`
              : `Não foi possível conectar à API TOTVS (${error.code || 'Erro desconhecido'})`;

        return errorResponse(res, errorMessage, 503, 'TOTVS_CONNECTION_ERROR');
      } else {
        // Erro ao configurar a requisição
        throw new Error(`Erro ao chamar API TOTVS: ${error.message}`);
      }
    }
  }),
);

router.post(
  '/invoices-search',
  asyncHandler(async (req, res) => {
    try {
      // Obter token atual (ou gerar novo se necessário)
      const tokenData = await getToken();

      if (!tokenData || !tokenData.access_token) {
        return errorResponse(
          res,
          'Não foi possível obter token de autenticação TOTVS',
          503,
          'TOKEN_UNAVAILABLE',
        );
      }

      // Montar payload com padrões e sobrepor com corpo recebido
      const defaultPayload = {
        filter: {
          change: {},
        },
        page: 1,
        pageSize: 100,
        expand: 'person',
      };

      const payload = {
        ...defaultPayload,
        ...req.body,
        filter: {
          ...defaultPayload.filter,
          ...(req.body?.filter || {}),
        },
      };

      const endpoint = `${TOTVS_BASE_URL}/fiscal/v2/invoices/search`;

      console.log('🧾 Buscando notas fiscais na API TOTVS:', {
        endpoint,
        page: payload.page,
        pageSize: payload.pageSize,
        hasPerson: payload.expand,
      });

      const doRequest = async (accessToken) =>
        axios.post(endpoint, payload, {
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          timeout: 30000,
        });

      let response;
      try {
        response = await doRequest(tokenData.access_token);
      } catch (error) {
        if (error.response?.status === 401) {
          console.log(
            '🔄 Token inválido ao buscar notas fiscais. Renovando token...',
          );
          const newTokenData = await getToken(true);
          response = await doRequest(newTokenData.access_token);
        } else {
          throw error;
        }
      }

      successResponse(
        res,
        {
          ...response.data,
        },
        'Notas fiscais obtidas com sucesso',
      );
    } catch (error) {
      console.error('❌ Erro ao buscar notas fiscais na API TOTVS:', {
        message: error.message,
        code: error.code,
        response: error.response?.data,
        status: error.response?.status,
      });

      if (error.response) {
        const errorMessage =
          error.response.data?.message ||
          error.response.data?.error ||
          error.response.data?.error_description ||
          (typeof error.response.data === 'string'
            ? error.response.data
            : 'Erro ao buscar notas fiscais na API TOTVS');

        return res.status(error.response.status || 400).json({
          success: false,
          message: errorMessage,
          error: 'TOTVS_API_ERROR',
          timestamp: new Date().toISOString(),
          details: error.response.data,
          payload: req.body,
        });
      } else if (error.request) {
        const errorMessage =
          error.code === 'ENOTFOUND'
            ? 'URL da API TOTVS não encontrada. Verifique se a URL está correta.'
            : error.code === 'ECONNREFUSED'
              ? 'Conexão recusada pela API TOTVS. O servidor pode estar offline.'
              : `Não foi possível conectar à API TOTVS (${error.code || 'Erro desconhecido'})`;

        return errorResponse(res, errorMessage, 503, 'TOTVS_CONNECTION_ERROR');
      }

      throw new Error(`Erro ao chamar API TOTVS: ${error.message}`);
    }
  }),
);

router.post(
  '/danfe-search',
  asyncHandler(async (req, res) => {
    const { mainInvoiceXml, nfeDocumentType } = req.body || {};

    if (
      !mainInvoiceXml ||
      typeof mainInvoiceXml !== 'string' ||
      mainInvoiceXml.trim() === ''
    ) {
      return errorResponse(
        res,
        'O campo mainInvoiceXml é obrigatório e deve ser uma string com conteúdo',
        400,
        'MISSING_MAIN_INVOICE_XML',
      );
    }

    // Valor padrão conforme especificado
    const documentType = nfeDocumentType || 'NFeNormal';

    try {
      // Obter token atual (ou gerar novo se necessário)
      const tokenData = await getToken();

      if (!tokenData || !tokenData.access_token) {
        return errorResponse(
          res,
          'Não foi possível obter token de autenticação TOTVS',
          503,
          'TOKEN_UNAVAILABLE',
        );
      }

      const endpoint = `${TOTVS_BASE_URL}/fiscal/v2/danfe-search`;
      const payload = {
        mainInvoiceXml,
        nfeDocumentType: documentType,
      };

      console.log('🧾 Gerando DANFE na API TOTVS:', {
        endpoint,
        nfeDocumentType: payload.nfeDocumentType,
        xmlLength: mainInvoiceXml.length,
      });

      const doRequest = async (accessToken) =>
        axios.post(endpoint, payload, {
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          timeout: 30000,
        });

      let response;
      try {
        response = await doRequest(tokenData.access_token);
      } catch (error) {
        if (error.response?.status === 401) {
          console.log('🔄 Token inválido ao gerar DANFE. Renovando token...');
          const newTokenData = await getToken(true);
          response = await doRequest(newTokenData.access_token);
        } else {
          throw error;
        }
      }

      successResponse(res, response.data, 'DANFE gerada com sucesso');
    } catch (error) {
      console.error('❌ Erro ao gerar DANFE na API TOTVS:', {
        message: error.message,
        code: error.code,
        response: error.response?.data,
        status: error.response?.status,
        headers: error.response?.headers,
        url: error.config?.url,
      });

      if (error.response) {
        let errorMessage = 'Erro ao gerar DANFE na API TOTVS';
        if (error.response.data) {
          if (typeof error.response.data === 'string') {
            errorMessage = error.response.data || errorMessage;
          } else if (typeof error.response.data === 'object') {
            errorMessage =
              error.response.data?.message ||
              error.response.data?.error ||
              error.response.data?.error_description ||
              error.response.data?.title ||
              errorMessage;
          }
        }

        return res.status(error.response.status || 400).json({
          success: false,
          message: errorMessage,
          error: 'TOTVS_API_ERROR',
          timestamp: new Date().toISOString(),
          details: error.response.data || null,
          status: error.response.status,
          payload: {
            nfeDocumentType: documentType,
            mainInvoiceXmlLength: mainInvoiceXml?.length,
          },
        });
      } else if (error.request) {
        const errorMessage =
          error.code === 'ENOTFOUND'
            ? 'URL da API TOTVS não encontrada. Verifique se a URL está correta.'
            : error.code === 'ECONNREFUSED'
              ? 'Conexão recusada pela API TOTVS. O servidor pode estar offline.'
              : `Não foi possível conectar à API TOTVS (${error.code || 'Erro desconhecido'})`;

        return errorResponse(res, errorMessage, 503, 'TOTVS_CONNECTION_ERROR');
      }

      throw new Error(`Erro ao chamar API TOTVS: ${error.message}`);
    }
  }),
);

router.post(
  '/danfe-from-invoice',
  asyncHandler(async (req, res) => {
    // Payload esperado é o mesmo da invoices-search
    const searchPayload = req.body || {};

    try {
      // Obter token
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

      // 1) invoices/search -> obter accessKey
      const invoicesEndpoint = `${TOTVS_BASE_URL}/fiscal/v2/invoices/search`;

      // Detectar se é busca por invoiceCode (vindo do accounts-receivable)
      // Nesse caso, transactionCode não está disponível - precisamos buscar por data + filial + pessoa
      const filterData = searchPayload.filter || {};
      const isInvoiceCodeSearch =
        filterData.invoiceCode && !filterData.transactionCode;

      let invoicesBody;
      if (isInvoiceCodeSearch) {
        // Busca alternativa: usar change date range + branchCodeList + personCodeList
        const invoiceDate = filterData.invoiceDate || '';
        const MARGIN_DAYS = 3;
        const startDate = new Date(invoiceDate);
        startDate.setDate(startDate.getDate() - MARGIN_DAYS);
        const endDate = new Date(invoiceDate);
        endDate.setDate(endDate.getDate() + MARGIN_DAYS);

        invoicesBody = {
          filter: {
            branchCodeList: filterData.branchCodeList || [],
            personCodeList: filterData.personCodeList || [],
            change: {
              startDate: `${startDate.toISOString().slice(0, 10)}T00:00:00.000Z`,
              endDate: `${endDate.toISOString().slice(0, 10)}T23:59:59.999Z`,
            },
          },
          page: 1,
          pageSize: 100,
          expand: 'person',
        };
      } else {
        const invoicesDefaults = {
          filter: { change: {} },
          page: 1,
          pageSize: 100,
          expand: 'person',
        };
        invoicesBody = {
          ...invoicesDefaults,
          ...searchPayload,
          filter: {
            ...invoicesDefaults.filter,
            ...(searchPayload.filter || {}),
          },
        };
      }

      const doInvoicesRequest = async (accessToken) =>
        axios.post(invoicesEndpoint, invoicesBody, {
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          timeout: 30000,
        });

      let invoicesResp;
      try {
        invoicesResp = await doInvoicesRequest(token);
      } catch (error) {
        if (error.response?.status === 401) {
          const newToken = (await getToken(true))?.access_token;
          invoicesResp = await doInvoicesRequest(newToken);
        } else {
          throw error;
        }
      }

      let items = invoicesResp?.data?.items || [];

      // Se busca por invoiceCode, filtrar os resultados para achar a NF correta
      if (isInvoiceCodeSearch && Array.isArray(items) && items.length > 0) {
        const targetInvoiceCode = parseInt(filterData.invoiceCode);
        const targetBranchCode = filterData.branchCodeList?.[0];
        items = items.filter((item) => {
          const matchCode = parseInt(item.invoiceCode) === targetInvoiceCode;
          const matchBranch = targetBranchCode
            ? parseInt(item.branchCode) === parseInt(targetBranchCode)
            : true;
          return matchCode && matchBranch;
        });
      }

      if (!Array.isArray(items) || items.length === 0) {
        return errorResponse(
          res,
          'Nenhuma nota fiscal encontrada para os filtros informados',
          404,
          'INVOICE_NOT_FOUND',
        );
      }

      // Usar o primeiro item encontrado (ou permitir index via req.body.index futuramente)
      const first = items[0];
      const accessKey = first?.eletronic?.accessKey;
      if (!accessKey) {
        return errorResponse(
          res,
          'Chave de acesso não encontrada na resposta de invoices-search',
          404,
          'ACCESS_KEY_NOT_FOUND',
        );
      }

      // 2) xml-contents -> obter XML principal
      const xmlEndpoint = `${TOTVS_BASE_URL}/fiscal/v2/xml-contents/${encodeURIComponent(accessKey)}`;

      const doXmlRequest = async (accessToken) =>
        axios.get(xmlEndpoint, {
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          timeout: 30000,
        });

      let xmlResp;
      try {
        xmlResp = await doXmlRequest(token);
      } catch (error) {
        if (error.response?.status === 401) {
          const newToken = (await getToken(true))?.access_token;
          xmlResp = await doXmlRequest(newToken);
        } else {
          throw error;
        }
      }

      const mainInvoiceXml =
        xmlResp?.data?.mainInvoiceXml || xmlResp?.data?.data?.mainInvoiceXml;
      if (!mainInvoiceXml) {
        return errorResponse(
          res,
          'XML principal da NFe não retornado pela API TOTVS',
          404,
          'XML_NOT_FOUND',
        );
      }

      // 3) danfe-search -> obter base64 do PDF
      const danfeEndpoint = `${TOTVS_BASE_URL}/fiscal/v2/danfe-search`;
      const danfeBody = {
        mainInvoiceXml,
        nfeDocumentType: 'NFeNormal',
      };

      const doDanfeRequest = async (accessToken) =>
        axios.post(danfeEndpoint, danfeBody, {
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          timeout: 30000,
        });

      let danfeResp;
      try {
        danfeResp = await doDanfeRequest(token);
      } catch (error) {
        if (error.response?.status === 401) {
          const newToken = (await getToken(true))?.access_token;
          danfeResp = await doDanfeRequest(newToken);
        } else {
          throw error;
        }
      }

      const danfePdfBase64 = danfeResp?.data?.danfePdfBase64;
      if (!danfePdfBase64) {
        return errorResponse(
          res,
          'DANFE não retornada pela API TOTVS',
          502,
          'DANFE_NOT_RETURNED',
        );
      }

      // Sucesso
      return successResponse(
        res,
        {
          danfePdfBase64,
          accessKey,
          invoice: {
            branchCode: first?.branchCode,
            invoiceCode: first?.invoiceCode,
            serialCode: first?.serialCode,
            personCode: first?.personCode,
            personName: first?.personName,
            invoiceDate: first?.invoiceDate,
          },
        },
        'DANFE gerada com sucesso a partir da pesquisa de notas',
      );
    } catch (error) {
      // Tratamento de erro geral
      const status = error.response?.status || 500;
      const details = error.response?.data || null;
      const message =
        details?.message ||
        details?.error ||
        details?.error_description ||
        error.message ||
        'Erro ao gerar DANFE';
      return res.status(status).json({
        success: false,
        message,
        error: 'DANFE_FLOW_ERROR',
        timestamp: new Date().toISOString(),
        details,
        step: details ? undefined : 'unknown',
      });
    }
  }),
);

// ==========================================
// DANFE em lote — busca + gera DANFE para múltiplas NFs de um cliente
// Otimizado: 1 invoices-search + 2 calls por NF (xml + danfe)
// ==========================================
router.post(
  '/danfe-batch',
  asyncHandler(async (req, res) => {
    const { personCode, branchCodeList, issueDates } = req.body || {};

    console.log('📦 danfe-batch recebido:', {
      personCode,
      branchCodeList,
      issueDates,
    });

    if (
      personCode === undefined ||
      personCode === null ||
      !Array.isArray(issueDates) ||
      issueDates.length === 0
    ) {
      return errorResponse(
        res,
        `personCode e issueDates[] são obrigatórios (recebido: personCode=${personCode}, issueDates=${JSON.stringify(issueDates)})`,
        400,
        'MISSING_PARAMS',
      );
    }

    try {
      const tokenData = await getToken();
      if (!tokenData?.access_token) {
        return errorResponse(
          res,
          'Token TOTVS indisponível',
          503,
          'TOKEN_UNAVAILABLE',
        );
      }
      let token = tokenData.access_token;

      // 1) Calcular range de datas (min-3 .. max+3)
      const dates = issueDates.map((d) => new Date(d)).filter((d) => !isNaN(d));
      if (dates.length === 0) {
        return errorResponse(res, 'Nenhuma data válida', 400, 'INVALID_DATES');
      }
      const minDate = new Date(Math.min(...dates));
      const maxDate = new Date(Math.max(...dates));
      minDate.setDate(minDate.getDate() - 3);
      maxDate.setDate(maxDate.getDate() + 3);

      const branches = (branchCodeList || []).filter((c) => c >= 1 && c <= 99);

      // 2) invoices-search — dividir em chunks de até 5 meses (API limita 6 meses)
      const invoicesEndpoint = `${TOTVS_BASE_URL}/fiscal/v2/invoices/search`;
      const MAX_MONTHS = 5;
      const dateChunks = [];
      let chunkStart = new Date(minDate);
      while (chunkStart < maxDate) {
        const chunkEnd = new Date(chunkStart);
        chunkEnd.setMonth(chunkEnd.getMonth() + MAX_MONTHS);
        if (chunkEnd > maxDate) chunkEnd.setTime(maxDate.getTime());
        dateChunks.push({
          start: `${chunkStart.toISOString().slice(0, 10)}T00:00:00`,
          end: `${chunkEnd.toISOString().slice(0, 10)}T23:59:59`,
        });
        chunkStart = new Date(chunkEnd);
        chunkStart.setDate(chunkStart.getDate() + 1);
      }

      console.log(
        `🔍 danfe-batch: ${dateChunks.length} chunk(s) de datas, personCode=${personCode}`,
      );

      const allItems = [];
      for (const chunk of dateChunks) {
        const invoicesBody = {
          filter: {
            branchCodeList: branches,
            personCodeList: [parseInt(personCode)],
            eletronicInvoiceStatusList: ['Authorized'],
            startIssueDate: chunk.start,
            endIssueDate: chunk.end,
            change: {},
          },
          page: 1,
          pageSize: 100,
          expand: 'person',
        };

        const doInvoicesReq = async (accessToken) =>
          axios.post(invoicesEndpoint, invoicesBody, {
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
              Authorization: `Bearer ${accessToken}`,
            },
            timeout: 30000,
            httpsAgent,
          });

        let invoicesResp;
        try {
          invoicesResp = await doInvoicesReq(token);
        } catch (err) {
          if (err.response?.status === 401) {
            token = (await getToken(true))?.access_token;
            invoicesResp = await doInvoicesReq(token);
          } else throw err;
        }

        const chunkItems = invoicesResp?.data?.items || [];
        console.log(
          `  📄 Chunk ${chunk.start} ~ ${chunk.end}: ${chunkItems.length} NFs`,
        );
        allItems.push(...chunkItems);
      }

      const items = allItems;
      if (items.length === 0) {
        return successResponse(
          res,
          { danfes: [], total: 0 },
          'Nenhuma NF encontrada',
        );
      }

      // 3) Deduplicar NFs por accessKey
      const uniqueNFs = [];
      const seenKeys = new Set();
      for (const nf of items) {
        const key = nf?.eletronic?.accessKey;
        if (key && !seenKeys.has(key)) {
          seenKeys.add(key);
          uniqueNFs.push(nf);
        }
      }

      // 4) Para cada NF: xml-contents → danfe-search (paralelo, max 3 concurrent)
      const CONCURRENCY = 3;
      const danfes = [];

      const processNF = async (nf) => {
        const accessKey = nf.eletronic.accessKey;
        // xml-contents
        const xmlEndpoint = `${TOTVS_BASE_URL}/fiscal/v2/xml-contents/${encodeURIComponent(accessKey)}`;
        const doXml = async (t) =>
          axios.get(xmlEndpoint, {
            headers: {
              Accept: 'application/json',
              Authorization: `Bearer ${t}`,
            },
            timeout: 30000,
            httpsAgent,
          });

        let xmlResp;
        try {
          xmlResp = await doXml(token);
        } catch (err) {
          if (err.response?.status === 401) {
            token = (await getToken(true))?.access_token;
            xmlResp = await doXml(token);
          } else throw err;
        }

        const mainInvoiceXml =
          xmlResp?.data?.mainInvoiceXml || xmlResp?.data?.data?.mainInvoiceXml;
        if (!mainInvoiceXml) return null;

        // danfe-search
        const danfeEndpoint = `${TOTVS_BASE_URL}/fiscal/v2/danfe-search`;
        const doDanfe = async (t) =>
          axios.post(
            danfeEndpoint,
            { mainInvoiceXml, nfeDocumentType: 'NFeNormal' },
            {
              headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                Authorization: `Bearer ${t}`,
              },
              timeout: 30000,
              httpsAgent,
            },
          );

        let danfeResp;
        try {
          danfeResp = await doDanfe(token);
        } catch (err) {
          if (err.response?.status === 401) {
            token = (await getToken(true))?.access_token;
            danfeResp = await doDanfe(token);
          } else throw err;
        }

        const base64 = danfeResp?.data?.danfePdfBase64;
        if (!base64) return null;

        return {
          invoiceCode: nf.invoiceCode,
          branchCode: nf.branchCode,
          danfePdfBase64: base64,
        };
      };

      // Processar em lotes de CONCURRENCY
      for (let i = 0; i < uniqueNFs.length; i += CONCURRENCY) {
        const batch = uniqueNFs.slice(i, i + CONCURRENCY);
        const results = await Promise.allSettled(batch.map(processNF));
        for (const r of results) {
          if (r.status === 'fulfilled' && r.value) danfes.push(r.value);
        }
      }

      return successResponse(
        res,
        { danfes, total: danfes.length, nfsFound: uniqueNFs.length },
        `${danfes.length} DANFE(s) gerada(s) com sucesso`,
      );
    } catch (error) {
      console.error('❌ danfe-batch erro:', {
        status: error.response?.status,
        data: error.response?.data,
        message: error.message,
      });
      const status = error.response?.status || 500;
      const details = error.response?.data;
      return res.status(status).json({
        success: false,
        message:
          details?.message || error.message || 'Erro ao gerar DANFEs em lote',
        error: 'DANFE_BATCH_ERROR',
        details,
      });
    }
  }),
);

router.get(
  '/xml-contents/:accessKey?',
  asyncHandler(async (req, res) => {
    const accessKey = req.params.accessKey || req.query.accessKey;

    if (!accessKey) {
      return errorResponse(
        res,
        'O parâmetro accessKey é obrigatório',
        400,
        'MISSING_ACCESS_KEY',
      );
    }

    try {
      // Obter token atual (ou gerar novo se necessário)
      const tokenData = await getToken();

      if (!tokenData || !tokenData.access_token) {
        return errorResponse(
          res,
          'Não foi possível obter token de autenticação TOTVS',
          503,
          'TOKEN_UNAVAILABLE',
        );
      }

      const endpoint = `${TOTVS_BASE_URL}/fiscal/v2/xml-contents/${encodeURIComponent(accessKey)}`;

      console.log('📄 Buscando XML da NF-e na API TOTVS:', {
        endpoint,
        accessKey,
        hasAccessKey: Boolean(accessKey),
      });

      const doRequest = async (accessToken) =>
        axios.get(endpoint, {
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          timeout: 30000,
        });

      let response;
      try {
        response = await doRequest(tokenData.access_token);
      } catch (error) {
        if (error.response?.status === 401) {
          console.log('🔄 Token inválido ao buscar XML. Renovando token...');
          const newTokenData = await getToken(true);
          response = await doRequest(newTokenData.access_token);
        } else {
          throw error;
        }
      }

      successResponse(
        res,
        response.data,
        'XML da nota fiscal obtido com sucesso',
      );
    } catch (error) {
      console.error('❌ Erro ao buscar XML da NF-e na API TOTVS:', {
        message: error.message,
        code: error.code,
        response: error.response?.data,
        status: error.response?.status,
        headers: error.response?.headers,
        url: error.config?.url,
      });

      if (error.response) {
        // Tratamento melhorado para diferentes formatos de erro
        let errorMessage = 'Erro ao buscar XML da NF-e na API TOTVS';

        if (error.response.data) {
          if (typeof error.response.data === 'string') {
            errorMessage = error.response.data || errorMessage;
          } else if (typeof error.response.data === 'object') {
            errorMessage =
              error.response.data?.message ||
              error.response.data?.error ||
              error.response.data?.error_description ||
              error.response.data?.title ||
              (error.response.status === 404
                ? 'Nota fiscal não encontrada na API TOTVS'
                : errorMessage);
          }
        } else if (error.response.status === 404) {
          errorMessage = 'Nota fiscal não encontrada na API TOTVS';
        }

        return res.status(error.response.status || 400).json({
          success: false,
          message: errorMessage,
          error: 'TOTVS_API_ERROR',
          timestamp: new Date().toISOString(),
          details: error.response.data || null,
          status: error.response.status,
          payload: { accessKey },
        });
      } else if (error.request) {
        const errorMessage =
          error.code === 'ENOTFOUND'
            ? 'URL da API TOTVS não encontrada. Verifique se a URL está correta.'
            : error.code === 'ECONNREFUSED'
              ? 'Conexão recusada pela API TOTVS. O servidor pode estar offline.'
              : `Não foi possível conectar à API TOTVS (${error.code || 'Erro desconhecido'})`;

        return errorResponse(res, errorMessage, 503, 'TOTVS_CONNECTION_ERROR');
      }

      throw new Error(`Erro ao chamar API TOTVS: ${error.message}`);
    }
  }),
);

/**
 * @route POST /totvs/legal-entity/search
 * @desc Busca dados de pessoa jurídica (cliente) na API TOTVS Moda
 * @access Public
 * @docs https://www30.bhan.com.br:9443/api/totvsmoda/person/v2/swagger/index.html
 * @example POST ${API_BASE_URL}/api/totvs/legal-entity/search
 * @body {
 *   personCode: number (código da pessoa - obrigatório)
 * }
 */
router.post(
  '/legal-entity/search',
  asyncHandler(async (req, res) => {
    const { personCode } = req.body;

    // Validação do personCode
    if (personCode === undefined || personCode === null || personCode === '') {
      return errorResponse(
        res,
        'O campo personCode é obrigatório',
        400,
        'MISSING_PERSON_CODE',
      );
    }

    // Converter para número se vier como string
    const personCodeNum =
      typeof personCode === 'string' ? parseInt(personCode, 10) : personCode;

    if (isNaN(personCodeNum) || personCodeNum < 0) {
      return errorResponse(
        res,
        'O campo personCode deve ser um número inteiro válido',
        400,
        'INVALID_PERSON_CODE',
      );
    }

    try {
      // Obter token atual (ou gerar novo se necessário)
      const tokenData = await getToken();

      if (!tokenData || !tokenData.access_token) {
        return errorResponse(
          res,
          'Não foi possível obter token de autenticação TOTVS',
          503,
          'TOKEN_UNAVAILABLE',
        );
      }

      // Preparar o payload para busca por código da pessoa
      const payload = {
        filter: {
          personCodeList: [personCodeNum],
        },
        page: 1,
        pageSize: 10,
      };

      const endpoint = `${TOTVS_BASE_URL}/person/v2/legal-entities/search`;

      console.log('🔍 Consultando pessoa jurídica na API TOTVS:', {
        endpoint,
        personCode: personCodeNum,
      });

      const doRequest = async (accessToken) =>
        axios.post(endpoint, payload, {
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          timeout: 30000,
        });

      let response;
      try {
        response = await doRequest(tokenData.access_token);
      } catch (error) {
        if (error.response?.status === 401) {
          console.log('🔄 Token inválido. Renovando token...');
          const newTokenData = await getToken(true);
          response = await doRequest(newTokenData.access_token);
        } else {
          throw error;
        }
      }

      console.log('✅ Dados da pessoa jurídica obtidos com sucesso');

      successResponse(
        res,
        response.data,
        'Dados da pessoa jurídica obtidos com sucesso',
      );
    } catch (error) {
      console.error('❌ Erro ao consultar pessoa jurídica na API TOTVS:', {
        message: error.message,
        code: error.code,
        response: error.response?.data,
        status: error.response?.status,
      });

      if (error.response) {
        let errorMessage = 'Erro ao consultar pessoa jurídica na API TOTVS';

        if (error.response.data) {
          if (typeof error.response.data === 'string') {
            errorMessage = error.response.data || errorMessage;
          } else if (typeof error.response.data === 'object') {
            errorMessage =
              error.response.data?.message ||
              error.response.data?.error ||
              error.response.data?.error_description ||
              error.response.data?.title ||
              (error.response.status === 404
                ? 'Pessoa jurídica não encontrada'
                : errorMessage);
          }
        } else if (error.response.status === 404) {
          errorMessage = 'Pessoa jurídica não encontrada';
        }

        return res.status(error.response.status || 400).json({
          success: false,
          message: errorMessage,
          error: 'TOTVS_API_ERROR',
          timestamp: new Date().toISOString(),
          details: error.response.data || null,
          status: error.response.status,
          payload: { personCode: personCodeNum },
        });
      } else if (error.request) {
        const errorMessage =
          error.code === 'ENOTFOUND'
            ? 'URL da API TOTVS não encontrada. Verifique se a URL está correta.'
            : error.code === 'ECONNREFUSED'
              ? 'Conexão recusada pela API TOTVS. O servidor pode estar offline.'
              : `Não foi possível conectar à API TOTVS (${error.code || 'Erro desconhecido'})`;

        return errorResponse(res, errorMessage, 503, 'TOTVS_CONNECTION_ERROR');
      }

      throw new Error(`Erro ao chamar API TOTVS: ${error.message}`);
    }
  }),
);

/**
 * @route POST /totvs/legal-entity/search-by-name
 * @desc Busca pessoa jurídica por nome fantasia na API TOTVS
 * @access Public
 * @body {
 *   fantasyName: string (obrigatório) - Nome fantasia para buscar
 *   page: number (opcional) - Página para buscar (default: 1)
 *   pageSize: number (opcional) - Tamanho da página (default: 100)
 * }
 */
router.post(
  '/legal-entity/search-by-name',
  asyncHandler(async (req, res) => {
    const { fantasyName, maxPages = 50 } = req.body;

    if (!fantasyName || fantasyName.trim().length < 2) {
      return errorResponse(
        res,
        'O campo fantasyName é obrigatório e deve ter pelo menos 2 caracteres',
        400,
        'MISSING_FANTASY_NAME',
      );
    }

    const searchTerm = fantasyName.trim().toUpperCase();

    try {
      // Obter token
      const tokenData = await getToken();

      const endpoint = `${TOTVS_BASE_URL}/person/v2/legal-entities/search`;

      console.log('🔍 Buscando clientes por nome fantasia na API TOTVS:', {
        endpoint,
        searchTerm,
        maxPages,
      });

      const doRequest = async (accessToken, page) => {
        const payload = {
          filter: {},
          expand:
            'phones,emails,addresses,contacts,classifications,observations',
          page: page,
          pageSize: 100, // Limite da API TOTVS
          order: 'name',
        };

        return axios.post(endpoint, payload, {
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          timeout: 60000,
        });
      };

      // Buscar múltiplas páginas até encontrar resultados ou atingir limite
      let allItems = [];
      let currentPage = 1;
      let hasMore = true;
      let token = tokenData.access_token;

      while (hasMore && currentPage <= maxPages) {
        let response;
        try {
          response = await doRequest(token, currentPage);
        } catch (error) {
          if (error.response?.status === 401) {
            console.log('🔄 Token inválido. Renovando token...');
            const newTokenData = await getToken(true);
            token = newTokenData.access_token;
            response = await doRequest(token, currentPage);
          } else {
            throw error;
          }
        }

        const pageItems = response.data?.items || [];
        allItems = allItems.concat(pageItems);
        hasMore = response.data?.hasNext || false;

        console.log(
          `📄 Página ${currentPage}: ${pageItems.length} itens (total: ${allItems.length})`,
        );

        currentPage++;
      }

      // Filtrar resultados pelo nome fantasia localmente
      const filteredItems = allItems.filter((item) => {
        const itemFantasyName = (item.fantasyName || '').toUpperCase();
        const itemName = (item.name || '').toUpperCase();
        return (
          itemFantasyName.includes(searchTerm) || itemName.includes(searchTerm)
        );
      });

      console.log(
        `✅ Busca concluída: ${filteredItems.length} de ${allItems.length} clientes encontrados em ${currentPage - 1} páginas`,
      );

      successResponse(
        res,
        {
          items: filteredItems,
          totalFiltered: filteredItems.length,
          totalFetched: allItems.length,
          pagesSearched: currentPage - 1,
          hasMore: hasMore,
        },
        `${filteredItems.length} cliente(s) encontrado(s)`,
      );
    } catch (error) {
      console.error('❌ Erro ao buscar clientes por nome na API TOTVS:', {
        message: error.message,
        code: error.code,
        response: error.response?.data,
        status: error.response?.status,
      });

      if (error.response) {
        let errorMessage = 'Erro ao buscar clientes na API TOTVS';

        if (error.response.data) {
          if (typeof error.response.data === 'string') {
            errorMessage = error.response.data || errorMessage;
          } else if (typeof error.response.data === 'object') {
            errorMessage =
              error.response.data?.message ||
              error.response.data?.error ||
              error.response.data?.error_description ||
              error.response.data?.title ||
              errorMessage;
          }
        }

        return res.status(error.response.status || 400).json({
          success: false,
          message: errorMessage,
          error: 'TOTVS_API_ERROR',
          timestamp: new Date().toISOString(),
          details: error.response.data || null,
          status: error.response.status,
        });
      } else if (error.request) {
        const errorMessage =
          error.code === 'ENOTFOUND'
            ? 'URL da API TOTVS não encontrada.'
            : error.code === 'ECONNREFUSED'
              ? 'Conexão recusada pela API TOTVS.'
              : `Não foi possível conectar à API TOTVS (${error.code || 'Erro desconhecido'})`;

        return errorResponse(res, errorMessage, 503, 'TOTVS_CONNECTION_ERROR');
      }

      throw new Error(`Erro ao chamar API TOTVS: ${error.message}`);
    }
  }),
);

/**
 * @route POST /totvs/legal-entity/search-by-phone
 * @desc Busca pessoa jurídica por número de telefone na API TOTVS
 *       A API TOTVS PJ não suporta filtro direto por telefone,
 *       então esta rota percorre as páginas e filtra localmente.
 * @access Public
 * @body {
 *   phoneNumber: string (obrigatório) - Número de telefone (apenas números, mín. 8 dígitos)
 *   maxPages: number (opcional) - Máximo de páginas a percorrer (default: 30)
 * }
 */
router.post(
  '/legal-entity/search-by-phone',
  asyncHandler(async (req, res) => {
    const { phoneNumber, maxPages = 30 } = req.body;

    if (!phoneNumber || phoneNumber.trim().length < 8) {
      return errorResponse(
        res,
        'O campo phoneNumber é obrigatório e deve ter pelo menos 8 dígitos',
        400,
        'MISSING_PHONE_NUMBER',
      );
    }

    // Remover caracteres não numéricos
    const cleanPhone = phoneNumber.replace(/\D/g, '');

    if (cleanPhone.length < 8) {
      return errorResponse(
        res,
        'O número de telefone deve ter pelo menos 8 dígitos numéricos',
        400,
        'INVALID_PHONE_NUMBER',
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

      const endpoint = `${TOTVS_BASE_URL}/person/v2/legal-entities/search`;

      console.log('🔍 Buscando pessoa jurídica por telefone na API TOTVS:', {
        endpoint,
        phoneNumber: cleanPhone,
        maxPages,
      });

      const doRequest = async (accessToken, page) => {
        const payload = {
          filter: {
            isCustomer: true,
          },
          expand:
            'phones,emails,addresses,contacts,classifications,observations',
          page: page,
          pageSize: 500,
          order: 'personCode',
        };

        return axios.post(endpoint, payload, {
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          timeout: 60000,
        });
      };

      let allMatches = [];
      let currentPage = 1;
      let hasMore = true;
      let token = tokenData.access_token;
      let totalFetched = 0;

      while (hasMore && currentPage <= maxPages) {
        let response;
        try {
          response = await doRequest(token, currentPage);
        } catch (error) {
          if (error.response?.status === 401) {
            console.log('🔄 Token inválido. Renovando token...');
            const newTokenData = await getToken(true);
            token = newTokenData.access_token;
            response = await doRequest(token, currentPage);
          } else {
            throw error;
          }
        }

        const pageItems = response.data?.items || [];
        totalFetched += pageItems.length;
        hasMore = response.data?.hasNext || false;

        // Filtrar por telefone localmente
        const matches = pageItems.filter((item) => {
          if (!item.phones || !Array.isArray(item.phones)) return false;
          return item.phones.some((phone) => {
            const num = (phone.number || '').replace(/\D/g, '');
            return num.includes(cleanPhone) || cleanPhone.includes(num);
          });
        });

        if (matches.length > 0) {
          allMatches = allMatches.concat(matches);
        }

        console.log(
          `📄 PJ Página ${currentPage}: ${pageItems.length} itens, ${matches.length} match(es) (total matches: ${allMatches.length})`,
        );

        currentPage++;
      }

      console.log(
        `✅ Busca PJ por telefone concluída: ${allMatches.length} de ${totalFetched} em ${currentPage - 1} páginas`,
      );

      successResponse(
        res,
        {
          items: allMatches,
          totalFiltered: allMatches.length,
          totalFetched: totalFetched,
          pagesSearched: currentPage - 1,
          hasMore: hasMore,
        },
        `${allMatches.length} pessoa(s) jurídica(s) encontrada(s) com o telefone informado`,
      );
    } catch (error) {
      console.error(
        '❌ Erro ao buscar pessoa jurídica por telefone na API TOTVS:',
        {
          message: error.message,
          code: error.code,
          response: error.response?.data,
          status: error.response?.status,
        },
      );

      if (error.response) {
        let errorMessage =
          'Erro ao buscar pessoa jurídica por telefone na API TOTVS';

        if (error.response.data) {
          if (typeof error.response.data === 'string') {
            errorMessage = error.response.data || errorMessage;
          } else if (typeof error.response.data === 'object') {
            errorMessage =
              error.response.data?.message ||
              error.response.data?.error ||
              error.response.data?.error_description ||
              error.response.data?.title ||
              errorMessage;
          }
        }

        return res.status(error.response.status || 400).json({
          success: false,
          message: errorMessage,
          error: 'TOTVS_API_ERROR',
          timestamp: new Date().toISOString(),
          details: error.response.data || null,
          status: error.response.status,
        });
      } else if (error.request) {
        const errorMessage =
          error.code === 'ENOTFOUND'
            ? 'URL da API TOTVS não encontrada.'
            : error.code === 'ECONNREFUSED'
              ? 'Conexão recusada pela API TOTVS.'
              : `Não foi possível conectar à API TOTVS (${error.code || 'Erro desconhecido'})`;

        return errorResponse(res, errorMessage, 503, 'TOTVS_CONNECTION_ERROR');
      }

      throw new Error(`Erro ao chamar API TOTVS: ${error.message}`);
    }
  }),
);

/**
 * @route POST /totvs/individual/search
 * @desc Busca dados de pessoa física (PF) na API TOTVS Moda
 * @access Public
 * @body {
 *   personCode: number (código da pessoa - obrigatório)
 * }
 */
router.post(
  '/individual/search',
  asyncHandler(async (req, res) => {
    const { personCode } = req.body;

    // Validação do personCode
    if (personCode === undefined || personCode === null || personCode === '') {
      return errorResponse(
        res,
        'O campo personCode é obrigatório',
        400,
        'MISSING_PERSON_CODE',
      );
    }

    // Converter para número se vier como string
    const personCodeNum =
      typeof personCode === 'string' ? parseInt(personCode, 10) : personCode;

    if (isNaN(personCodeNum) || personCodeNum < 0) {
      return errorResponse(
        res,
        'O campo personCode deve ser um número inteiro válido',
        400,
        'INVALID_PERSON_CODE',
      );
    }

    try {
      // Obter token atual (ou gerar novo se necessário)
      const tokenData = await getToken();

      if (!tokenData || !tokenData.access_token) {
        return errorResponse(
          res,
          'Não foi possível obter token de autenticação TOTVS',
          503,
          'TOKEN_UNAVAILABLE',
        );
      }

      // Preparar o payload para busca por código da pessoa
      const payload = {
        filter: {
          personCodeList: [personCodeNum],
        },
        page: 1,
        pageSize: 10,
      };

      const endpoint = `${TOTVS_BASE_URL}/person/v2/individuals/search`;

      console.log('🔍 Consultando pessoa física na API TOTVS:', {
        endpoint,
        personCode: personCodeNum,
      });

      const doRequest = async (accessToken) =>
        axios.post(endpoint, payload, {
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          timeout: 30000,
        });

      let response;
      try {
        response = await doRequest(tokenData.access_token);
      } catch (error) {
        if (error.response?.status === 401) {
          console.log('🔄 Token inválido. Renovando token...');
          const newTokenData = await getToken(true);
          response = await doRequest(newTokenData.access_token);
        } else {
          throw error;
        }
      }

      console.log('✅ Dados da pessoa física obtidos com sucesso');

      successResponse(
        res,
        response.data,
        'Dados da pessoa física obtidos com sucesso',
      );
    } catch (error) {
      console.error('❌ Erro ao consultar pessoa física na API TOTVS:', {
        message: error.message,
        code: error.code,
        response: error.response?.data,
        status: error.response?.status,
      });

      if (error.response) {
        let errorMessage = 'Erro ao consultar pessoa física na API TOTVS';

        if (error.response.data) {
          if (typeof error.response.data === 'string') {
            errorMessage = error.response.data || errorMessage;
          } else if (typeof error.response.data === 'object') {
            errorMessage =
              error.response.data?.message ||
              error.response.data?.error ||
              error.response.data?.error_description ||
              error.response.data?.title ||
              (error.response.status === 404
                ? 'Pessoa física não encontrada'
                : errorMessage);
          }
        } else if (error.response.status === 404) {
          errorMessage = 'Pessoa física não encontrada';
        }

        return res.status(error.response.status || 400).json({
          success: false,
          message: errorMessage,
          error: 'TOTVS_API_ERROR',
          timestamp: new Date().toISOString(),
          details: error.response.data || null,
          status: error.response.status,
          payload: { personCode: personCodeNum },
        });
      } else if (error.request) {
        const errorMessage =
          error.code === 'ENOTFOUND'
            ? 'URL da API TOTVS não encontrada. Verifique se a URL está correta.'
            : error.code === 'ECONNREFUSED'
              ? 'Conexão recusada pela API TOTVS. O servidor pode estar offline.'
              : `Não foi possível conectar à API TOTVS (${error.code || 'Erro desconhecido'})`;

        return errorResponse(res, errorMessage, 503, 'TOTVS_CONNECTION_ERROR');
      }

      throw new Error(`Erro ao chamar API TOTVS: ${error.message}`);
    }
  }),
);

/**
 * @route POST /totvs/individual/search-by-name
 * @desc Busca pessoa física por nome na API TOTVS
 * @access Public
 * @body {
 *   name: string (obrigatório) - Nome para buscar
 *   maxPages: number (opcional) - Máximo de páginas (default: 50)
 * }
 */
router.post(
  '/individual/search-by-name',
  asyncHandler(async (req, res) => {
    const { name, maxPages = 50 } = req.body;

    if (!name || name.trim().length < 2) {
      return errorResponse(
        res,
        'O campo name é obrigatório e deve ter pelo menos 2 caracteres',
        400,
        'MISSING_NAME',
      );
    }

    const searchTerm = name.trim().toUpperCase();

    try {
      // Obter token
      const tokenData = await getToken();

      const endpoint = `${TOTVS_BASE_URL}/person/v2/individuals/search`;

      console.log('🔍 Buscando pessoas físicas por nome na API TOTVS:', {
        endpoint,
        searchTerm,
        maxPages,
      });

      const doRequest = async (accessToken, page) => {
        const payload = {
          filter: {},
          expand:
            'phones,emails,addresses,contacts,classifications,observations',
          page: page,
          pageSize: 100, // Limite da API TOTVS
          order: 'name',
        };

        return axios.post(endpoint, payload, {
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          timeout: 60000,
        });
      };

      // Buscar múltiplas páginas até encontrar resultados ou atingir limite
      let allItems = [];
      let currentPage = 1;
      let hasMore = true;
      let token = tokenData.access_token;

      while (hasMore && currentPage <= maxPages) {
        let response;
        try {
          response = await doRequest(token, currentPage);
        } catch (error) {
          if (error.response?.status === 401) {
            console.log('🔄 Token inválido. Renovando token...');
            const newTokenData = await getToken(true);
            token = newTokenData.access_token;
            response = await doRequest(token, currentPage);
          } else {
            throw error;
          }
        }

        const pageItems = response.data?.items || [];
        allItems = allItems.concat(pageItems);
        hasMore = response.data?.hasNext || false;

        console.log(
          `📄 Página ${currentPage}: ${pageItems.length} itens (total: ${allItems.length})`,
        );

        currentPage++;
      }

      // Filtrar resultados pelo nome localmente
      const filteredItems = allItems.filter((item) => {
        const itemName = (item.name || '').toUpperCase();
        const itemNickname = (item.nickname || '').toUpperCase();
        return (
          itemName.includes(searchTerm) || itemNickname.includes(searchTerm)
        );
      });

      console.log(
        `✅ Busca concluída: ${filteredItems.length} de ${allItems.length} pessoas encontradas em ${currentPage - 1} páginas`,
      );

      successResponse(
        res,
        {
          items: filteredItems,
          totalFiltered: filteredItems.length,
          totalFetched: allItems.length,
          pagesSearched: currentPage - 1,
          hasMore: hasMore,
        },
        `${filteredItems.length} pessoa(s) encontrada(s)`,
      );
    } catch (error) {
      console.error(
        '❌ Erro ao buscar pessoas físicas por nome na API TOTVS:',
        {
          message: error.message,
          code: error.code,
          response: error.response?.data,
          status: error.response?.status,
        },
      );

      if (error.response) {
        let errorMessage = 'Erro ao buscar pessoas físicas na API TOTVS';

        if (error.response.data) {
          if (typeof error.response.data === 'string') {
            errorMessage = error.response.data || errorMessage;
          } else if (typeof error.response.data === 'object') {
            errorMessage =
              error.response.data?.message ||
              error.response.data?.error ||
              error.response.data?.error_description ||
              error.response.data?.title ||
              errorMessage;
          }
        }

        return res.status(error.response.status || 400).json({
          success: false,
          message: errorMessage,
          error: 'TOTVS_API_ERROR',
          timestamp: new Date().toISOString(),
          details: error.response.data || null,
          status: error.response.status,
        });
      } else if (error.request) {
        const errorMessage =
          error.code === 'ENOTFOUND'
            ? 'URL da API TOTVS não encontrada.'
            : error.code === 'ECONNREFUSED'
              ? 'Conexão recusada pela API TOTVS.'
              : `Não foi possível conectar à API TOTVS (${error.code || 'Erro desconhecido'})`;

        return errorResponse(res, errorMessage, 503, 'TOTVS_CONNECTION_ERROR');
      }

      throw new Error(`Erro ao chamar API TOTVS: ${error.message}`);
    }
  }),
);

/**
 * @route POST /totvs/individual/search-by-phone
 * @desc Busca pessoa física por número de telefone na API TOTVS
 * @access Public
 * @body {
 *   phoneNumber: string (obrigatório) - Número de telefone (apenas números, mín. 8 dígitos)
 * }
 */
router.post(
  '/individual/search-by-phone',
  asyncHandler(async (req, res) => {
    const { phoneNumber } = req.body;

    if (!phoneNumber || phoneNumber.trim().length < 8) {
      return errorResponse(
        res,
        'O campo phoneNumber é obrigatório e deve ter pelo menos 8 dígitos',
        400,
        'MISSING_PHONE_NUMBER',
      );
    }

    // Remover caracteres não numéricos
    const cleanPhone = phoneNumber.replace(/\D/g, '');

    if (cleanPhone.length < 8) {
      return errorResponse(
        res,
        'O número de telefone deve ter pelo menos 8 dígitos numéricos',
        400,
        'INVALID_PHONE_NUMBER',
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

      const payload = {
        filter: {
          phoneNumber: cleanPhone,
          isCustomer: true,
        },
        expand: 'phones,emails,addresses,classifications,observations',
        page: 1,
        pageSize: 500,
      };

      const endpoint = `${TOTVS_BASE_URL}/person/v2/individuals/search`;

      console.log('🔍 Buscando pessoa física por telefone na API TOTVS:', {
        endpoint,
        phoneNumber: cleanPhone,
      });

      const doRequest = async (accessToken) =>
        axios.post(endpoint, payload, {
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          timeout: 30000,
        });

      let response;
      try {
        response = await doRequest(tokenData.access_token);
      } catch (error) {
        if (error.response?.status === 401) {
          console.log('🔄 Token inválido. Renovando token...');
          const newTokenData = await getToken(true);
          response = await doRequest(newTokenData.access_token);
        } else {
          throw error;
        }
      }

      const items = response.data?.items || [];
      console.log(
        `✅ Busca por telefone concluída: ${items.length} pessoa(s) encontrada(s)`,
      );

      successResponse(
        res,
        response.data,
        `${items.length} pessoa(s) encontrada(s) com o telefone informado`,
      );
    } catch (error) {
      console.error(
        '❌ Erro ao buscar pessoa física por telefone na API TOTVS:',
        {
          message: error.message,
          code: error.code,
          response: error.response?.data,
          status: error.response?.status,
        },
      );

      if (error.response) {
        let errorMessage =
          'Erro ao buscar pessoa física por telefone na API TOTVS';

        if (error.response.data) {
          if (typeof error.response.data === 'string') {
            errorMessage = error.response.data || errorMessage;
          } else if (typeof error.response.data === 'object') {
            errorMessage =
              error.response.data?.message ||
              error.response.data?.error ||
              error.response.data?.error_description ||
              error.response.data?.title ||
              errorMessage;
          }
        }

        return res.status(error.response.status || 400).json({
          success: false,
          message: errorMessage,
          error: 'TOTVS_API_ERROR',
          timestamp: new Date().toISOString(),
          details: error.response.data || null,
          status: error.response.status,
        });
      } else if (error.request) {
        const errorMessage =
          error.code === 'ENOTFOUND'
            ? 'URL da API TOTVS não encontrada.'
            : error.code === 'ECONNREFUSED'
              ? 'Conexão recusada pela API TOTVS.'
              : `Não foi possível conectar à API TOTVS (${error.code || 'Erro desconhecido'})`;

        return errorResponse(res, errorMessage, 503, 'TOTVS_CONNECTION_ERROR');
      }

      throw new Error(`Erro ao chamar API TOTVS: ${error.message}`);
    }
  }),
);

/**
 * @route GET /totvs/branches
 * @desc Busca lista de empresas/filiais da API TOTVS
 * @access Public
 * @example GET ${API_BASE_URL}/api/totvs/branches
 * @query {
 *   branchCodePool: number (opcional - código empresa base para filtro),
 *   page: number (opcional - página inicial é 1),
 *   pageSize: number (opcional - máximo 1000)
 * }
 */
router.get(
  '/branches',
  asyncHandler(async (req, res) => {
    const { branchCodePool, page, pageSize } = req.query;

    // Obter token de autenticação
    const tokenData = await getToken();
    const accessToken = tokenData.access_token;

    if (!accessToken) {
      return errorResponse(
        res,
        'Não foi possível obter token de autenticação TOTVS',
        500,
        'TOKEN_ERROR',
      );
    }

    // Construir query params
    const params = new URLSearchParams();

    if (branchCodePool) {
      params.append('BranchCodePool', branchCodePool);
    } else {
      // Default: usar empresa 1 como pool base
      params.append('BranchCodePool', '1');
    }

    params.append('Page', page || '1');
    params.append('PageSize', pageSize || '1000');

    const url = `${TOTVS_BASE_URL}/person/v2/branchesList?${params.toString()}`;

    console.log('🏢 Buscando empresas TOTVS:', url);

    try {
      // Buscar todas as páginas
      let allBranches = [];
      let currentPage = parseInt(page) || 1;
      let hasNext = true;

      while (hasNext) {
        const pageParams = new URLSearchParams();
        if (branchCodePool) {
          pageParams.append('BranchCodePool', branchCodePool);
        } else {
          pageParams.append('BranchCodePool', '1');
        }
        pageParams.append('Page', currentPage.toString());
        pageParams.append('PageSize', '1000');

        const pageUrl = `${TOTVS_BASE_URL}/person/v2/branchesList?${pageParams.toString()}`;

        const response = await axios.get(pageUrl, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
          },
          timeout: 60000,
        });

        const data = response.data;

        if (data.items && Array.isArray(data.items)) {
          allBranches = allBranches.concat(data.items);
        }

        hasNext = data.hasNext || false;
        currentPage++;

        // Limite de segurança para evitar loop infinito
        if (currentPage > 50) {
          console.log('⚠️ Limite de páginas atingido (50)');
          break;
        }
      }

      console.log(`✅ Total de empresas encontradas: ${allBranches.length}`);

      // Mapear para formato compatível com FiltroEmpresa
      const empresas = allBranches.map((branch) => ({
        cd_empresa: String(branch.code),
        nm_grupoempresa:
          branch.branchGroupName ||
          branch.fantasyName ||
          branch.description ||
          `Empresa ${branch.code}`,
        cnpj: branch.cnpj,
        personCode: branch.personCode,
        personName: branch.personName,
        fantasyName: branch.fantasyName,
        description: branch.description,
      }));

      // Ordenar por código
      empresas.sort((a, b) => parseInt(a.cd_empresa) - parseInt(b.cd_empresa));

      return successResponse(
        res,
        {
          data: empresas,
          total: empresas.length,
        },
        `${empresas.length} empresas encontradas`,
      );
    } catch (error) {
      console.error('❌ Erro ao buscar empresas TOTVS:', {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status,
      });

      if (error.response) {
        let errorMessage = 'Erro ao buscar empresas na API TOTVS';

        if (error.response.data) {
          if (typeof error.response.data === 'string') {
            errorMessage = error.response.data || errorMessage;
          } else if (typeof error.response.data === 'object') {
            errorMessage =
              error.response.data?.message ||
              error.response.data?.error ||
              error.response.data?.error_description ||
              error.response.data?.title ||
              errorMessage;
          }
        }

        return res.status(error.response.status || 400).json({
          success: false,
          message: errorMessage,
          error: 'TOTVS_API_ERROR',
          timestamp: new Date().toISOString(),
          details: error.response.data || null,
          status: error.response.status,
        });
      } else if (error.request) {
        const errorMessage =
          error.code === 'ENOTFOUND'
            ? 'URL da API TOTVS não encontrada.'
            : error.code === 'ECONNREFUSED'
              ? 'Conexão recusada pela API TOTVS.'
              : `Não foi possível conectar à API TOTVS (${error.code || 'Erro desconhecido'})`;

        return errorResponse(res, errorMessage, 503, 'TOTVS_CONNECTION_ERROR');
      }

      throw new Error(`Erro ao chamar API TOTVS: ${error.message}`);
    }
  }),
);

/**
 * @route POST /totvs/accounts-receivable/search
 * @desc Busca documentos de contas a receber (faturas) na API TOTVS
 * @access Public
 * @example POST ${API_BASE_URL}/api/totvs/accounts-receivable/search
 * @body DocumentRequestModel conforme documentação TOTVS
 */
router.post(
  '/accounts-receivable/search',
  asyncHandler(async (req, res) => {
    try {
      // Obter token atual
      const tokenData = await getToken();

      if (!tokenData || !tokenData.access_token) {
        return errorResponse(
          res,
          'Não foi possível obter token de autenticação TOTVS',
          503,
          'TOKEN_UNAVAILABLE',
        );
      }

      // Montar payload com padrões e sobrepor com corpo recebido
      const defaultPayload = {
        filter: {},
        page: 1,
        pageSize: 100,
        expand: 'invoice,calculateValue',
      };

      const payload = {
        ...defaultPayload,
        ...req.body,
        filter: {
          ...defaultPayload.filter,
          ...(req.body?.filter || {}),
        },
      };

      const endpoint = `${TOTVS_BASE_URL}/accounts-receivable/v2/documents/search`;

      console.log('💰 Buscando contas a receber na API TOTVS:', {
        endpoint,
        page: payload.page,
        pageSize: payload.pageSize,
        filter: payload.filter,
      });

      const doRequest = async (accessToken) =>
        axios.post(endpoint, payload, {
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          timeout: 60000,
        });

      let response;
      try {
        response = await doRequest(tokenData.access_token);
      } catch (error) {
        if (error.response?.status === 401) {
          console.log('🔄 Token inválido. Renovando token...');
          const newTokenData = await getToken(true);
          response = await doRequest(newTokenData.access_token);
        } else {
          throw error;
        }
      }

      console.log(
        `✅ Contas a receber obtidas: ${response.data?.items?.length || 0} itens`,
      );

      successResponse(
        res,
        response.data,
        'Contas a receber obtidas com sucesso',
      );
    } catch (error) {
      console.error('❌ Erro ao buscar contas a receber na API TOTVS:', {
        message: error.message,
        code: error.code,
        response: error.response?.data,
        status: error.response?.status,
      });

      if (error.response) {
        let errorMessage = 'Erro ao buscar contas a receber na API TOTVS';

        if (error.response.data) {
          if (typeof error.response.data === 'string') {
            errorMessage = error.response.data || errorMessage;
          } else if (typeof error.response.data === 'object') {
            errorMessage =
              error.response.data?.message ||
              error.response.data?.error ||
              error.response.data?.error_description ||
              error.response.data?.title ||
              errorMessage;
          }
        }

        return res.status(error.response.status || 400).json({
          success: false,
          message: errorMessage,
          error: 'TOTVS_API_ERROR',
          timestamp: new Date().toISOString(),
          details: error.response.data || null,
          status: error.response.status,
        });
      } else if (error.request) {
        const errorMessage =
          error.code === 'ENOTFOUND'
            ? 'URL da API TOTVS não encontrada.'
            : error.code === 'ECONNREFUSED'
              ? 'Conexão recusada pela API TOTVS.'
              : `Não foi possível conectar à API TOTVS (${error.code || 'Erro desconhecido'})`;

        return errorResponse(res, errorMessage, 503, 'TOTVS_CONNECTION_ERROR');
      }

      throw new Error(`Erro ao chamar API TOTVS: ${error.message}`);
    }
  }),
);

/**
 * @route POST /totvs/accounts-receivable/search-all
 * @desc Busca TODAS as páginas de contas a receber (faturas) na API TOTVS
 * @access Public
 * @body DocumentRequestModel conforme documentação TOTVS (sem page/pageSize)
 */
router.post(
  '/accounts-receivable/search-all',
  asyncHandler(async (req, res) => {
    try {
      // Obter token atual
      const tokenData = await getToken();

      if (!tokenData || !tokenData.access_token) {
        return errorResponse(
          res,
          'Não foi possível obter token de autenticação TOTVS',
          503,
          'TOKEN_UNAVAILABLE',
        );
      }

      const endpoint = `${TOTVS_BASE_URL}/accounts-receivable/v2/documents/search`;
      let token = tokenData.access_token;

      console.log('💰 Buscando TODAS as contas a receber na API TOTVS:', {
        endpoint,
        filter: req.body?.filter,
      });

      const doRequest = async (accessToken, page) => {
        const payload = {
          filter: req.body?.filter || {},
          page: page,
          pageSize: 100, // Máximo permitido pela API
          expand: req.body?.expand || 'invoice,calculateValue',
          order: req.body?.order || '-expiredDate',
        };

        return axios.post(endpoint, payload, {
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          timeout: 60000,
        });
      };

      // Buscar todas as páginas
      let allItems = [];
      let currentPage = 1;
      let hasMore = true;
      const maxPages = req.body?.maxPages || 50; // Limite de segurança

      while (hasMore && currentPage <= maxPages) {
        let response;
        try {
          response = await doRequest(token, currentPage);
        } catch (error) {
          if (error.response?.status === 401) {
            console.log('🔄 Token inválido. Renovando token...');
            const newTokenData = await getToken(true);
            token = newTokenData.access_token;
            response = await doRequest(token, currentPage);
          } else {
            throw error;
          }
        }

        const pageItems = response.data?.items || [];
        allItems = allItems.concat(pageItems);
        hasMore = response.data?.hasNext || false;

        console.log(
          `📄 Página ${currentPage}: ${pageItems.length} itens (total: ${allItems.length})`,
        );

        currentPage++;
      }

      console.log(
        `✅ Busca concluída: ${allItems.length} faturas em ${currentPage - 1} páginas`,
      );

      successResponse(
        res,
        {
          items: allItems,
          totalItems: allItems.length,
          pagesSearched: currentPage - 1,
          hasMore: hasMore,
        },
        `${allItems.length} fatura(s) encontrada(s)`,
      );
    } catch (error) {
      console.error('❌ Erro ao buscar contas a receber na API TOTVS:', {
        message: error.message,
        code: error.code,
        response: error.response?.data,
        status: error.response?.status,
      });

      if (error.response) {
        let errorMessage = 'Erro ao buscar contas a receber na API TOTVS';

        if (error.response.data) {
          if (typeof error.response.data === 'string') {
            errorMessage = error.response.data || errorMessage;
          } else if (typeof error.response.data === 'object') {
            errorMessage =
              error.response.data?.message ||
              error.response.data?.error ||
              error.response.data?.error_description ||
              error.response.data?.title ||
              errorMessage;
          }
        }

        return res.status(error.response.status || 400).json({
          success: false,
          message: errorMessage,
          error: 'TOTVS_API_ERROR',
          timestamp: new Date().toISOString(),
          details: error.response.data || null,
          status: error.response.status,
        });
      } else if (error.request) {
        const errorMessage =
          error.code === 'ENOTFOUND'
            ? 'URL da API TOTVS não encontrada.'
            : error.code === 'ECONNREFUSED'
              ? 'Conexão recusada pela API TOTVS.'
              : `Não foi possível conectar à API TOTVS (${error.code || 'Erro desconhecido'})`;

        return errorResponse(res, errorMessage, 503, 'TOTVS_CONNECTION_ERROR');
      }

      throw new Error(`Erro ao chamar API TOTVS: ${error.message}`);
    }
  }),
);

// ==========================================
// ROTA OTIMIZADA PARA CONTAS A RECEBER V3
// Páginas buscadas em PARALELO (não sequencial)
// Lookup de nomes em batch (PJ+PF paralelo, com cache)
// BranchCodeList em cache de memória
// ==========================================

// Cache de branchCodes em memória (recarrega a cada 30 min)
let cachedBranchCodes = null;
let branchCacheTimestamp = 0;
const BRANCH_CACHE_TTL = 30 * 60 * 1000; // 30 minutos

async function getBranchCodes(token) {
  const now = Date.now();
  if (cachedBranchCodes && now - branchCacheTimestamp < BRANCH_CACHE_TTL) {
    return cachedBranchCodes;
  }
  try {
    const branchesUrl = `${TOTVS_BASE_URL}/person/v2/branchesList?BranchCodePool=1&Page=1&PageSize=1000`;
    const resp = await axios.get(branchesUrl, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      timeout: 10000,
    });
    if (resp.data?.items?.length > 0) {
      cachedBranchCodes = resp.data.items
        .map((b) => parseInt(b.code))
        .filter((c) => !isNaN(c) && c > 0);
      branchCacheTimestamp = now;
      return cachedBranchCodes;
    }
  } catch (err) {
    console.log('⚠️ Erro ao buscar branches, usando cache/fallback');
  }
  // Fallback se cache expirou e API falhou
  return (
    cachedBranchCodes || [
      1, 2, 5, 6, 11, 55, 65, 75, 85, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96,
      97, 98, 99, 100, 101, 870, 880, 890, 900, 910, 920, 930, 940, 950, 960,
      970, 980, 990,
    ]
  );
}

router.get(
  '/accounts-receivable/filter',
  asyncHandler(async (req, res) => {
    const startTime = Date.now();

    try {
      const {
        dt_inicio,
        dt_fim,
        modo, // 'vencimento' ou 'emissao'
        status, // 'Todos', 'Pago', 'Em Aberto', 'Vencido'
        cd_cliente,
        nr_fatura,
        cd_portador,
        tp_documento,
        tp_cobranca,
        tp_baixa,
        situacao, // statusList TOTVS: 1=Normal, 2=Devolvido, 3=Cancelado, 4=Quebrada
        branches, // branchCodes das empresas selecionadas pelo usuário
      } = req.query;

      if (!dt_inicio || !dt_fim) {
        return errorResponse(
          res,
          'Parâmetros dt_inicio e dt_fim são obrigatórios',
          400,
          'MISSING_PARAMS',
        );
      }

      const tokenData = await getToken();
      if (!tokenData?.access_token) {
        return errorResponse(
          res,
          'Token indisponível',
          503,
          'TOKEN_UNAVAILABLE',
        );
      }

      let token = tokenData.access_token;

      // Usar branches do frontend se enviadas, senão buscar todas do cache
      let branchCodeList;
      if (branches) {
        branchCodeList = branches
          .split(',')
          .map((b) => parseInt(b.trim()))
          .filter((b) => !isNaN(b) && b > 0);
      }
      if (!branchCodeList || branchCodeList.length === 0) {
        branchCodeList = await getBranchCodes(token);
      }

      // Montar filtro TOTVS
      const filter = { branchCodeList };

      // Filtro de situação (statusList)
      if (situacao) {
        filter.statusList = situacao
          .split(',')
          .map((s) => parseInt(s.trim()))
          .filter((s) => !isNaN(s));
      }
      // Se não informado, não filtra (retorna todas as situações)

      // Filtro de datas
      if (modo === 'emissao') {
        filter.startIssueDate = `${dt_inicio}T00:00:00`;
        filter.endIssueDate = `${dt_fim}T23:59:59`;
      } else if (modo === 'pagamento') {
        filter.startPaymentDate = `${dt_inicio}T00:00:00`;
        filter.endPaymentDate = `${dt_fim}T23:59:59`;
      } else {
        filter.startExpiredDate = `${dt_inicio}T00:00:00`;
        filter.endExpiredDate = `${dt_fim}T23:59:59`;
      }

      // Filtros opcionais da API
      if (cd_cliente) {
        const clientes = cd_cliente
          .split(',')
          .map((c) => parseInt(c.trim()))
          .filter((c) => !isNaN(c));
        if (clientes.length > 0) filter.customerCodeList = clientes;
      }
      if (nr_fatura) {
        const faturas = nr_fatura
          .split(',')
          .map((f) => parseFloat(f.trim()))
          .filter((f) => !isNaN(f));
        if (faturas.length > 0) filter.receivableCodeList = faturas;
      }
      if (tp_documento) {
        filter.documentTypeList = tp_documento
          .split(',')
          .map((d) => parseInt(d.trim()))
          .filter((d) => !isNaN(d));
      }
      if (tp_cobranca) {
        filter.chargeTypeList = tp_cobranca
          .split(',')
          .map((c) => parseInt(c.trim()))
          .filter((c) => !isNaN(c));
      }
      if (tp_baixa) {
        filter.dischargeTypeList = tp_baixa
          .split(',')
          .map((b) => parseInt(b.trim()))
          .filter((b) => !isNaN(b));
      }
      if (
        status === 'Em Aberto' ||
        status === 'Aberto' ||
        status === 'Vencido'
      ) {
        filter.hasOpenInvoices = true;
        filter.dischargeTypeList = [0];
      }

      const endpoint = `${TOTVS_BASE_URL}/accounts-receivable/v2/documents/search`;
      const PAGE_SIZE = 100;
      const PARALLEL_BATCH = 15; // 15 páginas em paralelo por vez

      console.log('🔍 Contas a Receber V3:', {
        modo,
        dt_inicio,
        dt_fim,
        status,
        branches_param: branches,
        branchCodeList_usado: branchCodeList,
        filtro_completo: JSON.stringify(filter),
      });

      const makeRequest = async (accessToken, pageNum) => {
        return axios.post(
          endpoint,
          {
            filter,
            page: pageNum,
            pageSize: PAGE_SIZE,
            order: modo === 'emissao' ? '-issueDate' : '-expiredDate',
          },
          {
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
              Authorization: `Bearer ${accessToken}`,
            },
            timeout: 30000,
          },
        );
      };

      // PASSO 1: Buscar página 1 para descobrir totalPages
      let firstResponse;
      try {
        firstResponse = await makeRequest(token, 1);
      } catch (error) {
        if (error.response?.status === 401) {
          const newTokenData = await getToken(true);
          token = newTokenData.access_token;
          firstResponse = await makeRequest(token, 1);
        } else {
          throw error;
        }
      }

      const totalPages = firstResponse.data?.totalPages || 1;
      const totalCount = firstResponse.data?.count || 0;
      let allItems = [...(firstResponse.data?.items || [])];

      console.log(
        `📄 Página 1/${totalPages} - Total: ${totalCount} registros (${Date.now() - startTime}ms)`,
      );

      // PASSO 2: Buscar páginas restantes em PARALELO (batches de PARALLEL_BATCH)
      if (totalPages > 1) {
        for (
          let batchStart = 2;
          batchStart <= totalPages;
          batchStart += PARALLEL_BATCH
        ) {
          const batchEnd = Math.min(
            batchStart + PARALLEL_BATCH - 1,
            totalPages,
          );
          const promises = [];

          for (let p = batchStart; p <= batchEnd; p++) {
            promises.push(
              makeRequest(token, p).catch((err) => {
                console.log(`⚠️ Erro página ${p}: ${err.message}`);
                return null; // Não quebrar o batch inteiro
              }),
            );
          }

          const results = await Promise.all(promises);
          for (const r of results) {
            if (r?.data?.items) {
              allItems = allItems.concat(r.data.items);
            }
          }

          console.log(
            `📄 Batch ${batchStart}-${batchEnd}/${totalPages}: acumulado ${allItems.length} (${Date.now() - startTime}ms)`,
          );
        }
      }

      console.log(
        `📊 ${allItems.length} itens buscados em ${Date.now() - startTime}ms`,
      );

      // PASSO 3: Filtros locais (status vencido/pago, situação e portador)
      let filteredItems = allItems;

      // Filtro local de situação (fallback - API TOTVS pode ignorar statusList em certas combinações)
      if (situacao) {
        const statusPermitidos = situacao
          .split(',')
          .map((s) => parseInt(s.trim()))
          .filter((s) => !isNaN(s));
        if (statusPermitidos.length > 0) {
          filteredItems = filteredItems.filter((item) =>
            statusPermitidos.includes(item.status),
          );
          console.log(
            `🔍 Filtro situação [${statusPermitidos}]: ${allItems.length} → ${filteredItems.length}`,
          );
        }
      }

      if (status === 'Pago') {
        // PAGO: precisa ter data de liquidação e valor pago acima de 0,01
        filteredItems = filteredItems.filter(
          (item) =>
            Boolean(item.paymentDate || item.settlementDate) &&
            Number(item.paidValue || 0) > 0.01,
        );
      } else if (status === 'Vencido') {
        // VENCIDO: antes de hoje e sem pagamento efetivo
        const hoje = new Date();
        hoje.setHours(0, 0, 0, 0);
        filteredItems = filteredItems.filter((item) => {
          const dataVenc = item.expiredDate ? new Date(item.expiredDate) : null;
          const temPagamento =
            Boolean(item.paymentDate || item.settlementDate) &&
            Number(item.paidValue || 0) > 0.01;
          return dataVenc && dataVenc < hoje && !temPagamento;
        });
      } else if (status === 'A Vencer') {
        // A VENCER: a partir de hoje e sem pagamento efetivo
        const hoje = new Date();
        hoje.setHours(0, 0, 0, 0);
        filteredItems = filteredItems.filter((item) => {
          const dataVenc = item.expiredDate ? new Date(item.expiredDate) : null;
          const temPagamento =
            Boolean(item.paymentDate || item.settlementDate) &&
            Number(item.paidValue || 0) > 0.01;
          return dataVenc && dataVenc >= hoje && !temPagamento;
        });
      } else if (status === 'Em Aberto') {
        // EM ABERTO: tudo que não tem pagamento efetivo (A Vencer + Vencido)
        filteredItems = filteredItems.filter((item) => {
          const temPagamento =
            Boolean(item.paymentDate || item.settlementDate) &&
            Number(item.paidValue || 0) > 0.01;
          return !temPagamento;
        });
      }

      if (cd_portador) {
        const portadores = cd_portador
          .split(',')
          .map((p) => parseInt(p.trim()))
          .filter((p) => !isNaN(p));
        if (portadores.length > 0) {
          filteredItems = filteredItems.filter((item) =>
            portadores.includes(item.bearerCode),
          );
        }
      }

      // Filtro local de cobrança (fallback - API TOTVS pode ignorar chargeTypeList)
      if (tp_cobranca) {
        const cobrancas = tp_cobranca
          .split(',')
          .map((c) => parseInt(c.trim()))
          .filter((c) => !isNaN(c));
        if (cobrancas.length > 0) {
          filteredItems = filteredItems.filter((item) =>
            cobrancas.includes(item.chargeType),
          );
        }
      }

      // Excluir chargeType 14 (Operadora de crédito) - interfere no relatório de cartão de crédito/débito
      filteredItems = filteredItems.filter((item) => item.chargeType !== 14);

      // Excluir documentType 11 (Desconto Financeiro) e 12 (DOFNI)
      filteredItems = filteredItems.filter(
        (item) => item.documentType !== 11 && item.documentType !== 12,
      );

      // PASSO 4: Mapear para formato frontend
      const mappedItems = filteredItems.map((item) => ({
        cd_empresa: item.branchCode,
        cd_cliente: item.customerCode,
        nm_cliente: item.customerCpfCnpj || `Cliente ${item.customerCode}`,
        nr_cpfcnpj: item.customerCpfCnpj,
        nr_fatura: item.receivableCode,
        nr_fat: item.receivableCode,
        nr_parcela: item.installmentCode,
        dt_vencimento: item.expiredDate,
        dt_liq: item.paymentDate || item.settlementDate,
        dt_emissao: item.issueDate,
        vl_fatura: item.installmentValue,
        vl_pago: item.paidValue || 0,
        vl_liquido: item.netValue,
        vl_desconto: item.discountValue,
        vl_abatimento: item.rebateValue,
        vl_juros: item.interestValue,
        vl_multa: item.assessmentValue,
        cd_barras: item.barCode,
        linha_digitavel: item.digitableLine,
        nosso_numero: item.ourNumber,
        qr_code_pix: item.qrCodePix,
        tp_situacao: item.status,
        tp_documento: item.documentType,
        tp_faturamento: item.billingType,
        tp_baixa: item.dischargeType,
        tp_cobranca: item.chargeType,
        cd_portador: item.bearerCode,
        nm_portador: item.bearerName,
      }));

      const totalTime = Date.now() - startTime;
      console.log(
        `✅ ${mappedItems.length} faturas em ${totalTime}ms (${totalPages} páginas paralelas)`,
      );

      successResponse(
        res,
        {
          items: mappedItems,
          totalItems: mappedItems.length,
          totalCount,
          pagesSearched: totalPages,
          hasMore: false,
          timeMs: totalTime,
        },
        `${mappedItems.length} fatura(s) encontrada(s) em ${totalTime}ms`,
      );
    } catch (error) {
      console.error('❌ Erro contas a receber:', error.message);

      if (error.response) {
        return res.status(error.response.status || 400).json({
          success: false,
          message: error.response.data?.message || 'Erro na API TOTVS',
          error: 'TOTVS_API_ERROR',
          details: error.response.data,
        });
      }

      return errorResponse(res, error.message, 500, 'INTERNAL_ERROR');
    }
  }),
);

router.get(
  '/accounts-receivable/pmr',
  asyncHandler(async (req, res) => {
    const startTime = Date.now();

    try {
      const {
        dt_inicio,
        dt_fim,
        modo = 'vencimento',
        status,
        cd_cliente,
        nr_fatura,
        cd_portador,
        tp_documento,
        tp_cobranca,
        tp_baixa,
        situacao,
        branches,
      } = req.query;

      if (!dt_inicio || !dt_fim) {
        return errorResponse(
          res,
          'Parâmetros dt_inicio e dt_fim são obrigatórios',
          400,
          'MISSING_PARAMS',
        );
      }

      const tokenData = await getToken();
      if (!tokenData?.access_token) {
        return errorResponse(
          res,
          'Token indisponível',
          503,
          'TOKEN_UNAVAILABLE',
        );
      }

      let token = tokenData.access_token;

      let branchCodeList;
      if (branches) {
        branchCodeList = branches
          .split(',')
          .map((branch) => parseInt(branch.trim(), 10))
          .filter((branch) => !Number.isNaN(branch) && branch > 0);
      }
      if (!branchCodeList || branchCodeList.length === 0) {
        branchCodeList = await getBranchCodes(token);
      }

      const filter = { branchCodeList };

      if (situacao) {
        filter.statusList = situacao
          .split(',')
          .map((value) => parseInt(value.trim(), 10))
          .filter((value) => !Number.isNaN(value));
      }

      if (modo === 'emissao') {
        filter.startIssueDate = `${dt_inicio}T00:00:00`;
        filter.endIssueDate = `${dt_fim}T23:59:59`;
      } else if (modo === 'pagamento') {
        filter.startPaymentDate = `${dt_inicio}T00:00:00`;
        filter.endPaymentDate = `${dt_fim}T23:59:59`;
      } else {
        filter.startExpiredDate = `${dt_inicio}T00:00:00`;
        filter.endExpiredDate = `${dt_fim}T23:59:59`;
      }

      if (cd_cliente) {
        const clientes = cd_cliente
          .split(',')
          .map((value) => parseInt(value.trim(), 10))
          .filter((value) => !Number.isNaN(value));
        if (clientes.length > 0) filter.customerCodeList = clientes;
      }
      if (nr_fatura) {
        const faturas = nr_fatura
          .split(',')
          .map((value) => parseFloat(value.trim()))
          .filter((value) => !Number.isNaN(value));
        if (faturas.length > 0) filter.receivableCodeList = faturas;
      }
      if (tp_documento) {
        filter.documentTypeList = tp_documento
          .split(',')
          .map((value) => parseInt(value.trim(), 10))
          .filter((value) => !Number.isNaN(value));
      }
      if (tp_cobranca) {
        filter.chargeTypeList = tp_cobranca
          .split(',')
          .map((value) => parseInt(value.trim(), 10))
          .filter((value) => !Number.isNaN(value));
      }
      if (tp_baixa) {
        filter.dischargeTypeList = tp_baixa
          .split(',')
          .map((value) => parseInt(value.trim(), 10))
          .filter((value) => !Number.isNaN(value));
      }
      if (
        status === 'Em Aberto' ||
        status === 'Aberto' ||
        status === 'Vencido'
      ) {
        filter.hasOpenInvoices = true;
        filter.dischargeTypeList = [0];
      }

      const endpoint = `${TOTVS_BASE_URL}/accounts-receivable/v2/documents/search`;
      const PAGE_SIZE = 100;
      const PARALLEL_BATCH = 15;

      console.log('📊 PMR contas a receber:', {
        modo,
        dt_inicio,
        dt_fim,
        branches_param: branches,
        branchCodeList_usado: branchCodeList,
        filtro_completo: JSON.stringify(filter),
      });

      const makeRequest = async (accessToken, pageNum) => {
        return axios.post(
          endpoint,
          {
            filter,
            page: pageNum,
            pageSize: PAGE_SIZE,
            order:
              modo === 'emissao'
                ? '-issueDate'
                : modo === 'pagamento'
                  ? '-paymentDate'
                  : '-expiredDate',
          },
          {
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
              Authorization: `Bearer ${accessToken}`,
            },
            timeout: 30000,
          },
        );
      };

      let firstResponse;
      try {
        firstResponse = await makeRequest(token, 1);
      } catch (error) {
        if (error.response?.status === 401) {
          const newTokenData = await getToken(true);
          token = newTokenData.access_token;
          firstResponse = await makeRequest(token, 1);
        } else {
          throw error;
        }
      }

      const totalPages = firstResponse.data?.totalPages || 1;
      const totalCount = firstResponse.data?.count || 0;
      let allItems = [...(firstResponse.data?.items || [])];

      console.log(
        `📄 PMR página 1/${totalPages} - Total: ${totalCount} registros (${Date.now() - startTime}ms)`,
      );

      if (totalPages > 1) {
        for (
          let batchStart = 2;
          batchStart <= totalPages;
          batchStart += PARALLEL_BATCH
        ) {
          const batchEnd = Math.min(
            batchStart + PARALLEL_BATCH - 1,
            totalPages,
          );
          const promises = [];

          for (let page = batchStart; page <= batchEnd; page++) {
            promises.push(
              makeRequest(token, page).catch((err) => {
                console.log(`⚠️ Erro PMR página ${page}: ${err.message}`);
                return null;
              }),
            );
          }

          const results = await Promise.all(promises);
          for (const result of results) {
            if (result?.data?.items) {
              allItems = allItems.concat(result.data.items);
            }
          }

          console.log(
            `📄 PMR batch ${batchStart}-${batchEnd}/${totalPages}: acumulado ${allItems.length} (${Date.now() - startTime}ms)`,
          );
        }
      }

      let filteredItems = allItems;

      if (situacao) {
        const statusPermitidos = situacao
          .split(',')
          .map((value) => parseInt(value.trim(), 10))
          .filter((value) => !Number.isNaN(value));
        if (statusPermitidos.length > 0) {
          filteredItems = filteredItems.filter((item) =>
            statusPermitidos.includes(item.status),
          );
        }
      }

      if (status === 'Pago') {
        filteredItems = filteredItems.filter(
          (item) =>
            Boolean(item.paymentDate || item.settlementDate) &&
            Number(item.paidValue || 0) > 0.01,
        );
      } else if (status === 'Vencido') {
        const hoje = new Date();
        hoje.setHours(0, 0, 0, 0);
        filteredItems = filteredItems.filter((item) => {
          const dataVenc = item.expiredDate ? new Date(item.expiredDate) : null;
          const temPagamento =
            Boolean(item.paymentDate || item.settlementDate) &&
            Number(item.paidValue || 0) > 0.01;
          return dataVenc && dataVenc < hoje && !temPagamento;
        });
      } else if (status === 'A Vencer') {
        const hoje = new Date();
        hoje.setHours(0, 0, 0, 0);
        filteredItems = filteredItems.filter((item) => {
          const dataVenc = item.expiredDate ? new Date(item.expiredDate) : null;
          const temPagamento =
            Boolean(item.paymentDate || item.settlementDate) &&
            Number(item.paidValue || 0) > 0.01;
          return dataVenc && dataVenc >= hoje && !temPagamento;
        });
      } else if (status === 'Em Aberto' || status === 'Aberto') {
        filteredItems = filteredItems.filter((item) => {
          const temPagamento =
            Boolean(item.paymentDate || item.settlementDate) &&
            Number(item.paidValue || 0) > 0.01;
          return !temPagamento;
        });
      }

      if (cd_portador) {
        const portadores = cd_portador
          .split(',')
          .map((value) => parseInt(value.trim(), 10))
          .filter((value) => !Number.isNaN(value));
        if (portadores.length > 0) {
          filteredItems = filteredItems.filter((item) =>
            portadores.includes(item.bearerCode),
          );
        }
      }

      if (tp_cobranca) {
        const cobrancas = tp_cobranca
          .split(',')
          .map((value) => parseInt(value.trim(), 10))
          .filter((value) => !Number.isNaN(value));
        if (cobrancas.length > 0) {
          filteredItems = filteredItems.filter((item) =>
            cobrancas.includes(item.chargeType),
          );
        }
      }

      filteredItems = filteredItems.filter((item) => item.chargeType !== 14);
      filteredItems = filteredItems.filter(
        (item) => item.documentType !== 11 && item.documentType !== 12,
      );

      const inicio = new Date(`${dt_inicio}T00:00:00`);
      const fim = new Date(`${dt_fim}T00:00:00`);
      const diasPeriodo = Math.max(
        1,
        Math.floor((fim - inicio) / (1000 * 60 * 60 * 24)) + 1,
      );

      const summary = {
        saldoContasReceber: 0,
        vendasPrazo: 0,
        vendasPrazoDia: 0,
        pmrDias: 0,
        quantidadeTitulosAbertos: 0,
        quantidadeFaturas: 0,
        diasPeriodo,
      };

      const byBranchMap = {};

      filteredItems.forEach((item) => {
        const branchCode = Number(item.branchCode || 0);
        const valorFatura = Number(item.installmentValue || 0);
        const valorPago = Number(item.paidValue || 0);
        const saldoAberto = Math.max(0, valorFatura - valorPago);

        if (!byBranchMap[branchCode]) {
          byBranchMap[branchCode] = {
            cd_empresa: branchCode,
            saldoContasReceber: 0,
            vendasPrazo: 0,
            vendasPrazoDia: 0,
            pmrDias: 0,
            quantidadeTitulosAbertos: 0,
            quantidadeFaturas: 0,
          };
        }

        if (saldoAberto > 0.01) {
          summary.saldoContasReceber += saldoAberto;
          summary.quantidadeTitulosAbertos += 1;
          byBranchMap[branchCode].saldoContasReceber += saldoAberto;
          byBranchMap[branchCode].quantidadeTitulosAbertos += 1;
        }

        if (Number(item.documentType) === 1 && valorFatura > 0) {
          summary.vendasPrazo += valorFatura;
          summary.quantidadeFaturas += 1;
          byBranchMap[branchCode].vendasPrazo += valorFatura;
          byBranchMap[branchCode].quantidadeFaturas += 1;
        }
      });

      summary.vendasPrazoDia =
        diasPeriodo > 0 ? summary.vendasPrazo / diasPeriodo : 0;
      summary.pmrDias =
        summary.vendasPrazoDia > 0
          ? summary.saldoContasReceber / summary.vendasPrazoDia
          : 0;

      const byBranch = Object.values(byBranchMap)
        .map((branch) => {
          const vendasPrazoDia =
            diasPeriodo > 0 ? branch.vendasPrazo / diasPeriodo : 0;
          return {
            ...branch,
            vendasPrazoDia,
            pmrDias:
              vendasPrazoDia > 0
                ? branch.saldoContasReceber / vendasPrazoDia
                : 0,
          };
        })
        .sort((a, b) => b.saldoContasReceber - a.saldoContasReceber);

      const totalTime = Date.now() - startTime;

      successResponse(
        res,
        {
          summary,
          byBranch,
          totalItems: filteredItems.length,
          totalCount,
          pagesSearched: totalPages,
          hasMore: false,
          timeMs: totalTime,
        },
        `PMR calculado com sucesso em ${totalTime}ms`,
      );
    } catch (error) {
      console.error('❌ Erro ao calcular PMR contas a receber:', error.message);

      if (error.response) {
        return res.status(error.response.status || 400).json({
          success: false,
          message: error.response.data?.message || 'Erro na API TOTVS',
          error: 'TOTVS_API_ERROR',
          details: error.response.data,
        });
      }

      return errorResponse(res, error.message, 500, 'INTERNAL_ERROR');
    }
  }),
);

/**
 * @route POST /totvs/persons/batch-lookup
 * @desc Busca dados de pessoas (PJ + PF) em lote via API TOTVS Moda
 *       Retorna nome, nome fantasia e telefone para cada código de pessoa
 * @body { personCodes: number[] }
 */
router.post(
  '/persons/batch-lookup',
  asyncHandler(async (req, res) => {
    const { personCodes } = req.body;

    if (!Array.isArray(personCodes) || personCodes.length === 0) {
      return errorResponse(
        res,
        'personCodes deve ser um array não vazio',
        400,
        'INVALID_INPUT',
      );
    }

    const startTime = Date.now();

    // Deduplica e converte para inteiro
    const uniqueCodes = [
      ...new Set(
        personCodes
          .map((c) => parseInt(c, 10))
          .filter((c) => !isNaN(c) && c > 0),
      ),
    ];
    console.log(`👥 Batch lookup: ${uniqueCodes.length} códigos únicos`);

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

      const result = {}; // { personCode: { name, fantasyName, phone, uf } }
      const BATCH_SIZE = 50;

      const doRequest = async (endpoint, payload, accessToken) =>
        axios.post(endpoint, payload, {
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          timeout: 30000,
        });

      // Processar em lotes de BATCH_SIZE
      for (let i = 0; i < uniqueCodes.length; i += BATCH_SIZE) {
        const batch = uniqueCodes.slice(i, i + BATCH_SIZE);
        const payload = {
          filter: { personCodeList: batch },
          expand: 'phones',
          page: 1,
          pageSize: batch.length,
        };

        // Buscar PJ e PF em paralelo para cada lote
        const [pjResult, pfResult] = await Promise.allSettled([
          (async () => {
            try {
              const resp = await doRequest(
                `${TOTVS_BASE_URL}/person/v2/legal-entities/search`,
                payload,
                tokenData.access_token,
              );
              return resp.data?.items || [];
            } catch (err) {
              if (err.response?.status === 401) {
                const newToken = await getToken(true);
                const resp = await doRequest(
                  `${TOTVS_BASE_URL}/person/v2/legal-entities/search`,
                  payload,
                  newToken.access_token,
                );
                return resp.data?.items || [];
              }
              console.warn(
                `⚠️ PJ batch ${i / BATCH_SIZE + 1} falhou:`,
                err.message,
              );
              return [];
            }
          })(),
          (async () => {
            try {
              const resp = await doRequest(
                `${TOTVS_BASE_URL}/person/v2/individuals/search`,
                payload,
                tokenData.access_token,
              );
              return resp.data?.items || [];
            } catch (err) {
              if (err.response?.status === 401) {
                const newToken = await getToken(true);
                const resp = await doRequest(
                  `${TOTVS_BASE_URL}/person/v2/individuals/search`,
                  payload,
                  newToken.access_token,
                );
                return resp.data?.items || [];
              }
              console.warn(
                `⚠️ PF batch ${i / BATCH_SIZE + 1} falhou:`,
                err.message,
              );
              return [];
            }
          })(),
        ]);

        // Extrair dados de PJ
        const pjItems = pjResult.status === 'fulfilled' ? pjResult.value : [];
        for (const item of pjItems) {
          const code = item.code;
          if (!code) continue;
          const defaultPhone =
            item.phones?.find((p) => p.isDefault) || item.phones?.[0];
          result[code] = {
            name: item.name || '',
            fantasyName: item.fantasyName || '',
            phone: defaultPhone?.number || '',
            uf: item.uf || '',
          };
        }

        // Extrair dados de PF
        const pfItems = pfResult.status === 'fulfilled' ? pfResult.value : [];
        for (const item of pfItems) {
          const code = item.code;
          if (!code || result[code]) continue; // PJ tem prioridade
          const defaultPhone =
            item.phones?.find((p) => p.isDefault) || item.phones?.[0];
          result[code] = {
            name: item.name || '',
            fantasyName: item.fantasyName || item.name || '',
            phone: defaultPhone?.number || '',
            uf: item.uf || '',
          };
        }

        console.log(
          `👤 Batch ${i / BATCH_SIZE + 1}: PJ=${pjItems.length}, PF=${pfItems.length}`,
        );
      }

      const totalTime = Date.now() - startTime;
      console.log(
        `✅ Batch lookup: ${Object.keys(result).length} pessoas encontradas em ${totalTime}ms`,
      );

      successResponse(
        res,
        result,
        `${Object.keys(result).length} pessoas encontradas em ${totalTime}ms`,
      );
    } catch (error) {
      console.error('❌ Erro batch lookup:', error.message);
      return errorResponse(res, error.message, 500, 'INTERNAL_ERROR');
    }
  }),
);

// ==========================================
// ROTA: BUSCAR CLIENTES FRANQUIA (por classificação)
// Cache em memória (recarrega a cada 60 min)
// Classificação FRANQUIA:
//   Tipo Cliente 2 / Classificação 1
//   OU Tipo Cliente 20 / Classificação 4
// ==========================================
let cachedFranchiseClients = null;
let franchiseCacheTimestamp = 0;
const FRANCHISE_CACHE_TTL = 60 * 60 * 1000; // 60 minutos

/**
 * @route GET /totvs/franchise-clients
 * @desc Retorna lista de códigos de clientes FRANQUIA (classificação TOTVS)
 * Classificações: type 2 codeList ["1"] OU type 20 codeList ["4"]
 */
router.get(
  '/franchise-clients',
  asyncHandler(async (req, res) => {
    const now = Date.now();
    const forceRefresh = req.query.refresh === 'true';

    // Retornar cache se válido
    if (
      !forceRefresh &&
      cachedFranchiseClients &&
      now - franchiseCacheTimestamp < FRANCHISE_CACHE_TTL
    ) {
      console.log(
        `📋 Franchise clients (cache): ${cachedFranchiseClients.length} clientes`,
      );
      return successResponse(
        res,
        cachedFranchiseClients,
        `${cachedFranchiseClients.length} franquias (cache)`,
      );
    }

    const startTime = Date.now();

    try {
      const tokenData = await getToken();
      if (!tokenData?.access_token) {
        return errorResponse(
          res,
          'Token indisponível',
          503,
          'TOKEN_UNAVAILABLE',
        );
      }

      let token = tokenData.access_token;
      const endpoint = `${TOTVS_BASE_URL}/person/v2/legal-entities/search`;

      // Buscar com filtro de classificação direto na API TOTVS
      // Duas classificações de franquia: type 2 code 1 e type 20 code 4
      const doRequest = async (
        accessToken,
        classificationType,
        codeList,
        page,
      ) => {
        const payload = {
          filter: {
            classifications: [
              {
                type: classificationType,
                codeList: codeList,
              },
            ],
          },
          page,
          pageSize: 100,
          order: 'code',
        };
        return axios.post(endpoint, payload, {
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          timeout: 60000,
        });
      };

      // Função para buscar TODAS as páginas de uma classificação
      const fetchAllPages = async (classificationType, codeList) => {
        let items = [];
        let currentPage = 1;
        let hasMore = true;
        const maxPages = 200;

        while (hasMore && currentPage <= maxPages) {
          let response;
          try {
            response = await doRequest(
              token,
              classificationType,
              codeList,
              currentPage,
            );
          } catch (error) {
            if (error.response?.status === 401) {
              const newTokenData = await getToken(true);
              token = newTokenData.access_token;
              response = await doRequest(
                token,
                classificationType,
                codeList,
                currentPage,
              );
            } else {
              throw error;
            }
          }

          const pageItems = response.data?.items || [];
          hasMore = response.data?.hasNext || false;

          items = items.concat(
            pageItems.map((item) => ({
              code: item.code,
              name: item.name || '',
              fantasyName: item.fantasyName || '',
              cnpj: item.cnpj || '',
            })),
          );

          if (currentPage % 10 === 0 || !hasMore) {
            console.log(
              `📄 Type ${classificationType} - Página ${currentPage}: ${pageItems.length} itens (total: ${items.length})`,
            );
          }

          currentPage++;
        }

        return items;
      };

      console.log(
        '🔍 Buscando clientes FRANQUIA na API TOTVS (filtro por classificação)...',
      );

      // Buscar as duas classificações em PARALELO
      const [franquiasTipo2, franquiasTipo20] = await Promise.all([
        fetchAllPages(2, ['1']),
        fetchAllPages(20, ['4']),
      ]);

      console.log(
        `📊 Tipo 2/Code 1: ${franquiasTipo2.length} | Tipo 20/Code 4: ${franquiasTipo20.length}`,
      );

      // Mesclar e deduplicar por code
      const codesSet = new Set();
      const allFranquias = [];

      [...franquiasTipo2, ...franquiasTipo20].forEach((item) => {
        if (!codesSet.has(item.code)) {
          codesSet.add(item.code);
          allFranquias.push(item);
        }
      });

      // Salvar no cache
      cachedFranchiseClients = allFranquias;
      franchiseCacheTimestamp = Date.now();

      const totalTime = Date.now() - startTime;
      console.log(
        `✅ ${allFranquias.length} franquias encontradas em ${totalTime}ms`,
      );

      successResponse(
        res,
        allFranquias,
        `${allFranquias.length} franquias encontradas em ${totalTime}ms`,
      );
    } catch (error) {
      console.error('❌ Erro ao buscar franquias:', error.message);
      return errorResponse(res, error.message, 500, 'INTERNAL_ERROR');
    }
  }),
);

/**
 * @route POST /totvs/franchise-financial-balance
 * @desc Busca saldo financeiro de clientes franquia na API TOTVS
 * @access Public
 * @body {
 *   customerCodeList: number[] (obrigatório),
 *   customerCpfCnpjList?: string[],
 *   branchCodeList?: number[],
 *   pageSize?: number
 * }
 */
router.post(
  '/franchise-financial-balance',
  asyncHandler(async (req, res) => {
    const {
      customerCodeList,
      customerCpfCnpjList = [],
      branchCodeList = [],
      pageSize = 200,
    } = req.body || {};

    if (!Array.isArray(customerCodeList) || customerCodeList.length === 0) {
      return errorResponse(
        res,
        'O campo customerCodeList é obrigatório e deve conter ao menos 1 cliente',
        400,
        'MISSING_CUSTOMER_CODE_LIST',
      );
    }

    const normalizedCodes = [
      ...new Set(
        customerCodeList
          .map((code) => parseInt(code, 10))
          .filter((code) => !Number.isNaN(code) && code > 0),
      ),
    ];

    if (normalizedCodes.length === 0) {
      return errorResponse(
        res,
        'Não há códigos de cliente válidos no customerCodeList',
        400,
        'INVALID_CUSTOMER_CODE_LIST',
      );
    }

    const normalizedBranchCodes = Array.isArray(branchCodeList)
      ? [
          ...new Set(
            branchCodeList
              .map((code) => parseInt(code, 10))
              .filter((code) => !Number.isNaN(code) && code > 0),
          ),
        ]
      : [];

    const normalizedPageSize = Math.min(
      Math.max(parseInt(pageSize, 10) || 200, 1),
      500,
    );

    const nowIso = new Date().toISOString();
    const endpoint = `${TOTVS_BASE_URL}/accounts-receivable/v2/customer-financial-balance/search`;

    try {
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

      if (normalizedBranchCodes.length === 0) {
        const allBranches = await getBranchCodes(token);
        normalizedBranchCodes.push(...allBranches);
      }

      const doRequest = async (accessToken, payload) =>
        axios.post(endpoint, payload, {
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          timeout: 180000,
          httpsAgent,
          httpAgent,
        });

      const buildPayload = (customerChunk, page) => {
        const payload = {
          filter: {
            customerCodeList: customerChunk,
          },
          option: {
            branchCodeList: normalizedBranchCodes,
            isLimit: true,
            isOpenInvoice: true,
            isRefundCredit: true,
            isAdvanceAmount: true,
            isDofni: true,
            isDofniCheck: true,
            isTransactionOut: true,
            isConsigned: true,
            isInvoiceBehindSchedule: true,
            dateInvoiceBehindSchedule: nowIso,
            isSalesOrderAdvance: true,
          },
          page,
          pageSize: normalizedPageSize,
        };

        if (
          Array.isArray(customerCpfCnpjList) &&
          customerCpfCnpjList.length > 0
        ) {
          payload.filter.customerCpfCnpjList = customerCpfCnpjList;
        }

        return payload;
      };

      const CHUNK_SIZE = 200;
      const allItems = [];

      for (let i = 0; i < normalizedCodes.length; i += CHUNK_SIZE) {
        const customerChunk = normalizedCodes.slice(i, i + CHUNK_SIZE);
        let currentPage = 1;
        let hasNext = true;

        while (hasNext) {
          const payload = buildPayload(customerChunk, currentPage);
          let response;
          try {
            response = await doRequest(token, payload);
          } catch (error) {
            if (error.response?.status === 401) {
              const newTokenData = await getToken(true);
              token = newTokenData.access_token;
              response = await doRequest(token, payload);
            } else {
              console.error('❌ franchise-financial-balance TOTVS error:', {
                status: error.response?.status,
                data: String(JSON.stringify(error.response?.data) || '').slice(
                  0,
                  1000,
                ),
              });
              throw error;
            }
          }

          const pageItems = response.data?.items || [];
          hasNext = Boolean(response.data?.hasNext);
          allItems.push(...pageItems);

          currentPage++;
        }
      }

      const consolidatedMap = new Map();

      allItems.forEach((item) => {
        const code = item?.code;
        if (!code) return;

        const values = Array.isArray(item.values) ? item.values : [];

        if (!consolidatedMap.has(code)) {
          consolidatedMap.set(code, {
            code,
            name: item.name || '',
            cpfCnpj: item.cpfCnpj || '',
            maxChangeFilterDate: item.maxChangeFilterDate || null,
            values: [],
            totals: {
              limitValue: 0,
              openInvoiceValue: 0,
              refundCreditValue: 0,
              advanceAmountValue: 0,
              dofniValue: 0,
              dofniCheckValue: 0,
              transactionOutValue: 0,
              consignedValue: 0,
              invoicesBehindScheduleValue: 0,
              salesOrderAdvanceValue: 0,
            },
          });
        }

        const current = consolidatedMap.get(code);

        values.forEach((branchValue) => {
          current.values.push(branchValue);
          current.totals.limitValue += Number(branchValue.limitValue || 0);
          current.totals.openInvoiceValue += Number(
            branchValue.openInvoiceValue || 0,
          );
          current.totals.refundCreditValue += Number(
            branchValue.refundCreditValue || 0,
          );
          current.totals.advanceAmountValue += Number(
            branchValue.advanceAmountValue || 0,
          );
          current.totals.dofniValue += Number(branchValue.dofniValue || 0);
          current.totals.dofniCheckValue += Number(
            branchValue.dofniCheckValue || 0,
          );
          current.totals.transactionOutValue += Number(
            branchValue.transactionOutValue || 0,
          );
          current.totals.consignedValue += Number(
            branchValue.consignedValue || 0,
          );
          current.totals.invoicesBehindScheduleValue += Number(
            branchValue.invoicesBehindScheduleValue || 0,
          );
          current.totals.salesOrderAdvanceValue += Number(
            branchValue.salesOrderAdvanceValue || 0,
          );
        });
      });

      const consolidatedItems = Array.from(consolidatedMap.values()).map(
        (item) => ({
          ...item,
          balanceLimitValue:
            item.totals.limitValue - item.totals.openInvoiceValue,
        }),
      );

      successResponse(
        res,
        {
          count: consolidatedItems.length,
          totalItems: consolidatedItems.length,
          items: consolidatedItems,
        },
        `Saldo financeiro obtido para ${consolidatedItems.length} clientes`,
      );
    } catch (error) {
      console.error('❌ Erro ao consultar saldo financeiro de franquias:', {
        message: error.message,
        status: error.response?.status,
        response: error.response?.data,
      });

      return errorResponse(
        res,
        error.response?.data?.message ||
          error.message ||
          'Erro ao consultar saldo financeiro de franquias',
        error.response?.status || 500,
        'FRANCHISE_FINANCIAL_BALANCE_ERROR',
        error.response?.data || null,
      );
    }
  }),
);

// ==========================================
// ROTA: BUSCAR CLIENTES MULTIMARCAS (por classificação)
// Cache em memória (recarrega a cada 60 min)
// Classificação MULTIMARCAS: Tipo 20 / Classificação 2
// ==========================================
let cachedMultibrandClients = null;
let multibrandCacheTimestamp = 0;
const MULTIBRAND_CACHE_TTL = 60 * 60 * 1000; // 60 minutos

/**
 * @route GET /totvs/multibrand-clients
 * @desc Retorna lista de códigos de clientes MULTIMARCAS (classificação TOTVS)
 * Classificações: type 20 codeList ["2"] e/ou type 5 codeList ["1"]
 */
router.get(
  '/multibrand-clients',
  asyncHandler(async (req, res) => {
    const now = Date.now();
    const forceRefresh = req.query.refresh === 'true';

    // Retornar cache se válido
    if (
      !forceRefresh &&
      cachedMultibrandClients &&
      now - multibrandCacheTimestamp < MULTIBRAND_CACHE_TTL
    ) {
      console.log(
        `📋 Multibrand clients (cache): ${cachedMultibrandClients.length} clientes`,
      );
      return successResponse(
        res,
        cachedMultibrandClients,
        `${cachedMultibrandClients.length} multimarcas (cache)`,
      );
    }

    const startTime = Date.now();

    try {
      const tokenData = await getToken();
      if (!tokenData?.access_token) {
        return errorResponse(
          res,
          'Token indisponível',
          503,
          'TOKEN_UNAVAILABLE',
        );
      }

      let token = tokenData.access_token;
      const endpoint = `${TOTVS_BASE_URL}/person/v2/legal-entities/search`;

      // Buscar com filtro de classificação direto na API TOTVS
      const doRequest = async (
        accessToken,
        classificationType,
        codeList,
        page,
      ) => {
        const payload = {
          filter: {
            classifications: [
              {
                type: classificationType,
                codeList: codeList,
              },
            ],
          },
          page,
          pageSize: 100,
          order: 'code',
        };
        return axios.post(endpoint, payload, {
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          timeout: 60000,
        });
      };

      // Função para buscar TODAS as páginas de uma classificação
      const fetchAllPages = async (classificationType, codeList) => {
        let items = [];
        let currentPage = 1;
        let hasMore = true;
        const maxPages = 200;

        while (hasMore && currentPage <= maxPages) {
          let response;
          try {
            response = await doRequest(
              token,
              classificationType,
              codeList,
              currentPage,
            );
          } catch (error) {
            if (error.response?.status === 401) {
              const newTokenData = await getToken(true);
              token = newTokenData.access_token;
              response = await doRequest(
                token,
                classificationType,
                codeList,
                currentPage,
              );
            } else {
              throw error;
            }
          }

          const pageItems = response.data?.items || [];
          hasMore = response.data?.hasNext || false;

          items = items.concat(
            pageItems.map((item) => ({
              code: item.code,
              name: item.name || '',
              fantasyName: item.fantasyName || '',
              cnpj: item.cnpj || '',
            })),
          );

          if (currentPage % 10 === 0 || !hasMore) {
            console.log(
              `📄 Type ${classificationType} - Página ${currentPage}: ${pageItems.length} itens (total: ${items.length})`,
            );
          }

          currentPage++;
        }

        return items;
      };

      console.log(
        '🔍 Buscando clientes MULTIMARCAS na API TOTVS (tipo 20/code 2 e/ou tipo 5/code 1)...',
      );

      // Buscar as duas classificações em PARALELO
      const [multimarcasTipo20, multimarcasTipo5] = await Promise.all([
        fetchAllPages(20, ['2']),
        fetchAllPages(5, ['1']),
      ]);

      console.log(
        `📊 Tipo 20/Code 2: ${multimarcasTipo20.length} | Tipo 5/Code 1: ${multimarcasTipo5.length}`,
      );

      // Mesclar e deduplicar por code
      const codesSet = new Set();
      const allMultibrand = [];

      [...multimarcasTipo20, ...multimarcasTipo5].forEach((item) => {
        if (!codesSet.has(item.code)) {
          codesSet.add(item.code);
          allMultibrand.push(item);
        }
      });

      // Salvar no cache
      cachedMultibrandClients = allMultibrand;
      multibrandCacheTimestamp = Date.now();

      const totalTime = Date.now() - startTime;
      console.log(
        `✅ ${allMultibrand.length} multimarcas encontrados em ${totalTime}ms`,
      );

      successResponse(
        res,
        allMultibrand,
        `${allMultibrand.length} multimarcas encontrados em ${totalTime}ms`,
      );
    } catch (error) {
      console.error('❌ Erro ao buscar multimarcas:', error.message);
      return errorResponse(res, error.message, 500, 'INTERNAL_ERROR');
    }
  }),
);

// ==========================================
// FISCAL MOVEMENT - RANKING DE FATURAMENTO
// Busca movimentos fiscais por empresa e por vendedor
// Endpoint TOTVS: analytics/v2/fiscal-movement/search
// ==========================================

/**
 * @route POST /totvs/fiscal-movement/search
 * @desc Busca movimentos fiscais na API TOTVS (ranking de faturamento)
 * @access Public
 * @body {
 *   filter: {
 *     branchCodeList: number[] (obrigatório),
 *     startMovementDate: string (ISO date-time, obrigatório),
 *     endMovementDate: string (ISO date-time, obrigatório)
 *   },
 *   page: number (página inicial é 1),
 *   pageSize: number (máx 1000)
 * }
 */
router.post(
  '/fiscal-movement/search',
  asyncHandler(async (req, res) => {
    const startTime = Date.now();
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

      const { filter, page, pageSize } = req.body;

      if (
        !filter ||
        !filter.branchCodeList ||
        !filter.startMovementDate ||
        !filter.endMovementDate
      ) {
        return errorResponse(
          res,
          'Os campos filter.branchCodeList, filter.startMovementDate e filter.endMovementDate são obrigatórios',
          400,
          'MISSING_REQUIRED_FIELDS',
        );
      }

      const endpoint = `${TOTVS_BASE_URL}/analytics/v2/fiscal-movement/search`;

      const payload = {
        filter: {
          branchCodeList: filter.branchCodeList,
          startMovementDate: filter.startMovementDate,
          endMovementDate: filter.endMovementDate,
        },
        page: page || 1,
        pageSize: Math.min(pageSize || 1000, 1000),
      };

      console.log('📊 Buscando movimentos fiscais na API TOTVS:', {
        endpoint,
        branches: payload.filter.branchCodeList.length,
        periodo: `${payload.filter.startMovementDate} a ${payload.filter.endMovementDate}`,
        page: payload.page,
        pageSize: payload.pageSize,
      });

      const doRequest = async (accessToken, requestPayload) =>
        axios.post(endpoint, requestPayload, {
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          timeout: 60000,
        });

      // Buscar primeira página
      let response;
      try {
        response = await doRequest(tokenData.access_token, payload);
      } catch (error) {
        if (error.response?.status === 401) {
          console.log('🔄 Token inválido. Renovando token...');
          const newTokenData = await getToken(true);
          response = await doRequest(newTokenData.access_token, payload);
        } else {
          throw error;
        }
      }

      // Coletar todos os itens (paginação automática)
      let allItems = response.data?.items || response.data?.data || [];
      const hasNext = response.data?.hasNext ?? false;
      const totalRecords =
        response.data?.total || response.data?.totalRecords || allItems.length;

      console.log(
        `📊 Página 1: ${allItems.length} itens | hasNext: ${hasNext} | total: ${totalRecords}`,
      );

      // Se há mais páginas, buscar todas
      if (hasNext && totalRecords > payload.pageSize) {
        const totalPages = Math.ceil(totalRecords / payload.pageSize);
        const currentToken = tokenData.access_token;

        for (let p = 2; p <= totalPages; p++) {
          const nextPayload = { ...payload, page: p };
          try {
            const nextResponse = await doRequest(currentToken, nextPayload);
            const nextItems =
              nextResponse.data?.items || nextResponse.data?.data || [];
            allItems = [...allItems, ...nextItems];
            console.log(
              `📊 Página ${p}/${totalPages}: +${nextItems.length} itens (total acumulado: ${allItems.length})`,
            );

            if (!nextResponse.data?.hasNext) break;
          } catch (pageError) {
            console.error(`⚠️ Erro na página ${p}:`, pageError.message);
            break;
          }
        }
      }

      const totalTime = Date.now() - startTime;
      console.log(
        `✅ Movimentos fiscais obtidos: ${allItems.length} itens em ${totalTime}ms`,
      );

      successResponse(
        res,
        {
          items: allItems,
          total: allItems.length,
          totalRecords,
          hasNext: false,
          queryTime: totalTime,
        },
        `${allItems.length} movimentos fiscais obtidos em ${totalTime}ms`,
      );
    } catch (error) {
      console.error('❌ Erro ao buscar movimentos fiscais na API TOTVS:', {
        message: error.message,
        code: error.code,
        response: error.response?.data,
        status: error.response?.status,
      });

      if (error.response) {
        const errorMessage =
          error.response.data?.message ||
          error.response.data?.error ||
          error.response.data?.error_description ||
          (typeof error.response.data === 'string'
            ? error.response.data
            : 'Erro ao buscar movimentos fiscais na API TOTVS');

        return res.status(error.response.status || 400).json({
          success: false,
          message: errorMessage,
          error: 'TOTVS_API_ERROR',
          timestamp: new Date().toISOString(),
          details: error.response.data,
          payload: req.body,
        });
      } else if (error.request) {
        const errorMessage =
          error.code === 'ENOTFOUND'
            ? 'URL da API TOTVS não encontrada.'
            : error.code === 'ECONNREFUSED'
              ? 'Conexão recusada pela API TOTVS.'
              : `Não foi possível conectar à API TOTVS (${error.code || 'Erro desconhecido'})`;

        return errorResponse(res, errorMessage, 503, 'TOTVS_CONNECTION_ERROR');
      }

      throw new Error(`Erro ao chamar API TOTVS: ${error.message}`);
    }
  }),
);

// ==========================================
// CACHE de invoices em memória (LRU simples)
// Chave: hash dos parâmetros da consulta
// TTL: 10 minutos
// ==========================================
const invoicesCache = new Map();
const INVOICES_CACHE_TTL = 10 * 60 * 1000; // 10 minutos
const INVOICES_CACHE_MAX_SIZE = 20;

function getInvoicesCacheKey(body) {
  return JSON.stringify({
    s: body.startDate,
    e: body.endDate,
    b: body.branchCodeList ? [...body.branchCodeList].sort() : null,
    o: body.operationType || null,
    p: body.personCodeList ? [...body.personCodeList].sort() : null,
    is: body.invoiceStatusList ? [...body.invoiceStatusList].sort() : null,
    oc: body.operationCodeList ? [...body.operationCodeList].sort() : null,
  });
}

function getFromInvoicesCache(key) {
  const entry = invoicesCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > INVOICES_CACHE_TTL) {
    invoicesCache.delete(key);
    return null;
  }
  return entry.data;
}

function setInvoicesCache(key, data) {
  if (invoicesCache.size >= INVOICES_CACHE_MAX_SIZE) {
    const oldestKey = invoicesCache.keys().next().value;
    invoicesCache.delete(oldestKey);
  }
  invoicesCache.set(key, { data, timestamp: Date.now() });
}

/**
 * @route POST /totvs/invoices/search
 * @desc Proxy para fiscal/v2/invoices/search da API TOTVS Moda.
 *       OTIMIZADO: pageSize 500, 10 páginas paralelas, cache 10min, keep-alive.
 *       Usa change.startDate/endDate (data de ALTERAÇÃO da NF) com margem ±3 dias.
 *       Popula branchCodeList automaticamente se não informado.
 *       Busca TODAS as páginas automaticamente.
 * @access Public
 * @body {
 *   startDate: string (YYYY-MM-DD, obrigatório),
 *   endDate: string (YYYY-MM-DD, obrigatório),
 *   branchCodeList: number[] (opcional),
 *   operationType: string (opcional),
 *   personCodeList: number[] (opcional),
 *   invoiceStatusList: string[] (opcional),
 *   operationCodeList: number[] (opcional),
 *   maxPages: number (opcional, default: 100),
 *   noCache: boolean (opcional, forçar bypass do cache)
 * }
 */
router.post(
  '/invoices/search',
  asyncHandler(async (req, res) => {
    const startTime = Date.now();
    try {
      // ====== CACHE CHECK ======
      const cacheKey = getInvoicesCacheKey(req.body);
      if (!req.body.noCache) {
        const cached = getFromInvoicesCache(cacheKey);
        if (cached) {
          const cacheTime = Date.now() - startTime;
          console.log(
            `⚡ [Invoices] CACHE HIT — ${cached.totalItems} itens em ${cacheTime}ms`,
          );
          return successResponse(
            res,
            { ...cached, fromCache: true, queryTime: cacheTime },
            `${cached.totalItems} invoices (cache) em ${cacheTime}ms`,
          );
        }
      }

      const tokenData = await getToken();

      if (!tokenData || !tokenData.access_token) {
        return errorResponse(
          res,
          'Não foi possível obter token de autenticação TOTVS',
          503,
          'TOKEN_UNAVAILABLE',
        );
      }

      let token = tokenData.access_token;

      const {
        startDate,
        endDate,
        branchCodeList,
        operationType,
        personCodeList,
        invoiceStatusList,
        operationCodeList,
        maxPages: maxPagesParam,
      } = req.body;

      const MAX_PAGES = Math.min(parseInt(maxPagesParam) || 100, 200);

      if (!startDate || !endDate) {
        return errorResponse(
          res,
          'Os campos startDate e endDate são obrigatórios (formato YYYY-MM-DD)',
          400,
          'MISSING_REQUIRED_FIELDS',
        );
      }

      const branches =
        branchCodeList && branchCodeList.length > 0
          ? branchCodeList
          : await getBranchCodes(token);

      // Margem de ±3 dias nas datas de alteração (change) para cobrir NFs
      // cuja data de transação (invoiceDate) difere da data de alteração.
      // O frontend filtra depois por invoiceDate dentro do range real.
      const MARGIN_DAYS = 3;
      const marginStart = new Date(startDate);
      marginStart.setDate(marginStart.getDate() - MARGIN_DAYS);
      const marginEnd = new Date(endDate);
      marginEnd.setDate(marginEnd.getDate() + MARGIN_DAYS);
      const changeStartDate = marginStart.toISOString().slice(0, 10);
      const changeEndDate = marginEnd.toISOString().slice(0, 10);

      const endpoint = `${TOTVS_BASE_URL}/fiscal/v2/invoices/search`;
      const filter = {
        branchCodeList: branches,
        change: {
          startDate: `${changeStartDate}T00:00:00.000Z`,
          endDate: `${changeEndDate}T23:59:59.999Z`,
        },
      };

      if (operationType) filter.operationType = operationType;
      if (personCodeList?.length > 0) filter.personCodeList = personCodeList;
      if (invoiceStatusList?.length > 0)
        filter.invoiceStatusList = invoiceStatusList;
      if (operationCodeList?.length > 0)
        filter.operationCodeList = operationCodeList;

      // ====== OTIMIZAÇÃO: 10 paralelas + keep-alive + cache ======
      const PAGE_SIZE = 100;
      const PARALLEL_BATCH = 10;

      console.log(
        `📊 [Invoices] ${branches.length} branches | change ${changeStartDate}→${changeEndDate} (±${MARGIN_DAYS}d)` +
          `${operationType ? ` | tipo: ${operationType}` : ''}` +
          `${invoiceStatusList?.length ? ` | status: ${invoiceStatusList.join(',')}` : ''}` +
          `${operationCodeList?.length ? ` | ${operationCodeList.length} ops` : ''}` +
          ` | pageSize: ${PAGE_SIZE} | parallel: ${PARALLEL_BATCH}`,
      );

      // Request com keep-alive agent para reutilizar conexão TCP/TLS
      const makeRequest = async (accessToken, pageNum) =>
        axios.post(
          endpoint,
          { filter, page: pageNum, pageSize: PAGE_SIZE },
          {
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
              Authorization: `Bearer ${accessToken}`,
              Connection: 'keep-alive',
            },
            timeout: 60000,
            httpsAgent,
            httpAgent,
          },
        );

      // PASSO 1: Buscar página 1 para descobrir totalPages
      let firstResponse;
      try {
        firstResponse = await makeRequest(token, 1);
      } catch (error) {
        if (error.response?.status === 401) {
          const newTokenData = await getToken(true);
          token = newTokenData.access_token;
          firstResponse = await makeRequest(token, 1);
        } else {
          throw error;
        }
      }

      const apiTotalPages = firstResponse.data?.totalPages || 1;
      const totalPages = Math.min(apiTotalPages, MAX_PAGES);
      const totalCount = firstResponse.data?.count || 0;
      let allItems = [...(firstResponse.data?.items || [])];

      console.log(
        `📄 [Invoices] Pg 1/${totalPages} | count: ${totalCount} | itens: ${allItems.length} (${Date.now() - startTime}ms)`,
      );

      // PASSO 2: Buscar páginas restantes — PARALLEL_BATCH por vez
      if (totalPages > 1) {
        const remainingPages = [];
        for (let p = 2; p <= totalPages; p++) remainingPages.push(p);

        for (let i = 0; i < remainingPages.length; i += PARALLEL_BATCH) {
          const batch = remainingPages.slice(i, i + PARALLEL_BATCH);

          const results = await Promise.all(
            batch.map((p) =>
              makeRequest(token, p).catch((err) => {
                // Retry uma vez em caso de timeout
                if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
                  console.warn(`⚠️ [Invoices] Retry pg ${p} (timeout)`);
                  return makeRequest(token, p).catch(() => null);
                }
                console.warn(`⚠️ [Invoices] Erro pg ${p}: ${err.message}`);
                return null;
              }),
            ),
          );

          for (const r of results) {
            if (r?.data?.items) {
              allItems = allItems.concat(r.data.items);
            }
          }

          const batchEnd = batch[batch.length - 1];
          console.log(
            `📄 [Invoices] Batch pg ${batch[0]}-${batchEnd}/${totalPages} | acum: ${allItems.length} (${Date.now() - startTime}ms)`,
          );
        }
      }

      const totalTime = Date.now() - startTime;

      const responseData = {
        items: allItems,
        count: totalCount,
        totalPages,
        totalItems: allItems.length,
        hasNext: false,
        queryTime: totalTime,
      };

      // ====== SALVAR NO CACHE ======
      setInvoicesCache(cacheKey, responseData);

      console.log(
        `✅ [Invoices] ${allItems.length} invoices | ${totalPages} pgs (×${PAGE_SIZE}) | ${totalTime}ms`,
      );

      successResponse(
        res,
        responseData,
        `${allItems.length} invoices em ${totalTime}ms`,
      );
    } catch (error) {
      console.error('❌ Erro ao buscar invoices:', {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status,
      });

      if (error.response) {
        return res.status(error.response.status || 400).json({
          success: false,
          message:
            error.response.data?.message ||
            'Erro ao buscar invoices na API TOTVS',
          error: 'TOTVS_API_ERROR',
          details: error.response.data,
        });
      }

      throw new Error(`Erro ao buscar invoices: ${error.message}`);
    }
  }),
);

// ==========================================
// BAIXA DE TÍTULOS (INVOICES PAYMENT) - Confiança
// POST /invoices-settle
// Efetua baixa de títulos no TOTVS via accounts-receivable/v2/invoices-payment
// Usa invoices-payment ao invés de invoices-settle/create pois este último
// não permite títulos vencidos (ExpiredInvoice).
// ==========================================
router.post(
  '/invoices-settle',
  asyncHandler(async (req, res) => {
    const { items, bank } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return errorResponse(
        res,
        'É necessário enviar um array de itens para baixa',
        400,
        'INVALID_ITEMS',
      );
    }

    // Validar campos obrigatórios de cada item
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (
        !item.branchCode ||
        !item.customerCode ||
        !item.receivableCode ||
        !item.installmentCode ||
        !item.paidValue
      ) {
        return errorResponse(
          res,
          `Item ${i + 1} está incompleto. Campos obrigatórios: branchCode, customerCode, receivableCode, installmentCode, paidValue`,
          400,
          'INVALID_ITEM_FIELDS',
        );
      }
    }

    // Dados bancários: usar os enviados pelo frontend, senão fallback Confiança
    const requestPaidType = req.body.paidType || 4; // Default: Conta corrente
    const BANK_DATA =
      bank && bank.bankNumber
        ? {
            bankNumber: bank.bankNumber,
            agencyNumber: bank.agencyNumber,
            account: String(bank.account),
          }
        : {
            bankNumber: 422,
            agencyNumber: 1610,
            account: '005818984',
          };

    console.log('🏦 Banco selecionado para baixa:', BANK_DATA);
    console.log('💳 Tipo de pagamento (paidType):', requestPaidType);

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

      const results = [];
      const errors = [];

      // Agrupar itens por branchCode (empresa de liquidação)
      // O invoices-payment exige um branchCode de liquidação + settlementDate no nível raiz
      // e aceita múltiplas faturas + múltiplos pagamentos
      // Processamos cada item individualmente para melhor controle de erros
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const branchCode =
          typeof item.branchCode === 'string'
            ? parseInt(item.branchCode, 10)
            : item.branchCode;
        const customerCode =
          typeof item.customerCode === 'string'
            ? parseInt(item.customerCode, 10)
            : item.customerCode;
        const receivableCode =
          typeof item.receivableCode === 'string'
            ? parseInt(item.receivableCode, 10)
            : item.receivableCode;
        const installmentCode =
          typeof item.installmentCode === 'string'
            ? parseInt(item.installmentCode, 10)
            : item.installmentCode;
        const paidValue =
          typeof item.paidValue === 'string'
            ? parseFloat(item.paidValue)
            : item.paidValue;

        // Data de liquidação: usar a data do arquivo (dt_pagamento) se fornecida, senão hoje
        let settlementDate;
        if (item.settlementDate) {
          // Aceitar formatos ISO (2026-02-15) ou BR (15/02/2026)
          const raw = item.settlementDate;
          if (raw.includes('/')) {
            // Formato BR: dd/mm/yyyy
            const [dd, mm, yyyy] = raw.split('/');
            settlementDate = new Date(
              `${yyyy}-${mm}-${dd}T12:00:00`,
            ).toISOString();
          } else {
            // Formato ISO ou similar
            settlementDate = new Date(raw).toISOString();
          }
        } else {
          settlementDate = new Date().toISOString();
        }

        // Payload conforme InvoicesPaymentCommand do Swagger
        // Para adiantamento (paidType 3), tenta primeiro empresa 99, se falhar tenta empresa 1
        const settlementBranchCode = requestPaidType === 3 ? 99 : branchCode;

        const buildPayload = (sBranchCode) => ({
          branchCode: sBranchCode,
          settlementDate,
          movementDate: settlementDate,
          invoices: [
            {
              branchCode,
              customerCode,
              receivableCode,
              installmentCode,
              paidValue,
            },
          ],
          payments: [
            {
              value: paidValue,
              paidType: requestPaidType,
              ...(requestPaidType === 4
                ? {
                    bank: {
                      bankNumber: BANK_DATA.bankNumber,
                      agencyNumber: BANK_DATA.agencyNumber,
                      account: BANK_DATA.account,
                    },
                  }
                : {}),
            },
          ],
        });

        const payload = buildPayload(settlementBranchCode);

        try {
          console.log(
            `📋 [${i + 1}/${items.length}] Efetuando baixa no TOTVS (invoices-payment) - Empresa ${settlementBranchCode}:`,
            JSON.stringify(payload, null, 2),
          );

          const response = await axios.post(
            `${TOTVS_BASE_URL}/accounts-receivable/v2/invoices-payment`,
            payload,
            {
              headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                Authorization: `Bearer ${tokenData.access_token}`,
              },
              httpsAgent,
              timeout: 30000,
            },
          );

          console.log(
            `✅ [${i + 1}/${items.length}] Baixa efetuada com sucesso - Fatura ${receivableCode} (Empresa ${settlementBranchCode})`,
            JSON.stringify(response.data),
          );
          results.push({
            index: i,
            receivableCode,
            installmentCode,
            branchCode,
            success: true,
            data: response.data,
          });
        } catch (itemError) {
          console.error(
            `❌ [${i + 1}/${items.length}] Erro na baixa - Fatura ${receivableCode} (Empresa ${settlementBranchCode}):`,
            {
              status: itemError.response?.status,
              data: JSON.stringify(itemError.response?.data, null, 2),
              message: itemError.response?.data?.message || itemError.message,
            },
          );

          // Para adiantamento: se falhou na empresa 99, tentar na empresa 1
          if (requestPaidType === 3 && settlementBranchCode === 99) {
            try {
              const fallbackPayload = buildPayload(1);
              console.log(
                `🔄 [${i + 1}/${items.length}] Tentando fallback na Empresa 1 para adiantamento...`,
              );

              const fallbackResponse = await axios.post(
                `${TOTVS_BASE_URL}/accounts-receivable/v2/invoices-payment`,
                fallbackPayload,
                {
                  headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                    Authorization: `Bearer ${tokenData.access_token}`,
                  },
                  httpsAgent,
                  timeout: 30000,
                },
              );

              console.log(
                `✅ [${i + 1}/${items.length}] Baixa efetuada com sucesso (fallback Empresa 1) - Fatura ${receivableCode}`,
              );
              results.push({
                index: i,
                receivableCode,
                installmentCode,
                branchCode,
                success: true,
                data: fallbackResponse.data,
              });
              continue;
            } catch (fallbackError) {
              console.error(
                `❌ [${i + 1}/${items.length}] Fallback Empresa 1 também falhou - Fatura ${receivableCode}:`,
                {
                  status: fallbackError.response?.status,
                  data: JSON.stringify(fallbackError.response?.data, null, 2),
                },
              );
              // Segue para o tratamento de erro normal abaixo
            }
          }

          // Se for erro de token, tentar renovar uma vez
          if (itemError.response?.status === 401) {
            try {
              const newTokenData = await getToken(true);
              const retryResponse = await axios.post(
                `${TOTVS_BASE_URL}/accounts-receivable/v2/invoices-payment`,
                payload,
                {
                  headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                    Authorization: `Bearer ${newTokenData.access_token}`,
                  },
                  httpsAgent,
                  timeout: 30000,
                },
              );

              console.log(
                `✅ [${i + 1}/${items.length}] Baixa efetuada com sucesso (retry) - Fatura ${receivableCode}`,
              );
              results.push({
                index: i,
                receivableCode,
                installmentCode,
                branchCode,
                success: true,
                data: retryResponse.data,
              });
              continue;
            } catch (retryError) {
              // Falhou mesmo com retry
            }
          }

          // Traduzir erros do TOTVS para mensagens amigáveis
          const TOTVS_ERROR_MAP = {
            InvoiceNotOpen: 'Fatura já baixada ou não está em aberto',
            AcountCustomerNotFound:
              'Cliente não possui conta de adiantamento cadastrada',
            FieldValueGreaterThan: 'Cliente não possui saldo suficiente',
            ValidateBalanceAdvance: 'Cliente não possui saldo de adiantamento',
            InvoiceNotFound: 'Fatura não encontrada no TOTVS',
            CustomerNotFound: 'Cliente não encontrado no TOTVS',
            BranchNotFound: 'Empresa não encontrada no TOTVS',
            InvalidSettlementDate: 'Data de liquidação inválida',
            SettlementDateLessThanIssueDate:
              'Data de pagamento anterior à emissão',
            PaymentValueExceedsInvoice:
              'Valor do pagamento excede o valor da fatura',
            DuplicatePayment: 'Pagamento duplicado detectado',
          };

          let mensagensTraducao = [];
          const rawData = itemError.response?.data;
          if (rawData) {
            let errosTotvs = [];
            if (typeof rawData === 'string') {
              try {
                errosTotvs = JSON.parse(rawData);
              } catch (e) {
                /* ignore */
              }
            } else if (Array.isArray(rawData)) {
              errosTotvs = rawData;
            }
            if (Array.isArray(errosTotvs)) {
              mensagensTraducao = errosTotvs.map((e) => {
                const traduzido = TOTVS_ERROR_MAP[e.code];
                return traduzido || e.message || e.code || 'Erro desconhecido';
              });
            }
          }

          errors.push({
            index: i,
            receivableCode,
            installmentCode,
            branchCode,
            success: false,
            error: itemError.response?.data?.message || itemError.message,
            errorMessages:
              mensagensTraducao.length > 0
                ? mensagensTraducao
                : ['Erro ao processar baixa no TOTVS'],
            status: itemError.response?.status,
            details: itemError.response?.data,
            payloadSent: payload,
          });
        }
      }

      const totalProcessed = results.length + errors.length;
      console.log(
        `📊 Baixa finalizada: ${results.length}/${totalProcessed} com sucesso, ${errors.length} erros`,
      );

      return res
        .status(errors.length > 0 && results.length === 0 ? 400 : 200)
        .json({
          success: errors.length === 0,
          message:
            errors.length === 0
              ? `Todas as ${results.length} baixas foram efetuadas com sucesso`
              : `${results.length} baixas efetuadas, ${errors.length} falharam`,
          totalProcessed,
          successCount: results.length,
          errorCount: errors.length,
          results,
          errors,
        });
    } catch (error) {
      console.error('❌ Erro geral na baixa de títulos:', error.message);
      throw new Error(`Erro ao efetuar baixa de títulos: ${error.message}`);
    }
  }),
);

// ==========================================
// ROTA PARA CONTAS A PAGAR VIA API TOTVS
// Usa /accounts-payable/v2/duplicates/search
// Paginação paralela + mapeamento para formato frontend
// ==========================================

/**
 * @route POST /totvs/accounts-payable/search
 * @desc Busca duplicatas de contas a pagar na API TOTVS (accounts-payable/v2/duplicates/search)
 * @access Public
 * @body {
 *   dt_inicio: string (YYYY-MM-DD, obrigatório),
 *   dt_fim: string (YYYY-MM-DD, obrigatório),
 *   branches: number[] (códigos das empresas, obrigatório),
 *   modo: 'vencimento' | 'emissao' | 'liquidacao' (default: 'vencimento'),
 *   situacao: 'TODAS' | 'N' | 'C' | 'A' | 'D' | 'L' | 'Q' (default: 'N'),
 *     N=Normal, C=Cancelada, A=Agrupada, D=Devolvida, L=Liquidada comissão, Q=Quebrada
 *   previsao: 'TODOS' | 'PREVISAO' | 'REAL' | 'CONSIGNADO' (default: 'TODOS'),
 *   supplierCodeList: number[] (fornecedores, opcional),
 *   duplicateCodeList: number[] (duplicatas, opcional),
 *   documentTypeList: number[] (tipos de documento, opcional)
 * }
 */
router.post(
  '/accounts-payable/search',
  asyncHandler(async (req, res) => {
    const startTime = Date.now();

    try {
      const {
        dt_inicio,
        dt_fim,
        branches,
        modo = 'vencimento',
        situacao = 'N',
        previsao = 'TODOS',
        supplierCodeList,
        duplicateCodeList,
        documentTypeList,
      } = req.body;

      if (!dt_inicio || !dt_fim) {
        return errorResponse(
          res,
          'Parâmetros dt_inicio e dt_fim são obrigatórios',
          400,
          'MISSING_PARAMS',
        );
      }

      if (!branches || !Array.isArray(branches) || branches.length === 0) {
        return errorResponse(
          res,
          'Parâmetro branches (array de códigos das empresas) é obrigatório',
          400,
          'MISSING_PARAMS',
        );
      }

      const tokenData = await getToken();
      if (!tokenData?.access_token) {
        return errorResponse(
          res,
          'Token indisponível',
          503,
          'TOKEN_UNAVAILABLE',
        );
      }

      let token = tokenData.access_token;

      // Converter branches para inteiros
      const branchCodeList = branches
        .map((b) => parseInt(b))
        .filter((b) => !isNaN(b) && b > 0);

      if (branchCodeList.length === 0) {
        return errorResponse(
          res,
          'Nenhuma empresa válida informada em branches',
          400,
          'INVALID_BRANCHES',
        );
      }

      // Montar filtro TOTVS accounts-payable
      const filter = { branchCodeList };

      // Filtro de datas
      if (modo === 'emissao') {
        filter.startIssueDate = `${dt_inicio}T00:00:00`;
        filter.endIssueDate = `${dt_fim}T23:59:59`;
      } else if (modo === 'liquidacao') {
        filter.startSettlementDate = `${dt_inicio}T00:00:00`;
        filter.endSettlementDate = `${dt_fim}T23:59:59`;
      } else {
        // vencimento (padrão)
        filter.startExpiredDate = `${dt_inicio}T00:00:00`;
        filter.endExpiredDate = `${dt_fim}T23:59:59`;
      }

      // Filtro de situação (status) - StatusType enum:
      // Grouped (A), Canceled (C), Retorned (D), CommissionSettled (L), Normal (N), Broken (Q)
      if (situacao && situacao !== 'TODAS') {
        const situacaoToEnum = {
          N: 'Normal',
          C: 'Canceled',
          A: 'Grouped',
          D: 'Retorned',
          L: 'CommissionSettled',
          Q: 'Broken',
          NORMAIS: 'Normal',
          CANCELADAS: 'Canceled',
        };

        if (situacaoToEnum[situacao]) {
          filter.status = situacaoToEnum[situacao];
        }
      }

      // Filtro de fornecedores
      if (
        supplierCodeList &&
        Array.isArray(supplierCodeList) &&
        supplierCodeList.length > 0
      ) {
        filter.supplierCodeList = supplierCodeList
          .map((s) => parseInt(s))
          .filter((s) => !isNaN(s));
      }

      // Filtro de duplicatas
      if (
        duplicateCodeList &&
        Array.isArray(duplicateCodeList) &&
        duplicateCodeList.length > 0
      ) {
        filter.duplicateCodeList = duplicateCodeList
          .map((d) => parseInt(d))
          .filter((d) => !isNaN(d));
      }

      // Filtro de tipos de documento
      if (
        documentTypeList &&
        Array.isArray(documentTypeList) &&
        documentTypeList.length > 0
      ) {
        filter.documentTypeList = documentTypeList
          .map((d) => parseInt(d))
          .filter((d) => !isNaN(d));
      }

      const endpoint = `${TOTVS_BASE_URL}/accounts-payable/v2/duplicates/search`;
      const PAGE_SIZE = 100;
      const PARALLEL_BATCH = 10; // 10 páginas em paralelo por vez

      console.log('💳 Contas a Pagar TOTVS V1:', {
        modo,
        dt_inicio,
        dt_fim,
        situacao,
        previsao,
        branches: branchCodeList,
        filtro: JSON.stringify(filter),
      });

      const makeRequest = async (accessToken, pageNum) => {
        return axios.post(
          endpoint,
          {
            filter,
            page: pageNum,
            pageSize: PAGE_SIZE,
          },
          {
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
              Authorization: `Bearer ${accessToken}`,
            },
            httpsAgent,
            httpAgent,
            timeout: 60000,
          },
        );
      };

      // PASSO 1: Buscar página 1 para descobrir totalPages
      let firstResponse;
      try {
        firstResponse = await makeRequest(token, 1);
      } catch (error) {
        if (error.response?.status === 401) {
          console.log('🔄 Token inválido. Renovando token...');
          const newTokenData = await getToken(true);
          token = newTokenData.access_token;
          firstResponse = await makeRequest(token, 1);
        } else {
          throw error;
        }
      }

      const totalPages = firstResponse.data?.totalPages || 1;
      const totalCount = firstResponse.data?.count || 0;
      let allItems = [...(firstResponse.data?.items || [])];

      console.log(
        `📄 Contas a Pagar - Página 1/${totalPages} - Total: ${totalCount} registros (${Date.now() - startTime}ms)`,
      );

      // PASSO 2: Buscar páginas restantes em PARALELO
      if (totalPages > 1) {
        for (
          let batchStart = 2;
          batchStart <= totalPages;
          batchStart += PARALLEL_BATCH
        ) {
          const batchEnd = Math.min(
            batchStart + PARALLEL_BATCH - 1,
            totalPages,
          );
          const promises = [];

          for (let p = batchStart; p <= batchEnd; p++) {
            promises.push(
              makeRequest(token, p).catch((err) => {
                console.log(`⚠️ Erro página ${p}: ${err.message}`);
                return null;
              }),
            );
          }

          const results = await Promise.all(promises);
          for (const r of results) {
            if (r?.data?.items) {
              allItems = allItems.concat(r.data.items);
            }
          }

          console.log(
            `📄 Contas a Pagar - Batch ${batchStart}-${batchEnd}/${totalPages}: acumulado ${allItems.length} (${Date.now() - startTime}ms)`,
          );
        }
      }

      console.log(
        `📊 Contas a Pagar - ${allItems.length} itens buscados em ${Date.now() - startTime}ms`,
      );

      // PASSO 3: Filtros locais

      let filteredItems = allItems;

      // Situação já filtrada via API (filter.status com enum string)

      // Filtro local de previsão (PrevisionType: 1=Forecast, 2=Real, 3=Consignment)
      if (previsao && previsao !== 'TODOS') {
        let previsionFilter;
        if (previsao === 'PREVISAO') previsionFilter = 1;
        else if (previsao === 'REAL') previsionFilter = 2;
        else if (previsao === 'CONSIGNADO') previsionFilter = 3;

        if (previsionFilter !== undefined) {
          filteredItems = filteredItems.filter(
            (item) =>
              item.inclusionType === previsionFilter || !previsionFilter,
          );
          // Na verdade, o PrevisionType fica no installment, no nível do item do DuplicateOutModel
          // Vou usar o campo correto se existir. A API retorna itens com campos variados.
        }
      }

      // PASSO 4: Mapear para formato frontend (mesmo formato do banco de dados)
      const mappedItems = filteredItems.map((item) => {
        // Extrair dados de despesa e centro de custo do array expense
        const firstExpense =
          item.expense && item.expense.length > 0 ? item.expense[0] : null;

        // Mapear tp_situacao da API (StatusType)
        // A API pode retornar como inteiro (enum) OU como string letra
        // Inteiro: Grouped=0, Canceled=1, Retorned=2, CommissionSettled=3, Normal=4, Broken=5
        // String:  A=Agrupada, C=Cancelada, D=Devolvida, L=Liquidada comissão, N=Normal, Q=Quebrada
        const statusVal = item.status;
        const situacaoMapFromApi = {
          // Inteiros (enum)
          0: 'A',
          1: 'C',
          2: 'D',
          3: 'L',
          4: 'N',
          5: 'Q',
          // Strings (letras diretas)
          A: 'A',
          C: 'C',
          D: 'D',
          L: 'L',
          N: 'N',
          Q: 'Q',
          // Strings enum em inglês
          Grouped: 'A',
          Canceled: 'C',
          Retorned: 'D',
          CommissionSettled: 'L',
          Normal: 'N',
          Broken: 'Q',
        };
        const tpSituacao = situacaoMapFromApi[statusVal] || 'N';

        // Mapear tp_previsaoreal (PrevisionType: 1=Forecast, 2=Real, 3=Consignment)
        // No DuplicateOutModel não vem diretamente, precisamos verificar
        let tpPrevisaoReal = '';
        // O campo pode não estar disponível diretamente no search result
        // Verificar se existe no item
        if (item.previsionType === 1) tpPrevisaoReal = 'P';
        else if (item.previsionType === 2) tpPrevisaoReal = 'R';
        else if (item.previsionType === 3) tpPrevisaoReal = 'C';

        // Mapear tp_estagio (StageType enum)
        // 1=Título não conferido, 2=Liberado, 5=Aceito, 90=Liquidado, etc.
        let tpEstagio = '';
        const stageMap = {
          1: 'NConf',
          2: 'Lib',
          3: 'ChAut',
          4: 'ChEm',
          5: 'Aceito',
          10: 'Endos',
          20: 'PgBco',
          30: 'Res',
          40: 'PgAut',
          41: 'EnvAg',
          42: 'EmAg',
          43: 'PgTrib',
          70: 'Restr',
          71: 'RestrP',
          90: 'Liquid',
        };
        if (item.stageType) {
          tpEstagio = stageMap[item.stageType] || String(item.stageType);
        }

        return {
          cd_empresa: item.branchCode,
          cd_fornecedor: item.supplierCode,
          nr_cpfcnpj_fornecedor: item.supplierCpfCnpj || '',
          nr_duplicata: item.duplicateCode,
          nr_portador: item.bearerCode,
          nr_parcela: item.installmentCode,
          dt_emissao: item.issueDate,
          dt_vencimento: item.dueDate,
          dt_entrada: item.entryDate,
          dt_liq: item.settlementDate || null,
          dt_chegada: item.arrivalDate || null,
          tp_situacao: tpSituacao,
          tp_estagio: tpEstagio,
          tp_previsaoreal: tpPrevisaoReal,
          vl_duplicata: item.duplicateValue || 0,
          vl_juros: item.feesValue || 0,
          vl_acrescimo: 0, // Não tem campo separado na API, está incluso em feesValue
          vl_desconto: item.discountValue || 0,
          vl_pago: item.paidValue || 0,
          vl_rateio:
            firstExpense?.proratedValue ||
            firstExpense?.proratedPercentage ||
            0,
          in_aceite: '', // Não disponível diretamente na API
          cd_despesaitem: firstExpense?.expenseCode || '',
          ds_despesaitem: firstExpense?.expenseName || '',
          cd_ccusto: firstExpense?.costCenterCode || '',
          ds_ccusto: '', // Será enriquecido pelo frontend
          nm_fornecedor: '', // Será enriquecido pelo frontend
          ds_observacao: '', // Não disponível no search
          // Campos extras da API TOTVS
          tp_inclusao: item.inclusionType,
          nm_usuario_inclusao: item.userInclusionName || '',
          // Se houver múltiplas despesas, incluir todas
          despesas: item.expense || [],
        };
      });

      // PASSO 5: Enriquecer com nomes de fornecedores via API TOTVS Person
      const uniqueSupplierCodes = [
        ...new Set(mappedItems.map((i) => i.cd_fornecedor).filter(Boolean)),
      ];

      const supplierNameMap = new Map();
      if (uniqueSupplierCodes.length > 0) {
        console.log(
          `👤 Buscando nomes de ${uniqueSupplierCodes.length} fornecedores...`,
        );
        console.log(
          `👤 Primeiros 5 códigos: ${uniqueSupplierCodes.slice(0, 5).join(', ')}`,
        );

        const currentToken = await getToken();
        const accessToken = currentToken?.access_token;

        if (!accessToken) {
          console.warn('⚠️ Token não disponível para buscar fornecedores');
        } else {
          // Buscar como PJ (legal-entities) e PF (individuals) em paralelo
          const SUPPLIER_BATCH = 50;
          const supplierChunks = [];
          for (let i = 0; i < uniqueSupplierCodes.length; i += SUPPLIER_BATCH) {
            supplierChunks.push(
              uniqueSupplierCodes.slice(i, i + SUPPLIER_BATCH),
            );
          }

          const pjEndpoint = `${TOTVS_BASE_URL}/person/v2/legal-entities/search`;
          const pfEndpoint = `${TOTVS_BASE_URL}/person/v2/individuals/search`;

          const headers = {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Bearer ${accessToken}`,
          };

          // Buscar PJ em paralelo
          const pjPromises = supplierChunks.map(async (chunk) => {
            try {
              const resp = await axios.post(
                pjEndpoint,
                {
                  filter: {
                    personCodeList: chunk.map((c) => parseInt(c)),
                  },
                  page: 1,
                  pageSize: 100,
                },
                { headers, timeout: 30000, httpsAgent, httpAgent },
              );
              // Inspecionar estrutura da resposta
              const respData = resp.data;
              console.log(
                `👤 PJ resp keys: ${JSON.stringify(Object.keys(respData || {}))} | tipo: ${typeof respData}`,
              );
              console.log(
                `👤 PJ resp amostra: ${JSON.stringify(respData).slice(0, 300)}`,
              );
              const items = respData?.items || [];
              console.log(
                `👤 PJ lote: buscou ${chunk.length} códigos, encontrou ${items.length} resultados`,
              );
              return items;
            } catch (err) {
              console.warn(
                `⚠️ Erro PJ lote: ${err.message} | status: ${err.response?.status} | data: ${JSON.stringify(err.response?.data || '').slice(0, 300)}`,
              );
              return [];
            }
          });

          // Buscar PF em paralelo
          const pfPromises = supplierChunks.map(async (chunk) => {
            try {
              const resp = await axios.post(
                pfEndpoint,
                {
                  filter: {
                    personCodeList: chunk.map((c) => parseInt(c)),
                  },
                  page: 1,
                  pageSize: 100,
                },
                { headers, timeout: 30000, httpsAgent, httpAgent },
              );
              const respData = resp.data;
              console.log(
                `👤 PF resp keys: ${JSON.stringify(Object.keys(respData || {}))} | tipo: ${typeof respData}`,
              );
              const items = respData?.items || [];
              console.log(
                `👤 PF lote: buscou ${chunk.length} códigos, encontrou ${items.length} resultados`,
              );
              return items;
            } catch (err) {
              console.warn(
                `⚠️ Erro PF lote: ${err.message} | status: ${err.response?.status} | data: ${JSON.stringify(err.response?.data || '').slice(0, 300)}`,
              );
              return [];
            }
          });

          const [pjResults, pfResults] = await Promise.all([
            Promise.all(pjPromises),
            Promise.all(pfPromises),
          ]);

          // Processar resultados PJ (API retorna 'code', não 'personCode')
          pjResults.flat().forEach((p) => {
            const pCode = p.code ?? p.personCode;
            if (pCode != null) {
              supplierNameMap.set(
                pCode,
                p.fantasyName || p.name || p.corporateName || '',
              );
            }
          });

          // Processar resultados PF (nome completo)
          pfResults.flat().forEach((p) => {
            const pCode = p.code ?? p.personCode;
            if (pCode != null && !supplierNameMap.has(pCode)) {
              supplierNameMap.set(pCode, p.name || '');
            }
          });

          console.log(
            `👤 ${supplierNameMap.size} nomes de fornecedores encontrados de ${uniqueSupplierCodes.length} únicos`,
          );

          // Log de amostra
          if (supplierNameMap.size > 0) {
            const sample = Array.from(supplierNameMap.entries()).slice(0, 3);
            console.log(`👤 Amostra: ${JSON.stringify(sample)}`);
          } else {
            console.warn(
              `⚠️ Nenhum fornecedor encontrado! Primeiros 3 códigos buscados: ${uniqueSupplierCodes.slice(0, 3).join(', ')}`,
            );
          }
        }
      }

      // Aplicar nomes dos fornecedores nos itens mapeados
      mappedItems.forEach((item) => {
        const nome = supplierNameMap.get(item.cd_fornecedor);
        if (nome) item.nm_fornecedor = nome;
      });

      const totalTime = Date.now() - startTime;
      console.log(
        `✅ Contas a Pagar - ${mappedItems.length} itens mapeados em ${totalTime}ms (${totalPages} páginas)`,
      );

      // Calcular totais
      const totals = mappedItems.reduce(
        (acc, row) => {
          acc.totalDuplicata += parseFloat(row.vl_duplicata || 0);
          acc.totalPago += parseFloat(row.vl_pago || 0);
          acc.totalJuros += parseFloat(row.vl_juros || 0);
          acc.totalDesconto += parseFloat(row.vl_desconto || 0);
          return acc;
        },
        { totalDuplicata: 0, totalPago: 0, totalJuros: 0, totalDesconto: 0 },
      );

      successResponse(
        res,
        {
          periodo: { dt_inicio, dt_fim },
          empresas: branchCodeList,
          totals,
          count: mappedItems.length,
          totalCount,
          pagesSearched: totalPages,
          timeMs: totalTime,
          filtros: {
            situacao,
            previsao,
            modo,
            supplierCodeList: supplierCodeList || null,
            duplicateCodeList: duplicateCodeList || null,
          },
          data: mappedItems,
        },
        `${mappedItems.length} duplicata(s) de contas a pagar encontrada(s) em ${totalTime}ms`,
      );
    } catch (error) {
      console.error('❌ Erro ao buscar contas a pagar na API TOTVS:', {
        message: error.message,
        code: error.code,
        response: error.response?.data,
        status: error.response?.status,
      });

      if (error.response) {
        let errorMessage = 'Erro ao buscar contas a pagar na API TOTVS';

        if (error.response.data) {
          if (typeof error.response.data === 'string') {
            errorMessage = error.response.data || errorMessage;
          } else if (typeof error.response.data === 'object') {
            errorMessage =
              error.response.data?.message ||
              error.response.data?.error ||
              error.response.data?.error_description ||
              error.response.data?.title ||
              errorMessage;
          }
        }

        return res.status(error.response.status || 400).json({
          success: false,
          message: errorMessage,
          error: 'TOTVS_API_ERROR',
          timestamp: new Date().toISOString(),
          details: error.response.data || null,
          status: error.response.status,
        });
      } else if (error.request) {
        const errorMessage =
          error.code === 'ENOTFOUND'
            ? 'URL da API TOTVS não encontrada.'
            : error.code === 'ECONNREFUSED'
              ? 'Conexão recusada pela API TOTVS.'
              : `Não foi possível conectar à API TOTVS (${error.code || 'Erro desconhecido'})`;

        return errorResponse(res, errorMessage, 503, 'TOTVS_CONNECTION_ERROR');
      }

      throw new Error(`Erro ao chamar API TOTVS: ${error.message}`);
    }
  }),
);

// ==========================================
// SYNC PES_PESSOA - TOTVS → Supabase
// Rotas para sincronizar pessoas (PF + PJ)
// ==========================================

// ==========================================
// CLIENTES TOTVS v2 - Buscar + Enviar Supabase
// Busca PF + PJ com expand de phones/emails/addresses
// Paginação server-side (1000 por página) com cache em memória
// ==========================================

// Cache de resultado da última busca (expira em 10 min)
let clientesCache = {
  data: null,
  filter: null,
  timestamp: 0,
  totalPF: 0,
  totalPJ: 0,
  duration: '',
};
const CLIENTES_CACHE_TTL = 10 * 60 * 1000;

/**
 * @route GET /totvs/clientes/fetch-all
 * @desc Busca clientes (PF + PJ) do TOTVS com paginação.
 *       1a chamada: busca tudo da API TOTVS e guarda em cache.
 *       Chamadas seguintes (mesmos filtros): retorna do cache.
 * @query startDate (YYYY-MM-DD) - Data início do cadastro
 * @query endDate (YYYY-MM-DD) - Data fim do cadastro
 * @query personCode (opcional) - Código(s) da pessoa (ex: 180 ou 180,200)
 * @query page (opcional, default 1) - Página (1-indexed)
 * @query pageSize (opcional, default 1000) - Itens por página
 */
router.get(
  '/clientes/fetch-all',
  asyncHandler(async (req, res) => {
    const startTime = Date.now();
    const { startDate, endDate, personCode } = req.query;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(
      5000,
      Math.max(1, parseInt(req.query.pageSize, 10) || 1000),
    );

    // Validar token
    const tokenData = await getToken();
    if (!tokenData?.access_token) {
      return errorResponse(
        res,
        'Não foi possível obter token de autenticação TOTVS',
        503,
        'TOKEN_UNAVAILABLE',
      );
    }

    // Montar filtro
    let filter = {};

    if (personCode) {
      const codes = personCode
        .split(',')
        .map((c) => parseInt(c.trim(), 10))
        .filter((c) => !isNaN(c) && c > 0);
      if (codes.length > 0) {
        filter.personCodeList = codes;
        console.log(`🔍 Buscando por código(s): ${codes.join(', ')}`);
      }
    } else if (startDate || endDate) {
      const sd = startDate
        ? `${startDate}T00:00:00.000Z`
        : '2000-01-01T00:00:00.000Z';
      const ed = endDate
        ? `${endDate}T23:59:59.999Z`
        : new Date().toISOString();
      filter.startInsertDate = sd;
      filter.endInsertDate = ed;
      console.log(`🔍 Filtro de data de cadastro: ${sd} → ${ed}`);
    } else {
      console.log('🔍 Buscando TODOS os clientes (sem filtro)...');
    }

    const filterKey = JSON.stringify(filter);
    console.log(
      '📤 Filtro:',
      filterKey,
      `| Página: ${page} | PageSize: ${pageSize}`,
    );

    try {
      // Verificar se cache é válido (mesmo filtro e não expirou)
      const now = Date.now();
      let allRows;
      let totalPF, totalPJ, fetchDuration;

      if (
        clientesCache.data &&
        clientesCache.filter === filterKey &&
        now - clientesCache.timestamp < CLIENTES_CACHE_TTL
      ) {
        console.log(`📦 Usando cache (${clientesCache.data.length} clientes)`);
        allRows = clientesCache.data;
        totalPF = clientesCache.totalPF;
        totalPJ = clientesCache.totalPJ;
        fetchDuration = clientesCache.duration;
      } else {
        // Buscar tudo da API TOTVS
        const result = await fetchAndMapPersons(filter, 'FETCH');
        allRows = result.allRows;
        totalPF = result.pfRows.length;
        totalPJ = result.pjRows.length;
        fetchDuration = ((Date.now() - startTime) / 1000).toFixed(1) + 's';

        // Guardar no cache
        clientesCache = {
          data: allRows,
          filter: filterKey,
          timestamp: Date.now(),
          totalPF,
          totalPJ,
          duration: fetchDuration,
        };
        console.log(
          `✅ ${allRows.length} clientes buscados e cacheados em ${fetchDuration}`,
        );
      }

      // Paginar
      const totalItems = allRows.length;
      const totalPages = Math.ceil(totalItems / pageSize);
      const startIdx = (page - 1) * pageSize;
      const endIdx = startIdx + pageSize;
      const pageData = allRows.slice(startIdx, endIdx);

      const duration = ((Date.now() - startTime) / 1000).toFixed(1);

      successResponse(
        res,
        {
          clientes: pageData,
          page,
          pageSize,
          totalPages,
          totalItems,
          totalPF,
          totalPJ,
          hasNext: page < totalPages,
          hasPrev: page > 1,
          duration: `${duration}s`,
          fetchDuration,
        },
        `Página ${page}/${totalPages} — ${pageData.length} de ${totalItems} clientes`,
      );
    } catch (error) {
      console.error('❌ Erro ao buscar clientes:', error.message);
      errorResponse(
        res,
        `Erro ao buscar clientes do TOTVS: ${error.message}`,
        500,
        'FETCH_CLIENTES_ERROR',
      );
    }
  }),
);

/**
 * @route GET /totvs/clientes/fetch-batch
 * @desc Busca PF + PJ por faixa de códigos (ex: 1-500, 501-1000).
 *       Usado para carga incremental em lotes.
 * @query startCode (default 1) - Código inicial
 * @query endCode (default 500) - Código final
 */
router.get(
  '/clientes/fetch-batch',
  asyncHandler(async (req, res) => {
    const startCode = Math.max(1, parseInt(req.query.startCode, 10) || 1);
    const endCode = Math.max(
      startCode,
      parseInt(req.query.endCode, 10) || startCode + 499,
    );

    if (endCode - startCode + 1 > 1000) {
      return errorResponse(
        res,
        'Máximo de 1000 códigos por lote',
        400,
        'BATCH_TOO_LARGE',
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

    const codes = Array.from(
      { length: endCode - startCode + 1 },
      (_, i) => startCode + i,
    );
    const filter = { personCodeList: codes };
    const startTime = Date.now();

    console.log(
      `📦 Buscando lote códigos ${startCode}-${endCode} (${codes.length} códigos)...`,
    );

    try {
      const { pfRows, pjRows, allRows } = await fetchAndMapPersons(
        filter,
        `BATCH-${startCode}-${endCode}`,
      );
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);

      console.log(
        `✅ Lote ${startCode}-${endCode}: ${allRows.length} clientes (PF:${pfRows.length} PJ:${pjRows.length}) em ${duration}s`,
      );

      successResponse(
        res,
        {
          clientes: allRows,
          totalPF: pfRows.length,
          totalPJ: pjRows.length,
          total: allRows.length,
          startCode,
          endCode,
          duration: `${duration}s`,
        },
        `Lote ${startCode}-${endCode}: ${allRows.length} clientes`,
      );
    } catch (error) {
      console.error(`❌ Erro no lote ${startCode}-${endCode}:`, error.message);
      errorResponse(
        res,
        `Erro ao buscar lote: ${error.message}`,
        500,
        'FETCH_BATCH_ERROR',
      );
    }
  }),
);

/**
 * @route GET /totvs/clientes/search-name
 * @desc Busca clientes na tabela pes_pessoa do Supabase por nome ou nome fantasia.
 *       Retorna código, nome, nome fantasia, CPF/CNPJ, tipo, empresa, telefone, email.
 * @query nome - Termo para buscar no campo nm_pessoa (ILIKE)
 * @query fantasia - Termo para buscar no campo fantasy_name (ILIKE)
 */
router.get(
  '/clientes/search-name',
  asyncHandler(async (req, res) => {
    const { nome, fantasia, cnpj } = req.query;

    if (!nome && !fantasia && !cnpj) {
      return errorResponse(
        res,
        'Informe pelo menos um dos campos: nome, fantasia ou cnpj',
        400,
        'MISSING_SEARCH_TERM',
      );
    }

    try {
      let query = supabase
        .from('pes_pessoa')
        .select(
          'code, cd_empresacad, nm_pessoa, fantasy_name, cpf, tipo_pessoa, telefone, email, is_customer, customer_status, person_status',
        )
        .order('nm_pessoa', { ascending: true })
        .limit(50);

      if (cnpj) {
        // Busca por CPF/CNPJ (campo cpf na tabela)
        const cnpjLimpo = cnpj.replace(/[^\d]/g, '');
        query = query.ilike('cpf', `%${cnpjLimpo}%`);
      } else if (nome && fantasia) {
        query = query.or(
          `nm_pessoa.ilike.%${nome}%,fantasy_name.ilike.%${fantasia}%`,
        );
      } else if (nome) {
        query = query.ilike('nm_pessoa', `%${nome}%`);
      } else {
        query = query.ilike('fantasy_name', `%${fantasia}%`);
      }

      const { data, error } = await query;

      if (error) {
        console.error('❌ Erro ao buscar clientes por nome:', error.message);
        return errorResponse(
          res,
          `Erro na busca: ${error.message}`,
          500,
          'SUPABASE_SEARCH_ERROR',
        );
      }

      // Deduplicar por code (pode ter mesmo cliente em várias empresas)
      const uniqueMap = new Map();
      for (const row of data || []) {
        const existing = uniqueMap.get(row.code);
        if (!existing) {
          uniqueMap.set(row.code, row);
        }
      }
      const clientes = Array.from(uniqueMap.values());

      console.log(
        `🔍 Busca por nome: "${nome || ''}" / fantasia: "${fantasia || ''}" → ${clientes.length} resultados`,
      );

      successResponse(
        res,
        { clientes, total: clientes.length },
        `${clientes.length} clientes encontrados`,
      );
    } catch (error) {
      console.error('❌ Erro ao buscar clientes por nome:', error.message);
      errorResponse(
        res,
        `Erro ao buscar: ${error.message}`,
        500,
        'SEARCH_NAME_ERROR',
      );
    }
  }),
);

/**
 * @route POST /totvs/clientes/save-supabase
 * @desc Recebe array de clientes e faz upsert no Supabase (tabela pes_pessoa)
 * @body { clientes: Array }
 */
router.post(
  '/clientes/save-supabase',
  asyncHandler(async (req, res) => {
    const { clientes } = req.body;

    if (!Array.isArray(clientes) || clientes.length === 0) {
      return errorResponse(
        res,
        'O campo clientes é obrigatório e deve ser um array não-vazio',
        400,
        'MISSING_CLIENTES',
      );
    }

    const startTime = Date.now();
    console.log(`💾 Salvando ${clientes.length} clientes no Supabase...`);

    try {
      const result = await upsertBatch(clientes);
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);

      console.log(
        `✅ Upsert concluído: ${result.inserted} inseridos, ${result.errors} erros em ${duration}s`,
      );

      successResponse(
        res,
        {
          inserted: result.inserted,
          errors: result.errors,
          total: clientes.length,
          duration: `${duration}s`,
        },
        `${result.inserted} clientes salvos no Supabase`,
      );
    } catch (error) {
      console.error('❌ Erro ao salvar no Supabase:', error.message);
      errorResponse(
        res,
        `Erro ao salvar clientes no Supabase: ${error.message}`,
        500,
        'SAVE_SUPABASE_ERROR',
      );
    }
  }),
);

/**
 * @route POST /totvs/sync/pes-pessoa/full
 * @desc Carga COMPLETA de todas as pessoas (PF + PJ) do TOTVS para o Supabase.
 *       Use apenas uma vez para popular a tabela pes_pessoa.
 *       ATENÇÃO: Pode demorar vários minutos dependendo do volume de dados.
 * @access Public
 */
router.post(
  '/sync/pes-pessoa/full',
  asyncHandler(async (req, res) => {
    console.log('🚀 Iniciando SYNC FULL pes_pessoa (manual via API)');

    const result = await syncFullPesPessoa();

    if (result.success) {
      successResponse(
        res,
        result,
        'Sincronização completa concluída com sucesso',
      );
    } else {
      errorResponse(
        res,
        `Erro na sincronização: ${result.error}`,
        500,
        'SYNC_FULL_ERROR',
      );
    }
  }),
);

/**
 * @route POST /totvs/sync/pes-pessoa/incremental
 * @desc Sincronização INCREMENTAL: busca apenas pessoas alteradas/criadas nas últimas 24h
 *       e faz upsert no Supabase. É o que roda automaticamente todo dia às 03:00.
 * @access Public
 */
router.post(
  '/sync/pes-pessoa/incremental',
  asyncHandler(async (req, res) => {
    console.log('🔄 Iniciando SYNC INCREMENTAL pes_pessoa (manual via API)');

    const result = await syncIncrementalPesPessoa();

    if (result.success) {
      successResponse(res, result, 'Sincronização incremental concluída');
    } else {
      errorResponse(
        res,
        `Erro na sincronização incremental: ${result.error}`,
        500,
        'SYNC_INCREMENTAL_ERROR',
      );
    }
  }),
);

/**
 * @route POST /totvs/person-statistics
 * @desc Busca estatísticas de um cliente na API TOTVS Moda
 * @access Public
 * @body { personCode: number }
 */
router.post(
  '/person-statistics',
  asyncHandler(async (req, res) => {
    const { personCode, branchCode } = req.body;

    if (personCode === undefined || personCode === null || personCode === '') {
      return errorResponse(
        res,
        'O campo personCode é obrigatório',
        400,
        'MISSING_PERSON_CODE',
      );
    }

    const personCodeNum =
      typeof personCode === 'string' ? parseInt(personCode, 10) : personCode;

    if (isNaN(personCodeNum) || personCodeNum < 0) {
      return errorResponse(
        res,
        'O campo personCode deve ser um número inteiro válido',
        400,
        'INVALID_PERSON_CODE',
      );
    }

    // BranchCode: usar o informado ou default 1
    const branchCodeNum = branchCode ? parseInt(branchCode, 10) : 1;

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

      const endpoint = `${TOTVS_BASE_URL}/person/v2/person-statistics`;

      // Buscar filiais válidas do TOTVS
      const branchesUrl = `${TOTVS_BASE_URL}/person/v2/branchesList?BranchCodePool=1&Page=1&PageSize=1000`;
      const branchesResp = await axios.get(branchesUrl, {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          Accept: 'application/json',
        },
        httpsAgent,
        timeout: 30000,
      });
      const branchCodes = (branchesResp.data?.items || [])
        .map((b) => b.code)
        .filter((c) => c >= 1 && c <= 990);

      const doRequest = async (accessToken) =>
        axios.get(endpoint, {
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          params: { CustomerCode: personCodeNum, BranchCode: branchCodes },
          paramsSerializer: (params) => {
            const parts = [];
            for (const [key, value] of Object.entries(params)) {
              if (Array.isArray(value)) {
                value.forEach((v) => parts.push(`${key}=${v}`));
              } else {
                parts.push(`${key}=${value}`);
              }
            }
            return parts.join('&');
          },
          httpsAgent,
          timeout: 30000,
        });

      let response;
      try {
        response = await doRequest(tokenData.access_token);
      } catch (error) {
        if (error.response?.status === 401) {
          const newTokenData = await getToken(true);
          response = await doRequest(newTokenData.access_token);
        } else {
          throw error;
        }
      }

      successResponse(
        res,
        response.data,
        'Estatísticas do cliente obtidas com sucesso',
      );
    } catch (error) {
      console.error('❌ Erro ao consultar person-statistics:', {
        message: error.message,
        status: error.response?.status,
        responseData: error.response?.data,
      });

      errorResponse(
        res,
        error.response?.data?.message ||
          `Erro ao consultar estatísticas do cliente: ${error.message}`,
        error.response?.status || 500,
        'PERSON_STATISTICS_ERROR',
      );
    }
  }),
);

// ==========================================
// RANKING DE PRODUTOS MAIS VENDIDOS
// ==========================================

/**
 * @route POST /totvs/best-selling-products
 * @desc Busca ranking de produtos mais vendidos em um período
 * @body { branchs: number[], datemin: string, datemax: string }
 */
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
        data: JSON.stringify(error.response?.data, null, 2),
      });

      if (error.response) {
        const totvsMsg =
          error.response.data?.message ||
          error.response.data?.errors?.[0]?.message ||
          error.response.data?.error ||
          (typeof error.response.data === 'string'
            ? error.response.data
            : null) ||
          'Erro ao buscar saldos na API TOTVS';
        return errorResponse(
          res,
          totvsMsg,
          error.response.status || 500,
          'TOTVS_API_ERROR',
          { totvs: error.response.data },
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

/**
 * POST /product-search
 * Busca produtos via API TOTVS com suporte a expand (barCodes, classifications, etc.)
 */
router.post(
  '/product-search',
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

      if (!filter || !option || option.branchInfoCode == null) {
        return errorResponse(
          res,
          'Campos obrigatórios: filter, option.branchInfoCode',
          400,
          'MISSING_PARAMS',
        );
      }

      const body = {
        filter: filter || {},
        option,
        page: page || 1,
        pageSize: Math.min(pageSize || 200, 1000),
      };

      if (order) body.order = order;
      if (expand) body.expand = expand;

      const url = `${TOTVS_BASE_URL}/product/v2/products/search`;
      console.log('🔍 Buscando produtos TOTVS:', url);
      console.log('🔍 Body:', JSON.stringify(body, null, 2));

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
        `✅ Produtos encontrados: ${data.items?.length || 0} itens (total: ${data.totalItems || 0})`,
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
        `${data.items?.length || 0} produtos encontrados`,
      );
    } catch (error) {
      console.error('❌ Erro ao buscar produtos TOTVS:', {
        message: error.message,
        status: error.response?.status,
        data: JSON.stringify(error.response?.data, null, 2),
      });

      if (error.response) {
        const totvsMsg =
          error.response.data?.message ||
          error.response.data?.errors?.[0]?.message ||
          error.response.data?.error ||
          (typeof error.response.data === 'string'
            ? error.response.data
            : null) ||
          'Erro ao buscar produtos na API TOTVS';
        return errorResponse(
          res,
          totvsMsg,
          error.response.status || 500,
          'TOTVS_API_ERROR',
          { totvs: error.response.data },
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

// ==========================================
// PAINEL DE VENDAS - SalePanel + SellerPanel
// ==========================================

/**
 * Helper genérico para chamar endpoints do SalePanel / SellerPanel
 * com retry automático em caso de 401.
 */
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
    console.log(`📊 [PainelVendas] ${url}`);

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
      return errorResponse(
        res,
        error.response.data?.message || 'Erro na API TOTVS',
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

/**
 * @route POST /totvs/sale-panel/totals
 * @desc Totais gerais do painel de vendas
 */
router.post(
  '/sale-panel/totals',
  asyncHandler(async (req, res) => {
    await callTotvsAnalytics('/sale-panel/v2/totals/search', req.body, res);
  }),
);

/**
 * @route POST /totvs/sale-panel/hours
 * @desc Vendas por hora
 */
router.post(
  '/sale-panel/hours',
  asyncHandler(async (req, res) => {
    await callTotvsAnalytics('/sale-panel/v2/hours/search', req.body, res);
  }),
);

/**
 * @route POST /totvs/sale-panel/weekdays
 * @desc Vendas por dia da semana
 */
router.post(
  '/sale-panel/weekdays',
  asyncHandler(async (req, res) => {
    await callTotvsAnalytics('/sale-panel/v2/weekdays/search', req.body, res);
  }),
);

/**
 * @route POST /totvs/sale-panel/sellers
 * @desc Vendas por vendedor
 */
router.post(
  '/sale-panel/sellers',
  asyncHandler(async (req, res) => {
    await callTotvsAnalytics('/sale-panel/v2/sellers/search', req.body, res);
  }),
);

/**
 * @route POST /totvs/sale-panel/sellers-list
 * @desc Lista de vendedores
 */
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

/**
 * @route POST /totvs/sale-panel/totals-seller
 * @desc Totais por vendedor
 */
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

/**
 * @route POST /totvs/sale-panel/totals-branch
 * @desc Totais por empresa
 */
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

/**
 * @route POST /totvs/sale-panel/totals-branch-type
 * @desc Totais por tipo de empresa
 */
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

/**
 * @route POST /totvs/sale-panel/document-types
 * @desc Vendas por forma de pagamento
 */
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

/**
 * @route POST /totvs/sale-panel/product-classifications
 * @desc Vendas por classificação de produto
 */
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

/**
 * @route GET /totvs/sale-panel/product-classification-types
 * @desc Tipos de classificação de produto
 */
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

/**
 * @route POST /totvs/sale-panel/branch-ranking
 * @desc Ranking de vendas por empresa
 */
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

/**
 * @route POST /totvs/seller-panel/totals
 * @desc Totais do painel de vendedor
 */
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

/**
 * @route POST /totvs/seller-panel/sales-vs-returns
 * @desc Vendas vs devoluções
 */
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

/**
 * @route POST /totvs/seller-panel/weekdays
 * @desc Vendas por dia da semana (vendedor)
 */
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

/**
 * @route POST /totvs/seller-panel/product-classification
 * @desc Classificação de produto por vendedor
 */
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

/**
 * @route POST /totvs/seller-panel/sales-target
 * @desc Metas do vendedor
 */
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

/**
 * @route POST /totvs/seller-panel/top-customers
 * @desc Melhores clientes
 */
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

/**
 * @route GET /totvs/cnpj/:cnpj
 * @desc Consulta dados completos de CNPJ via BrasilAPI (gratuita, sem auth)
 */
router.get(
  '/cnpj/:cnpj',
  asyncHandler(async (req, res) => {
    const cnpj = req.params.cnpj.replace(/\D/g, '');
    if (cnpj.length !== 14) {
      return errorResponse(res, 'CNPJ inválido — deve conter 14 dígitos', 400);
    }
    const response = await axios.get(
      `https://brasilapi.com.br/api/cnpj/v1/${cnpj}`,
      { timeout: 15000 },
    );
    successResponse(res, response.data, 'CNPJ consultado com sucesso');
  }),
);

/**
 * @route GET /totvs/cep/:cep
 * @desc Consulta CEP com geolocalização via BrasilAPI v2 (gratuita, sem auth)
 */
router.get(
  '/cep/:cep',
  asyncHandler(async (req, res) => {
    const cep = req.params.cep.replace(/\D/g, '');
    if (cep.length !== 8) {
      return errorResponse(res, 'CEP inválido — deve conter 8 dígitos', 400);
    }
    const response = await axios.get(
      `https://brasilapi.com.br/api/cep/v2/${cep}`,
      { timeout: 15000 },
    );
    successResponse(res, response.data, 'CEP consultado com sucesso');
  }),
);

/**
 * @route POST /totvs/fiscal-nf-search
 * @desc Busca notas fiscais (todas as operações/empresas) com filtro completo.
 *       Suporta paginação automática (fetchAll=true) ou manual (page + pageSize).
 * @body {object}   [change]                    — filtro por data de alteração { startDate, endDate }
 * @body {number[]} [branchCodeList]             — lista de códigos de filial
 * @body {number[]} [invoiceSequenceList]        — lista de sequências de NF
 * @body {number[]} [invoiceCodeList]            — lista de códigos de NF
 * @body {string}   [operationType]              — tipo de operação ("All", "Input", "Output")
 * @body {string}   [origin]                     — origem ("All", etc.)
 * @body {string[]} [invoiceStatusList]          — status da NF ("Canceled", "Normal", etc.)
 * @body {number[]} [personCodeList]             — lista de códigos de pessoa
 * @body {number[]} [operationCodeList]          — lista de códigos de operação
 * @body {number[]} [documentTypeCodeList]       — lista de códigos de tipo de documento
 * @body {string[]} [personCpfCnpjList]          — lista de CPF/CNPJ de pessoa
 * @body {number}   [startInvoiceCode]           — código inicial de NF
 * @body {number}   [endInvoiceCode]             — código final de NF
 * @body {string}   [startIssueDate]             — data de emissão inicial (ex: "2025-07-01T00:00:00")
 * @body {string}   [endIssueDate]               — data de emissão final (ex: "2025-12-31T23:59:59")
 * @body {string[]} [serialCodeList]             — lista de códigos de série
 * @body {string[]} [eletronicInvoiceStatusList] — status da NF-e ("Authorized", etc.)
 * @body {number[]} [shippingCompanyCodeList]    — lista de códigos de transportadora
 * @body {string[]} [shippingCompanyCpfCnpjList] — lista de CPF/CNPJ de transportadora
 * @body {number}   [amountLastDays]             — quantidade de dias anteriores
 * @body {number}   [transactionBranchCode]      — código da filial da transação
 * @body {number}   [transactionCode]            — código da transação
 * @body {string}   [transactionDate]            — data da transação
 * @body {string}   [expand]                     — padrão "items"
 * @body {number}   [page]                       — padrão 1 (ignorado se fetchAll=true)
 * @body {number}   [pageSize]                   — padrão 100
 * @body {string}   [order]                      — ex: "issueDate:desc"
 * @body {boolean}  [fetchAll]                   — se true, busca todas as páginas e retorna tudo
 */
router.post(
  '/fiscal-nf-search',
  asyncHandler(async (req, res) => {
    const {
      // Campos de filtro
      change,
      branchCodeList,
      invoiceSequenceList,
      invoiceCodeList,
      operationType,
      origin,
      invoiceStatusList,
      personCodeList,
      operationCodeList,
      documentTypeCodeList,
      personCpfCnpjList,
      startInvoiceCode,
      endInvoiceCode,
      startIssueDate,
      endIssueDate,
      serialCodeList,
      eletronicInvoiceStatusList,
      shippingCompanyCodeList,
      shippingCompanyCpfCnpjList,
      amountLastDays,
      transactionBranchCode,
      transactionCode,
      transactionDate,
      // Campos de paginação/controle
      expand = 'items',
      page = 1,
      pageSize = 100,
      order = 'issueDate:desc',
      fetchAll = false,
    } = req.body || {};

    const tokenData = await getToken();
    if (!tokenData?.access_token) {
      return errorResponse(
        res,
        'Não foi possível obter token de autenticação TOTVS',
        503,
        'TOKEN_UNAVAILABLE',
      );
    }

    const endpoint = `${TOTVS_BASE_URL}/fiscal/v2/invoices/search`;

    // Monta o objeto filter apenas com campos definidos
    const buildFilter = () => {
      const filter = {};
      if (change) filter.change = change;
      if (branchCodeList?.length) filter.branchCodeList = branchCodeList;
      if (invoiceSequenceList?.length)
        filter.invoiceSequenceList = invoiceSequenceList;
      if (invoiceCodeList?.length) filter.invoiceCodeList = invoiceCodeList;
      if (operationType) filter.operationType = operationType;
      if (origin) filter.origin = origin;
      if (invoiceStatusList?.length)
        filter.invoiceStatusList = invoiceStatusList;
      if (personCodeList?.length) filter.personCodeList = personCodeList;
      if (operationCodeList?.length)
        filter.operationCodeList = operationCodeList;
      if (documentTypeCodeList?.length)
        filter.documentTypeCodeList = documentTypeCodeList;
      if (personCpfCnpjList?.length)
        filter.personCpfCnpjList = personCpfCnpjList;
      if (startInvoiceCode != null) filter.startInvoiceCode = startInvoiceCode;
      if (endInvoiceCode != null) filter.endInvoiceCode = endInvoiceCode;
      if (startIssueDate) filter.startIssueDate = startIssueDate;
      if (endIssueDate) filter.endIssueDate = endIssueDate;
      if (serialCodeList?.length) filter.serialCodeList = serialCodeList;
      if (eletronicInvoiceStatusList?.length)
        filter.eletronicInvoiceStatusList = eletronicInvoiceStatusList;
      if (shippingCompanyCodeList?.length)
        filter.shippingCompanyCodeList = shippingCompanyCodeList;
      if (shippingCompanyCpfCnpjList?.length)
        filter.shippingCompanyCpfCnpjList = shippingCompanyCpfCnpjList;
      if (amountLastDays != null) filter.amountLastDays = amountLastDays;
      if (transactionBranchCode != null)
        filter.transactionBranchCode = transactionBranchCode;
      if (transactionCode != null) filter.transactionCode = transactionCode;
      if (transactionDate) filter.transactionDate = transactionDate;
      return filter;
    };

    const buildPayload = (currentPage) => ({
      filter: buildFilter(),
      expand,
      page: currentPage,
      pageSize,
      order,
    });

    const doRequest = async (payload, accessToken) =>
      axios.post(endpoint, payload, {
        httpsAgent,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        timeout: 120000,
      });

    const fetchPage = async (currentPage) => {
      const payload = buildPayload(currentPage);
      let response;
      try {
        response = await doRequest(payload, tokenData.access_token);
      } catch (err) {
        if (err.response?.status === 401) {
          const newToken = await getToken(true);
          response = await doRequest(payload, newToken.access_token);
        } else {
          console.error(`❌ TOTVS API error (page ${currentPage}):`, {
            status: err.response?.status,
            statusText: err.response?.statusText,
            data: JSON.stringify(err.response?.data),
            payload: JSON.stringify(payload),
          });
          throw err;
        }
      }
      return response.data;
    };

    if (!fetchAll) {
      const data = await fetchPage(page);
      return successResponse(res, data, 'Notas fiscais obtidas com sucesso');
    }

    // Busca todas as páginas automaticamente (com paralelismo)
    const firstPage = await fetchPage(1);
    const totalRecords = firstPage?.totalRecords ?? firstPage?.total ?? 0;
    const totalPages =
      totalRecords > 0 ? Math.ceil(totalRecords / pageSize) : 1;

    const allItems = [...(firstPage?.items || firstPage?.data || [])];

    if (totalPages > 1) {
      const CONCURRENCY = 10;
      const remaining = Array.from({ length: totalPages - 1 }, (_, i) => i + 2);

      for (let i = 0; i < remaining.length; i += CONCURRENCY) {
        const batch = remaining.slice(i, i + CONCURRENCY);
        const results = await Promise.all(batch.map((p) => fetchPage(p)));
        for (const pageData of results) {
          const items = pageData?.items || pageData?.data || [];
          allItems.push(...items);
        }
      }
    }

    successResponse(
      res,
      { totalRecords, totalPages, pageSize, items: allItems },
      `${allItems.length} notas fiscais obtidas com sucesso`,
    );
  }),
);

/**
 * @route POST /totvs/fiscal-nf-save
 * @desc Recebe um array de notas fiscais (vindas da rota fiscal-nf-search) e faz
 *       upsert na tabela notas_fiscais do Supabase.
 *       Chave de upsert: branch_code + transaction_code
 * @body {object[]} items — array de NFs retornado pela API TOTVS
 */
router.post(
  '/fiscal-nf-save',
  asyncHandler(async (req, res) => {
    const { items } = req.body || {};

    if (!Array.isArray(items) || items.length === 0) {
      return errorResponse(
        res,
        'items deve ser um array não vazio',
        400,
        'VALIDATION',
      );
    }

    // Mapear campos da API TOTVS para colunas da tabela
    const parseDate = (v) => (v ? v.split('T')[0] : null);
    const parseIntOrNull = (v) => {
      const n = parseInt(v);
      return isNaN(n) ? null : n;
    };
    const parseFloatOrNull = (v) => {
      const n = parseFloat(v);
      return isNaN(n) ? null : n;
    };

    const rows = items
      .map((nf) => ({
        // --- Identificação ---
        branch_code: parseIntOrNull(nf.branchCode),
        branch_cnpj: nf.branchCnpj ?? null,
        transaction_code: parseIntOrNull(nf.transactionCode),
        transaction_branch_code: parseIntOrNull(nf.transactionBranchCode),
        transaction_date: parseDate(nf.transactionDate),
        invoice_code: nf.invoiceCode ?? null,
        invoice_sequence: parseIntOrNull(nf.invoiceSequence),
        serial_code: nf.serialCode ?? null,
        invoice_status: nf.invoiceStatus ?? null,
        issue_date: parseDate(nf.issueDate) || parseDate(nf.invoiceDate),
        invoice_date: parseDate(nf.invoiceDate),
        release_date: parseDate(nf.releaseDate),
        exit_time: nf.exitTime ?? null,
        last_change_date: nf.lastchangeDate ?? null,
        max_change_filter_date: nf.maxChangeFilterDate ?? null,

        // --- Pessoa ---
        person_code: parseIntOrNull(nf.personCode),
        person_name: nf.personName ?? null,
        person_cpf_cnpj: nf.person?.personCpfCnpj ?? nf.personCpfCnpj ?? null,
        person: nf.person ?? null,

        // --- Operação ---
        origin: nf.origin ?? null,
        document_type_code: parseIntOrNull(nf.documentType),
        operation_type: nf.operationType ?? null,
        operation_code: parseIntOrNull(nf.operationCode),
        operation_name: nf.operatioName ?? nf.operationName ?? null,

        // --- PDV ---
        inclusion_component_code: nf.inclusionComponentCode ?? null,
        peripheral_pdv_code: nf.peripheralPdvCode ?? null,
        version_pdv: nf.versionPdv ?? null,
        mobile_version: nf.mobileVersion ?? null,
        id_document_pdv: nf.idDocumentPDV ?? null,
        user_code: parseIntOrNull(nf.userCode),
        terminal_code: parseIntOrNull(nf.terminalCode),

        // --- Condição de pagamento ---
        payment_condition_code: parseIntOrNull(nf.paymentConditionCode),
        payment_condition_name: nf.paymentConditionName ?? null,

        // --- Valores financeiros ---
        quantity: parseFloatOrNull(nf.quantity),
        product_value: parseFloatOrNull(nf.productValue),
        additional_value: parseFloatOrNull(nf.additionalValue),
        discount_value: parseFloatOrNull(nf.discountValue),
        discount_percentage: parseFloatOrNull(nf.discountPercentage),
        shipping_value: parseFloatOrNull(nf.shippingValue),
        freight_value: parseFloatOrNull(
          nf.shippingCompany?.freightValue ?? nf.freightValue,
        ),
        insurance_value: parseFloatOrNull(nf.insuranceValue),
        other_expenses: parseFloatOrNull(nf.otherExpenses),
        ipi_value: parseFloatOrNull(nf.ipiValue),
        base_icms_value: parseFloatOrNull(nf.baseIcmsValue),
        icms_value: parseFloatOrNull(nf.icmsValue),
        icms_st_value: parseFloatOrNull(nf.icmsStValue),
        icms_sub_st_value: parseFloatOrNull(nf.icmsSubStValue),
        pis_value: parseFloatOrNull(nf.pisValue),
        cofins_value: parseFloatOrNull(nf.cofinsValue),
        total_value: parseFloatOrNull(nf.totalValue),
        seller_cpf: nf.sellerCpf ?? null,

        // --- NF-e (eletrônica) ---
        eletronic_invoice_status:
          nf.eletronic?.electronicInvoiceStatus ??
          nf.eletronicInvoiceStatus ??
          null,
        eletronic: nf.eletronic ?? null,

        // --- Transportadora ---
        shipping_company_code: parseIntOrNull(
          nf.shippingCompany?.shippingCompanyCode ?? nf.shippingCompanyCode,
        ),
        shipping_company_cpf_cnpj:
          nf.shippingCompany?.cpfCnpj ?? nf.shippingCompanyCpfCnpj ?? null,
        shipping_company: nf.shippingCompany ?? null,

        // --- ECF / SAT ---
        ecf: nf.ecf ?? null,
        sat: nf.sat ?? null,

        // --- Pedidos / Produção ---
        production_order: nf.productionOrder ?? null,
        sales_order: nf.salesOrder ?? null,

        // --- Pagamentos ---
        payments: nf.payments ?? null,

        // --- Observações ---
        observation_nf: nf.observationNF ?? null,
        observation_nfe: nf.observationNFE ?? null,

        // --- Referências ---
        referenced_tax_invoice: nf.referencedTaxInvoice ?? null,

        // --- Itens e dados brutos ---
        items: nf.items ?? [],
        raw_data: nf,
        synced_at: new Date().toISOString(),
      }))
      .filter((r) => r.branch_code && r.transaction_code); // descartar linhas sem chave

    if (rows.length === 0) {
      return errorResponse(
        res,
        'Nenhum registro válido (branch_code e transaction_code obrigatórios)',
        400,
        'VALIDATION',
      );
    }

    // Upsert em lotes de 200 para evitar payload muito grande
    const BATCH_SIZE = 200;
    let totalUpserted = 0;

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);

      const { error, count } = await supabaseFiscal
        .from('notas_fiscais')
        .upsert(batch, {
          onConflict:
            'branch_code,transaction_code,invoice_code,issue_date,total_value',
          count: 'exact',
        });

      if (error) {
        logger.error(
          `Erro no upsert de NFs (lote ${i / BATCH_SIZE + 1}): ${error.message}`,
        );
        return errorResponse(res, error.message, 500, 'DB_ERROR');
      }

      totalUpserted += count ?? batch.length;
    }

    successResponse(
      res,
      { saved: totalUpserted, total: rows.length },
      `${totalUpserted} nota(s) fiscal(is) salva(s) com sucesso`,
    );
  }),
);

export default router;
