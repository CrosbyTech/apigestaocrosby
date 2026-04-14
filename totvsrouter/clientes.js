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
import {
  syncFullPesPessoa,
  syncIncrementalPesPessoa,
  fetchAndMapPersons,
  mapPersonToRow,
  upsertBatch,
} from '../utils/syncPesPessoa.js';
import supabase from '../config/supabase.js';
const router = express.Router();

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
            if (num.length < 8) return false;
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

// =============================================================================
// BUSCA PESSOA FÍSICA POR TELEFONE
// =============================================================================

/**
 * @route POST /totvs/individual/search-by-phone
 * @desc Busca pessoa física por número de telefone na API TOTVS
 *       A API TOTVS PF suporta filtro direto por phoneNumber.
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
// CONSULTA CNPJ (BrasilAPI)
// ==========================================

/**
 * @route GET /totvs/cnpj/:cnpj
 * @desc Consulta dados públicos de um CNPJ via BrasilAPI
 * @param cnpj — apenas números, 14 dígitos
 */
router.get(
  '/cnpj/:cnpj',
  asyncHandler(async (req, res) => {
    const cnpj = (req.params.cnpj || '').replace(/\D/g, '');

    if (cnpj.length !== 14) {
      return errorResponse(
        res,
        'CNPJ deve conter exatamente 14 dígitos numéricos',
        400,
        'INVALID_CNPJ',
      );
    }

    const { data } = await axios.get(
      `https://brasilapi.com.br/api/cnpj/v1/${cnpj}`,
      { timeout: 15000 },
    );

    successResponse(res, data, 'CNPJ consultado com sucesso');
  }),
);

// ==========================================
// CONSULTA CEP (BrasilAPI)
// ==========================================

/**
 * @route GET /totvs/cep/:cep
 * @desc Consulta endereço a partir de um CEP via BrasilAPI
 * @param cep — apenas números, 8 dígitos
 */
router.get(
  '/cep/:cep',
  asyncHandler(async (req, res) => {
    const cep = (req.params.cep || '').replace(/\D/g, '');

    if (cep.length !== 8) {
      return errorResponse(
        res,
        'CEP deve conter exatamente 8 dígitos numéricos',
        400,
        'INVALID_CEP',
      );
    }

    const { data } = await axios.get(
      `https://brasilapi.com.br/api/cep/v2/${cep}`,
      { timeout: 15000 },
    );

    successResponse(res, data, 'CEP consultado com sucesso');
  }),
);

// ==========================================
// BUSCA POR CNPJ / CPF DIRETO NO TOTVS
// ==========================================

/**
 * @route POST /totvs/clientes/search-by-fiscal
 * @desc Busca cliente por CNPJ (PJ) ou CPF (PF) diretamente na API TOTVS
 * @body { fiscalNumber: string } — apenas números (11 ou 14 dígitos)
 */
router.post(
  '/clientes/search-by-fiscal',
  asyncHandler(async (req, res) => {
    const { fiscalNumber } = req.body;

    if (!fiscalNumber) {
      return errorResponse(
        res,
        'O campo fiscalNumber é obrigatório',
        400,
        'MISSING_FISCAL',
      );
    }

    const clean = String(fiscalNumber).replace(/\D/g, '');

    if (clean.length !== 11 && clean.length !== 14) {
      return errorResponse(
        res,
        'fiscalNumber deve ter 11 dígitos (CPF) ou 14 dígitos (CNPJ)',
        400,
        'INVALID_FISCAL',
      );
    }

    const isCNPJ = clean.length === 14;

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

      // PF: usa cpfList no filter (busca direta, sem paginação)
      // PJ: pagina e filtra localmente pelo campo cnpj (API PJ não tem cnpjList)
      const endpoint = isCNPJ
        ? `${TOTVS_BASE_URL}/person/v2/legal-entities/search`
        : `${TOTVS_BASE_URL}/person/v2/individuals/search`;

      console.log(
        `🔍 Buscando ${isCNPJ ? 'PJ (paginação local)' : 'PF (cpfList)'} na TOTVS:`,
        clean,
      );

      const doRequest = async (token, payload) =>
        axios.post(endpoint, payload, {
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Bearer ${token}`,
          },
          timeout: 60000,
        });

      let found = [];
      let currentToken = tokenData.access_token;

      if (!isCNPJ) {
        // ── PF: filtro direto por cpfList ──────────────────────────────────
        const payload = {
          filter: { cpfList: [clean] },
          expand:
            'phones,emails,addresses,contacts,classifications,observations',
          page: 1,
          pageSize: 10,
        };

        let response;
        try {
          response = await doRequest(currentToken, payload);
        } catch (err) {
          if (err.response?.status === 401) {
            const newToken = await getToken(true);
            currentToken = newToken.access_token;
            response = await doRequest(currentToken, payload);
          } else {
            throw err;
          }
        }

        found = response.data?.items || [];
        console.log(`✅ Busca PF por cpfList: ${found.length} resultado(s)`);
      } else {
        // ── PJ: pagina e filtra localmente pelo campo cnpj ──────────────────
        let currentPage = 1;
        let hasMore = true;
        const MAX_PAGES = 30;

        while (hasMore && currentPage <= MAX_PAGES && found.length === 0) {
          const payload = {
            filter: {},
            expand:
              'phones,emails,addresses,contacts,classifications,observations',
            page: currentPage,
            pageSize: 500,
            order: 'personCode',
          };

          let response;
          try {
            response = await doRequest(currentToken, payload);
          } catch (err) {
            if (err.response?.status === 401) {
              const newToken = await getToken(true);
              currentToken = newToken.access_token;
              response = await doRequest(currentToken, payload);
            } else {
              throw err;
            }
          }

          const pageItems = response.data?.items || [];
          hasMore = response.data?.hasNext || false;

          const matches = pageItems.filter((item) => {
            const val = String(item.cnpj || '').replace(/\D/g, '');
            return val === clean;
          });

          found = found.concat(matches);
          console.log(
            `📄 PJ Página ${currentPage}: ${pageItems.length} itens, ${matches.length} match(es)`,
          );
          currentPage++;
        }

        console.log(`✅ Busca PJ: ${found.length} resultado(s)`);
      }

      successResponse(
        res,
        { items: found, total: found.length },
        `${found.length} cliente(s) encontrado(s)`,
      );
    } catch (error) {
      console.error('❌ Erro ao buscar por fiscal number:', {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data,
      });

      if (error.response) {
        return res.status(error.response.status || 400).json({
          success: false,
          message:
            error.response.data?.message ||
            error.response.data?.error ||
            'Erro ao buscar cliente na TOTVS',
          error: 'TOTVS_API_ERROR',
          timestamp: new Date().toISOString(),
          details: error.response.data || null,
          status: error.response.status,
        });
      }

      return errorResponse(
        res,
        `Erro ao buscar cliente: ${error.message}`,
        500,
        'FETCH_ERROR',
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
export default router;
