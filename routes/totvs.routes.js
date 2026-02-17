import express from 'express';
import axios from 'axios';
import {
  asyncHandler,
  successResponse,
  errorResponse,
} from '../utils/errorHandler.js';
import { getToken, getTokenInfo } from '../utils/totvsTokenManager.js';

const router = express.Router();

// URL base da nossa API (Render)
// Configurar via variável de ambiente API_BASE_URL no Render
// Exemplo: https://sua-api.onrender.com
const API_BASE_URL =
  process.env.API_BASE_URL ||
  process.env.RENDER_EXTERNAL_URL ||
  'http://localhost:4000';

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
      const invoicesDefaults = {
        filter: { change: {} },
        page: 1,
        pageSize: 100,
        expand: 'person',
      };
      const invoicesBody = {
        ...invoicesDefaults,
        ...searchPayload,
        filter: { ...invoicesDefaults.filter, ...(searchPayload.filter || {}) },
      };

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

      const items = invoicesResp?.data?.items || [];
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
// Sem lookup de nomes (usa CPF/CNPJ direto)
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

      if (status === 'Vencido') {
        const hoje = new Date();
        hoje.setHours(0, 0, 0, 0);
        filteredItems = filteredItems.filter((item) => {
          const dataVenc = item.expiredDate ? new Date(item.expiredDate) : null;
          return dataVenc && dataVenc < hoje && !item.paymentDate;
        });
      } else if (status === 'Pago' || status === 'Liquidado') {
        filteredItems = filteredItems.filter(
          (item) => item.paymentDate || item.dischargeType > 0,
        );
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

      // PASSO 4: Mapear para formato frontend (sem lookup de nomes - usa CPF/CNPJ)
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

export default router;
