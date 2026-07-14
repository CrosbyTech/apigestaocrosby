import express from 'express';
import axios from 'axios';
import {
  asyncHandler,
  successResponse,
  errorResponse,
} from '../utils/errorHandler.js';
import { getToken } from '../utils/totvsTokenManager.js';
import {
  httpsAgent,
  httpAgent,
  TOTVS_BASE_URL,
} from '../totvsrouter/totvsHelper.js';
import supabase from '../config/supabase.js';

const router = express.Router();

const VOUCHER_SEARCH_ENDPOINT = `${TOTVS_BASE_URL}/voucher/v2/search`;
const VOUCHER_UPDATE_ENDPOINT = `${TOTVS_BASE_URL}/voucher/v2/update`;
const VOUCHER_CREATE_ENDPOINT = `${TOTVS_BASE_URL}/voucher/v2/create`;
const VOUCHER_CUSTOMER_CREATE_ENDPOINT = `${TOTVS_BASE_URL}/voucher/v2/customer/create`;
const INVOICES_SEARCH_ENDPOINT = `${TOTVS_BASE_URL}/fiscal/v2/invoices/search`;
const PERSON_INDIVIDUALS_SEARCH_ENDPOINT = `${TOTVS_BASE_URL}/person/v2/individuals/search`;
const PERSON_LEGAL_ENTITIES_SEARCH_ENDPOINT = `${TOTVS_BASE_URL}/person/v2/legal-entities/search`;

// ==========================================
// Configuração padrão do "Voucher Varejo" (componente PDVFM066)
// Baseado no print do sistema TOTVS enviado pela operação:
//   Tipo = Desconto, Situação = Em andamento, Prefixo = PROMO,
//   Desconto (valor) = R$ 50,00, Gatilho = Valor >= R$ 100,00,
//   Validade = 1 dia, empresas participantes do varejo.
// ==========================================
const VAREJO_VOUCHER_CONFIG = {
  branchCodeRegistration: 90, // Empresa de cadastro (operador 090 do print)
  prefixCode: 'PROMO',
  voucherType: 1, // 1 = Desconto
  status: 1, // 1 = Em andamento
  value: 50, // Desconto em R$
  minPurchase: 100, // Gatilho: só válido para compras >= R$ 100
  durationDays: 1, // Validade em dias
  printTemplateCode: 1, // Modelo de impressão (TOTVS exige na criação do voucher)
  // Empresas participantes (frame "Empresa participante" do print)
  participantBranches: [
    2, 5, 55, 65, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98,
  ],
};

// POST autenticado na API TOTVS com retry automático em caso de token expirado (401)
const postTotvsAuthed = async (endpoint, payload) => {
  const tokenData = await getToken();
  if (!tokenData?.access_token) {
    const err = new Error('Não foi possível obter token TOTVS');
    err.status = 503;
    throw err;
  }
  const call = (accessToken) =>
    axios.post(endpoint, payload, {
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      timeout: 60000,
      httpsAgent,
      httpAgent,
    });

  try {
    return await call(tokenData.access_token);
  } catch (error) {
    if (error.response?.status === 401) {
      const newTokenData = await getToken(true);
      return await call(newTokenData.access_token);
    }
    throw error;
  }
};

// Status conforme documentação API TOTVS
// 1 = InProgress (Em andamento)
// 4 = Closed (Encerrado)
// 6 = Canceled (Cancelado)
const STATUS_LABELS = {
  1: 'Em andamento',
  InProgress: 'Em andamento',
  4: 'Encerrado',
  Closed: 'Encerrado',
  6: 'Cancelado',
  Canceled: 'Cancelado',
};

/**
 * @route GET /totvs/vouchers/search
 * @desc Lista vouchers da API TOTVS com filtros de período, filial e status
 * @query {
 *   startDateInitial: string (ISO date, obrigatório),
 *   startDateFinal: string (ISO date, obrigatório),
 *   branchCode: number (opcional - filtrar por filial local após busca),
 *   status: string (opcional - InProgress, Closed, Canceled)
 * }
 */
router.get(
  '/vouchers/search',
  asyncHandler(async (req, res) => {
    const { startDateInitial, startDateFinal, branchCode, status } = req.query;

    if (!startDateInitial || !startDateFinal) {
      return errorResponse(
        res,
        'Os parâmetros startDateInitial e startDateFinal são obrigatórios',
        400,
        'MISSING_REQUIRED_PARAMS',
      );
    }

    if (
      isNaN(Date.parse(startDateInitial)) ||
      isNaN(Date.parse(startDateFinal))
    ) {
      return errorResponse(res, 'Datas inválidas', 400, 'INVALID_DATE_FORMAT');
    }

    if (new Date(startDateInitial) > new Date(startDateFinal)) {
      return errorResponse(
        res,
        'startDateInitial deve ser anterior a startDateFinal',
        400,
        'INVALID_DATE_RANGE',
      );
    }

    const startTime = Date.now();

    // Obter token
    const tokenData = await getToken();
    if (!tokenData?.access_token) {
      return errorResponse(
        res,
        'Não foi possível obter token TOTVS',
        503,
        'TOKEN_UNAVAILABLE',
      );
    }
    const token = tokenData.access_token;

    // Parâmetros de paginação do cliente
    const clientPage = Math.max(1, parseInt(req.query.page || '1', 10));
    const clientPageSize = Math.min(
      200,
      Math.max(1, parseInt(req.query.pageSize || '50', 10)),
    );

    // Buscar todos os vouchers da API TOTVS com fetch paralelo
    const TOTVS_PAGE_SIZE = 100;
    const makeVoucherReq = (p) => {
      const qp = {
        StartDateInitial: startDateInitial,
        StartDateFinal: startDateFinal,
        Page: p,
        PageSize: TOTVS_PAGE_SIZE,
      };
      if (status) qp.Status = status;
      return axios({
        method: 'get',
        url: VOUCHER_SEARCH_ENDPOINT,
        params: qp,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
        timeout: 60000,
        httpsAgent,
        httpAgent,
      });
    };

    const firstResp = await makeVoucherReq(1);
    let allVouchers = firstResp.data?.items || [];
    const totvsPages = firstResp.data?.totalPages || 1;
    if (totvsPages > 1) {
      const remaining = Array.from({ length: totvsPages - 1 }, (_, i) => i + 2);
      const CONCURRENCY = 10;
      for (let i = 0; i < remaining.length; i += CONCURRENCY) {
        const batch = await Promise.all(
          remaining.slice(i, i + CONCURRENCY).map(makeVoucherReq),
        );
        for (const r of batch)
          allVouchers = allVouchers.concat(r.data?.items || []);
      }
    }

    // Filtrar por filial localmente (API não suporta filtro por filial)
    const branchFilter = branchCode ? Number(branchCode) : null;
    if (branchFilter) {
      allVouchers = allVouchers.filter((v) =>
        (v.branchs || []).some((b) => b.branchCode === branchFilter),
      );
    }

    // Normalizar dados e filtrar apenas vouchers com cliente vinculado
    const data = allVouchers
      .map((v) => ({
        voucherNumber: v.voucherNumber || null,
        voucherCode: v.voucherCode || null,
        description: v.description || null,
        prefixCode: v.prefixCode || null,
        voucherType: v.voucherType || null,
        printTemplateCode: v.printTemplateCode || null,
        status: v.status,
        statusLabel: STATUS_LABELS[v.status] || v.status || '—',
        value: Number(v.value) || 0,
        percentage: v.percentage || 0,
        startDate: v.startDate || null,
        endDate: v.endDate || null,
        inclusionDate: v.inclusionDate || null,
        closingDate: v.closingDate || null,
        customerCode: v.customerCode != null ? v.customerCode : null,
        customerName: v.customerName || null,
        partnerCode: v.partnerCode || null,
        partnerName: v.partnerName || null,
        quantity: v.quantity || 0,
        branchCode: v.branchs?.[0]?.branchCode || null,
        branches: (v.branchs || []).map((b) => b.branchCode),
        phoneNumber: v.phoneNumber || v.customerPhone || null, // Adiciona telefone se disponível
      }))
      .filter(
        (v) =>
          v.customerCode != null &&
          v.customerCode !== '' &&
          v.customerCode !== 0 &&
          !!v.customerName &&
          v.customerName.trim() !== '',
      );

    // Resumo completo de todos os vouchers filtrados (antes de paginar)
    const statusCounts = {};
    for (const v of data) {
      statusCounts[v.statusLabel] = (statusCounts[v.statusLabel] || 0) + 1;
    }
    const totalValue =
      Math.round(data.reduce((sum, v) => sum + v.value, 0) * 100) / 100;
    const total = data.length;
    const totalPages = Math.ceil(total / clientPageSize) || 1;
    const pageStart = (clientPage - 1) * clientPageSize;
    const pageData = data.slice(pageStart, pageStart + clientPageSize);

    const queryTime = Date.now() - startTime;

    // Enriquecimento: buscar última compra com desconto para vouchers encerrados
    let enrichEnabled = req.query.enrich === 'true';
    // Só permite enrich se status for 'Encerrado' ou não informado
    if (enrichEnabled) {
      if (
        status &&
        status !== 'Closed' &&
        status !== 'Encerrado' &&
        status !== '4'
      ) {
        enrichEnabled = false;
      }
    }
    if (enrichEnabled) {
      const closedVouchers = pageData.filter(
        (v) => v.statusLabel === 'Encerrado' && v.customerCode,
      );

      if (closedVouchers.length > 0) {
        console.log(
          `🔍 Enriquecendo ${closedVouchers.length} vouchers encerrados com dados fiscais...`,
        );

        // Agrupar vouchers por filial para minimizar chamadas
        const vouchersByBranch = {};
        for (const v of closedVouchers) {
          const bc = v.branchCode;
          if (!bc) continue;
          if (!vouchersByBranch[bc]) vouchersByBranch[bc] = [];
          vouchersByBranch[bc].push(v);
        }

        // Para cada filial, buscar invoices no período dos vouchers
        for (const [bc, vouchers] of Object.entries(vouchersByBranch)) {
          // Encontrar range de datas que cobre todos os vouchers dessa filial
          const dates = vouchers.flatMap((v) =>
            [v.startDate, v.endDate].filter(Boolean),
          );
          if (dates.length === 0) continue;

          const minDate = dates.sort()[0].split('T')[0];
          const maxDate = dates.sort().reverse()[0].split('T')[0];

          // Coletar todos os personCodes únicos
          const personCodes = [
            ...new Set(vouchers.map((v) => v.customerCode).filter(Boolean)),
          ];

          try {
            const invoicesPayload = {
              startDate: minDate,
              endDate: maxDate,
              branchCodeList: [Number(bc)],
              personCodeList: personCodes,
              operationType: 'Output', // Vendas (saída)
              maxPages: 10,
            };

            console.log(
              `📊 Buscando invoices filial ${bc}: ${personCodes.length} clientes, período ${minDate} a ${maxDate}`,
            );

            const invoicesResponse = await axios.post(
              INVOICES_SEARCH_ENDPOINT,
              {
                filter: {
                  branchCodeList: [Number(bc)],
                  change: {
                    startDate: `${minDate}T00:00:00.000Z`,
                    endDate: `${maxDate}T23:59:59.999Z`,
                  },
                  operationType: 'Output',
                  personCodeList: personCodes,
                },
                page: 1,
                pageSize: 100,
              },
              {
                headers: {
                  'Content-Type': 'application/json',
                  Accept: 'application/json',
                  Authorization: `Bearer ${token}`,
                },
                timeout: 60000,
                httpsAgent,
                httpAgent,
              },
            );

            let invoiceItems = invoicesResponse.data?.items || [];

            // Buscar páginas adicionais se necessário
            const totalPages = invoicesResponse.data?.totalPages || 1;
            for (let p = 2; p <= Math.min(totalPages, 10); p++) {
              try {
                const nextResp = await axios.post(
                  INVOICES_SEARCH_ENDPOINT,
                  {
                    filter: {
                      branchCodeList: [Number(bc)],
                      change: {
                        startDate: `${minDate}T00:00:00.000Z`,
                        endDate: `${maxDate}T23:59:59.999Z`,
                      },
                      operationType: 'Output',
                      personCodeList: personCodes,
                    },
                    page: p,
                    pageSize: 100,
                  },
                  {
                    headers: {
                      'Content-Type': 'application/json',
                      Accept: 'application/json',
                      Authorization: `Bearer ${token}`,
                    },
                    timeout: 60000,
                    httpsAgent,
                    httpAgent,
                  },
                );
                invoiceItems = invoiceItems.concat(nextResp.data?.items || []);
                if (!nextResp.data?.hasNext) break;
              } catch (e) {
                console.warn(
                  `⚠️ Erro página ${p} invoices filial ${bc}:`,
                  e.message,
                );
                break;
              }
            }

            console.log(
              `✅ ${invoiceItems.length} invoices encontradas para filial ${bc}`,
            );

            // Para cada voucher, encontrar a última compra dentro da vigência
            for (const voucher of vouchers) {
              const vStart = voucher.startDate
                ? new Date(voucher.startDate)
                : null;
              const vEnd = voucher.endDate ? new Date(voucher.endDate) : null;

              // Filtrar invoices deste cliente dentro da vigência do voucher
              const clientInvoices = invoiceItems
                .filter((inv) => {
                  if (inv.personCode !== voucher.customerCode) return false;
                  const invDate = new Date(
                    inv.invoiceDate || inv.transactionDate,
                  );
                  if (vStart && invDate < vStart) return false;
                  if (vEnd && invDate > vEnd) return false;
                  return true;
                })
                .sort(
                  (a, b) =>
                    new Date(b.invoiceDate || b.transactionDate) -
                    new Date(a.invoiceDate || a.transactionDate),
                );

              if (clientInvoices.length > 0) {
                const lastInvoice = clientInvoices[0];
                // Usar discountValue direto da API se disponível,
                // senão calcular a partir do valor líquido: net * pct / (100 - pct)
                let discountValue = 0;
                if (
                  lastInvoice.discountValue != null &&
                  Number(lastInvoice.discountValue) > 0
                ) {
                  discountValue = Number(lastInvoice.discountValue);
                } else if (lastInvoice.discountPercentage) {
                  const netValue =
                    lastInvoice.totalValue || lastInvoice.productValue || 0;
                  discountValue =
                    Math.round(
                      ((netValue * lastInvoice.discountPercentage) /
                        (100 - lastInvoice.discountPercentage)) *
                        100,
                    ) / 100;
                }

                voucher.lastPurchase = {
                  transactionCode: lastInvoice.transactionCode,
                  transactionDate:
                    lastInvoice.transactionDate || lastInvoice.invoiceDate,
                  productValue: lastInvoice.productValue || 0,
                  totalValue: lastInvoice.totalValue || 0,
                  discountPercentage: lastInvoice.discountPercentage || 0,
                  discountValue,
                  operationName:
                    lastInvoice.operatioName || lastInvoice.operationName || '',
                  invoiceSequence: lastInvoice.invoiceSequence,
                  withinVoucherPeriod: true,
                };
              } else {
                voucher.lastPurchase = null;
              }
            }
          } catch (err) {
            console.error(
              `❌ Erro ao buscar invoices filial ${bc}:`,
              err.message,
            );
            for (const voucher of vouchers) {
              voucher.lastPurchase = null;
            }
          }
        }

        // Vouchers encerrados sem filial
        for (const v of closedVouchers) {
          if (v.lastPurchase === undefined) v.lastPurchase = null;
        }
      }
    }

    successResponse(
      res,
      {
        data: pageData,
        summary: {
          total,
          totalPages,
          currentPage: clientPage,
          pageSize: clientPageSize,
          statusCounts,
          totalValue,
          queryTime,
        },
      },
      `${pageData.length} vouchers (pág. ${clientPage}/${totalPages}, total ${total}) em ${queryTime}ms`,
    );
  }),
);

/**
 * @route POST /vouchers/update-batch
 * @desc Atualiza vouchers em lote na API TOTVS
 * @body {
 *   vouchers: Array<{
 *     voucherNumber: number,
 *     description: string,
 *     voucherType: number,
 *     status: number,
 *     startDate: string,
 *     endDate: string,
 *     value: number,
 *     printTemplateCode: number
 *   }>
 * }
 */
router.post(
  '/vouchers/update-batch',
  asyncHandler(async (req, res) => {
    const { vouchers } = req.body;

    if (!Array.isArray(vouchers) || vouchers.length === 0) {
      return errorResponse(
        res,
        'vouchers deve ser um array não vazio',
        400,
        'INVALID_INPUT',
      );
    }

    const normalizedVouchers = vouchers.map((voucher, index) => ({
      index,
      voucherNumber: Number(voucher?.voucherNumber),
      description:
        typeof voucher?.description === 'string'
          ? voucher.description.trim()
          : '',
      voucherType: Number(voucher?.voucherType),
      status: Number(voucher?.status),
      startDate: voucher?.startDate,
      endDate: voucher?.endDate,
      value: Number(voucher?.value),
      printTemplateCode: Number(voucher?.printTemplateCode),
    }));

    for (const voucher of normalizedVouchers) {
      if (
        !Number.isFinite(voucher.voucherNumber) ||
        voucher.voucherNumber <= 0
      ) {
        return errorResponse(
          res,
          `voucherNumber inválido no item ${voucher.index + 1}`,
          400,
          'INVALID_VOUCHER_NUMBER',
        );
      }

      if (!voucher.description) {
        return errorResponse(
          res,
          `description é obrigatória no item ${voucher.index + 1}`,
          400,
          'MISSING_DESCRIPTION',
        );
      }

      if (!Number.isFinite(voucher.voucherType)) {
        return errorResponse(
          res,
          `voucherType inválido no item ${voucher.index + 1}`,
          400,
          'INVALID_VOUCHER_TYPE',
        );
      }

      if (!Number.isFinite(voucher.status)) {
        return errorResponse(
          res,
          `status inválido no item ${voucher.index + 1}`,
          400,
          'INVALID_STATUS',
        );
      }

      if (!voucher.startDate || Number.isNaN(Date.parse(voucher.startDate))) {
        return errorResponse(
          res,
          `startDate inválida no item ${voucher.index + 1}`,
          400,
          'INVALID_START_DATE',
        );
      }

      if (!voucher.endDate || Number.isNaN(Date.parse(voucher.endDate))) {
        return errorResponse(
          res,
          `endDate inválida no item ${voucher.index + 1}`,
          400,
          'INVALID_END_DATE',
        );
      }

      if (!Number.isFinite(voucher.value)) {
        return errorResponse(
          res,
          `value inválido no item ${voucher.index + 1}`,
          400,
          'INVALID_VALUE',
        );
      }

      if (!Number.isFinite(voucher.printTemplateCode)) {
        return errorResponse(
          res,
          `printTemplateCode inválido no item ${voucher.index + 1}`,
          400,
          'INVALID_PRINT_TEMPLATE_CODE',
        );
      }
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

    const results = await Promise.allSettled(
      normalizedVouchers.map(async (voucher) => {
        const payload = {
          voucherNumber: voucher.voucherNumber,
          description: voucher.description,
          voucherType: voucher.voucherType,
          status: voucher.status,
          startDate: voucher.startDate,
          endDate: voucher.endDate,
          value: voucher.value,
          printTemplateCode: voucher.printTemplateCode,
        };

        const response = await axios.post(VOUCHER_UPDATE_ENDPOINT, payload, {
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Bearer ${tokenData.access_token}`,
          },
          timeout: 60000,
          httpsAgent,
          httpAgent,
        });

        return {
          voucherNumber: voucher.voucherNumber,
          response: response.data,
        };
      }),
    );

    const updated = [];
    const failed = [];

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        updated.push(result.value);
        return;
      }

      failed.push({
        voucherNumber: normalizedVouchers[index].voucherNumber,
        message:
          result.reason?.response?.data?.message ||
          result.reason?.response?.data?.error ||
          result.reason?.message ||
          'Erro ao atualizar voucher',
        details: result.reason?.response?.data || null,
      });
    });

    const hasFailures = failed.length > 0;
    successResponse(
      res,
      {
        updated,
        failed,
        totalRequested: normalizedVouchers.length,
        totalUpdated: updated.length,
        totalFailed: failed.length,
      },
      hasFailures
        ? `${updated.length} voucher(s) atualizado(s) e ${failed.length} com falha`
        : `${updated.length} voucher(s) atualizado(s) com sucesso`,
    );
  }),
);

/**
 * @route POST /vouchers/customers/phones
 * @desc Retorna mapa de telefones para lista de códigos de clientes.
 *       1º busca no Supabase (pes_pessoa); para os não encontrados, consulta o TOTVS.
 * @body { customerCodes: number[] }
 */
router.post(
  '/vouchers/customers/phones',
  asyncHandler(async (req, res) => {
    const { customerCodes } = req.body;

    if (!Array.isArray(customerCodes) || customerCodes.length === 0) {
      return errorResponse(
        res,
        'customerCodes deve ser um array não vazio',
        400,
        'INVALID_INPUT',
      );
    }

    const codes = customerCodes
      .map((c) => parseInt(c, 10))
      .filter((c) => !isNaN(c) && c > 0);

    if (codes.length === 0) {
      return successResponse(
        res,
        { phones: {} },
        'Nenhum código válido informado',
      );
    }

    const phones = {};

    // 1. Buscar no Supabase
    const { data: supabaseData } = await supabase
      .from('pes_pessoa')
      .select('code, telefone, phones')
      .in('code', codes);

    for (const person of supabaseData || []) {
      if (!person.code) continue;
      let phone = person.telefone || '';
      if (!phone && Array.isArray(person.phones) && person.phones.length > 0) {
        const defaultPhone =
          person.phones.find((p) => p.isDefault) || person.phones[0];
        phone = defaultPhone?.number || '';
      }
      if (phone) {
        phones[String(person.code)] = phone.replace(/\D/g, '');
      }
    }

    // 2. Para os não encontrados no Supabase, buscar no TOTVS
    const missingCodes = codes.filter((c) => !phones[String(c)]);
    if (missingCodes.length > 0) {
      console.log(
        `🔍 Buscando ${missingCodes.length} telefones faltantes no TOTVS...`,
      );
      try {
        const tokenData = await getToken();
        if (tokenData?.access_token) {
          const BATCH_SIZE = 50;
          const doRequest = (endpoint, payload) =>
            axios.post(endpoint, payload, {
              headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                Authorization: `Bearer ${tokenData.access_token}`,
              },
              timeout: 30000,
              httpsAgent,
              httpAgent,
            });

          for (let i = 0; i < missingCodes.length; i += BATCH_SIZE) {
            const batch = missingCodes.slice(i, i + BATCH_SIZE);
            const payload = {
              filter: { personCodeList: batch },
              expand: 'phones',
              page: 1,
              pageSize: batch.length,
            };

            const [pjResult, pfResult] = await Promise.allSettled([
              doRequest(
                `${TOTVS_BASE_URL}/person/v2/legal-entities/search`,
                payload,
              ),
              doRequest(
                `${TOTVS_BASE_URL}/person/v2/individuals/search`,
                payload,
              ),
            ]);

            const allItems = [
              ...(pjResult.status === 'fulfilled'
                ? pjResult.value.data?.items || []
                : []),
              ...(pfResult.status === 'fulfilled'
                ? pfResult.value.data?.items || []
                : []),
            ];

            for (const item of allItems) {
              const code = String(item.code);
              if (!code || phones[code]) continue;
              const defaultPhone =
                item.phones?.find((p) => p.isDefault) || item.phones?.[0];
              const phone = (defaultPhone?.number || '').replace(/\D/g, '');
              if (phone) phones[code] = phone;
            }
          }
        }
      } catch (err) {
        console.warn('⚠️ Falha ao buscar telefones no TOTVS:', err.message);
      }
    }

    console.log(
      `📞 Telefones encontrados: ${Object.keys(phones).length} de ${codes.length} clientes`,
    );
    successResponse(
      res,
      { phones },
      `${Object.keys(phones).length} telefones encontrados`,
    );
  }),
);

/**
 * @route POST /vouchers/create-batch
 * @desc Cria vouchers em lote na API TOTVS
 * @body {
 *   vouchers: Array<{
 *     branchCodeRegistration: number,
 *     prefixCode: string,
 *     voucherType: number,
 *     status: number,
 *     startDate: string (ISO),
 *     endDate: string (ISO),
 *     description?: string,
 *     value?: number,
 *     percentage?: number,
 *     quantity?: number,
 *     printTemplateCode?: number,
 *     branchs?: Array<{ branchCode: number }>
 *   }>
 * }
 */
router.post(
  '/vouchers/create-batch',
  asyncHandler(async (req, res) => {
    const { vouchers } = req.body;

    if (!Array.isArray(vouchers) || vouchers.length === 0) {
      return errorResponse(
        res,
        'vouchers deve ser um array não vazio',
        400,
        'INVALID_INPUT',
      );
    }

    const normalizedVouchers = vouchers.map((voucher, index) => ({
      index,
      branchCodeRegistration: Number(voucher?.branchCodeRegistration),
      prefixCode:
        typeof voucher?.prefixCode === 'string'
          ? voucher.prefixCode.trim()
          : '',
      voucherType: Number(voucher?.voucherType),
      status: Number(voucher?.status),
      startDate: voucher?.startDate,
      endDate: voucher?.endDate,
      description:
        typeof voucher?.description === 'string'
          ? voucher.description.trim()
          : '',
      value:
        voucher?.value !== undefined && voucher?.value !== ''
          ? Number(voucher.value)
          : null,
      percentage:
        voucher?.percentage !== undefined && voucher?.percentage !== ''
          ? Number(voucher.percentage)
          : null,
      quantity:
        voucher?.quantity !== undefined && voucher?.quantity !== ''
          ? Number(voucher.quantity)
          : null,
      printTemplateCode:
        voucher?.printTemplateCode !== undefined &&
        voucher?.printTemplateCode !== ''
          ? Number(voucher.printTemplateCode)
          : null,
      branchs: Array.isArray(voucher?.branchs) ? voucher.branchs : [],
    }));

    // Validar campos obrigatórios
    for (const voucher of normalizedVouchers) {
      if (
        !Number.isFinite(voucher.branchCodeRegistration) ||
        voucher.branchCodeRegistration <= 0
      ) {
        return errorResponse(
          res,
          `branchCodeRegistration inválido no item ${voucher.index + 1}`,
          400,
          'INVALID_BRANCH_CODE',
        );
      }

      if (!voucher.prefixCode) {
        return errorResponse(
          res,
          `prefixCode é obrigatório no item ${voucher.index + 1}`,
          400,
          'MISSING_PREFIX_CODE',
        );
      }

      if (!Number.isFinite(voucher.voucherType)) {
        return errorResponse(
          res,
          `voucherType inválido no item ${voucher.index + 1}`,
          400,
          'INVALID_VOUCHER_TYPE',
        );
      }

      if (!Number.isFinite(voucher.status)) {
        return errorResponse(
          res,
          `status inválido no item ${voucher.index + 1}`,
          400,
          'INVALID_STATUS',
        );
      }

      if (!voucher.startDate || Number.isNaN(Date.parse(voucher.startDate))) {
        return errorResponse(
          res,
          `startDate inválida no item ${voucher.index + 1}`,
          400,
          'INVALID_START_DATE',
        );
      }

      if (!voucher.endDate || Number.isNaN(Date.parse(voucher.endDate))) {
        return errorResponse(
          res,
          `endDate inválida no item ${voucher.index + 1}`,
          400,
          'INVALID_END_DATE',
        );
      }
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

    const results = await Promise.allSettled(
      normalizedVouchers.map(async (voucher) => {
        const payload = {
          branchCodeRegistration: voucher.branchCodeRegistration,
          prefixCode: voucher.prefixCode,
          voucherType: voucher.voucherType,
          status: voucher.status,
          startDate: voucher.startDate,
          endDate: voucher.endDate,
        };

        if (voucher.description) payload.description = voucher.description;
        if (voucher.value !== null) payload.value = voucher.value;
        if (voucher.percentage !== null)
          payload.percentage = voucher.percentage;
        if (voucher.quantity !== null) payload.quantity = voucher.quantity;
        if (voucher.printTemplateCode !== null)
          payload.printTemplateCode = voucher.printTemplateCode;
        if (voucher.branchs.length > 0) payload.branchs = voucher.branchs;

        const response = await axios.post(VOUCHER_CREATE_ENDPOINT, payload, {
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Bearer ${tokenData.access_token}`,
          },
          timeout: 60000,
          httpsAgent,
          httpAgent,
        });

        return {
          index: voucher.index,
          prefixCode: voucher.prefixCode,
          response: response.data,
        };
      }),
    );

    const created = [];
    const failed = [];

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        created.push(result.value);
        return;
      }

      failed.push({
        index: normalizedVouchers[index].index,
        prefixCode: normalizedVouchers[index].prefixCode,
        message:
          result.reason?.response?.data?.message ||
          result.reason?.response?.data?.error ||
          result.reason?.message ||
          'Erro ao criar voucher',
        details: result.reason?.response?.data || null,
      });
    });

    const hasFailures = failed.length > 0;
    successResponse(
      res,
      {
        created,
        failed,
        totalRequested: normalizedVouchers.length,
        totalCreated: created.length,
        totalFailed: failed.length,
      },
      hasFailures
        ? `${created.length} voucher(s) criado(s) e ${failed.length} com falha`
        : `${created.length} voucher(s) criado(s) com sucesso`,
    );
  }),
);

/**
 * @route GET /vouchers/import-template
 * @desc Retorna um template Excel para importação de vouchers
 */
router.get('/vouchers/import-template', (req, res) => {
  try {
    const XLSX = require('xlsx');

    // Criar workbook com exemplo
    const templateData = [
      {
        branchCodeRegistration: 1,
        prefixCode: 'VOL',
        voucherType: 1,
        status: 1,
        startDate: '2024-01-01',
        endDate: '2024-12-31',
        description: 'Voucher de exemplo',
        value: 100,
        percentage: undefined,
        quantity: undefined,
        printTemplateCode: undefined,
      },
    ];

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(templateData);

    // Definir largura das colunas
    ws['!cols'] = [
      { wch: 15 },
      { wch: 12 },
      { wch: 12 },
      { wch: 10 },
      { wch: 12 },
      { wch: 12 },
      { wch: 25 },
      { wch: 10 },
      { wch: 12 },
      { wch: 12 },
      { wch: 15 },
    ];

    XLSX.utils.book_append_sheet(wb, ws, 'Vouchers');

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename=template_vouchers.xlsx',
    );

    XLSX.write(wb, { type: 'stream', stream: res });
  } catch (err) {
    console.error('Erro ao gerar template:', err);
    errorResponse(
      res,
      'Erro ao gerar template de importação',
      500,
      'TEMPLATE_ERROR',
    );
  }
});

/**
 * @route POST /vouchers/varejo/customer-lookup
 * @desc Busca dados básicos de um cliente por CPF, CNPJ ou código interno.
 *       - 11 dígitos  -> CPF  (pessoa física)
 *       - 14 dígitos  -> CNPJ (pessoa jurídica)
 *       - demais casos -> tratado como código interno (busca PF e PJ)
 * @body { query: string }
 * @returns { customer: { code, name, fantasyName?, document, documentType, personType } }
 */
router.post(
  '/vouchers/varejo/customer-lookup',
  asyncHandler(async (req, res) => {
    const { query } = req.body;

    if (query === undefined || query === null || String(query).trim() === '') {
      return errorResponse(
        res,
        'Informe o CPF, CNPJ ou código do cliente',
        400,
        'MISSING_QUERY',
      );
    }

    const digits = String(query).replace(/\D/g, '');
    if (!digits) {
      return errorResponse(
        res,
        'Consulta inválida. Informe apenas números (CPF, CNPJ ou código).',
        400,
        'INVALID_QUERY',
      );
    }

    const mapPF = (it) => ({
      code: it.code,
      name: it.name || '',
      document: it.cpf || digits,
      documentType: 'CPF',
      personType: 'PF',
    });
    const mapPJ = (it) => ({
      code: it.code,
      name: it.name || '',
      fantasyName: it.fantasyName || '',
      document: it.cnpj || digits,
      documentType: 'CNPJ',
      personType: 'PJ',
    });

    let customer = null;

    // 1) Busca direta por documento
    if (digits.length === 11) {
      const resp = await postTotvsAuthed(PERSON_INDIVIDUALS_SEARCH_ENDPOINT, {
        filter: { cpfList: [digits] },
        page: 1,
        pageSize: 5,
      });
      const items = resp.data?.items || [];
      if (items.length) customer = mapPF(items[0]);
    } else if (digits.length === 14) {
      const resp = await postTotvsAuthed(
        PERSON_LEGAL_ENTITIES_SEARCH_ENDPOINT,
        {
          filter: { cnpjList: [digits] },
          page: 1,
          pageSize: 5,
        },
      );
      const items = resp.data?.items || [];
      if (items.length) customer = mapPJ(items[0]);
    }

    // 2) Fallback / busca por código interno (PF e PJ em paralelo)
    if (!customer) {
      const codeNum = parseInt(digits, 10);
      if (!Number.isNaN(codeNum) && codeNum > 0) {
        const [pf, pj] = await Promise.allSettled([
          postTotvsAuthed(PERSON_INDIVIDUALS_SEARCH_ENDPOINT, {
            filter: { personCodeList: [codeNum] },
            page: 1,
            pageSize: 5,
          }),
          postTotvsAuthed(PERSON_LEGAL_ENTITIES_SEARCH_ENDPOINT, {
            filter: { personCodeList: [codeNum] },
            page: 1,
            pageSize: 5,
          }),
        ]);
        const pfItems =
          pf.status === 'fulfilled' ? pf.value.data?.items || [] : [];
        const pjItems =
          pj.status === 'fulfilled' ? pj.value.data?.items || [] : [];
        if (pfItems.length) customer = mapPF(pfItems[0]);
        else if (pjItems.length) customer = mapPJ(pjItems[0]);
      }
    }

    if (!customer) {
      return errorResponse(
        res,
        'Cliente não encontrado. Verifique o CPF, CNPJ ou código informado.',
        404,
        'CUSTOMER_NOT_FOUND',
      );
    }

    successResponse(res, { customer }, 'Cliente encontrado');
  }),
);

/**
 * @route POST /vouchers/varejo/generate
 * @desc Gera um voucher de desconto (PDVFM066) e o vincula a um cliente.
 *       Fluxo: 1) cria o voucher base (voucher/v2/create) com o gatilho de valor >= R$100;
 *              2) vincula o cliente (voucher/v2/customer/create) usando o voucher base.
 * @body {
 *   customerCode?: number,       // código interno do cliente (preferencial)
 *   cpfCnpj?: string,            // CPF/CNPJ (usado se não houver customerCode)
 *   customerName?: string,       // apenas para descrição do voucher
 *   value?: number,             // override do desconto (default 50)
 *   minPurchase?: number,       // override do gatilho (default 100)
 *   durationDays?: number       // override da validade em dias (default 1)
 * }
 */
router.post(
  '/vouchers/varejo/generate',
  asyncHandler(async (req, res) => {
    const {
      customerCode,
      cpfCnpj,
      customerName,
      value: valueOverride,
      minPurchase: minPurchaseOverride,
      durationDays: durationOverride,
      printTemplateCode: printTemplateOverride,
    } = req.body || {};

    const codeNum =
      customerCode !== undefined &&
      customerCode !== null &&
      customerCode !== ''
        ? parseInt(customerCode, 10)
        : null;
    const docDigits = cpfCnpj ? String(cpfCnpj).replace(/\D/g, '') : null;

    if ((codeNum === null || Number.isNaN(codeNum)) && !docDigits) {
      return errorResponse(
        res,
        'Informe o código do cliente ou o CPF/CNPJ',
        400,
        'MISSING_CUSTOMER',
      );
    }

    const cfg = VAREJO_VOUCHER_CONFIG;
    const value = Number(valueOverride ?? cfg.value);
    const minPurchase = Number(minPurchaseOverride ?? cfg.minPurchase);
    const durationDays = Number(durationOverride ?? cfg.durationDays);
    const printTemplateCode = Number(
      printTemplateOverride ?? cfg.printTemplateCode,
    );

    if (!Number.isFinite(value) || value <= 0) {
      return errorResponse(res, 'Valor do desconto inválido', 400, 'INVALID_VALUE');
    }
    if (!Number.isFinite(minPurchase) || minPurchase < 0) {
      return errorResponse(
        res,
        'Valor mínimo de compra inválido',
        400,
        'INVALID_MIN_PURCHASE',
      );
    }
    if (!Number.isFinite(durationDays) || durationDays <= 0) {
      return errorResponse(res, 'Validade inválida', 400, 'INVALID_DURATION');
    }
    if (!Number.isFinite(printTemplateCode) || printTemplateCode <= 0) {
      return errorResponse(
        res,
        'Modelo de impressão (printTemplateCode) inválido',
        400,
        'INVALID_PRINT_TEMPLATE_CODE',
      );
    }

    // Vigência: início hoje 00:00, fim daqui a `durationDays` dia(s) às 23:59:59
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + durationDays);
    end.setHours(23, 59, 59, 0);

    const description = `${cfg.prefixCode} VAREJO${
      customerName ? ` - ${customerName}` : ''
    }`.slice(0, 60);

    // 1) Criar voucher base
    const createPayload = {
      branchCodeRegistration: cfg.branchCodeRegistration,
      description,
      prefixCode: cfg.prefixCode,
      voucherType: cfg.voucherType, // 1 = Desconto
      status: cfg.status, // 1 = Em andamento
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      value, // Desconto em R$
      printTemplateCode, // Modelo de impressão exigido pela TOTVS
      branchs: cfg.participantBranches.map((branchCode) => ({ branchCode })),
      triggers: [
        {
          triggerType: 2, // 2 = Valor
          operationType: 4, // 4 = Maior igual
          value: minPurchase, // só válido para compras >= minPurchase
        },
      ],
    };

    let createResp;
    try {
      createResp = await postTotvsAuthed(VOUCHER_CREATE_ENDPOINT, createPayload);
    } catch (error) {
      const data = error.response?.data;
      const msg =
        data?.message ||
        data?.detailedMessage ||
        (Array.isArray(data) ? data[0]?.message : null) ||
        error.message ||
        'Erro desconhecido';
      return errorResponse(
        res,
        `Erro ao criar o voucher base na TOTVS: ${msg}`,
        error.response?.status || 502,
        'VOUCHER_CREATE_FAILED',
        data || null,
      );
    }

    const voucherNumberBase = createResp.data?.voucherNumber;
    if (!voucherNumberBase) {
      return errorResponse(
        res,
        'A TOTVS não retornou o número do voucher base',
        502,
        'VOUCHER_BASE_NO_NUMBER',
        createResp.data || null,
      );
    }

    // 2) Vincular cliente ao voucher base
    const customerPayload = {
      branchCodeRegistration: cfg.branchCodeRegistration,
      voucherNumberBase,
    };
    if (codeNum !== null && !Number.isNaN(codeNum)) {
      customerPayload.customerCodeList = [codeNum];
    } else {
      customerPayload.customerCpfCnpjList = [docDigits];
    }

    let customerResp;
    try {
      customerResp = await postTotvsAuthed(
        VOUCHER_CUSTOMER_CREATE_ENDPOINT,
        customerPayload,
      );
    } catch (error) {
      const data = error.response?.data;
      const msg =
        data?.message ||
        data?.detailedMessage ||
        (Array.isArray(data) ? data[0]?.message : null) ||
        error.message ||
        'Erro desconhecido';
      return errorResponse(
        res,
        `Voucher base criado (nº ${voucherNumberBase}), mas falhou ao vincular o cliente: ${msg}`,
        error.response?.status || 502,
        'VOUCHER_CUSTOMER_FAILED',
        data || null,
      );
    }

    const generated = customerResp.data?.items?.[0] || null;

    successResponse(
      res,
      {
        baseVoucherNumber: voucherNumberBase,
        baseVoucherCode: createResp.data?.voucherCode || null,
        voucher: generated, // { voucherNumber, voucherCode, customerCode, customerCpfCnpj }
        config: {
          value,
          minPurchase,
          durationDays,
          printTemplateCode,
          prefixCode: cfg.prefixCode,
          startDate: createPayload.startDate,
          endDate: createPayload.endDate,
        },
      },
      'Voucher gerado e vinculado ao cliente com sucesso',
      201,
    );
  }),
);

// ==========================================
// GRUPOS DE PROMOÇÃO (campanhas de voucher)
// ==========================================

// Calcula o status de um grupo com base nas datas / flag de cancelamento.
// 'cancelada' | 'agendada' | 'ativa' | 'encerrada'
const computePromoStatus = (grupo) => {
  if (grupo?.cancelado) return 'cancelada';
  const now = Date.now();
  const inicio = grupo?.data_inicio ? new Date(grupo.data_inicio).getTime() : NaN;
  const fim = grupo?.data_fim ? new Date(grupo.data_fim).getTime() : NaN;
  if (!Number.isNaN(inicio) && now < inicio) return 'agendada';
  if (!Number.isNaN(fim) && now > fim) return 'encerrada';
  return 'ativa';
};

/**
 * @route GET /vouchers/promocoes
 * @desc Lista os grupos de promoção com status computado e contagem de participantes.
 */
router.get(
  '/vouchers/promocoes',
  asyncHandler(async (req, res) => {
    const { data: grupos, error } = await supabase
      .from('promocao_grupos')
      .select('*')
      .order('criado_em', { ascending: false });

    if (error) return errorResponse(res, error.message, 400, 'PROMO_LIST_FAILED');

    // Contagem de participantes por grupo
    const { data: participantes } = await supabase
      .from('promocao_vouchers')
      .select('grupo_id');

    const counts = {};
    for (const p of participantes || []) {
      counts[p.grupo_id] = (counts[p.grupo_id] || 0) + 1;
    }

    const data = (grupos || []).map((g) => ({
      ...g,
      status: computePromoStatus(g),
      participantes: counts[g.id] || 0,
    }));

    successResponse(res, { grupos: data }, `${data.length} grupo(s) de promoção`);
  }),
);

/**
 * @route POST /vouchers/promocoes
 * @desc Cria um grupo de promoção (campanha).
 * @body {
 *   nome: string,
 *   dataInicio: string (ISO),
 *   dataFim: string (ISO),
 *   descontoTipo: 'valor' | 'percentual',
 *   descontoValor: number,
 *   compraMinima?: number,
 *   criadoPor?: string (email)
 * }
 */
router.post(
  '/vouchers/promocoes',
  asyncHandler(async (req, res) => {
    const {
      nome,
      dataInicio,
      dataFim,
      descontoTipo,
      descontoValor,
      compraMinima,
      criadoPor,
    } = req.body || {};

    const nomeTrim = typeof nome === 'string' ? nome.trim() : '';
    if (!nomeTrim) {
      return errorResponse(res, 'Informe o nome da promoção', 400, 'MISSING_NAME');
    }

    if (!dataInicio || Number.isNaN(Date.parse(dataInicio))) {
      return errorResponse(res, 'Data de início inválida', 400, 'INVALID_START_DATE');
    }
    if (!dataFim || Number.isNaN(Date.parse(dataFim))) {
      return errorResponse(res, 'Data final inválida', 400, 'INVALID_END_DATE');
    }
    if (new Date(dataInicio) > new Date(dataFim)) {
      return errorResponse(
        res,
        'A data de início deve ser anterior à data final',
        400,
        'INVALID_DATE_RANGE',
      );
    }

    const tipo = descontoTipo === 'percentual' ? 'percentual' : 'valor';
    const valor = Number(descontoValor);
    if (!Number.isFinite(valor) || valor <= 0) {
      return errorResponse(res, 'Valor do desconto inválido', 400, 'INVALID_VALUE');
    }
    if (tipo === 'percentual' && valor > 100) {
      return errorResponse(
        res,
        'O percentual de desconto não pode ser maior que 100%',
        400,
        'INVALID_PERCENTAGE',
      );
    }

    const minimo = compraMinima !== undefined && compraMinima !== '' ? Number(compraMinima) : 0;
    if (!Number.isFinite(minimo) || minimo < 0) {
      return errorResponse(res, 'Compra mínima inválida', 400, 'INVALID_MIN_PURCHASE');
    }

    const payload = {
      nome: nomeTrim,
      data_inicio: new Date(dataInicio).toISOString(),
      data_fim: new Date(dataFim).toISOString(),
      desconto_tipo: tipo,
      desconto_valor: valor,
      compra_minima: minimo,
      criado_por: typeof criadoPor === 'string' ? criadoPor : null,
    };

    const { data, error } = await supabase
      .from('promocao_grupos')
      .insert(payload)
      .select()
      .single();

    if (error) return errorResponse(res, error.message, 400, 'PROMO_CREATE_FAILED');

    successResponse(
      res,
      { grupo: { ...data, status: computePromoStatus(data), participantes: 0 } },
      'Promoção criada com sucesso',
      201,
    );
  }),
);

/**
 * @route GET /vouchers/promocoes/:id
 * @desc Detalhe de um grupo + lista de vouchers/clientes vinculados.
 */
router.get(
  '/vouchers/promocoes/:id',
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id) || id <= 0) {
      return errorResponse(res, 'ID de promoção inválido', 400, 'INVALID_ID');
    }

    const { data: grupo, error } = await supabase
      .from('promocao_grupos')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !grupo) {
      return errorResponse(res, 'Promoção não encontrada', 404, 'PROMO_NOT_FOUND');
    }

    const { data: vouchers } = await supabase
      .from('promocao_vouchers')
      .select('*')
      .eq('grupo_id', id)
      .order('criado_em', { ascending: false });

    successResponse(
      res,
      {
        grupo: {
          ...grupo,
          status: computePromoStatus(grupo),
          participantes: (vouchers || []).length,
        },
        vouchers: vouchers || [],
      },
      `${(vouchers || []).length} voucher(s) na promoção`,
    );
  }),
);

/**
 * @route POST /vouchers/promocoes/:id/generate
 * @desc Gera um voucher sob as regras do grupo e vincula ao cliente.
 *       Impede que o mesmo cliente participe duas vezes do mesmo grupo.
 * @body { customerCode: number, cpfCnpj?: string, customerName?: string, criadoPor?: string }
 */
router.post(
  '/vouchers/promocoes/:id/generate',
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id) || id <= 0) {
      return errorResponse(res, 'ID de promoção inválido', 400, 'INVALID_ID');
    }

    const { customerCode, cpfCnpj, customerName, criadoPor } = req.body || {};
    const codeNum =
      customerCode !== undefined && customerCode !== null && customerCode !== ''
        ? parseInt(customerCode, 10)
        : null;
    if (codeNum === null || Number.isNaN(codeNum) || codeNum <= 0) {
      return errorResponse(
        res,
        'Informe o código do cliente (customerCode)',
        400,
        'MISSING_CUSTOMER',
      );
    }
    const docDigits = cpfCnpj ? String(cpfCnpj).replace(/\D/g, '') : null;

    // 1) Carrega o grupo e valida se está ativo
    const { data: grupo, error: grupoErr } = await supabase
      .from('promocao_grupos')
      .select('*')
      .eq('id', id)
      .single();

    if (grupoErr || !grupo) {
      return errorResponse(res, 'Promoção não encontrada', 404, 'PROMO_NOT_FOUND');
    }

    const status = computePromoStatus(grupo);
    if (status !== 'ativa') {
      return errorResponse(
        res,
        `A promoção não está ativa (status: ${status})`,
        400,
        'GROUP_NOT_ACTIVE',
      );
    }

    // 2) Unicidade: cliente não pode participar duas vezes do mesmo grupo
    const { data: existente } = await supabase
      .from('promocao_vouchers')
      .select('id')
      .eq('grupo_id', id)
      .eq('customer_code', codeNum)
      .maybeSingle();

    if (existente) {
      return errorResponse(
        res,
        'Este cliente já participou desta promoção',
        409,
        'CUSTOMER_ALREADY_IN_GROUP',
      );
    }

    // 3) Monta o payload da TOTVS a partir das regras do grupo
    const isPercent = grupo.desconto_tipo === 'percentual';
    const descontoValor = Number(grupo.desconto_valor);
    const compraMinima = Number(grupo.compra_minima) || 0;
    const branches = Array.isArray(grupo.participant_branches)
      ? grupo.participant_branches
      : VAREJO_VOUCHER_CONFIG.participantBranches;

    const description = `${grupo.prefix_code} ${grupo.nome}${
      customerName ? ` - ${customerName}` : ''
    }`.slice(0, 60);

    const createPayload = {
      branchCodeRegistration:
        grupo.branch_code_registration || VAREJO_VOUCHER_CONFIG.branchCodeRegistration,
      description,
      prefixCode: grupo.prefix_code || VAREJO_VOUCHER_CONFIG.prefixCode,
      voucherType: 1, // 1 = Desconto
      status: 1, // 1 = Em andamento
      startDate: new Date(grupo.data_inicio).toISOString(),
      endDate: new Date(grupo.data_fim).toISOString(),
      printTemplateCode:
        grupo.print_template_code || VAREJO_VOUCHER_CONFIG.printTemplateCode,
      branchs: branches.map((branchCode) => ({ branchCode })),
      triggers: [
        {
          triggerType: 2, // 2 = Valor
          operationType: 4, // 4 = Maior igual
          value: compraMinima,
        },
      ],
    };
    if (isPercent) createPayload.percentage = descontoValor;
    else createPayload.value = descontoValor;

    // 4) Cria o voucher base na TOTVS
    let createResp;
    try {
      createResp = await postTotvsAuthed(VOUCHER_CREATE_ENDPOINT, createPayload);
    } catch (error) {
      const data = error.response?.data;
      const msg =
        data?.message ||
        data?.detailedMessage ||
        (Array.isArray(data) ? data[0]?.message : null) ||
        error.message ||
        'Erro desconhecido';
      return errorResponse(
        res,
        `Erro ao criar o voucher base na TOTVS: ${msg}`,
        error.response?.status || 502,
        'VOUCHER_CREATE_FAILED',
        data || null,
      );
    }

    const voucherNumberBase = createResp.data?.voucherNumber;
    if (!voucherNumberBase) {
      return errorResponse(
        res,
        'A TOTVS não retornou o número do voucher base',
        502,
        'VOUCHER_BASE_NO_NUMBER',
        createResp.data || null,
      );
    }

    // 5) Vincula o cliente ao voucher base
    const customerPayload = {
      branchCodeRegistration:
        grupo.branch_code_registration || VAREJO_VOUCHER_CONFIG.branchCodeRegistration,
      voucherNumberBase,
      customerCodeList: [codeNum],
    };

    let customerResp;
    try {
      customerResp = await postTotvsAuthed(
        VOUCHER_CUSTOMER_CREATE_ENDPOINT,
        customerPayload,
      );
    } catch (error) {
      const data = error.response?.data;
      const msg =
        data?.message ||
        data?.detailedMessage ||
        (Array.isArray(data) ? data[0]?.message : null) ||
        error.message ||
        'Erro desconhecido';
      return errorResponse(
        res,
        `Voucher base criado (nº ${voucherNumberBase}), mas falhou ao vincular o cliente: ${msg}`,
        error.response?.status || 502,
        'VOUCHER_CUSTOMER_FAILED',
        data || null,
      );
    }

    const generated = customerResp.data?.items?.[0] || null;

    // 6) Persiste a participação (snapshot). Violação de unicidade => 409 (corrida).
    const { error: insertErr } = await supabase.from('promocao_vouchers').insert({
      grupo_id: id,
      customer_code: codeNum,
      customer_cpf_cnpj: docDigits,
      customer_name: customerName || null,
      voucher_number: generated?.voucherNumber || voucherNumberBase,
      voucher_code: generated?.voucherCode || createResp.data?.voucherCode || null,
      desconto_tipo: grupo.desconto_tipo,
      valor: descontoValor,
      start_date: createPayload.startDate,
      end_date: createPayload.endDate,
      criado_por: typeof criadoPor === 'string' ? criadoPor : null,
    });

    if (insertErr) {
      if (insertErr.code === '23505') {
        return errorResponse(
          res,
          'Este cliente já participou desta promoção',
          409,
          'CUSTOMER_ALREADY_IN_GROUP',
        );
      }
      // Voucher já foi criado na TOTVS; retorna sucesso mas avisa da falha de registro
      console.warn('⚠️ Falha ao registrar participação da promoção:', insertErr.message);
    }

    successResponse(
      res,
      {
        baseVoucherNumber: voucherNumberBase,
        baseVoucherCode: createResp.data?.voucherCode || null,
        voucher: generated,
        config: {
          descontoTipo: grupo.desconto_tipo,
          descontoValor,
          compraMinima,
          prefixCode: grupo.prefix_code,
          startDate: createPayload.startDate,
          endDate: createPayload.endDate,
        },
      },
      'Voucher gerado e vinculado ao cliente com sucesso',
      201,
    );
  }),
);

/**
 * @route PUT /vouchers/promocoes/:id
 * @desc Edita um grupo de promoção (atualização parcial). Também serve para
 *       ativar/desativar via o campo `cancelado`.
 * @body { nome?, dataInicio?, dataFim?, descontoTipo?, descontoValor?, compraMinima?, cancelado? }
 */
router.put(
  '/vouchers/promocoes/:id',
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id) || id <= 0) {
      return errorResponse(res, 'ID de promoção inválido', 400, 'INVALID_ID');
    }

    const { data: grupo, error: grupoErr } = await supabase
      .from('promocao_grupos')
      .select('*')
      .eq('id', id)
      .single();

    if (grupoErr || !grupo) {
      return errorResponse(res, 'Promoção não encontrada', 404, 'PROMO_NOT_FOUND');
    }

    const {
      nome,
      dataInicio,
      dataFim,
      descontoTipo,
      descontoValor,
      compraMinima,
      cancelado,
      atualizadoPor,
    } = req.body || {};

    const patch = {};

    if (nome !== undefined) {
      const nomeTrim = typeof nome === 'string' ? nome.trim() : '';
      if (!nomeTrim) {
        return errorResponse(res, 'Informe o nome da promoção', 400, 'MISSING_NAME');
      }
      patch.nome = nomeTrim;
    }

    if (dataInicio !== undefined) {
      if (!dataInicio || Number.isNaN(Date.parse(dataInicio))) {
        return errorResponse(res, 'Data de início inválida', 400, 'INVALID_START_DATE');
      }
      patch.data_inicio = new Date(dataInicio).toISOString();
    }

    if (dataFim !== undefined) {
      if (!dataFim || Number.isNaN(Date.parse(dataFim))) {
        return errorResponse(res, 'Data final inválida', 400, 'INVALID_END_DATE');
      }
      patch.data_fim = new Date(dataFim).toISOString();
    }

    // Valida a faixa de datas considerando os valores finais (novos ou atuais)
    const inicioFinal = patch.data_inicio || grupo.data_inicio;
    const fimFinal = patch.data_fim || grupo.data_fim;
    if (new Date(inicioFinal) > new Date(fimFinal)) {
      return errorResponse(
        res,
        'A data de início deve ser anterior à data final',
        400,
        'INVALID_DATE_RANGE',
      );
    }

    let tipoFinal = grupo.desconto_tipo;
    if (descontoTipo !== undefined) {
      tipoFinal = descontoTipo === 'percentual' ? 'percentual' : 'valor';
      patch.desconto_tipo = tipoFinal;
    }

    if (descontoValor !== undefined) {
      const valor = Number(descontoValor);
      if (!Number.isFinite(valor) || valor <= 0) {
        return errorResponse(res, 'Valor do desconto inválido', 400, 'INVALID_VALUE');
      }
      if (tipoFinal === 'percentual' && valor > 100) {
        return errorResponse(
          res,
          'O percentual de desconto não pode ser maior que 100%',
          400,
          'INVALID_PERCENTAGE',
        );
      }
      patch.desconto_valor = valor;
    } else if (descontoTipo !== undefined && tipoFinal === 'percentual') {
      // Mudou para percentual sem novo valor: garante que o valor atual é válido
      if (Number(grupo.desconto_valor) > 100) {
        return errorResponse(
          res,
          'O percentual de desconto não pode ser maior que 100%',
          400,
          'INVALID_PERCENTAGE',
        );
      }
    }

    if (compraMinima !== undefined) {
      const minimo = compraMinima === '' ? 0 : Number(compraMinima);
      if (!Number.isFinite(minimo) || minimo < 0) {
        return errorResponse(res, 'Compra mínima inválida', 400, 'INVALID_MIN_PURCHASE');
      }
      patch.compra_minima = minimo;
    }

    if (cancelado !== undefined) {
      patch.cancelado = Boolean(cancelado);
    }

    if (atualizadoPor !== undefined && typeof atualizadoPor === 'string') {
      // criado_por permanece; não há coluna de atualizado_por — ignora silenciosamente
    }

    if (Object.keys(patch).length === 0) {
      return errorResponse(res, 'Nenhum campo para atualizar', 400, 'NO_FIELDS');
    }

    const { data, error } = await supabase
      .from('promocao_grupos')
      .update(patch)
      .eq('id', id)
      .select()
      .single();

    if (error) return errorResponse(res, error.message, 400, 'PROMO_UPDATE_FAILED');

    // Contagem de participantes para devolver o registro completo
    const { count } = await supabase
      .from('promocao_vouchers')
      .select('id', { count: 'exact', head: true })
      .eq('grupo_id', id);

    successResponse(
      res,
      {
        grupo: {
          ...data,
          status: computePromoStatus(data),
          participantes: count || 0,
        },
      },
      'Promoção atualizada com sucesso',
    );
  }),
);

/**
 * @route DELETE /vouchers/promocoes/:id
 * @desc Exclui um grupo de promoção. Os vouchers vinculados (promocao_vouchers)
 *       são removidos em cascata pela FK.
 */
router.delete(
  '/vouchers/promocoes/:id',
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id) || id <= 0) {
      return errorResponse(res, 'ID de promoção inválido', 400, 'INVALID_ID');
    }

    const { data: grupo, error: grupoErr } = await supabase
      .from('promocao_grupos')
      .select('id')
      .eq('id', id)
      .single();

    if (grupoErr || !grupo) {
      return errorResponse(res, 'Promoção não encontrada', 404, 'PROMO_NOT_FOUND');
    }

    const { error } = await supabase.from('promocao_grupos').delete().eq('id', id);

    if (error) return errorResponse(res, error.message, 400, 'PROMO_DELETE_FAILED');

    successResponse(res, { id }, 'Promoção excluída com sucesso');
  }),
);

export default router;
