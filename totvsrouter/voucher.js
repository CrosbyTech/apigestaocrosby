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

const router = express.Router();

const VOUCHER_SEARCH_ENDPOINT = `${TOTVS_BASE_URL}/voucher/v2/search`;
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
      return errorResponse(res, 'Os parâmetros startDateInitial e startDateFinal são obrigatórios', 400, 'MISSING_REQUIRED_PARAMS');
    }

    if (isNaN(Date.parse(startDateInitial)) || isNaN(Date.parse(startDateFinal))) {
      return errorResponse(res, 'Datas inválidas', 400, 'INVALID_DATE_FORMAT');
    }

    if (new Date(startDateInitial) > new Date(startDateFinal)) {
      return errorResponse(res, 'startDateInitial deve ser anterior a startDateFinal', 400, 'INVALID_DATE_RANGE');
    }

    const startTime = Date.now();

    // Obter token
    const tokenData = await getToken();
    if (!tokenData?.access_token) {
      return errorResponse(res, 'Não foi possível obter token TOTVS', 503, 'TOKEN_UNAVAILABLE');
    }
    const token = tokenData.access_token;

    // Buscar vouchers com paginação
    let allVouchers = [];
    let page = 1;
    const pageSize = 100;
    let hasMore = true;

    while (hasMore) {
      const params = {
        StartDateInitial: startDateInitial,
        StartDateFinal: startDateFinal,
        Page: page,
        PageSize: pageSize,
      };
      // Status é enviado como array para a API TOTVS
      if (status) params.Status = status;

      const response = await axios({
        method: 'get',
        url: VOUCHER_SEARCH_ENDPOINT,
        params,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
        timeout: 60000,
        httpsAgent,
        httpAgent,
      });

      const items = response.data?.items || [];
      allVouchers = allVouchers.concat(items);

      const hasNext = response.data?.hasNext ?? false;
      if (!hasNext || items.length === 0) {
        hasMore = false;
      } else {
        page++;
      }
    }

    // Filtrar por filial localmente (API não suporta filtro por filial)
    const branchFilter = branchCode ? Number(branchCode) : null;
    if (branchFilter) {
      allVouchers = allVouchers.filter((v) =>
        (v.branchs || []).some((b) => b.branchCode === branchFilter),
      );
    }

    // Normalizar dados
    const data = allVouchers.map((v) => ({
      voucherNumber: v.voucherNumber || null,
      voucherCode: v.voucherCode || null,
      description: v.description || null,
      prefixCode: v.prefixCode || null,
      voucherType: v.voucherType || null,
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
    }));

    const queryTime = Date.now() - startTime;

    // Enriquecimento: buscar última compra com desconto para vouchers encerrados
    const enrichEnabled = req.query.enrich === 'true';
    if (enrichEnabled) {
      const closedVouchers = data.filter(v => v.statusLabel === 'Encerrado' && v.customerCode);

      if (closedVouchers.length > 0) {
        console.log(`🔍 Enriquecendo ${closedVouchers.length} vouchers encerrados com dados fiscais...`);

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
          const dates = vouchers.flatMap(v => [v.startDate, v.endDate].filter(Boolean));
          if (dates.length === 0) continue;

          const minDate = dates.sort()[0].split('T')[0];
          const maxDate = dates.sort().reverse()[0].split('T')[0];

          // Coletar todos os personCodes únicos
          const personCodes = [...new Set(vouchers.map(v => v.customerCode).filter(Boolean))];

          try {
            const invoicesPayload = {
              startDate: minDate,
              endDate: maxDate,
              branchCodeList: [Number(bc)],
              personCodeList: personCodes,
              operationType: 'Output', // Vendas (saída)
              maxPages: 10,
            };

            console.log(`📊 Buscando invoices filial ${bc}: ${personCodes.length} clientes, período ${minDate} a ${maxDate}`);

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
                console.warn(`⚠️ Erro página ${p} invoices filial ${bc}:`, e.message);
                break;
              }
            }

            console.log(`✅ ${invoiceItems.length} invoices encontradas para filial ${bc}`);

            // Para cada voucher, encontrar a última compra dentro da vigência
            for (const voucher of vouchers) {
              const vStart = voucher.startDate ? new Date(voucher.startDate) : null;
              const vEnd = voucher.endDate ? new Date(voucher.endDate) : null;

              // Filtrar invoices deste cliente dentro da vigência do voucher
              const clientInvoices = invoiceItems
                .filter(inv => {
                  if (inv.personCode !== voucher.customerCode) return false;
                  const invDate = new Date(inv.invoiceDate || inv.transactionDate);
                  if (vStart && invDate < vStart) return false;
                  if (vEnd && invDate > vEnd) return false;
                  return true;
                })
                .sort((a, b) => new Date(b.invoiceDate || b.transactionDate) - new Date(a.invoiceDate || a.transactionDate));

              if (clientInvoices.length > 0) {
                const lastInvoice = clientInvoices[0];
                // Usar discountValue direto da API se disponível,
                // senão calcular a partir do valor líquido: net * pct / (100 - pct)
                let discountValue = 0;
                if (lastInvoice.discountValue != null && Number(lastInvoice.discountValue) > 0) {
                  discountValue = Number(lastInvoice.discountValue);
                } else if (lastInvoice.discountPercentage) {
                  const netValue = lastInvoice.totalValue || lastInvoice.productValue || 0;
                  discountValue = Math.round(netValue * lastInvoice.discountPercentage / (100 - lastInvoice.discountPercentage) * 100) / 100;
                }

                voucher.lastPurchase = {
                  transactionCode: lastInvoice.transactionCode,
                  transactionDate: lastInvoice.transactionDate || lastInvoice.invoiceDate,
                  productValue: lastInvoice.productValue || 0,
                  totalValue: lastInvoice.totalValue || 0,
                  discountPercentage: lastInvoice.discountPercentage || 0,
                  discountValue,
                  operationName: lastInvoice.operatioName || lastInvoice.operationName || '',
                  invoiceSequence: lastInvoice.invoiceSequence,
                  withinVoucherPeriod: true,
                };
              } else {
                voucher.lastPurchase = null;
              }
            }
          } catch (err) {
            console.error(`❌ Erro ao buscar invoices filial ${bc}:`, err.message);
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

    // Resumo por status
    const statusCounts = {};
    for (const v of data) {
      const label = v.statusLabel;
      statusCounts[label] = (statusCounts[label] || 0) + 1;
    }

    successResponse(res, {
      data,
      summary: {
        total: data.length,
        statusCounts,
        totalValue: Math.round(data.reduce((sum, v) => sum + v.value, 0) * 100) / 100,
        queryTime,
      },
    }, `${data.length} vouchers encontrados em ${queryTime}ms`);
  }),
);

export default router;
