import axios from 'axios';
import { getToken } from '../utils/totvsTokenManager.js';
import {
  httpsAgent,
  httpAgent,
  TOTVS_BASE_URL,
  getBranchCodes,
} from '../totvsrouter/totvsHelper.js';

// ==========================================
// VOUCHER USAGE ENRICHMENT SERVICE
//
// Heurística de cruzamento:
// 1. Busca vouchers utilizados (status=4) via GET voucher/v2/search
// 2. Para cada voucher, busca movimentação fiscal do cliente
//    (customerCode) no período startDate → endDate do voucher
// 3. Agrupa itens da movimentação por chave provisória
//    (personCode + branchCode + movementDate + operationCode)
//    quando não existe transactionCode
// 4. Seleciona a ÚLTIMA compra agrupada como candidata
// 5. Retorna o desconto encontrado na compra candidata
//
// Limitações:
// - A associação voucher ↔ compra é probabilística, não determinística
// - Se o cliente fez múltiplas compras no período, a regra
//   "última compra" pode associar ao pedido errado
// - Se não houver transactionCode, a chave de agrupamento provisória
//   pode falhar com compras simultâneas no mesmo dia/filial
// - O discountValue da movimentação pode conter descontos não
//   relacionados ao voucher (desconto comercial, etc.)
// ==========================================

const VOUCHER_SEARCH_ENDPOINT = `${TOTVS_BASE_URL}/voucher/v2/search`;
const FISCAL_MOVEMENT_ENDPOINT = `${TOTVS_BASE_URL}/analytics/v2/fiscal-movement/search`;

// Status do voucher na API TOTVS:
// 1 = Ativo/Disponível
// 4 = Utilizado
const VOUCHER_STATUS_USED = 4;

/**
 * Faz uma requisição autenticada à API TOTVS com retry automático em 401.
 */
async function totvsRequest(method, url, data, token) {
  const config = {
    method,
    url,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      Connection: 'keep-alive',
    },
    timeout: 60000,
    httpsAgent,
    httpAgent,
  };
  if (data && method.toLowerCase() !== 'get') config.data = data;
  if (data && method.toLowerCase() === 'get') config.params = data;

  try {
    return await axios(config);
  } catch (error) {
    if (error.response?.status === 401) {
      console.log('🔄 [VoucherUsage] Token expirado, renovando...');
      const newTokenData = await getToken(true);
      config.headers.Authorization = `Bearer ${newTokenData.access_token}`;
      return await axios(config);
    }
    throw error;
  }
}

/**
 * Busca vouchers utilizados (status=4) com paginação automática.
 * Usa GET voucher/v2/search com query params.
 *
 * Campos retornados pela API:
 *   voucherNumber, voucherCode, prefixCode, voucherType, status, value,
 *   startDate, endDate, inclusionDate, customerCode, customerName,
 *   branchs[{branchCode}], closingDate, etc.
 */
async function fetchUsedVouchers(token, filters) {
  const { startDateInitial, startDateFinal, companyCode, customerCode, status } = filters;

  let allItems = [];
  let page = 1;
  const pageSize = 100;
  let hasMore = true;

  const voucherStatus = status || VOUCHER_STATUS_USED;
  console.log(`🎫 [VoucherUsage] Buscando vouchers (status=${voucherStatus})...`, {
    periodo: `${startDateInitial} a ${startDateFinal}`,
    companyCode: companyCode || 'todas',
    customerCode: customerCode || 'todos',
  });

  while (hasMore) {
    const params = {
      StartDateInitial: startDateInitial,
      StartDateFinal: startDateFinal,
      Status: voucherStatus,
      Page: page,
      PageSize: pageSize,
    };
    if (companyCode) params.CompanyCode = Number(companyCode);
    if (customerCode) params.CustomerCode = Number(customerCode);

    const response = await totvsRequest('get', VOUCHER_SEARCH_ENDPOINT, params, token);
    const items = response.data?.items || [];
    allItems = allItems.concat(items);

    const hasNext = response.data?.hasNext ?? false;
    const total = response.data?.count || 0;

    console.log(`🎫 [VoucherUsage] Página ${page}: +${items.length} vouchers (acumulado: ${allItems.length}/${total})`);

    if (!hasNext || items.length === 0) {
      hasMore = false;
    } else {
      page++;
    }
  }

  console.log(`🎫 [VoucherUsage] Total de vouchers (status=${voucherStatus}): ${allItems.length}`);
  return allItems;
}

/**
 * Extrai campos normalizados de um voucher utilizado.
 * Baseado na estrutura real da API:
 *   { voucherNumber, status, value, startDate, endDate,
 *     customerCode, customerName, branchs: [{branchCode}] }
 */
function normalizeUsedVoucher(voucher) {
  return {
    voucherNumber: String(voucher.voucherNumber || voucher.voucherCode || ''),
    customerCode: voucher.customerCode != null ? Number(voucher.customerCode) : null,
    customerName: voucher.customerName || null,
    // endDate como proxy da data de utilização (sem campo usedDate na API)
    usedDate: voucher.endDate || voucher.closingDate || null,
    startDate: voucher.startDate || null,
    branchCode: voucher.branchs?.[0]?.branchCode || null,
    allBranchCodes: (voucher.branchs || []).map(b => b.branchCode),
    voucherValue: Number(voucher.value) || 0,
  };
}

/**
 * Busca movimentação fiscal para um cliente específico em um período,
 * com paginação automática.
 */
async function fetchFiscalMovements(token, branchCodeList, personCode, startDate, endDate) {
  const filter = {
    branchCodeList,
    startMovementDate: startDate,
    endMovementDate: endDate,
  };

  let allItems = [];
  let page = 1;
  const pageSize = 100;
  let hasMore = true;

  while (hasMore) {
    const payload = { filter, page, pageSize };
    const response = await totvsRequest('post', FISCAL_MOVEMENT_ENDPOINT, payload, token);
    const items = response.data?.items || response.data?.data || [];
    allItems = allItems.concat(items);

    const hasNext = response.data?.hasNext ?? false;
    const total = response.data?.total || response.data?.totalRecords || 0;

    if (!hasNext || items.length === 0 || allItems.length >= total) {
      hasMore = false;
    } else {
      page++;
    }
  }

  // Filtrar pelo personCode do cliente (a API pode retornar itens de outros clientes
  // se a busca for por filial/período sem filtro de person)
  if (personCode) {
    allItems = allItems.filter(
      (item) => Number(item.personCode) === Number(personCode),
    );
  }

  return allItems;
}

/**
 * Agrupa itens da movimentação fiscal por "compra".
 *
 * Como a movimentação pode retornar linhas por item vendido,
 * precisamos reconstruir a compra completa. Se a API retornar
 * um transactionCode, usamos esse campo como chave. Caso contrário,
 * criamos uma chave provisória com:
 *   personCode + branchCode + movementDate + operationCode
 *
 * Dentro de cada grupo, somamos:
 *   - grossValue
 *   - discountValue
 *   - netValue
 */
function groupMovementsByPurchase(movements) {
  const groups = new Map();

  for (const item of movements) {
    // Tentar usar transactionCode como chave primária de agrupamento
    const txCode = item.transactionCode || item.saleCode || item.invoiceCode;

    const groupKey = txCode
      ? `tx_${txCode}`
      : `prov_${item.personCode}_${item.branchCode}_${item.movementDate}_${item.operationCode}`;

    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        groupKey,
        hasTransactionCode: !!txCode,
        transactionCode: txCode || null,
        personCode: item.personCode,
        branchCode: item.branchCode,
        movementDate: item.movementDate,
        operationCode: item.operationCode,
        grossValue: 0,
        discountValue: 0,
        netValue: 0,
        itemCount: 0,
      });
    }

    const group = groups.get(groupKey);
    group.grossValue += Number(item.grossValue) || 0;
    group.discountValue += Number(item.discountValue) || 0;
    group.netValue += Number(item.netValue) || 0;
    group.itemCount += 1;
  }

  return Array.from(groups.values());
}

/**
 * Encontra a última compra do cliente dentro do período do voucher.
 *
 * Regra: seleciona a compra mais recente (por movementDate)
 * cujo movementDate seja <= usedDate do voucher.
 *
 * Se houver um transactionCode, a confiança é alta.
 * Se houver múltiplas compras no mesmo dia, a confiança é baixa (ambiguidade).
 * Caso contrário, confiança é média.
 */
function findLastPurchase(groupedPurchases, usedDate) {
  if (!groupedPurchases || groupedPurchases.length === 0) {
    return null;
  }

  // Filtrar compras até a data de utilização do voucher
  const usedDateNorm = new Date(usedDate).getTime();
  const eligiblePurchases = groupedPurchases.filter((p) => {
    const purchaseDate = new Date(p.movementDate).getTime();
    return purchaseDate <= usedDateNorm;
  });

  if (eligiblePurchases.length === 0) return null;

  // Ordenar por data decrescente para pegar a última
  eligiblePurchases.sort(
    (a, b) => new Date(b.movementDate).getTime() - new Date(a.movementDate).getTime(),
  );

  const lastPurchase = eligiblePurchases[0];

  // Determinar nível de confiança
  let matchConfidence = 'medium';

  if (lastPurchase.hasTransactionCode) {
    // Existe identificador forte da transação
    matchConfidence = 'high';
  } else {
    // Verificar ambiguidade: múltiplas compras no mesmo dia
    const sameDatePurchases = eligiblePurchases.filter(
      (p) => p.movementDate === lastPurchase.movementDate,
    );
    if (sameDatePurchases.length > 1) {
      matchConfidence = 'low'; // Ambiguidade: mais de uma compra no mesmo dia
    }
  }

  return {
    purchase: lastPurchase,
    matchConfidence,
    totalCandidates: eligiblePurchases.length,
  };
}

/**
 * Processa o enriquecimento de vouchers utilizados com dados de compra.
 *
 * @param {Object} filters - Filtros da requisição
 * @param {string} filters.startDateInitial - Data inicial (obrigatório)
 * @param {string} filters.startDateFinal - Data final (obrigatório)
 * @param {number} [filters.companyCode] - Código da empresa/filial
 * @param {number} [filters.customerCode] - Código do cliente
 * @returns {Object} Resultado enriquecido
 */
export async function getVoucherUsageEnriched(filters) {
  const startTime = Date.now();
  const { startDateInitial, startDateFinal, companyCode, customerCode, status } = filters;

  // 1. Obter token
  const tokenData = await getToken();
  if (!tokenData?.access_token) {
    throw Object.assign(new Error('Não foi possível obter token de autenticação TOTVS'), {
      statusCode: 503,
      errorCode: 'TOKEN_UNAVAILABLE',
    });
  }
  const token = tokenData.access_token;

  // 2. Determinar branchCodeList para movimentação fiscal
  let branchCodeList;
  if (companyCode) {
    branchCodeList = [Number(companyCode)];
  } else {
    branchCodeList = await getBranchCodes(token);
  }

  console.log(`🎫 [VoucherUsage] Filiais para busca fiscal: ${branchCodeList.length} filiais`);

  // 3. Buscar vouchers no período (status conforme filtro, default=4)
  const usedVouchers = await fetchUsedVouchers(token, filters);

  if (usedVouchers.length === 0) {
    return {
      success: true,
      filters: { startDateInitial, startDateFinal, companyCode, customerCode, status },
      data: [],
      summary: {
        totalVouchers: 0,
        usedVouchers: 0,
        matchedVouchers: 0,
        unmatchedVouchers: 0,
        queryTime: Date.now() - startTime,
      },
    };
  }

  // 4. Para vouchers ativos (status=1), retornar sem cruzamento fiscal
  const voucherStatusFilter = status || VOUCHER_STATUS_USED;
  if (voucherStatusFilter === 1) {
    const activeResults = usedVouchers.map(voucher => {
      const norm = normalizeUsedVoucher(voucher);
      return {
        voucherNumber: norm.voucherNumber,
        customerCode: norm.customerCode ? String(norm.customerCode) : null,
        customerName: norm.customerName,
        usedDate: norm.usedDate,
        branchCode: norm.branchCode || 0,
        purchaseDate: null,
        grossValue: 0,
        discountFound: 0,
        estimatedVoucherUsedValue: 0,
        voucherNominalValue: norm.voucherValue,
        matchMethod: null,
        matchConfidence: null,
        matchError: null,
        status: 'active',
      };
    });

    const totalTime = Date.now() - startTime;
    return {
      success: true,
      filters: { startDateInitial, startDateFinal, companyCode, customerCode, status },
      data: activeResults,
      summary: {
        totalVouchers: activeResults.length,
        usedVouchers: 0,
        matchedVouchers: 0,
        unmatchedVouchers: 0,
        queryTime: totalTime,
      },
    };
  }

  // 5. Para cada voucher utilizado, buscar e cruzar com movimentação fiscal
  const enrichedResults = [];
  let matchedCount = 0;

  for (const voucher of usedVouchers) {
    const norm = normalizeUsedVoucher(voucher);

    // Pular vouchers sem cliente identificado
    if (!norm.customerCode) {
      console.log(`⚠️ [VoucherUsage] Voucher ${norm.voucherNumber}: sem customerCode, ignorando`);
      enrichedResults.push({
        voucherNumber: norm.voucherNumber,
        customerCode: null,
        customerName: norm.customerName,
        usedDate: norm.usedDate,
        branchCode: norm.branchCode || 0,
        purchaseDate: null,
        grossValue: 0,
        discountFound: 0,
        estimatedVoucherUsedValue: 0,
        voucherNominalValue: norm.voucherValue,
        matchMethod: 'last_purchase_within_voucher_period',
        matchConfidence: 'low',
        matchError: 'customer_not_identified',
      });
      continue;
    }

    // Aplicar filtro de customerCode se informado na query
    if (customerCode && Number(norm.customerCode) !== Number(customerCode)) {
      continue;
    }

    try {
      // Período da busca fiscal: startDate → endDate do voucher
      const fiscalStartDate = norm.startDate || startDateInitial;
      const fiscalEndDate = norm.usedDate || startDateFinal;

      // Usar as filiais do voucher quando disponíveis, senão usar branchCodeList geral
      const voucherBranches = norm.allBranchCodes.length > 0
        ? norm.allBranchCodes
        : branchCodeList;

      // Buscar movimentação fiscal do cliente
      const movements = await fetchFiscalMovements(
        token,
        voucherBranches,
        norm.customerCode,
        fiscalStartDate,
        fiscalEndDate,
      );

      // Agrupar itens por compra (evitar duplicidade por item)
      const groupedPurchases = groupMovementsByPurchase(movements);

      // Encontrar a última compra como candidata
      const match = findLastPurchase(groupedPurchases, norm.usedDate || startDateFinal);

      if (match) {
        matchedCount++;
        enrichedResults.push({
          voucherNumber: norm.voucherNumber,
          customerCode: String(norm.customerCode),
          customerName: norm.customerName,
          usedDate: norm.usedDate,
          branchCode: match.purchase.branchCode || norm.branchCode || 0,
          purchaseDate: match.purchase.movementDate,
          grossValue: Math.round(match.purchase.grossValue * 100) / 100,
          discountFound: Math.round(match.purchase.discountValue * 100) / 100,
          estimatedVoucherUsedValue: Math.round(match.purchase.discountValue * 100) / 100,
          voucherNominalValue: norm.voucherValue,
          matchMethod: 'last_purchase_within_voucher_period',
          matchConfidence: match.matchConfidence,
        });
      } else {
        enrichedResults.push({
          voucherNumber: norm.voucherNumber,
          customerCode: String(norm.customerCode),
          customerName: norm.customerName,
          usedDate: norm.usedDate,
          branchCode: norm.branchCode || 0,
          purchaseDate: null,
          grossValue: 0,
          discountFound: 0,
          estimatedVoucherUsedValue: 0,
          voucherNominalValue: norm.voucherValue,
          matchMethod: 'last_purchase_within_voucher_period',
          matchConfidence: 'low',
          matchError: 'no_purchase_found_in_period',
        });
      }
    } catch (err) {
      console.error(`❌ [VoucherUsage] Erro ao processar voucher ${norm.voucherNumber}:`, err.message);
      enrichedResults.push({
        voucherNumber: norm.voucherNumber,
        customerCode: String(norm.customerCode),
        customerName: norm.customerName,
        usedDate: norm.usedDate,
        branchCode: norm.branchCode || 0,
        purchaseDate: null,
        grossValue: 0,
        discountFound: 0,
        estimatedVoucherUsedValue: 0,
        voucherNominalValue: norm.voucherValue,
        matchMethod: 'last_purchase_within_voucher_period',
        matchConfidence: 'low',
        matchError: `fiscal_fetch_error: ${err.message}`,
      });
    }
  }

  const totalTime = Date.now() - startTime;
  console.log(`✅ [VoucherUsage] Concluído em ${totalTime}ms: ${matchedCount}/${usedVouchers.length} vouchers com compra associada`);

  return {
    success: true,
    filters: { startDateInitial, startDateFinal, companyCode, customerCode, status },
    data: enrichedResults,
    summary: {
      totalVouchers: usedVouchers.length,
      usedVouchers: usedVouchers.length,
      matchedVouchers: matchedCount,
      unmatchedVouchers: usedVouchers.length - matchedCount,
      queryTime: totalTime,
    },
  };
}
