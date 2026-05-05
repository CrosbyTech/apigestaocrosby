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
const INVOICES_SEARCH_ENDPOINT = `${TOTVS_BASE_URL}/fiscal/v2/invoices/search`;

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

export default router;
