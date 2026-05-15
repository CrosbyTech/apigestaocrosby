/**
 * =============================================================================
 *  CMV (Custo de Mercadoria Vendida) — Rotas TOTVS Fiscal
 * =============================================================================
 *
 *  Expõe de forma CRUA (proxy) duas rotas do swagger TOTVS Fiscal v2:
 *
 *  1) POST /api/totvsmoda/fiscal/v2/invoices/search
 *     → Lista de notas fiscais com TODOS os filtros do schema InvoiceFilterModel.
 *     → Retorna o schema InvoiceSearchOutDto completo (com items, taxes, person,
 *       shippingCompany, payments, referencedInvoices, rateDifferential, etc.).
 *
 *  2) GET /api/totvsmoda/fiscal/v2/invoices/item-detail-search
 *     → Detalhe de itens de uma nota fiscal específica (via chave de acesso ou
 *       branchCode + invoiceSequence + invoiceDate).
 *     → Retorna o schema InvoiceSearchResponseModel com lista de itens
 *       (InvoiceItemSearchDataModel) incluindo produtos, impostos e barcodes.
 *
 *  Fluxo de uso típico (CMV):
 *  ─────────────────────────
 *   a) POST /api/totvs/cmv/invoices/search  → busca lista de NFs no período
 *      (com expand "items, taxes, person, payments, referencedInvoices, ...")
 *   b) Para cada nota retornada, extrai a `accessKey` (em items[i].eletronic.accessKey)
 *   c) GET /api/totvs/cmv/invoices/item-detail-search?AccessKey={chave}&Expand=barcodes
 *      → obtém detalhamento granular dos itens daquela nota.
 *
 *  Swagger TOTVS:
 *    https://www30.bhan.com.br:9443/api/totvsmoda/fiscal/v2/swagger/index.html
 * =============================================================================
 */

import express from 'express';
import axios from 'axios';
import {
  asyncHandler,
  successResponse,
  errorResponse,
} from '../utils/errorHandler.js';
import { getToken } from '../utils/totvsTokenManager.js';
import { httpsAgent, TOTVS_BASE_URL } from './totvsHelper.js';

const router = express.Router();

const INVOICES_SEARCH_ENDPOINT = `${TOTVS_BASE_URL}/fiscal/v2/invoices/search`;
const INVOICES_ITEM_DETAIL_ENDPOINT = `${TOTVS_BASE_URL}/fiscal/v2/invoices/item-detail-search`;
const PRODUCTS_SEARCH_ENDPOINT = `${TOTVS_BASE_URL}/product/v2/products/search`;
const COSTS_SEARCH_ENDPOINT = `${TOTVS_BASE_URL}/product/v2/costs/search`;

// =============================================================================
//  Cache em memória para reduzir chamadas repetidas à TOTVS.
//  - Chave: hash do body normalizado.
//  - TTL: 10 minutos para products/costs (dados pouco voláteis intraday),
//         2 minutos para invoices (mais voláteis).
//  - In-flight dedupe: se 2 requests idênticos chegam juntos, fazem 1 só call.
// =============================================================================
const _cache = new Map(); // key → { expiresAt, data }
const _inflight = new Map(); // key → Promise

function _cacheGet(key) {
  const e = _cache.get(key);
  if (!e) return null;
  if (Date.now() > e.expiresAt) {
    _cache.delete(key);
    return null;
  }
  return e.data;
}
function _cacheSet(key, data, ttlMs) {
  _cache.set(key, { data, expiresAt: Date.now() + ttlMs });
  // limita tamanho do cache (LRU simples)
  if (_cache.size > 500) {
    const firstKey = _cache.keys().next().value;
    _cache.delete(firstKey);
  }
}
function _stableKey(prefix, obj) {
  // chave estável independente da ordem dos campos
  const norm = JSON.stringify(obj, Object.keys(obj).sort());
  return `${prefix}:${norm}`;
}

/**
 * Executa fetch com cache + dedupe de requests in-flight.
 */
async function _cachedFetch(key, ttlMs, fetcher) {
  const cached = _cacheGet(key);
  if (cached) return { data: cached, fromCache: true };

  if (_inflight.has(key)) {
    const data = await _inflight.get(key);
    return { data, fromCache: true };
  }

  const promise = (async () => {
    const data = await fetcher();
    _cacheSet(key, data, ttlMs);
    return data;
  })();
  _inflight.set(key, promise);
  try {
    const data = await promise;
    return { data, fromCache: false };
  } finally {
    _inflight.delete(key);
  }
}

/**
 * Repassa erros da TOTVS preservando status e payload.
 */
function forwardTotvsError(res, err, contexto = 'TOTVS') {
  if (err?.response) {
    return res.status(err.response.status).json({
      success: false,
      source: contexto,
      status: err.response.status,
      data: err.response.data,
    });
  }
  return errorResponse(
    res,
    `Erro de comunicação com ${contexto}: ${err.message}`,
    500,
  );
}

// =============================================================================
// 1) POST /cmv/invoices/search
// =============================================================================
/**
 * @route POST /api/totvs/cmv/invoices/search
 * @desc  Proxy CRU para POST /api/totvsmoda/fiscal/v2/invoices/search
 *        (schema TOTVS: InvoiceSearchInDto → InvoiceSearchOutDto)
 *
 * Body aceito (envie EXATAMENTE como a TOTVS espera):
 * {
 *   "filter": {                           // InvoiceFilterModel
 *     "change": {                         // InvoiceChangeFilterModel (filtro por alteração)
 *       "startDate": "ISO date-time",
 *       "endDate":   "ISO date-time"
 *     },
 *     "branchCodeList":          [int],   // OBRIGATÓRIO — códigos de empresa
 *     "invoiceSequenceList":     [int],   // sequenciais (fatura)
 *     "invoiceCodeList":         [int],   // números da nota fiscal
 *     "operationType":           "All"|"Input"|"Output",
 *     "origin":                  "All"|"Own"|"ThirdParty",
 *     "invoiceStatusList":       ["Canceled"|"Denied"|"Issued"|"Normal"|"Deleted"],
 *     "personCodeList":          [int],
 *     "operationCodeList":       [int],
 *     "documentTypeCodeList":    [int],   // 55 = NF-e, 65 = NFC-e, etc.
 *     "personCpfCnpjList":       [string],
 *     "startInvoiceCode":        int,
 *     "endInvoiceCode":          int,
 *     "startIssueDate":          "ISO date-time",   // intervalo MÁX 6 meses
 *     "endIssueDate":            "ISO date-time",
 *     "serialCodeList":          [string],
 *     "eletronicInvoiceStatusList": ["Authorized"|"Canceled"|"Denied"|"Sent"|"Generated"|"Rejected"],
 *     "shippingCompanyCodeList": [int],
 *     "shippingCompanyCpfCnpjList": [string],
 *     "amountLastDays":          int,     // máx 180 dias
 *     "transactionBranchCode":   int,
 *     "transactionCode":         int,
 *     "transactionDate":         "ISO date-time"
 *   },
 *   "page":     1,                        // página inicial
 *   "pageSize": 100,                      // padrão 100, máx 100
 *   "expand":   "shippingCompany, salesOrder, person, items, barCodes, taxes, payments, referencedInvoices, rateDifferential, relatedProductionOrder, observationNF, observationNFE, referencedTaxInvoices",
 *   "order":    "-invoiceDate,branchCode" // - = decrescente
 * }
 *
 * Resposta (InvoiceSearchOutDto):
 * {
 *   "count": int, "totalPages": int, "hasNext": bool, "totalItems": int,
 *   "items": [ InvoiceDataModel ]        // ver schema completo no swagger
 * }
 */
router.post(
  '/cmv/invoices/search',
  asyncHandler(async (req, res) => {
    const body = req.body || {};

    // Validação mínima — branchCodeList é obrigatório segundo o schema
    if (
      !body?.filter?.branchCodeList ||
      !Array.isArray(body.filter.branchCodeList) ||
      body.filter.branchCodeList.length === 0
    ) {
      return errorResponse(
        res,
        'Campo filter.branchCodeList é obrigatório (lista de códigos de empresa).',
        400,
      );
    }

    try {
      const cacheKey = _stableKey('invoices', body);
      const { data, fromCache } = await _cachedFetch(
        cacheKey,
        2 * 60 * 1000, // 2 min
        async () => {
          const { access_token } = await getToken();
          const r = await axios.post(INVOICES_SEARCH_ENDPOINT, body, {
            headers: {
              Authorization: `Bearer ${access_token}`,
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            httpsAgent,
            timeout: 120000,
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
          });
          return r.data;
        },
      );
      res.set('X-Cache', fromCache ? 'HIT' : 'MISS');
      return successResponse(res, data, 'Notas fiscais obtidas com sucesso');
    } catch (err) {
      return forwardTotvsError(res, err, 'TOTVS /fiscal/v2/invoices/search');
    }
  }),
);

// =============================================================================
// 2) GET /cmv/invoices/item-detail-search
// =============================================================================
/**
 * @route GET /api/totvs/cmv/invoices/item-detail-search
 * @desc  Proxy CRU para GET /api/totvsmoda/fiscal/v2/invoices/item-detail-search
 *
 * Query params (todos opcionais individualmente, mas você precisa informar
 * AccessKey OU o conjunto BranchCode + InvoiceDate + InvoiceSequence):
 *
 *   BranchCode       (int)     — Empresa da fatura (FISFM017)
 *   InvoiceDate      (date)    — Data da fatura
 *   InvoiceSequence  (int)     — Número da fatura
 *   AccessKey        (string)  — Chave de acesso NF-e (44 chars)
 *   Expand           (string)  — atualmente suporta "barcodes"
 *
 * Resposta (InvoiceSearchResponseModel):
 * {
 *   "branchCode":      int,
 *   "invoiceSequence": int,
 *   "invoiceDate":     date-time,
 *   "inTransactionAgroup": bool,
 *   "items": [
 *     {                                       // InvoiceItemSearchDataModel
 *       "sequence": int, "code": string, "name": string,
 *       "ncm": string, "cfop": int, "measureUnit": string,
 *       "quantity": double,
 *       "grossValue": double, "discountValue": double, "netValue": double,
 *       "unitGrossValue": double, "unitDiscountValue": double, "unitNetValue": double,
 *       "additionalValue": double, "freightValue": double, "insuranceValue": double,
 *       "invoiceItemsProduct": [               // produtos do item
 *         {
 *           "productCode": int, "productName": string, "dealerCode": int,
 *           "quantity": double,
 *           "unitGrossValue": double, "unitDiscountValue": double, "unitNetValue": double,
 *           "grossValue": double, "discountValue": double, "netValue": double,
 *           "referencedInvoices": [ … ],
 *           "transactions": [ { branchCode, transactionDate, transactionCode, quantity, salesOrder } ]
 *         }
 *       ],
 *       "invoiceItemTax": [                    // impostos
 *         {
 *           "code": int, "name": string, "cst": string,
 *           "taxPercentage": double, "calculationBasisPercentage": double,
 *           "calculationBasisDiscountPercentage": double, "calculationBasisValue": double,
 *           "freeValue": double, "otherValue": double, "taxValue": double,
 *           "benefitCode": string, "unencumberedValue": double,
 *           "unencumberedReason": int, "deferredBaseValue": double
 *         }
 *       ],
 *       "barcodes": [ { "barcode": string } ]  // somente quando Expand=barcodes
 *     }
 *   ]
 * }
 */
router.get(
  '/cmv/invoices/item-detail-search',
  asyncHandler(async (req, res) => {
    const { BranchCode, InvoiceDate, InvoiceSequence, AccessKey, Expand } =
      req.query;

    // Pelo menos AccessKey OU a tripla (BranchCode + InvoiceDate + InvoiceSequence)
    const temChave = !!AccessKey;
    const temTripla = BranchCode && InvoiceDate && InvoiceSequence;
    if (!temChave && !temTripla) {
      return errorResponse(
        res,
        'Informe AccessKey OU o conjunto BranchCode + InvoiceDate + InvoiceSequence.',
        400,
      );
    }

    const params = {};
    if (BranchCode !== undefined) params.BranchCode = Number(BranchCode);
    if (InvoiceDate !== undefined) params.InvoiceDate = InvoiceDate;
    if (InvoiceSequence !== undefined)
      params.InvoiceSequence = Number(InvoiceSequence);
    if (AccessKey !== undefined) params.AccessKey = AccessKey;
    if (Expand !== undefined) params.Expand = Expand;

    try {
      const { access_token } = await getToken();
      const totvsResp = await axios.get(INVOICES_ITEM_DETAIL_ENDPOINT, {
        headers: {
          Authorization: `Bearer ${access_token}`,
          Accept: 'application/json',
        },
        params,
        httpsAgent,
        timeout: 60000,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      });

      return successResponse(
        res,
        totvsResp.data,
        'Itens da nota fiscal obtidos com sucesso',
      );
    } catch (err) {
      return forwardTotvsError(
        res,
        err,
        'TOTVS /fiscal/v2/invoices/item-detail-search',
      );
    }
  }),
);

// =============================================================================
// 3) POST /cmv/products/search
// =============================================================================
/**
 * @route POST /api/totvs/cmv/products/search
 * @desc  Proxy CRU para POST /api/totvsmoda/product/v2/products/search
 *        (schema TOTVS: ProductInDto → ProductOutDto)
 *
 * Body típico para mapear productCode → referenceCode:
 * {
 *   "filter": {
 *     "productCodeList": [int, ...],   // até centenas de códigos
 *     // ou "referenceCodeList": [string, ...]
 *   },
 *   "option": { "branchInfoCode": int }, // OBRIGATÓRIO (empresa base)
 *   "page": 1,
 *   "pageSize": 1000,                    // máx 1000
 *   "expand": "referenceCodeSequences"   // opcional
 * }
 *
 * Response items[]:
 *   { productCode, productName, productSku,
 *     ReferenceCode (string), referenceId, referenceName, lastReferenceCode,
 *     colorCode, sizeName, gridCode, ... }
 */
router.post(
  '/cmv/products/search',
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    if (!body?.filter) {
      return errorResponse(res, 'Campo "filter" é obrigatório.', 400);
    }
    if (!body?.option?.branchInfoCode) {
      return errorResponse(
        res,
        'Campo option.branchInfoCode é obrigatório.',
        400,
      );
    }

    try {
      const cacheKey = _stableKey('products', body);
      const { data, fromCache } = await _cachedFetch(
        cacheKey,
        10 * 60 * 1000, // 10 min
        async () => {
          const { access_token } = await getToken();
          const r = await axios.post(PRODUCTS_SEARCH_ENDPOINT, body, {
            headers: {
              Authorization: `Bearer ${access_token}`,
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            httpsAgent,
            timeout: 120000,
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
          });
          return r.data;
        },
      );
      res.set('X-Cache', fromCache ? 'HIT' : 'MISS');
      return successResponse(res, data, 'Produtos obtidos com sucesso');
    } catch (err) {
      return forwardTotvsError(res, err, 'TOTVS /product/v2/products/search');
    }
  }),
);

// =============================================================================
// 4) POST /cmv/costs/search
// =============================================================================
/**
 * @route POST /api/totvs/cmv/costs/search
 * @desc  Proxy CRU para POST /api/totvsmoda/product/v2/costs/search
 *        (schema TOTVS: ProductCostInDto → ProductCostOutDto)
 *
 * Body típico para obter custo por referência:
 * {
 *   "filter": {
 *     "referenceCodeList": [string, ...],  // ou "productCodeList": [int]
 *   },
 *   "option": {
 *     "costs": [
 *       { "branchCode": int, "costCodeList": [int, ...] }
 *     ]
 *   },
 *   "page": 1,
 *   "pageSize": 1000
 * }
 *
 * Response items[]:
 *   { productCode, productName, productSku, referenceCode,
 *     colorCode, sizeName,
 *     costs: [ { branchCode, costCode, costName, cost (double) } ] }
 */
router.post(
  '/cmv/costs/search',
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    if (!body?.filter) {
      return errorResponse(res, 'Campo "filter" é obrigatório.', 400);
    }
    if (!Array.isArray(body?.option?.costs) || body.option.costs.length === 0) {
      return errorResponse(
        res,
        'Campo option.costs[] é obrigatório (lista com {branchCode, costCodeList}).',
        400,
      );
    }

    try {
      const cacheKey = _stableKey('costs', body);
      const { data, fromCache } = await _cachedFetch(
        cacheKey,
        10 * 60 * 1000, // 10 min
        async () => {
          const { access_token } = await getToken();
          const r = await axios.post(COSTS_SEARCH_ENDPOINT, body, {
            headers: {
              Authorization: `Bearer ${access_token}`,
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            httpsAgent,
            timeout: 120000,
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
          });
          return r.data;
        },
      );
      res.set('X-Cache', fromCache ? 'HIT' : 'MISS');
      return successResponse(res, data, 'Custos obtidos com sucesso');
    } catch (err) {
      return forwardTotvsError(res, err, 'TOTVS /product/v2/costs/search');
    }
  }),
);

// =============================================================================
// 5) DELETE /cmv/cache  — limpa o cache em memória
// =============================================================================
router.delete(
  '/cmv/cache',
  asyncHandler(async (_req, res) => {
    const size = _cache.size;
    _cache.clear();
    return successResponse(
      res,
      { cleared: size },
      `Cache limpo (${size} entradas removidas).`,
    );
  }),
);

export default router;
