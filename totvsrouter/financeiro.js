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
  getBranchCodes,
} from './totvsHelper.js';

const router = express.Router();

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
export default router;
