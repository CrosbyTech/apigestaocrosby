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
  getBranchCodes,
  getBranchesWithNames,
} from './totvsHelper.js';

const router = express.Router();

// =============================================================================
// PAINEL DE VENDAS — Faturamento Total
// POST /api/totvs/sale-panel/totals
// Body: { filtroempresa?: number[], datemin, datemax, operations?, sellers? }
// filtroempresa → lista de branchCodes do FiltroEmpresa; se omitido, usa todos.
// =============================================================================
router.post(
  '/sale-panel/totals',
  asyncHandler(async (req, res) => {
    const { filtroempresa, datemin, datemax, operations, sellers } = req.body;

    if (!datemin || !datemax) {
      return errorResponse(
        res,
        'Os campos datemin e datemax são obrigatórios',
        400,
        'MISSING_DATES',
      );
    }

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

    // Resolver branchs: usa filtroempresa do frontend ou busca todas do cache
    let branchs;
    if (Array.isArray(filtroempresa) && filtroempresa.length > 0) {
      branchs = filtroempresa
        .map((b) => parseInt(b))
        .filter((b) => !isNaN(b) && b > 0);
    }
    if (!branchs || branchs.length === 0) {
      branchs = await getBranchCodes(token);
    }

    const payload = {
      branchs,
      datemin,
      datemax,
      ...(Array.isArray(operations) && operations.length > 0 && { operations }),
      ...(Array.isArray(sellers) && sellers.length > 0 && { sellers }),
    };

    const endpoint = `${TOTVS_BASE_URL}/sale-panel/v2/totals/search`;

    console.log(`📊 [PainelVendas] ${endpoint}`, JSON.stringify(payload));

    const doRequest = async (accessToken) =>
      axios.post(endpoint, payload, {
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        httpsAgent,
        httpAgent,
        timeout: 60000,
      });

    let response;
    try {
      response = await doRequest(token);
    } catch (error) {
      if (error.response?.status === 401) {
        console.log('🔄 [PainelVendas] Token expirado, renovando...');
        const newTokenData = await getToken(true);
        response = await doRequest(newTokenData.access_token);
      } else {
        throw error;
      }
    }

    return successResponse(
      res,
      response.data,
      'Faturamento total obtido com sucesso',
    );
  }),
);

// =============================================================================
// RANKING DE FATURAMENTO POR FILIAL
// POST /api/totvs/sale-panel/ranking-faturamento
// Body: { datemin, datemax, operations?, branchs? }
// Se branchs não informado, busca todos via getBranchCodes()
// =============================================================================
router.post(
  '/sale-panel/ranking-faturamento',
  asyncHandler(async (req, res) => {
    const { datemin, datemax, operations, branchs } = req.body;

    if (!datemin || !datemax) {
      return errorResponse(
        res,
        'Os campos datemin e datemax são obrigatórios',
        400,
        'MISSING_DATES',
      );
    }

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

    let resolvedBranchs;
    if (Array.isArray(branchs) && branchs.length > 0) {
      resolvedBranchs = branchs
        .map((b) => parseInt(b))
        .filter((b) => !isNaN(b) && b > 0);
    } else {
      resolvedBranchs = await getBranchCodes(token);
    }

    // Filiais que recebem filtro de operações específico
    const SPECIAL_BRANCH_CODES = [
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 31, 41, 45, 50, 55,
      65, 75, 85, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101,
      105, 106, 107, 108, 109, 111, 200, 300, 311, 351, 400, 411, 450, 500, 550,
      551, 600, 650, 700, 750, 800, 850, 870, 880, 890, 891, 900, 910, 920, 930,
      940, 950, 960, 970, 980, 990,
    ]; // CASCAVEL, JOAO PESSOA, BREJINHO, TACARUNA
    const SPECIAL_OPERATIONS = [
      1, 2, 55, 510, 511, 1511, 521, 1521, 522, 960, 9001, 9009, 9027, 9017,
      9400, 9401, 9402, 9403, 9404, 9005, 545, 546, 555, 548, 1210, 9405, 1205,
      1101, 9065, 9064, 9063, 9062, 9061, 9420, 9026, 9067,
    ];

    const specialBranchs = resolvedBranchs.filter((b) =>
      SPECIAL_BRANCH_CODES.includes(b),
    );
    const otherBranchs = resolvedBranchs.filter(
      (b) => !SPECIAL_BRANCH_CODES.includes(b),
    );

    const endpoint = `${TOTVS_BASE_URL}/sale-panel/v2/totals-branch/search`;

    console.log(
      `🏆 [RankingFaturamento] ${endpoint}`,
      JSON.stringify({
        datemin,
        datemax,
        specialBranchs: specialBranchs.length,
        otherBranchs: otherBranchs.length,
      }),
    );

    const callTotvs = async (accessToken, body) =>
      axios.post(endpoint, body, {
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        httpsAgent,
        httpAgent,
        timeout: 60000,
      });

    const safeCall = async (body) => {
      try {
        return await callTotvs(token, body);
      } catch (error) {
        if (error.response?.status === 401) {
          console.log('🔄 [RankingFaturamento] Token expirado, renovando...');
          const newTokenData = await getToken(true);
          token = newTokenData.access_token;
          return callTotvs(token, body);
        }
        throw error;
      }
    };

    // Executa as chamadas (em paralelo quando há dois grupos)
    const callPromises = [];
    if (specialBranchs.length > 0) {
      callPromises.push(
        safeCall({
          branchs: specialBranchs,
          datemin,
          datemax,
          operations: SPECIAL_OPERATIONS,
        }),
      );
    }
    if (otherBranchs.length > 0) {
      callPromises.push(safeCall({ branchs: otherBranchs, datemin, datemax }));
    }

    const responses = await Promise.all(callPromises);
    const datasets = responses.map((r) => r.data);

    // Mescla dataRow e dataRowLastYear das duas respostas
    const mergedDataRow = datasets.flatMap((d) => d.dataRow || []);
    const mergedDataRowLastYear = datasets.flatMap(
      (d) => d.dataRowLastYear || [],
    );

    // Soma os totais e recalcula TM e PA
    const sumTotals = (totalsArr) => {
      const valid = totalsArr.filter(Boolean);
      if (valid.length === 0) return null;
      const summed = valid.reduce(
        (acc, t) => ({
          invoice_qty: acc.invoice_qty + (t.invoice_qty || 0),
          invoice_value: acc.invoice_value + (t.invoice_value || 0),
          itens_qty: acc.itens_qty + (t.itens_qty || 0),
        }),
        { invoice_qty: 0, invoice_value: 0, itens_qty: 0 },
      );
      summed.tm =
        summed.invoice_qty > 0 ? summed.invoice_value / summed.invoice_qty : 0;
      summed.pa =
        summed.invoice_qty > 0 ? summed.itens_qty / summed.invoice_qty : 0;
      summed.pmpv =
        summed.itens_qty > 0 ? summed.invoice_value / summed.itens_qty : 0;
      return summed;
    };

    const mergedData = {
      dataRow: mergedDataRow,
      dataRowLastYear: mergedDataRowLastYear,
      total: sumTotals(datasets.map((d) => d.total)),
      totalLastYear: sumTotals(datasets.map((d) => d.totalLastYear)),
    };

    return successResponse(
      res,
      mergedData,
      'Ranking de faturamento por filial obtido com sucesso',
    );
  }),
);

// =============================================================================
// VENDEDORES DO PAINEL DE VENDAS (por filial)
// POST /api/totvs/sale-panel/sellers
// Body: { filtroempresa?: number[], datemin, datemax }
// Retorna: { branches: [{ branch_code, branch_name, dataRow, invoiceQuantity, invoiceValue, itemQuantity }] }
// =============================================================================
router.post(
  '/sale-panel/sellers',
  asyncHandler(async (req, res) => {
    const { filtroempresa, datemin, datemax } = req.body;

    if (!datemin || !datemax) {
      return errorResponse(
        res,
        'Os campos datemin e datemax são obrigatórios',
        400,
        'MISSING_DATES',
      );
    }

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

    // Resolver filiais com nomes
    const allBranches = await getBranchesWithNames(token);
    let branches;
    if (Array.isArray(filtroempresa) && filtroempresa.length > 0) {
      const filterSet = new Set(
        filtroempresa.map((b) => parseInt(b)).filter((b) => !isNaN(b) && b > 0),
      );
      branches = allBranches.filter((b) => filterSet.has(b.code));
    } else {
      branches = allBranches;
    }

    const endpoint = `${TOTVS_BASE_URL}/sale-panel/v2/sellers/search`;

    // Mesmas filiais e operações especiais usadas no ranking-faturamento
    const SPECIAL_BRANCH_CODES = new Set([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 31, 41, 45, 50, 55,
      65, 75, 85, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101,
      105, 106, 107, 108, 109, 111, 200, 300, 311, 351, 400, 411, 450, 500, 550,
      551, 600, 650, 700, 750, 800, 850, 870, 880, 890, 891, 900, 910, 920, 930,
      940, 950, 960, 970, 980, 990,
    ]);
    const SPECIAL_OPERATIONS = [
      1, 2, 55, 510, 511, 1511, 521, 1521, 522, 960, 9001, 9009, 9027, 9017,
      9400, 9401, 9402, 9403, 9404, 9005, 545, 546, 555, 548, 1210, 9405, 1205,
      1101, 9065, 9064, 9063, 9062, 9061, 9420, 9026, 9067, 7234, 7236, 7240,
      7241, 7242, 7234, 7235, 7236, 7237, 7240, 7254, 7259, 7255, 7243, 7245,
      7244,
    ];

    console.log(
      `👤 [PainelVendas/Sellers] ${endpoint} — ${branches.length} filiais`,
    );

    const doRequest = async (accessToken, branchCode) => {
      const body = { branchs: [branchCode], datemin, datemax };
      if (SPECIAL_BRANCH_CODES.has(branchCode)) {
        body.operations = SPECIAL_OPERATIONS;
      }
      return axios.post(endpoint, body, {
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        httpsAgent,
        httpAgent,
        timeout: 60000,
      });
    };

    // Chamar por filial em lotes de 5 para não sobrecarregar
    const BATCH_SIZE = 5;
    const results = [];
    for (let i = 0; i < branches.length; i += BATCH_SIZE) {
      const batch = branches.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(async (branch) => {
          try {
            let response;
            try {
              response = await doRequest(token, branch.code);
            } catch (error) {
              if (error.response?.status === 401) {
                const newTokenData = await getToken(true);
                token = newTokenData.access_token;
                response = await doRequest(token, branch.code);
              } else {
                throw error;
              }
            }
            const data = response.data;
            if (data.dataRow && data.dataRow.length > 0) {
              return {
                branch_code: branch.code,
                branch_name: branch.name,
                dataRow: data.dataRow,
                invoiceQuantity: data.invoiceQuantity || 0,
                invoiceValue: data.invoiceValue || 0,
                itemQuantity: data.itemQuantity || 0,
              };
            }
            return null;
          } catch (err) {
            console.log(
              `⚠️ [Sellers] Erro filial ${branch.code}: ${err.message}`,
            );
            return null;
          }
        }),
      );
      results.push(...batchResults);
    }

    const branchesData = results.filter(Boolean);

    return successResponse(
      res,
      { branches: branchesData },
      'Vendedores por filial obtidos com sucesso',
    );
  }),
);

// =============================================================================
// TOP CUSTOMERS via fiscal-movement/search
// POST /api/totvs/seller-panel/top-customers
// Body: { branchs: number[], datemin, datemax, orderByQuantity, returnItensQuantity }
// =============================================================================
router.post(
  '/seller-panel/top-customers',
  asyncHandler(async (req, res) => {
    // Rota pesada — aumentar timeout do request para 10 min
    req.setTimeout(600000);
    res.setTimeout(600000);
    const startTime = Date.now();
    const { branchs, datemin, datemax, orderByQuantity, returnItensQuantity } =
      req.body;

    if (!datemin || !datemax) {
      return errorResponse(
        res,
        'Os campos datemin e datemax são obrigatórios',
        400,
        'MISSING_DATES',
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

    let accessToken = tokenData.access_token;

    // Lojas de varejo permitidas
    const VAREJO_BRANCHES = [
      2, 200, 5, 500, 55, 550, 65, 650, 87, 870, 88, 880, 89, 890, 90, 891, 91,
      910, 92, 920, 93, 930, 94, 940, 95, 950, 96, 960, 97, 970, 98, 980,
    ];

    // Resolver branchCodes — filtrar apenas varejo
    let branchCodeList;
    if (Array.isArray(branchs) && branchs.length > 0 && branchs[0] !== 0) {
      branchCodeList = branchs.filter((b) => VAREJO_BRANCHES.includes(b));
    } else {
      branchCodeList = VAREJO_BRANCHES;
    }

    if (branchCodeList.length === 0) {
      return successResponse(res, [], 'Nenhuma loja de varejo selecionada');
    }

    const endpoint = `${TOTVS_BASE_URL}/analytics/v2/fiscal-movement/search`;
    const PAGE_SIZE = 1000;

    const doRequest = async (token, payload) =>
      axios.post(endpoint, payload, {
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
        httpsAgent,
        httpAgent,
        timeout: 120000,
      });

    // ======== Mesmas regras de operações do ranking-faturamento ========
    const SPECIAL_BRANCH_CODES = new Set([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 31, 41, 45, 50, 55,
      65, 75, 85, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101,
      105, 106, 107, 108, 109, 111, 200, 300, 311, 351, 400, 411, 450, 500, 550,
      551, 600, 650, 700, 750, 800, 850, 870, 880, 890, 891, 900, 910, 920, 930,
      940, 950, 960, 970, 980, 990,
    ]);
    const SPECIAL_OPERATIONS = new Set([
      1, 2, 55, 510, 511, 1511, 521, 1521, 522, 960, 9001, 9009, 9027, 9017,
      9400, 9401, 9402, 9403, 9404, 9005, 545, 546, 555, 548, 1210, 9405, 1205,
      1101, 9065, 9064, 9063, 9062, 9061, 9420, 9026, 9067,
    ]);

    // Separar branches especiais (com filtro de operações) dos demais
    const specialBranches = branchCodeList.filter((b) =>
      SPECIAL_BRANCH_CODES.has(b),
    );
    const otherBranches = branchCodeList.filter(
      (b) => !SPECIAL_BRANCH_CODES.has(b),
    );

    // Para filtrar operações no código: quais branches precisam do filtro
    const specialBranchSet = new Set(specialBranches);

    // Set de todas as branches válidas (para filtrar no código — API pode ignorar branchCodeList)
    const validBranchSet = new Set(branchCodeList);

    console.log(
      `🏆 [TopCustomers] Buscando fiscal-movement | ${branchCodeList.length} branches (${specialBranches.length} special + ${otherBranches.length} other) | ${datemin} a ${datemax}`,
    );

    // Função para buscar todas as páginas — agrega on-the-fly (fetch único, sem chunks)
    const fetchAllAggregated = async (brMap) => {
      let pg = 1;
      let hasNext = true;
      let totalItems = 0;
      // Dedup: operações complementares (ex: 545 remessa + 555 venda) geram 2 registros
      // para a mesma mercadoria. Usar chave composta para contar apenas uma vez.
      const seenMovements = new Set();
      while (hasNext) {
        const payload = {
          filter: {
            branchCodeList,
            startMovementDate: datemin,
            endMovementDate: datemax,
          },
          page: pg,
          pageSize: PAGE_SIZE,
        };
        let response;
        try {
          response = await doRequest(accessToken, payload);
        } catch (error) {
          if (error.response?.status === 401) {
            const newToken = await getToken(true);
            accessToken = newToken.access_token;
            response = await doRequest(accessToken, payload);
          } else {
            throw error;
          }
        }
        const pageItems = response.data?.items || [];
        // Agregar direto em memória — filtrar operações como ranking-faturamento
        for (const item of pageItems) {
          if (
            !item.operationModel ||
            item.operationModel === 'Purchases' ||
            item.operationModel === 'SaleReturns'
          )
            continue;
          const bc = item.branchCode;
          const pc = item.personCode;
          if (!bc || !pc) continue;
          // Filtrar branchCode no código (API pode ignorar branchCodeList)
          if (!validBranchSet.has(bc)) continue;
          // Filiais especiais: só aceitar operações do SPECIAL_OPERATIONS
          if (
            specialBranchSet.has(bc) &&
            !SPECIAL_OPERATIONS.has(item.operationCode)
          )
            continue;
          // Dedup: mesma pessoa+filial+data+produto+valores = mesmo movimento (operações complementares)
          const dedupKey = `${bc}|${pc}|${item.movementDate}|${item.productCode || ''}|${item.quantity || 0}|${item.grossValue || 0}|${item.netValue || 0}`;
          if (seenMovements.has(dedupKey)) continue;
          seenMovements.add(dedupKey);
          if (!brMap[bc]) brMap[bc] = {};
          if (!brMap[bc][pc]) {
            brMap[bc][pc] = {
              code: String(pc),
              personCode: pc,
              name: '',
              quantity: 0,
              grossValue: 0,
              discountValue: 0,
              netValue: 0,
              purchaseDates: new Set(),
            };
          }
          brMap[bc][pc].quantity += item.quantity || 0;
          brMap[bc][pc].grossValue += item.grossValue || 0;
          brMap[bc][pc].discountValue += item.discountValue || 0;
          brMap[bc][pc].netValue += item.netValue || 0;
          if (item.movementDate) {
            brMap[bc][pc].purchaseDates.add(
              String(item.movementDate).split('T')[0],
            );
          }
        }
        totalItems += pageItems.length;
        hasNext = response.data?.hasNext ?? false;
        console.log(
          `🏆 [TopCustomers] Pág ${pg}: +${pageItems.length} (total: ${totalItems}) hasNext: ${hasNext}`,
        );
        pg++;
        if (pg > 200) break;
      }
      return totalItems;
    };

    // ======== Ranking + branch info (definir antes para rodar em paralelo) ========
    let branchInfo = {};
    let rankingDataRow = [];

    const rankingEndpoint = `${TOTVS_BASE_URL}/sale-panel/v2/totals-branch/search`;
    const callRankingTotvs = async (token, body) =>
      axios.post(rankingEndpoint, body, {
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
        httpsAgent,
        httpAgent,
        timeout: 60000,
      });

    const fetchRankingData = async () => {
      const callPromises = [];
      if (specialBranches.length > 0) {
        callPromises.push(
          callRankingTotvs(accessToken, {
            branchs: specialBranches,
            datemin,
            datemax,
            operations: [...SPECIAL_OPERATIONS],
          }),
        );
      }
      if (otherBranches.length > 0) {
        callPromises.push(
          callRankingTotvs(accessToken, {
            branchs: otherBranches,
            datemin,
            datemax,
          }),
        );
      }
      const responses = await Promise.all(callPromises);
      return responses.flatMap((r) => r.data?.dataRow || []);
    };

    // ======== FASE 1: fiscal-movement (fetch único) + branch info + ranking — SIMULTÂNEO ========
    const branchMap = {};
    const [totalFetched, brRankResults] = await Promise.all([
      fetchAllAggregated(branchMap),
      Promise.allSettled([
        getBranchesWithNames(accessToken),
        fetchRankingData(),
      ]),
    ]);

    // Processar branch info + ranking
    if (brRankResults[0].status === 'fulfilled') {
      for (const b of brRankResults[0].value) {
        branchInfo[b.code] = {
          name: b.name || `Filial ${b.code}`,
          groupName: b.groupName || b.name || `Filial ${b.code}`,
        };
      }
    }
    if (brRankResults[1].status === 'fulfilled') {
      rankingDataRow = brRankResults[1].value;
    } else {
      console.log(
        '⚠️ [TopCustomers] Erro ranking:',
        brRankResults[1].reason?.message,
      );
    }

    const totalClientes = Object.values(branchMap).reduce(
      (s, m) => s + Object.keys(m).length,
      0,
    );
    console.log(
      `🏆 [TopCustomers] ${totalFetched} movimentos → ${totalClientes} clientes únicos (${Date.now() - startTime}ms)`,
    );

    // ======== Agrupar por empresa e PRÉ-LIMITAR antes de buscar nomes ========
    const limit = returnItensQuantity || 50;
    const PRE_LIMIT = limit * 3; // margem para filtrar CROSBY/TESTE depois
    const groupMap = {};

    for (const [bc, customers] of Object.entries(branchMap)) {
      const branchCode = Number(bc);
      const info = branchInfo[branchCode] || {
        name: `Filial ${branchCode}`,
        groupName: `Filial ${branchCode}`,
      };
      const groupKey = info.groupName;

      if (!groupMap[groupKey]) {
        groupMap[groupKey] = {
          groupName: groupKey,
          branchCodes: [],
          customerMap: {},
        };
      }
      groupMap[groupKey].branchCodes.push(branchCode);

      for (const [pc, data] of Object.entries(customers)) {
        if (!groupMap[groupKey].customerMap[pc]) {
          groupMap[groupKey].customerMap[pc] = {
            ...data,
            purchaseDates: new Set(data.purchaseDates),
          };
        } else {
          groupMap[groupKey].customerMap[pc].quantity += data.quantity;
          groupMap[groupKey].customerMap[pc].grossValue += data.grossValue;
          groupMap[groupKey].customerMap[pc].discountValue +=
            data.discountValue;
          groupMap[groupKey].customerMap[pc].netValue += data.netValue;
          for (const d of data.purchaseDates) {
            groupMap[groupKey].customerMap[pc].purchaseDates.add(d);
          }
        }
      }
    }

    // Pré-ordenar cada grupo e pegar só os top PRE_LIMIT para buscar nomes
    const needNameCodes = new Set();
    for (const group of Object.values(groupMap)) {
      const arr = Object.values(group.customerMap);
      if (orderByQuantity) {
        arr.sort((a, b) => b.quantity - a.quantity);
      } else {
        arr.sort((a, b) => b.netValue - a.netValue);
      }
      const top = arr.slice(0, PRE_LIMIT);
      for (const c of top) needNameCodes.add(c.personCode);
    }

    console.log(
      `🏆 [TopCustomers] Pré-limitado: buscando nomes de ${needNameCodes.size} clientes (de ${totalClientes} total)`,
    );

    // ======== FASE 2: buscar nomes — SÓ DOS TOP CLIENTES, EM PARALELO ========
    const personNames = {};
    const codesToLookup = [...needNameCodes];
    if (codesToLookup.length > 0) {
      const BATCH = 50;

      const doPersonReq = async (url, payload, token) =>
        axios.post(url, payload, {
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Bearer ${token}`,
          },
          httpsAgent,
          httpAgent,
          timeout: 30000,
        });

      const nameBatches = [];
      for (let i = 0; i < codesToLookup.length; i += BATCH) {
        nameBatches.push(codesToLookup.slice(i, i + BATCH));
      }

      const nameResults = await Promise.allSettled(
        nameBatches.map(async (batch) => {
          const payload = {
            filter: { personCodeList: batch },
            page: 1,
            pageSize: batch.length,
          };
          const [pjRes, pfRes] = await Promise.allSettled([
            doPersonReq(
              `${TOTVS_BASE_URL}/person/v2/legal-entities/search`,
              payload,
              accessToken,
            )
              .then((r) => r.data?.items || [])
              .catch(() => []),
            doPersonReq(
              `${TOTVS_BASE_URL}/person/v2/individuals/search`,
              payload,
              accessToken,
            )
              .then((r) => r.data?.items || [])
              .catch(() => []),
          ]);
          return {
            pj: pjRes.status === 'fulfilled' ? pjRes.value : [],
            pf: pfRes.status === 'fulfilled' ? pfRes.value : [],
          };
        }),
      );

      for (const result of nameResults) {
        if (result.status !== 'fulfilled') continue;
        for (const p of result.value.pj) {
          if (p.code) personNames[p.code] = p.fantasyName || p.name || '';
        }
        for (const p of result.value.pf) {
          if (p.code) personNames[p.code] = p.name || '';
        }
      }

      console.log(
        `🏆 [TopCustomers] Nomes obtidos: ${Object.keys(personNames).length}/${codesToLookup.length} (${Date.now() - startTime}ms)`,
      );
    }

    // Mapear ranking de faturamento por branchCode
    const rankingByBranch = {};
    for (const row of rankingDataRow) {
      const code = row.branch_code ?? 0;
      rankingByBranch[code] = row;
    }

    // Montar resultado final por grupo
    const branches = Object.values(groupMap).map((group) => {
      let clientList = Object.values(group.customerMap);
      // Enriquecer com nomes e calcular métricas de compra
      for (const c of clientList) {
        c.name = personNames[c.personCode] || `Cliente ${c.personCode}`;
        const dates = [...(c.purchaseDates || [])].sort();
        c.purchaseCount = dates.length;
        if (dates.length >= 2) {
          const first = new Date(dates[0]).getTime();
          const last = new Date(dates[dates.length - 1]).getTime();
          const diffMs = last - first;
          const diffMonths = diffMs / (1000 * 60 * 60 * 24 * 30.44);
          c.avgPurchaseIntervalMonths = parseFloat(
            (diffMonths / (dates.length - 1)).toFixed(1),
          );
        } else {
          c.avgPurchaseIntervalMonths = 0;
        }
        delete c.purchaseDates;
      }
      // Remover lojas próprias CROSBY e registros de TESTE
      clientList = clientList.filter((c) => {
        const upper = c.name.toUpperCase();
        return !upper.startsWith('CROSBY') && !upper.startsWith('TESTE');
      });
      // Ordenar e limitar
      if (orderByQuantity) {
        clientList.sort((a, b) => b.quantity - a.quantity);
      } else {
        clientList.sort((a, b) => b.netValue - a.netValue);
      }
      clientList = clientList.slice(0, limit);

      const totalNetValue = clientList.reduce((s, c) => s + c.netValue, 0);
      const totalGrossValue = clientList.reduce((s, c) => s + c.grossValue, 0);
      const totalQuantity = clientList.reduce((s, c) => s + c.quantity, 0);

      // Agregar ranking faturamento para o grupo (somar filiais do mesmo grupo)
      let rankingInvoiceQty = 0;
      let rankingInvoiceValue = 0;
      let rankingItensQty = 0;
      for (const bc of group.branchCodes) {
        const r = rankingByBranch[bc];
        if (r) {
          rankingInvoiceQty += Number(r.invoice_qty || 0);
          rankingInvoiceValue += Number(r.invoice_value || 0);
          rankingItensQty += Number(r.itens_qty || 0);
        }
      }
      const rankingTM =
        rankingInvoiceQty > 0 ? rankingInvoiceValue / rankingInvoiceQty : 0;
      const rankingPA =
        rankingInvoiceQty > 0 ? rankingItensQty / rankingInvoiceQty : 0;
      const rankingPMPV =
        rankingItensQty > 0 ? rankingInvoiceValue / rankingItensQty : 0;

      return {
        branchCode: group.branchCodes[0],
        branchCodes: group.branchCodes.sort((a, b) => a - b),
        branchName: group.groupName,
        totalClients: clientList.length,
        totalNetValue,
        totalGrossValue,
        totalQuantity,
        ranking: {
          invoiceQty: rankingInvoiceQty,
          invoiceValue: rankingInvoiceValue,
          itensQty: rankingItensQty,
          tm: rankingTM,
          pa: rankingPA,
          pmpv: rankingPMPV,
        },
        clients: clientList,
      };
    });

    // Ordenar branches por faturamento líquido
    branches.sort((a, b) => b.totalNetValue - a.totalNetValue);

    const totalTime = Date.now() - startTime;
    console.log(
      `🏆 [TopCustomers] Concluído: ${branches.length} filiais em ${totalTime}ms`,
    );

    return successResponse(
      res,
      { branches },
      `Top clientes de ${branches.length} filiais obtidos em ${totalTime}ms`,
    );
  }),
);

// =============================================================================
// TRANSAÇÕES DE UM CLIENTE — detalhe por fiscal-movement
// POST /api/totvs/seller-panel/top-customers/transactions
// Body: { personCode, branchCodes, datemin, datemax }
// =============================================================================
router.post(
  '/seller-panel/top-customers/transactions',
  asyncHandler(async (req, res) => {
    req.setTimeout(300000);
    res.setTimeout(300000);
    const { personCode, branchCodes, datemin, datemax } = req.body;

    if (!personCode || !datemin || !datemax) {
      return errorResponse(
        res,
        'personCode, datemin e datemax são obrigatórios',
        400,
        'MISSING_PARAMS',
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

    let accessToken = tokenData.access_token;
    const endpoint = `${TOTVS_BASE_URL}/analytics/v2/fiscal-movement/search`;
    const PAGE_SIZE = 500;

    const SPECIAL_BRANCH_CODES = new Set([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 31, 41, 45, 50, 55,
      65, 75, 85, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101,
      105, 106, 107, 108, 109, 111, 200, 300, 311, 351, 400, 411, 450, 500, 550,
      551, 600, 650, 700, 750, 800, 850, 870, 880, 890, 891, 900, 910, 920, 930,
      940, 950, 960, 970, 980, 990,
    ]);
    const SPECIAL_OPERATIONS = new Set([
      1, 2, 55, 510, 511, 1511, 521, 1521, 522, 960, 9001, 9009, 9027, 9017,
      9400, 9401, 9402, 9403, 9404, 9005, 545, 546, 555, 548, 1210, 9405, 1205,
      1101, 9065, 9064, 9063, 9062, 9061, 9420, 9026, 9067,
    ]);

    const specialBranchSet = new Set(
      (branchCodes || []).filter((b) => SPECIAL_BRANCH_CODES.has(b)),
    );

    const doRequest = async (token, payload) =>
      axios.post(endpoint, payload, {
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
        httpsAgent,
        httpAgent,
        timeout: 60000,
      });

    const targetPersonCode = Number(personCode);

    const transactions = [];
    const txSeenSet = new Set();
    let pg = 1;
    let hasNext = true;

    while (hasNext) {
      const payload = {
        filter: {
          branchCodeList: branchCodes || [],
          personCodeList: [targetPersonCode],
          startMovementDate: datemin,
          endMovementDate: datemax,
        },
        page: pg,
        pageSize: PAGE_SIZE,
      };

      let response;
      try {
        response = await doRequest(accessToken, payload);
      } catch (error) {
        if (error.response?.status === 401) {
          const newToken = await getToken(true);
          accessToken = newToken.access_token;
          response = await doRequest(accessToken, payload);
        } else {
          throw error;
        }
      }

      const items = response.data?.items || [];
      // Log temporário — inspecionar campos disponíveis
      if (pg === 1 && items.length > 0) {
        console.log(
          '🔍 [Transactions] Sample item keys:',
          Object.keys(items[0]),
        );
        console.log(
          '🔍 [Transactions] Sample item:',
          JSON.stringify(items[0], null, 2),
        );
      }
      for (const item of items) {
        // Filtrar por personCode no código (API ignora personCodeList)
        if (item.personCode !== targetPersonCode) continue;
        if (
          !item.operationModel ||
          item.operationModel === 'Purchases' ||
          item.operationModel === 'SaleReturns'
        )
          continue;
        const bc = item.branchCode;
        if (
          specialBranchSet.has(bc) &&
          !SPECIAL_OPERATIONS.has(item.operationCode)
        )
          continue;

        // Dedup: operações complementares (545/555) geram registros duplicados
        const dedupKey = `${bc}|${targetPersonCode}|${item.movementDate}|${item.productCode || ''}|${item.quantity || 0}|${item.grossValue || 0}|${item.netValue || 0}`;
        if (txSeenSet.has(dedupKey)) continue;
        txSeenSet.add(dedupKey);

        transactions.push({
          movementDate: item.movementDate,
          invoiceNumber: item.invoiceNumber || item.documentNumber || '',
          invoiceSeries: item.invoiceSeries || item.documentSeries || '',
          operationCode: item.operationCode,
          operationName: item.operationName || '',
          operationModel: item.operationModel || '',
          branchCode: bc,
          quantity: item.quantity || 0,
          grossValue: item.grossValue || 0,
          discountValue: item.discountValue || 0,
          netValue: item.netValue || 0,
          productCode: item.productCode || '',
          productName: item.productName || '',
        });
      }

      hasNext = response.data?.hasNext ?? false;
      pg++;
      if (pg > 50) break;
    }

    // Ordenar por data desc
    transactions.sort(
      (a, b) => new Date(b.movementDate) - new Date(a.movementDate),
    );

    return successResponse(
      res,
      { transactions, total: transactions.length },
      `${transactions.length} transações encontradas`,
    );
  }),
);

export default router;
