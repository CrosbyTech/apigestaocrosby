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
export default router;
