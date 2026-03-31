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
export default router;
