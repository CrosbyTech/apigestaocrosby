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
export default router;
