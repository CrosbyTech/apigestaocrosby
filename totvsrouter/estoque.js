import express from 'express';
import https from 'https';
import axios from 'axios';
import {
  asyncHandler,
  successResponse,
  errorResponse,
} from '../utils/errorHandler.js';
import { getToken } from '../utils/totvsTokenManager.js';
import { httpsAgent, httpAgent, TOTVS_BASE_URL } from './totvsHelper.js';

const router = express.Router();

// ─── Helpers internos ────────────────────────────────────────────────────────

const PRODUCT_BASE = `${TOTVS_BASE_URL}/product/v2`;

async function totvsPost(url, body, token, timeout = 120000) {
  return axios.post(url, body, {
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
    httpsAgent,
    httpAgent,
    timeout,
  });
}

async function totvsGet(url, token, timeout = 60000) {
  return axios.get(url, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
    httpsAgent,
    httpAgent,
    timeout,
  });
}

/** Execute request with automatic 401 retry */
async function withRetry(fn) {
  let tokenData = await getToken();
  if (!tokenData?.access_token) {
    throw {
      status: 503,
      code: 'TOKEN_UNAVAILABLE',
      message: 'Token TOTVS indisponível',
    };
  }
  try {
    return await fn(tokenData.access_token);
  } catch (error) {
    if (error.response?.status === 401) {
      tokenData = await getToken(true);
      return await fn(tokenData.access_token);
    }
    throw error;
  }
}

function handleTotvsError(res, error, context) {
  console.error(`❌ Erro ${context}:`, {
    message: error.message,
    status: error.response?.status,
    data: error.response?.data,
  });
  if (error.status === 503 && error.code === 'TOKEN_UNAVAILABLE') {
    return errorResponse(res, error.message, 503, 'TOKEN_UNAVAILABLE');
  }
  if (error.response) {
    return errorResponse(
      res,
      error.response.data?.message ||
        error.response.data?.errors?.[0]?.message ||
        `Erro ${context}`,
      error.response.status || 500,
      'TOTVS_API_ERROR',
    );
  }
  if (error.request) {
    return errorResponse(
      res,
      'Não foi possível conectar à API TOTVS',
      503,
      'TOTVS_CONNECTION_ERROR',
    );
  }
  throw error;
}

function buildQueryString(params) {
  const sp = new URLSearchParams();
  for (const [key, val] of Object.entries(params)) {
    if (val !== undefined && val !== null && val !== '') {
      if (Array.isArray(val)) {
        val.forEach((v) => sp.append(key, v));
      } else {
        sp.set(key, val);
      }
    }
  }
  const qs = sp.toString();
  return qs ? `?${qs}` : '';
}

// ═════════════════════════════════════════════════════════════════════════════
//  POST ROUTES — Busca com filtro (search)
// ═════════════════════════════════════════════════════════════════════════════

// ─── 1. Produtos Mais Vendidos ───────────────────────────────────────────────
router.post(
  '/best-selling-products',
  asyncHandler(async (req, res) => {
    const { branchs, datemin, datemax } = req.body;
    if (!branchs || !Array.isArray(branchs) || branchs.length === 0) {
      return errorResponse(
        res,
        'O campo branchs é obrigatório (array de números)',
        400,
        'MISSING_BRANCHS',
      );
    }
    if (!datemin || !datemax) {
      return errorResponse(
        res,
        'Os campos datemin e datemax são obrigatórios',
        400,
        'MISSING_DATES',
      );
    }
    try {
      const url = `${TOTVS_BASE_URL}/ecommerce-sales-order/v2/best-selling-products/search`;
      const data = await withRetry(async (token) => {
        const resp = await totvsPost(
          url,
          { branchs, datemin, datemax },
          token,
          60000,
        );
        return resp.data;
      });
      return successResponse(
        res,
        data,
        'Ranking de produtos mais vendidos obtido com sucesso',
      );
    } catch (error) {
      return handleTotvsError(res, error, 'ao buscar ranking de produtos');
    }
  }),
);

// ─── 2. Saldos de Estoque (Balances) ────────────────────────────────────────
router.post(
  '/product-balances',
  asyncHandler(async (req, res) => {
    const { filter, option, page, pageSize, order, expand } = req.body;
    if (!filter || !option?.balances || !Array.isArray(option.balances)) {
      return errorResponse(
        res,
        'Campos obrigatórios: filter, option.balances[]',
        400,
        'MISSING_PARAMS',
      );
    }
    for (const b of option.balances) {
      if (
        !b.branchCode ||
        !b.stockCodeList ||
        !Array.isArray(b.stockCodeList)
      ) {
        return errorResponse(
          res,
          'Cada balance deve ter branchCode e stockCodeList[]',
          400,
          'INVALID_BALANCE_OPTION',
        );
      }
    }
    try {
      const body = {
        filter,
        option,
        page: page || 1,
        pageSize: Math.min(pageSize || 100, 1000),
      };
      if (order) body.order = order;
      if (expand) body.expand = expand;
      const url = `${PRODUCT_BASE}/balances/search`;
      const data = await withRetry(async (token) => {
        const resp = await totvsPost(url, body, token);
        return resp.data;
      });
      return successResponse(
        res,
        {
          data: data.items || [],
          total: data.totalItems || 0,
          count: data.count || 0,
          totalPages: data.totalPages || 0,
          hasNext: data.hasNext || false,
          page: body.page,
          pageSize: body.pageSize,
        },
        `${data.items?.length || 0} saldos encontrados`,
      );
    } catch (error) {
      return handleTotvsError(res, error, 'ao buscar saldos de estoque');
    }
  }),
);

// ─── 3. Códigos de Produto ──────────────────────────────────────────────────
router.post(
  '/product-codes/search',
  asyncHandler(async (req, res) => {
    const { filter, page, pageSize, order } = req.body;
    if (!filter)
      return errorResponse(
        res,
        'Campo obrigatório: filter',
        400,
        'MISSING_FILTER',
      );
    try {
      const body = {
        filter,
        page: page || 1,
        pageSize: Math.min(pageSize || 1000, 100000),
      };
      if (order) body.order = order;
      const url = `${PRODUCT_BASE}/product-codes/search`;
      const data = await withRetry(
        async (token) => (await totvsPost(url, body, token)).data,
      );
      return successResponse(
        res,
        data,
        `${data.items?.length || 0} códigos de produto encontrados`,
      );
    } catch (error) {
      return handleTotvsError(res, error, 'ao buscar códigos de produto');
    }
  }),
);

// ─── 4. Preços de Produto ───────────────────────────────────────────────────
router.post(
  '/product-prices/search',
  asyncHandler(async (req, res) => {
    const { filter, option, page, pageSize, order, expand } = req.body;
    if (!filter || !option?.prices || !Array.isArray(option.prices)) {
      return errorResponse(
        res,
        'Campos obrigatórios: filter, option.prices[]',
        400,
        'MISSING_PARAMS',
      );
    }
    try {
      const body = {
        filter,
        option,
        page: page || 1,
        pageSize: Math.min(pageSize || 100, 1000),
      };
      if (order) body.order = order;
      if (expand) body.expand = expand;
      const url = `${PRODUCT_BASE}/prices/search`;
      const data = await withRetry(
        async (token) => (await totvsPost(url, body, token)).data,
      );
      return successResponse(
        res,
        data,
        `${data.items?.length || 0} preços encontrados`,
      );
    } catch (error) {
      return handleTotvsError(res, error, 'ao buscar preços');
    }
  }),
);

// ─── 5. Custos de Produto ───────────────────────────────────────────────────
router.post(
  '/product-costs/search',
  asyncHandler(async (req, res) => {
    const { filter, option, page, pageSize, order } = req.body;
    if (!filter || !option?.costs || !Array.isArray(option.costs)) {
      return errorResponse(
        res,
        'Campos obrigatórios: filter, option.costs[]',
        400,
        'MISSING_PARAMS',
      );
    }
    try {
      const body = {
        filter,
        option,
        page: page || 1,
        pageSize: Math.min(pageSize || 100, 1000),
      };
      if (order) body.order = order;
      const url = `${PRODUCT_BASE}/costs/search`;
      const data = await withRetry(
        async (token) => (await totvsPost(url, body, token)).data,
      );
      return successResponse(
        res,
        data,
        `${data.items?.length || 0} custos encontrados`,
      );
    } catch (error) {
      return handleTotvsError(res, error, 'ao buscar custos');
    }
  }),
);

// ─── 6. Referências de Produto ──────────────────────────────────────────────
router.post(
  '/product-references/search',
  asyncHandler(async (req, res) => {
    const { filter, option, page, pageSize, expand, order } = req.body;
    if (!filter || !option) {
      return errorResponse(
        res,
        'Campos obrigatórios: filter, option',
        400,
        'MISSING_PARAMS',
      );
    }
    try {
      const body = {
        filter,
        option,
        page: page || 1,
        pageSize: Math.min(pageSize || 100, 1000),
      };
      if (expand) body.expand = expand;
      if (order) body.order = order;
      const url = `${PRODUCT_BASE}/references/search`;
      const data = await withRetry(
        async (token) => (await totvsPost(url, body, token)).data,
      );
      return successResponse(
        res,
        data,
        `${data.items?.length || 0} referências encontradas`,
      );
    } catch (error) {
      return handleTotvsError(res, error, 'ao buscar referências');
    }
  }),
);

// ─── 7. Dados Completos de Produto ──────────────────────────────────────────
router.post(
  '/products/search',
  asyncHandler(async (req, res) => {
    const { filter, option, page, pageSize, expand, order } = req.body;
    if (!filter || !option) {
      return errorResponse(
        res,
        'Campos obrigatórios: filter, option',
        400,
        'MISSING_PARAMS',
      );
    }
    try {
      const body = {
        filter,
        option,
        page: page || 1,
        pageSize: Math.min(pageSize || 100, 1000),
      };
      if (expand) body.expand = expand;
      if (order) body.order = order;
      const url = `${PRODUCT_BASE}/products/search`;
      const data = await withRetry(
        async (token) => (await totvsPost(url, body, token)).data,
      );
      return successResponse(
        res,
        data,
        `${data.items?.length || 0} produtos encontrados`,
      );
    } catch (error) {
      return handleTotvsError(res, error, 'ao buscar produtos');
    }
  }),
);

// ─── 8. Tabela de Preço ─────────────────────────────────────────────────────
router.post(
  '/price-tables/search',
  asyncHandler(async (req, res) => {
    const { filter, option, page, pageSize, order } = req.body;
    if (!filter || !option?.branchCodeList || !option?.priceTableCode) {
      return errorResponse(
        res,
        'Campos obrigatórios: filter, option.branchCodeList[], option.priceTableCode',
        400,
        'MISSING_PARAMS',
      );
    }
    try {
      const body = {
        filter,
        option,
        page: page || 1,
        pageSize: Math.min(pageSize || 100, 1000),
      };
      if (order) body.order = order;
      const url = `${PRODUCT_BASE}/price-tables/search`;
      const data = await withRetry(
        async (token) => (await totvsPost(url, body, token)).data,
      );
      return successResponse(
        res,
        data,
        `${data.items?.length || 0} itens de tabela de preço encontrados`,
      );
    } catch (error) {
      return handleTotvsError(res, error, 'ao buscar tabela de preço');
    }
  }),
);

// ─── 9. Saldos Omni (alteração) ─────────────────────────────────────────────
router.post(
  '/omni-changed-balances',
  asyncHandler(async (req, res) => {
    const { filter, option, page, pageSize, order } = req.body;
    try {
      const body = {
        filter: filter || {},
        page: page || 1,
        pageSize: Math.min(pageSize || 100, 500),
      };
      if (option) body.option = option;
      if (order) body.order = order;
      const url = `${PRODUCT_BASE}/omni-changed-balances`;
      const data = await withRetry(
        async (token) => (await totvsPost(url, body, token)).data,
      );
      return successResponse(
        res,
        data,
        `${data.items?.length || 0} saldos omni encontrados`,
      );
    } catch (error) {
      return handleTotvsError(res, error, 'ao buscar saldos omni');
    }
  }),
);

// ─── 10. Dados de Lote (Batch) ──────────────────────────────────────────────
router.post(
  '/batch/search',
  asyncHandler(async (req, res) => {
    const { filter, page, pageSize } = req.body;
    if (!filter)
      return errorResponse(
        res,
        'Campo obrigatório: filter',
        400,
        'MISSING_FILTER',
      );
    try {
      const body = {
        filter,
        page: page || 1,
        pageSize: Math.min(pageSize || 100, 1000),
      };
      const url = `${PRODUCT_BASE}/batch/search`;
      const data = await withRetry(
        async (token) => (await totvsPost(url, body, token)).data,
      );
      return successResponse(
        res,
        data,
        `${data.items?.length || 0} lotes encontrados`,
      );
    } catch (error) {
      return handleTotvsError(res, error, 'ao buscar lotes');
    }
  }),
);

// ─── 11. Dados de Cor ───────────────────────────────────────────────────────
router.post(
  '/colors/search',
  asyncHandler(async (req, res) => {
    const { filter, expand, page, pageSize } = req.body;
    try {
      const body = {
        page: page || 1,
        pageSize: Math.min(pageSize || 100, 500),
      };
      if (filter) body.filter = filter;
      if (expand) body.expand = expand;
      const url = `${PRODUCT_BASE}/colors/search`;
      const data = await withRetry(
        async (token) => (await totvsPost(url, body, token)).data,
      );
      return successResponse(
        res,
        data,
        `${data.items?.length || 0} cores encontradas`,
      );
    } catch (error) {
      return handleTotvsError(res, error, 'ao buscar cores');
    }
  }),
);

// ─── 12. Composições ────────────────────────────────────────────────────────
router.post(
  '/compositions/search',
  asyncHandler(async (req, res) => {
    const {
      startChangeDate,
      endChangeDate,
      codeList,
      description,
      order,
      page,
      pageSize,
      expand,
    } = req.body;
    try {
      const body = {
        page: page || 1,
        pageSize: Math.min(pageSize || 100, 100),
      };
      if (startChangeDate) body.startChangeDate = startChangeDate;
      if (endChangeDate) body.endChangeDate = endChangeDate;
      if (codeList) body.codeList = codeList;
      if (description) body.description = description;
      if (order) body.order = order;
      if (expand) body.expand = expand;
      const url = `${PRODUCT_BASE}/compositions`;
      const data = await withRetry(
        async (token) => (await totvsPost(url, body, token)).data,
      );
      return successResponse(
        res,
        data,
        `${data.items?.length || 0} composições encontradas`,
      );
    } catch (error) {
      return handleTotvsError(res, error, 'ao buscar composições');
    }
  }),
);

// ═════════════════════════════════════════════════════════════════════════════
//  GET ROUTES — Consulta direta (query params)
// ═════════════════════════════════════════════════════════════════════════════

// ─── 13. Produto por Código ─────────────────────────────────────────────────
router.get(
  '/products/:code',
  asyncHandler(async (req, res) => {
    const { code } = req.params;
    const { branchCode } = req.query;
    if (!code)
      return errorResponse(
        res,
        'Código do produto é obrigatório',
        400,
        'MISSING_CODE',
      );
    try {
      let url = `${PRODUCT_BASE}/products/${encodeURIComponent(code)}/${branchCode || 1}`;
      const data = await withRetry(
        async (token) => (await totvsGet(url, token)).data,
      );
      return successResponse(res, data, 'Produto encontrado');
    } catch (error) {
      return handleTotvsError(res, error, 'ao buscar produto por código');
    }
  }),
);

// ─── 14. Unidades de Medida ─────────────────────────────────────────────────
router.get(
  '/measurement-unit',
  asyncHandler(async (req, res) => {
    const {
      StartChangeDate,
      EndChangeDate,
      MeasurementUnitList,
      Expand,
      Page,
      PageSize,
    } = req.query;
    try {
      const qs = buildQueryString({
        StartChangeDate,
        EndChangeDate,
        MeasurementUnitList,
        Expand,
        Page: Page || 1,
        PageSize: PageSize || 1000,
      });
      const url = `${PRODUCT_BASE}/measurement-unit${qs}`;
      const data = await withRetry(
        async (token) => (await totvsGet(url, token)).data,
      );
      return successResponse(
        res,
        data,
        `${data.items?.length || 0} unidades de medida encontradas`,
      );
    } catch (error) {
      return handleTotvsError(res, error, 'ao buscar unidades de medida');
    }
  }),
);

// ─── 15. Categorias ─────────────────────────────────────────────────────────
router.get(
  '/categories',
  asyncHandler(async (req, res) => {
    const { StartChangeDate, EndChangeDate, Order, Page, PageSize } = req.query;
    try {
      const qs = buildQueryString({
        StartChangeDate,
        EndChangeDate,
        Order,
        Page: Page || 1,
        PageSize: PageSize || 1000,
      });
      const url = `${PRODUCT_BASE}/category${qs}`;
      const data = await withRetry(
        async (token) => (await totvsGet(url, token)).data,
      );
      return successResponse(
        res,
        data,
        `${data.items?.length || 0} categorias encontradas`,
      );
    } catch (error) {
      return handleTotvsError(res, error, 'ao buscar categorias');
    }
  }),
);

// ─── 16. Grades ─────────────────────────────────────────────────────────────
router.get(
  '/grids',
  asyncHandler(async (req, res) => {
    const { StartChangeDate, EndChangeDate, Order, Page, PageSize } = req.query;
    try {
      const qs = buildQueryString({
        StartChangeDate,
        EndChangeDate,
        Order,
        Page: Page || 1,
        PageSize: PageSize || 1000,
      });
      const url = `${PRODUCT_BASE}/grid${qs}`;
      const data = await withRetry(
        async (token) => (await totvsGet(url, token)).data,
      );
      return successResponse(
        res,
        data,
        `${data.items?.length || 0} grades encontradas`,
      );
    } catch (error) {
      return handleTotvsError(res, error, 'ao buscar grades');
    }
  }),
);

// ─── 17. Classificações ─────────────────────────────────────────────────────
router.get(
  '/classifications',
  asyncHandler(async (req, res) => {
    const { StartChangeDate, EndChangeDate, TypeCodeList, Page, PageSize } =
      req.query;
    try {
      const qs = buildQueryString({
        StartChangeDate,
        EndChangeDate,
        TypeCodeList,
        Page: Page || 1,
        PageSize: PageSize || 1000,
      });
      const url = `${PRODUCT_BASE}/classifications${qs}`;
      const data = await withRetry(
        async (token) => (await totvsGet(url, token)).data,
      );
      return successResponse(
        res,
        data,
        `${data.items?.length || 0} classificações encontradas`,
      );
    } catch (error) {
      return handleTotvsError(res, error, 'ao buscar classificações');
    }
  }),
);

// ─── 18. Tipos de Classificação ─────────────────────────────────────────────
router.get(
  '/classification-types',
  asyncHandler(async (req, res) => {
    const {
      StartChangeDate,
      EndChangeDate,
      ClassificationTypeList,
      IsGroup,
      Order,
      Page,
      PageSize,
    } = req.query;
    try {
      const qs = buildQueryString({
        StartChangeDate,
        EndChangeDate,
        ClassificationTypeList,
        IsGroup,
        Order,
        Page: Page || 1,
        PageSize: PageSize || 100,
      });
      const url = `${PRODUCT_BASE}/classificationType${qs}`;
      const data = await withRetry(
        async (token) => (await totvsGet(url, token)).data,
      );
      return successResponse(
        res,
        data,
        `${data.items?.length || 0} tipos de classificação encontrados`,
      );
    } catch (error) {
      return handleTotvsError(res, error, 'ao buscar tipos de classificação');
    }
  }),
);

// ─── 19. Cabeçalhos de Tabela de Preço ──────────────────────────────────────
router.get(
  '/price-tables-headers',
  asyncHandler(async (req, res) => {
    const {
      StartChangeDate,
      EndChangeDate,
      PriceTableCodeList,
      Page,
      PageSize,
      Order,
    } = req.query;
    try {
      const qs = buildQueryString({
        StartChangeDate,
        EndChangeDate,
        PriceTableCodeList,
        Order,
        Page: Page || 1,
        PageSize: PageSize || 1000,
      });
      const url = `${PRODUCT_BASE}/price-tables-headers${qs}`;
      const data = await withRetry(
        async (token) => (await totvsGet(url, token)).data,
      );
      return successResponse(
        res,
        data,
        `${data.items?.length || 0} cabeçalhos de tabela de preço encontrados`,
      );
    } catch (error) {
      return handleTotvsError(
        res,
        error,
        'ao buscar cabeçalhos de tabela de preço',
      );
    }
  }),
);

// ─── 20. Escalas de Tabela de Preço ─────────────────────────────────────────
router.get(
  '/price-table-scales',
  asyncHandler(async (req, res) => {
    const {
      StartChangeDate,
      EndChangeDate,
      ScaleCodeList,
      PriceTableCodeList,
      Page,
      PageSize,
    } = req.query;
    try {
      const qs = buildQueryString({
        StartChangeDate,
        EndChangeDate,
        ScaleCodeList,
        PriceTableCodeList,
        Page: Page || 1,
        PageSize: PageSize || 1000,
      });
      const url = `${PRODUCT_BASE}/price-table-scales${qs}`;
      const data = await withRetry(
        async (token) => (await totvsGet(url, token)).data,
      );
      return successResponse(
        res,
        data,
        `${data.items?.length || 0} escalas encontradas`,
      );
    } catch (error) {
      return handleTotvsError(
        res,
        error,
        'ao buscar escalas de tabela de preço',
      );
    }
  }),
);

// ─── 21. Tipos de Campos Adicionais ─────────────────────────────────────────
router.get(
  '/additional-fields-types',
  asyncHandler(async (req, res) => {
    const {
      StartChangeDate,
      EndChangeDate,
      CodeList,
      Description,
      Order,
      Page,
      PageSize,
    } = req.query;
    try {
      const qs = buildQueryString({
        StartChangeDate,
        EndChangeDate,
        CodeList,
        Description,
        Order,
        Page: Page || 1,
        PageSize: PageSize || 100,
      });
      const url = `${PRODUCT_BASE}/additional-fields-types${qs}`;
      const data = await withRetry(
        async (token) => (await totvsGet(url, token)).data,
      );
      return successResponse(
        res,
        data,
        `${data.items?.length || 0} tipos de campo adicional encontrados`,
      );
    } catch (error) {
      return handleTotvsError(
        res,
        error,
        'ao buscar tipos de campos adicionais',
      );
    }
  }),
);

// ─── 22. Configuração de Agrupador de Produto ───────────────────────────────
router.get(
  '/product-grouper-config',
  asyncHandler(async (req, res) => {
    const {
      StartChangeDate,
      EndChangeDate,
      GrouperCodeList,
      Order,
      Page,
      PageSize,
    } = req.query;
    try {
      const qs = buildQueryString({
        StartChangeDate,
        EndChangeDate,
        GrouperCodeList,
        Order,
        Page: Page || 1,
        PageSize: PageSize || 100,
      });
      const url = `${PRODUCT_BASE}/product-grouper-configuration${qs}`;
      const data = await withRetry(
        async (token) => (await totvsGet(url, token)).data,
      );
      return successResponse(
        res,
        data,
        `${data.items?.length || 0} configurações de agrupador encontradas`,
      );
    } catch (error) {
      return handleTotvsError(
        res,
        error,
        'ao buscar configuração de agrupador',
      );
    }
  }),
);

// ─── 23. Itens de Instrução ─────────────────────────────────────────────────
router.get(
  '/instruction-items',
  asyncHandler(async (req, res) => {
    const {
      StartChangeDate,
      EndChangeDate,
      CodeList,
      Description,
      Order,
      Page,
      PageSize,
      Expand,
    } = req.query;
    try {
      const qs = buildQueryString({
        StartChangeDate,
        EndChangeDate,
        CodeList,
        Description,
        Order,
        Expand,
        Page: Page || 1,
        PageSize: PageSize || 100,
      });
      const url = `${PRODUCT_BASE}/instruction-items${qs}`;
      const data = await withRetry(
        async (token) => (await totvsGet(url, token)).data,
      );
      return successResponse(
        res,
        data,
        `${data.items?.length || 0} itens de instrução encontrados`,
      );
    } catch (error) {
      return handleTotvsError(res, error, 'ao buscar itens de instrução');
    }
  }),
);

// ─── 24. Composição por Grupo de Produto ────────────────────────────────────
router.get(
  '/composition-group-product',
  asyncHandler(async (req, res) => {
    const {
      ProductCodeList,
      GroupCodeList,
      ReferenceCodeList,
      Page,
      PageSize,
    } = req.query;
    if (!ProductCodeList && !GroupCodeList && !ReferenceCodeList) {
      return errorResponse(
        res,
        'Informe ao menos um: ProductCodeList, GroupCodeList ou ReferenceCodeList',
        400,
        'MISSING_PARAMS',
      );
    }
    try {
      const qs = buildQueryString({
        ProductCodeList,
        GroupCodeList,
        ReferenceCodeList,
        Page: Page || 1,
        PageSize: PageSize || 100,
      });
      const url = `${PRODUCT_BASE}/composition-group-product${qs}`;
      const data = await withRetry(
        async (token) => (await totvsGet(url, token)).data,
      );
      return successResponse(
        res,
        data,
        `${data.items?.length || 0} composições por grupo encontradas`,
      );
    } catch (error) {
      return handleTotvsError(
        res,
        error,
        'ao buscar composição por grupo de produto',
      );
    }
  }),
);

// ─── 25. Composição por Produto ─────────────────────────────────────────────
router.get(
  '/composition-product',
  asyncHandler(async (req, res) => {
    const {
      ProductCodeList,
      GroupCodeList,
      ReferenceCodeList,
      Page,
      PageSize,
    } = req.query;
    if (!ProductCodeList && !GroupCodeList && !ReferenceCodeList) {
      return errorResponse(
        res,
        'Informe ao menos um: ProductCodeList, GroupCodeList ou ReferenceCodeList',
        400,
        'MISSING_PARAMS',
      );
    }
    try {
      const qs = buildQueryString({
        ProductCodeList,
        GroupCodeList,
        ReferenceCodeList,
        Page: Page || 1,
        PageSize: PageSize || 100,
      });
      const url = `${PRODUCT_BASE}/composition-product${qs}`;
      const data = await withRetry(
        async (token) => (await totvsGet(url, token)).data,
      );
      return successResponse(
        res,
        data,
        `${data.items?.length || 0} composições por produto encontradas`,
      );
    } catch (error) {
      return handleTotvsError(res, error, 'ao buscar composição por produto');
    }
  }),
);

// ─── 26. Movimentação Kardex ────────────────────────────────────────────────
router.get(
  '/kardex-movement',
  asyncHandler(async (req, res) => {
    const { ProductCode, BranchCode, StartDate, EndDate, BalanceType } =
      req.query;
    if (!ProductCode) {
      return errorResponse(
        res,
        'ProductCode é obrigatório',
        400,
        'MISSING_PRODUCT_CODE',
      );
    }
    try {
      const qs = buildQueryString({
        ProductCode,
        BranchCode,
        StartDate,
        EndDate,
        BalanceType,
      });
      const url = `${PRODUCT_BASE}/kardex-movement${qs}`;
      const data = await withRetry(
        async (token) => (await totvsGet(url, token)).data,
      );
      return successResponse(
        res,
        data,
        'Movimentação kardex obtida com sucesso',
      );
    } catch (error) {
      return handleTotvsError(res, error, 'ao buscar movimentação kardex');
    }
  }),
);

export default router;
