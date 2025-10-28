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
  })
);

// URL da API TOTVS Moda - baseado na documentação Swagger
// Documentação: https://www30.bhan.com.br:9443/api/totvsmoda/authorization/v2/swagger/index.html
// Pode ser configurada via variável de ambiente TOTVS_AUTH_ENDPOINT
const TOTVS_AUTH_ENDPOINT = 
  process.env.TOTVS_AUTH_ENDPOINT || 
  'https://www30.bhan.com.br:9443/api/totvsmoda/authorization/v2/token';

// URL base da API TOTVS Moda
const TOTVS_BASE_URL = 
  process.env.TOTVS_BASE_URL || 
  'https://www30.bhan.com.br:9443/api/totvsmoda';

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

    if (!['password', 'client_credentials', 'refresh_token'].includes(grant_type)) {
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
      formData.append('ValidationResult.IsValid', req.body.validationResult.isValid || '');
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
            'Accept': 'application/json',
          },
          timeout: 30000, // 30 segundos de timeout
          // Pode ser necessário ignorar erros de certificado SSL em ambiente de desenvolvimento
          // httpsAgent: new https.Agent({ rejectUnauthorized: false }) // Descomente se necessário
        }
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
        const errorMessage = error.code === 'ENOTFOUND'
          ? `URL da API TOTVS não encontrada: ${TOTVS_AUTH_ENDPOINT}. Verifique se a URL está correta.`
          : error.code === 'ECONNREFUSED'
          ? `Conexão recusada pela API TOTVS: ${TOTVS_AUTH_ENDPOINT}. O servidor pode estar offline ou a porta está incorreta.`
          : error.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' || error.code === 'CERT_HAS_EXPIRED'
          ? `Erro de certificado SSL. Verifique a configuração do certificado da API TOTVS.`
          : `Não foi possível conectar à API TOTVS (${error.code || 'Erro desconhecido'})`;

        return errorResponse(
          res,
          errorMessage,
          503,
          'TOTVS_CONNECTION_ERROR',
        );
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
    const branchCodeNum = typeof branchCode === 'string' ? parseInt(branchCode, 10) : branchCode;
    
    if (isNaN(branchCodeNum) || branchCodeNum < 0 || branchCodeNum.toString().length > 4) {
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

    if (customerCode !== undefined && customerCode !== null && customerCode !== '') {
      // Converter para número se vier como string
      const customerCodeNum = typeof customerCode === 'string' ? parseInt(customerCode, 10) : customerCode;
      
      if (isNaN(customerCodeNum) || customerCodeNum < 0 || customerCodeNum.toString().length > 9) {
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
      if (typeof customerCpfCnpj !== 'string' || !/^\d+$/.test(customerCpfCnpj)) {
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

    if (receivableCode === undefined || receivableCode === null || receivableCode === '') {
      return errorResponse(
        res,
        'O campo receivableCode é obrigatório',
        400,
        'MISSING_RECEIVABLE_CODE',
      );
    }

    // Converter para número se vier como string
    const receivableCodeNum = typeof receivableCode === 'string' ? parseInt(receivableCode, 10) : receivableCode;
    
    if (isNaN(receivableCodeNum) || receivableCodeNum < 0 || receivableCodeNum.toString().length > 10) {
      return errorResponse(
        res,
        'O campo receivableCode deve ser um número inteiro com máximo de 10 caracteres',
        400,
        'INVALID_RECEIVABLE_CODE',
      );
    }

    if (installmentNumber === undefined || installmentNumber === null || installmentNumber === '') {
      return errorResponse(
        res,
        'O campo installmentNumber é obrigatório',
        400,
        'MISSING_INSTALLMENT_NUMBER',
      );
    }

    // Converter para número se vier como string
    const installmentNumberNum = typeof installmentNumber === 'string' ? parseInt(installmentNumber, 10) : installmentNumber;
    
    if (isNaN(installmentNumberNum) || installmentNumberNum < 0 || installmentNumberNum.toString().length > 3) {
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
      if (customerCode !== undefined && customerCode !== null && customerCode !== '') {
        const customerCodeNum = typeof customerCode === 'string' ? parseInt(customerCode, 10) : customerCode;
        payload.customerCode = customerCodeNum;
      } else {
        payload.customerCpfCnpj = customerCpfCnpj;
      }

      console.log('🧾 Gerando boleto bancário na API TOTVS:', {
        endpoint: `${TOTVS_BASE_URL}/accounts-receivable/v2/bank-slip`,
        branchCode: payload.branchCode,
        receivableCode: payload.receivableCode,
        installmentNumber: payload.installmentNumber,
        customerIdentifier: payload.customerCode ? `Code: ${payload.customerCode}` : `CPF/CNPJ: ${payload.customerCpfCnpj}`,
      });

      // Fazer requisição para a API TOTVS
      const response = await axios.post(
        `${TOTVS_BASE_URL}/accounts-receivable/v2/bank-slip`,
        payload,
        {
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Authorization': `Bearer ${tokenData.access_token}`,
          },
          timeout: 30000, // 30 segundos de timeout
        }
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
          ...(typeof response.data === 'object' && response.data?.base64 ? 
            Object.keys(response.data).filter(k => k !== 'base64').reduce((acc, k) => {
              acc[k] = response.data[k];
              return acc;
            }, {}) : {}),
        },
        'Boleto bancário gerado com sucesso',
      );
    } catch (error) {
      // Tratamento de erros da API TOTVS
      console.error('❌ Erro ao gerar boleto bancário na API TOTVS:', {
        message: error.message,
        code: error.code,
        response: error.response?.data,
        status: error.response?.status,
      });

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
                  'Accept': 'application/json',
                  'Authorization': `Bearer ${newTokenData.access_token}`,
                },
                timeout: 30000,
              }
            );

            console.log('✅ Boleto bancário gerado com sucesso após renovar token');

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
                ...(typeof retryResponse.data === 'object' && retryResponse.data?.base64 ? 
                  Object.keys(retryResponse.data).filter(k => k !== 'base64').reduce((acc, k) => {
                    acc[k] = retryResponse.data[k];
                    return acc;
                  }, {}) : {}),
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
        const errorMessage = error.response.data?.message ||
          error.response.data?.error ||
          error.response.data?.error_description ||
          (typeof error.response.data === 'string' ? error.response.data : 'Erro ao gerar boleto bancário na API TOTVS');

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
            customerIdentifier: customerCode ? `Code: ${customerCode}` : `CPF/CNPJ: ${customerCpfCnpj}`,
          },
        });
        return;
      } else if (error.request) {
        // A requisição foi feita mas não houve resposta
        const errorMessage = error.code === 'ENOTFOUND'
          ? `URL da API TOTVS não encontrada. Verifique se a URL está correta.`
          : error.code === 'ECONNREFUSED'
          ? `Conexão recusada pela API TOTVS. O servidor pode estar offline.`
          : `Não foi possível conectar à API TOTVS (${error.code || 'Erro desconhecido'})`;

        return errorResponse(
          res,
          errorMessage,
          503,
          'TOTVS_CONNECTION_ERROR',
        );
      } else {
        // Erro ao configurar a requisição
        throw new Error(`Erro ao chamar API TOTVS: ${error.message}`);
      }
    }
  })
);

export default router;