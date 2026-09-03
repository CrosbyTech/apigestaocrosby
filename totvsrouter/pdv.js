// =============================================================================
// PDV RFID — rotas de apoio à tela de PDV do HeadCoach
// Consulta produto por qualquer código (interno, EAN ou EPC RFID), preços,
// condições de pagamento, operações e inclusão da transação no TOTVS.
//
// A consulta por código usa GET /product/v2/products/{code}/{branch}, que
// resolve inclusive o EPC gravado na tag RFID (cadastrado como código de
// barras tipo RFID no ERP — componente PRDFP123).
// =============================================================================
import express from 'express';
import axios from 'axios';
import {
  asyncHandler,
  successResponse,
  errorResponse,
} from '../utils/errorHandler.js';
import { getToken } from '../utils/totvsTokenManager.js';
import { httpsAgent, httpAgent, TOTVS_BASE_URL } from './totvsHelper.js';

const router = express.Router();

// Chamada TOTVS com retry automático em 401 (token expirado)
async function callTotvs(method, url, { data, params, timeout } = {}) {
  const doCall = async (token) =>
    axios({
      method,
      url,
      data,
      params,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
      httpsAgent,
      httpAgent,
      timeout: timeout ?? 30000,
    });

  const tokenData = await getToken();
  if (!tokenData?.access_token) {
    const err = new Error('Não foi possível obter token TOTVS');
    err.code = 'TOKEN_UNAVAILABLE';
    throw err;
  }
  try {
    return await doCall(tokenData.access_token);
  } catch (err) {
    if (err.response?.status === 401) {
      const refreshed = await getToken(true);
      return doCall(refreshed.access_token);
    }
    throw err;
  }
}

// Cache dos cabeçalhos de tabela de preço (tipo + percentual de variação)
const tableHeaderCache = new Map(); // code → { header, at }
const TABLE_HEADER_TTL = 30 * 60 * 1000;

async function getTableHeader(tableCode) {
  const cached = tableHeaderCache.get(tableCode);
  if (cached && Date.now() - cached.at < TABLE_HEADER_TTL) return cached.header;
  const resp = await callTotvs(
    'get',
    `${TOTVS_BASE_URL}/product/v2/price-tables-headers`,
    { params: { PriceTableCodeList: tableCode, Page: 1, PageSize: 5 } },
  );
  const header = (resp.data?.items || []).find((h) => h.code === tableCode) || null;
  tableHeaderCache.set(tableCode, { header, at: Date.now() });
  return header;
}

// Preço-base para tabelas "capa de pedido": 4=ATACADO; se zerado, 1=VAREJO
const BASE_PRICE_CODE = parseInt(process.env.PDV_BASE_PRICE_CODE || '4', 10);

async function fetchPrice(productCode, branch, priceCode) {
  try {
    const resp = await callTotvs(
      'post',
      `${TOTVS_BASE_URL}/product/v2/prices/search`,
      {
        data: {
          filter: { productCodeList: [productCode] },
          option: {
            prices: [
              { branchCode: branch, priceCodeList: [priceCode], isPromotionalPrice: true },
            ],
          },
          page: 1,
          pageSize: 5,
        },
      },
    );
    const p = resp.data?.items?.[0]?.prices?.[0];
    if (!p) return 0;
    return p.promotionalPrice > 0 ? p.promotionalPrice : p.price || 0;
  } catch {
    return 0;
  }
}

// Resolve o preço do produto na tabela do cliente (por item OU capa de pedido)
async function resolveTablePrice(productCode, branch, tableCode) {
  // 1) Tabela por item — preço direto
  try {
    const ptResp = await callTotvs(
      'post',
      `${TOTVS_BASE_URL}/product/v2/price-tables/search`,
      {
        data: {
          filter: { productCodeList: [productCode] },
          option: { branchCodeList: [branch], priceTableCode: tableCode },
          page: 1,
          pageSize: 5,
        },
      },
    );
    const pt = ptResp.data?.items?.[0]?.prices?.[0];
    if (pt && (pt.price > 0 || pt.originalPrice > 0)) {
      return {
        priceTableCode: tableCode,
        price: pt.price > 0 ? pt.price : pt.originalPrice,
        method: 'item',
      };
    }
  } catch {
    // tabela tipo OrderHeader cai aqui ("Field Type ... invalid value OrderHeader")
  }

  // 2) Tabela capa de pedido — variação % sobre o preço-base (atacado)
  try {
    const header = await getTableHeader(tableCode);
    if (header && header.variationPercentage != null) {
      let base = await fetchPrice(productCode, branch, BASE_PRICE_CODE);
      let baseCode = BASE_PRICE_CODE;
      if (!(base > 0)) {
        base = await fetchPrice(productCode, branch, 1);
        baseCode = 1;
      }
      if (base > 0) {
        const price = Math.round(base * (1 + header.variationPercentage / 100) * 100) / 100;
        return {
          priceTableCode: tableCode,
          price,
          method: 'variacao',
          basePriceCode: baseCode,
          basePrice: base,
          variationPercentage: header.variationPercentage,
        };
      }
    }
  } catch (err) {
    console.log(
      `⚠️ [PDV] Tabela ${tableCode} (capa) indisponível p/ produto ${productCode}: ${err.message}`,
    );
  }
  return null;
}

// =============================================================================
// GET /pdv/product/:code?branch=2&priceCodes=1,2
// Consulta produto por código interno, EAN ou EPC RFID + preço na filial.
// =============================================================================
router.get(
  '/pdv/product/:code',
  asyncHandler(async (req, res) => {
    const { code } = req.params;
    const branch = parseInt(req.query.branch, 10);
    if (!branch) {
      return errorResponse(res, 'Informe ?branch=', 400, 'MISSING_BRANCH');
    }
    const priceCodes = String(req.query.priceCodes || '1,2')
      .split(',')
      .map((n) => parseInt(n, 10))
      .filter((n) => !Number.isNaN(n));

    let productResp;
    try {
      productResp = await callTotvs(
        'get',
        `${TOTVS_BASE_URL}/product/v2/products/${encodeURIComponent(code)}/${branch}`,
      );
    } catch (err) {
      if (err.response?.status === 400 || err.response?.status === 404) {
        return errorResponse(
          res,
          `Código "${code}" não encontrado no TOTVS`,
          404,
          'PRODUCT_NOT_FOUND',
        );
      }
      throw err;
    }

    const item = productResp.data?.items?.[0];
    if (!item) {
      return errorResponse(
        res,
        `Código "${code}" não encontrado no TOTVS`,
        404,
        'PRODUCT_NOT_FOUND',
      );
    }

    // Preço pela TABELA DO CLIENTE (?priceTable=N) — usado pelo Orçamento.
    // Dois tipos de tabela no TOTVS:
    //  - por ITEM: price-tables/search devolve o preço direto;
    //  - "capa de pedido" (OrderHeader, ex.: TABELA REVENDEDOR GERAL 80%):
    //    o preço é o ATACADO (código 4) × (1 + variationPercentage/100).
    //    Validado com produto 67379: atacado 94,50 × 1,1111 = 105,00.
    const priceTable = parseInt(req.query.priceTable, 10);
    let tablePrice = null;
    if (priceTable) {
      tablePrice = await resolveTablePrice(item.productCode, branch, priceTable);
    }

    // Preço padrão do produto na filial (não bloqueia a resposta se falhar —
    // a tela permite digitar o valor manualmente)
    let prices = [];
    try {
      const priceResp = await callTotvs(
        'post',
        `${TOTVS_BASE_URL}/product/v2/prices/search`,
        {
          data: {
            filter: { productCodeList: [item.productCode] },
            option: {
              prices: [
                {
                  branchCode: branch,
                  priceCodeList: priceCodes,
                  isPromotionalPrice: true,
                },
              ],
            },
            page: 1,
            pageSize: 10,
          },
        },
      );
      prices = priceResp.data?.items?.[0]?.prices || [];
    } catch (err) {
      console.log(
        `⚠️ [PDV] Preço indisponível p/ produto ${item.productCode}: ${err.message}`,
      );
    }

    return successResponse(
      res,
      { product: item, prices, tablePrice },
      'Produto encontrado',
    );
  }),
);

// =============================================================================
// GET /pdv/customer/:code — dados do cliente p/ orçamento: tabela de preço
// (preferências do cadastro), telefone e documento. Tenta PJ e PF.
// =============================================================================
router.get(
  '/pdv/customer/:code',
  asyncHandler(async (req, res) => {
    const code = parseInt(req.params.code, 10);
    if (!code) {
      return errorResponse(res, 'Código inválido', 400, 'INVALID_CODE');
    }
    const payload = {
      filter: { personCodeList: [code] },
      expand: 'phones,preferences',
      page: 1,
      pageSize: 1,
    };
    const [pj, pf] = await Promise.allSettled([
      callTotvs('post', `${TOTVS_BASE_URL}/person/v2/legal-entities/search`, {
        data: payload,
      }),
      callTotvs('post', `${TOTVS_BASE_URL}/person/v2/individuals/search`, {
        data: payload,
      }),
    ]);
    const item =
      (pj.status === 'fulfilled' && pj.value.data?.items?.[0]) ||
      (pf.status === 'fulfilled' && pf.value.data?.items?.[0]) ||
      null;
    if (!item) {
      return errorResponse(
        res,
        `Cliente ${code} não encontrado`,
        404,
        'CUSTOMER_NOT_FOUND',
      );
    }
    const phone =
      (item.phones || [])
        .map((p) => p.number || p.phoneNumber || p.phone)
        .find(Boolean) || null;
    return successResponse(
      res,
      {
        code,
        name: item.name || item.fantasyName,
        cpfCnpj: item.cpf || item.cnpj || null,
        phone,
        priceTableCode: item.preferences?.priceTableCode ?? null,
        priceTableDescription:
          item.preferences?.priceTableDescription ?? null,
        paymentConditionCode:
          item.preferences?.paymentConditionCode ?? null,
      },
      'Dados do cliente',
    );
  }),
);

// =============================================================================
// GET /pdv/payment-conditions — condições de pagamento ativas
// =============================================================================
router.get(
  '/pdv/payment-conditions',
  asyncHandler(async (req, res) => {
    // Sem params: a rota TOTVS devolve todas (validação recusa PageSize alto)
    const resp = await callTotvs(
      'get',
      `${TOTVS_BASE_URL}/general/v2/payment-conditions`,
    );
    const items = (resp.data?.items || [])
      .filter((c) => !c.isBlocked)
      .map((c) => ({
        code: c.code,
        name: c.name,
        installment: c.installment,
      }));
    return successResponse(res, { items }, 'Condições de pagamento');
  }),
);

// =============================================================================
// GET /pdv/operations — operações ativas (para escolher a operação da venda)
// =============================================================================
// Cache em memória (30 min) — a lista muda raramente e são ~2 páginas de 500
let opsCache = null;
let opsCacheAt = 0;
const OPS_CACHE_TTL = 30 * 60 * 1000;

router.get(
  '/pdv/operations',
  asyncHandler(async (req, res) => {
    if (opsCache && Date.now() - opsCacheAt < OPS_CACHE_TTL) {
      return successResponse(res, { items: opsCache }, 'Operações (cache)');
    }
    // A rota TOTVS exige OperationCodeList OU intervalo de datas de alteração —
    // usamos um intervalo amplo para listar todas.
    let all = [];
    let page = 1;
    let hasNext = true;
    while (hasNext && page <= 20) {
      const resp = await callTotvs(
        'get',
        `${TOTVS_BASE_URL}/general/v2/operations`,
        {
          params: {
            Page: page,
            PageSize: 500,
            StartChangeDate: '1900-01-01T00:00:00',
            EndChangeDate: '2100-01-01T00:00:00',
          },
        },
      );
      all = all.concat(resp.data?.items || []);
      hasNext = resp.data?.hasNext || false;
      page++;
    }
    const items = all
      .filter((o) => !o.isInactive)
      .map((o) => ({
        operationCode: o.operationCode,
        description: o.description,
      }))
      .sort((a, b) => a.operationCode - b.operationCode);
    opsCache = items;
    opsCacheAt = Date.now();
    return successResponse(res, { items }, 'Operações');
  }),
);

// =============================================================================
// GET /pdv/sellers?branch=551 — vendedores da empresa (painel de vendas)
// =============================================================================
router.get(
  '/pdv/sellers',
  asyncHandler(async (req, res) => {
    const branch = parseInt(req.query.branch, 10);
    if (!branch) {
      return errorResponse(res, 'Informe ?branch=', 400, 'MISSING_BRANCH');
    }
    const resp = await callTotvs(
      'post',
      `${TOTVS_BASE_URL}/sale-panel/v2/sellers-list/search`,
      { data: { branchs: [branch] } },
    );
    const items = (resp.data?.dataRow || [])
      .map((s) => ({ code: s.seller_code, name: s.seller_name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return successResponse(res, { items }, 'Vendedores da empresa');
  }),
);

// =============================================================================
// POST /pdv/transactions — inclui a transação no TOTVS
// Body: payload no formato InsertCompleteTransactionCommand (montado no front)
// =============================================================================
router.post(
  '/pdv/transactions',
  asyncHandler(async (req, res) => {
    const payload = req.body;
    if (
      !payload?.branchCode ||
      !payload?.items?.length ||
      payload?.totalAmountTransaction == null
    ) {
      return errorResponse(
        res,
        'Payload incompleto: branchCode, items e totalAmountTransaction são obrigatórios',
        400,
        'INVALID_PAYLOAD',
      );
    }

    // TransactionStatusType é obrigatório e o insert SÓ aceita 1 (Em
    // andamento) — 0 e 2..6 retornam "Invalid Status value".
    if (payload.status == null) payload.status = 1;

    console.log(
      `🛒 [PDV] Incluindo transação: filial ${payload.branchCode}, ${payload.items.length} itens, total ${payload.totalAmountTransaction}`,
    );

    try {
      const resp = await callTotvs(
        'post',
        `${TOTVS_BASE_URL}/general/v2/transactions`,
        { data: payload },
      );
      console.log(
        `✅ [PDV] Transação incluída: ${JSON.stringify(resp.data)}`,
      );
      return successResponse(res, resp.data, 'Transação incluída com sucesso');
    } catch (err) {
      // TOTVS devolve DomainNotificationMessage no 400 — repassa o detalhe
      const detail = err.response?.data;
      console.error(
        `❌ [PDV] Erro ao incluir transação:`,
        JSON.stringify(detail || err.message).slice(0, 500),
      );
      return errorResponse(
        res,
        Array.isArray(detail)
          ? detail.map((d) => d.message || d.detailedMessage).join('; ')
          : detail?.message || detail?.detailedMessage || err.message,
        err.response?.status || 502,
        'TOTVS_TRANSACTION_ERROR',
        detail,
      );
    }
  }),
);

// =============================================================================
// GET /pdv/transaction-status?branch=95&code=879424&date=2026-08-25
// Consulta a transação com as parcelas — usado pelo botão "Encerrar venda"
// para confirmar que o plano de pagamento foi gravado antes de liberar o
// recebimento (recebimento sem plano trava no TOTVS e cancela a transação).
// =============================================================================
router.get(
  '/pdv/transaction-status',
  asyncHandler(async (req, res) => {
    const branch = parseInt(req.query.branch, 10);
    const code = parseInt(req.query.code, 10);
    const date = String(req.query.date || '');
    if (!branch || !code || !date) {
      return errorResponse(
        res,
        'Informe ?branch=&code=&date=',
        400,
        'MISSING_PARAMS',
      );
    }
    const resp = await callTotvs(
      'get',
      `${TOTVS_BASE_URL}/general/v2/transactions/search`,
      {
        params: {
          BranchCodeList: branch,
          TransactionCodeList: code,
          TransactionDate: date,
          Page: 1,
          PageSize: 1,
          Expand: 'installment',
        },
      },
    );
    const t = resp.data?.items?.[0];
    if (!t) {
      return errorResponse(
        res,
        `Transação ${code} não encontrada na empresa ${branch}`,
        404,
        'TRANSACTION_NOT_FOUND',
      );
    }
    return successResponse(
      res,
      {
        status: t.status,
        totalValue: t.totalValue,
        installment: t.installment || [],
        hasPaymentPlan: (t.installment || []).length > 0,
      },
      'Situação da transação',
    );
  }),
);

// =============================================================================
// POST /pdv/transaction-receiving — recebe o pagamento da transação
// Gera o contas a receber e dispara o faturamento (transação vira "atendida").
// Body: { branchCode, transactionCode, transactionDate, totalAmount,
//         documentType, terminalCode?, documentNumber?, dueDate?, receipts? }
// documentType (registro "Tipo de documento" do ERP): 1=Fatura, 2=Cheque,
// 3=Dinheiro, 4=Cartão crédito, 5=Cartão débito, 20=PIX (customizado Crosby).
// =============================================================================
router.post(
  '/pdv/transaction-receiving',
  asyncHandler(async (req, res) => {
    const {
      branchCode,
      transactionCode,
      transactionDate,
      totalAmount,
      terminalCode,
      documentType,
      documentNumber,
      dueDate,
      receipts,
    } = req.body || {};

    if (
      !branchCode ||
      !transactionCode ||
      !transactionDate ||
      totalAmount == null ||
      (!documentType && !Array.isArray(receipts))
    ) {
      return errorResponse(
        res,
        'Campos obrigatórios: branchCode, transactionCode, transactionDate, totalAmount e documentType (ou receipts)',
        400,
        'INVALID_PAYLOAD',
      );
    }

    const payload = {
      branchCode,
      transactionCode,
      transactionDate,
      totalAmount,
      terminalCode: terminalCode ?? 1,
      receipts: Array.isArray(receipts)
        ? receipts
        : [
            {
              documentType,
              documentNumber: documentNumber ?? transactionCode,
              dueDate: dueDate ?? transactionDate,
              documentAmount: totalAmount,
            },
          ],
    };

    console.log(
      `💵 [PDV] Recebendo transação ${transactionCode} (filial ${branchCode}): ${JSON.stringify(payload.receipts)}`,
    );

    try {
      // O recebimento dispara o faturamento (NF) de forma síncrona no ERP —
      // costuma passar de 30s; timeout largo pra receber a resposta real.
      const resp = await callTotvs(
        'post',
        `${TOTVS_BASE_URL}/general/v2/transaction-receiving`,
        { data: payload, timeout: 180000 },
      );
      console.log(`✅ [PDV] Recebimento OK: ${JSON.stringify(resp.data)}`);
      return successResponse(res, resp.data ?? {}, 'Recebimento efetuado');
    } catch (err) {
      const detail = err.response?.data;
      // Log completo da borda TOTVS: às vezes o 503 vem do gateway com corpo
      // HTML/vazio — registrar status, content-type e corpo bruto ajuda a
      // distinguir gateway de regra de negócio
      console.error(`❌ [PDV] Erro no recebimento:`, {
        httpStatus: err.response?.status ?? null,
        contentType: err.response?.headers?.['content-type'] ?? null,
        axiosMessage: err.message,
        bodyRaw:
          typeof detail === 'string'
            ? detail.slice(0, 400)
            : JSON.stringify(detail ?? null)?.slice(0, 400),
      });
      return errorResponse(
        res,
        Array.isArray(detail)
          ? detail.map((d) => d.message || d.detailedMessage).join('; ')
          : detail?.message || detail?.detailedMessage || err.message,
        err.response?.status || 502,
        'TOTVS_RECEIVING_ERROR',
        detail,
      );
    }
  }),
);

// =============================================================================
// GET /pdv/transaction?branch=2&code=12345&date=2026-08-19
// Lê uma transação no TOTVS (GET general/v2/transactions — exige os três
// parâmetros) e devolve os itens já normalizados com o PREÇO LÍQUIDO unitário,
// pronto pra tela de etiquetas.
//
// O nome/referência do produto NÃO vem na transação: cada productCode é
// enriquecido em paralelo por GET /product/v2/products/{code}/{branch}
// (mesma rota usada na bipagem do PDV RFID).
// =============================================================================

// Pega o primeiro campo não-nulo entre vários nomes possíveis — a resposta do
// general/v2/transactions varia de nome conforme a versão do TOTVS Moda.
const pick = (obj, ...keys) => {
  for (const k of keys) {
    const v = k.split('.').reduce((o, part) => (o == null ? o : o[part]), obj);
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return null;
};

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

router.get(
  '/pdv/transaction',
  asyncHandler(async (req, res) => {
    const branch = parseInt(req.query.branch, 10);
    const code = String(req.query.code || '').trim();
    const date = String(req.query.date || '').trim().slice(0, 10);

    if (!branch || !code || !date) {
      return errorResponse(
        res,
        'Informe ?branch=, ?code= e ?date= (o TOTVS exige os três)',
        400,
        'MISSING_PARAMS',
      );
    }

    let resp;
    try {
      resp = await callTotvs(
        'get',
        `${TOTVS_BASE_URL}/general/v2/transactions`,
        {
          params: {
            BranchCode: branch,
            TransactionCode: code,
            TransactionDate: date,
            Expand: 'items',
          },
        },
      );
    } catch (err) {
      const detail = err.response?.data;
      if (err.response?.status === 400 || err.response?.status === 404) {
        return errorResponse(
          res,
          `Transação ${code} (filial ${branch}, ${date}) não encontrada no TOTVS`,
          404,
          'TRANSACTION_NOT_FOUND',
          detail,
        );
      }
      throw err;
    }

    const data = resp.data || {};
    // A resposta varia: ora `items` é a lista de transações (com os produtos
    // aninhados em `items`), ora já é a própria lista de produtos.
    const topList = Array.isArray(data.items) ? data.items : null;
    const itemsAreProducts =
      topList != null &&
      topList.length > 0 &&
      topList[0]?.productCode != null &&
      !Array.isArray(topList[0]?.items);

    const transaction = itemsAreProducts
      ? data
      : topList
        ? topList[0] || {}
        : data.transaction || data;

    const rawItems = itemsAreProducts
      ? topList
      : transaction.items ||
        transaction.transactionItems ||
        data.transactionItems ||
        [];

    if (!Array.isArray(rawItems) || rawItems.length === 0) {
      return errorResponse(
        res,
        `Transação ${code} encontrada, mas sem itens na resposta do TOTVS`,
        404,
        'TRANSACTION_WITHOUT_ITEMS',
        data,
      );
    }

    // Normaliza os itens (quantidade + valores unitários)
    const items = rawItems.map((it, idx) => {
      const quantity = num(pick(it, 'quantity', 'itemQuantity', 'qtd')) || 1;
      const gross = num(
        pick(it, 'value', 'grossValue', 'unitValue', 'productValue', 'price'),
      );
      const discountRaw = num(
        pick(it, 'unitDiscountValue', 'discountValue', 'discount'),
      );
      // Alguns retornos trazem o desconto TOTAL do item, outros o unitário.
      // Se o desconto for maior que o bruto unitário, tratamos como total.
      const discountUnit =
        discountRaw > gross && quantity > 1 ? discountRaw / quantity : discountRaw;
      // `value` e `unitDiscountValue` são UNITÁRIOS; `netValue` é o total da
      // linha. O preço da etiqueta é sempre o líquido unitário.
      const netFromTotvs = num(pick(it, 'netValue', 'liquidValue', 'totalValue'));
      let netUnit = gross - discountUnit;
      if (netUnit <= 0 && netFromTotvs > 0) {
        netUnit = quantity > 0 ? netFromTotvs / quantity : netFromTotvs;
      }
      return {
        seq: pick(it, 'sequence', 'itemSequence') ?? idx + 1,
        productCode: pick(it, 'productCode', 'product.productCode', 'code'),
        quantity,
        grossUnit: Math.round(gross * 100) / 100,
        discountUnit: Math.round(discountUnit * 100) / 100,
        netUnit: Math.round(netUnit * 100) / 100,
      };
    });

    // Enriquecimento: nome/referência/cor/tamanho de cada produto (paralelo,
    // em lotes de 8 pra não estourar o TOTVS)
    const uniqueCodes = [...new Set(items.map((i) => i.productCode).filter(Boolean))];
    const infoByCode = new Map();
    for (let i = 0; i < uniqueCodes.length; i += 8) {
      const chunk = uniqueCodes.slice(i, i + 8);
      await Promise.all(
        chunk.map(async (pc) => {
          try {
            const r = await callTotvs(
              'get',
              `${TOTVS_BASE_URL}/product/v2/products/${encodeURIComponent(pc)}/${branch}`,
            );
            const p = r.data?.items?.[0];
            if (p) infoByCode.set(pc, p);
          } catch (err) {
            console.log(
              `⚠️ [Etiquetas] Produto ${pc} sem cadastro acessível: ${err.message}`,
            );
          }
        }),
      );
    }

    const enriched = items.map((it) => {
      const p = infoByCode.get(it.productCode) || {};
      return {
        ...it,
        reference: pick(p, 'referenceCode', 'reference', 'productReference'),
        // referenceName é o nome curto da referência ("CAMISA CLOUDY STORM"),
        // bem melhor na etiqueta que o productName (que inclui cor e tamanho).
        description:
          pick(p, 'referenceName', 'productName', 'name', 'description') ||
          `Produto ${it.productCode}`,
        fullName: pick(p, 'productName'),
        color: pick(p, 'colorName', 'color.colorName', 'colorDescription'),
        size: pick(p, 'sizeName', 'size.sizeName', 'sizeDescription'),
        ean: pick(p, 'barCode', 'ean', 'barcode'),
      };
    });

    return successResponse(
      res,
      {
        transaction: {
          branchCode: branch,
          transactionCode: code,
          transactionDate: pick(transaction, 'transactionDate', 'date') || date,
          customerName: pick(transaction, 'customerName', 'personName', 'customer.name'),
          totalAmount: num(
            pick(transaction, 'totalAmountTransaction', 'totalAmount', 'total'),
          ),
        },
        items: enriched,
      },
      `Transação ${code} com ${enriched.length} item(ns)`,
    );
  }),
);

// =============================================================================
// PRÉ-VENDA (Orçamento RFID → Fechar Pré-Venda)
// Fluxo: escolhe forma de pagamento → PIX/cartão geram link Pagar.me;
// boleto confere o limite do cliente no TOTVS; dinheiro segue direto.
// Em todos os casos gera a transação "em andamento" no TOTVS para o
// faturista emitir a nota.
// =============================================================================
const PAGARME_SK = process.env.PAGARME_SECRET_KEY || '';
const pagarmeAuth = () =>
  'Basic ' + Buffer.from(`${PAGARME_SK}:`).toString('base64');

async function criarLinkPagamento({
  nome,
  valorCentavos,
  metodo,
  cardType = 'credito',
  installments = 1,
  lockInstallments = false,
}) {
  const paymentSettings = {};
  if (metodo === 'pix') {
    paymentSettings.accepted_payment_methods = ['pix'];
    paymentSettings.pix_settings = { expires_in: 60 * 60 * 48 };
  } else if (cardType === 'debito') {
    paymentSettings.accepted_payment_methods = ['debit_card'];
    paymentSettings.debit_card_settings = {};
  } else {
    // Crédito: lockInstallments=true trava EXATAMENTE em N parcelas;
    // false oferece de 1x até Nx (sempre sem juros — total = valor cheio)
    const n = Math.min(Math.max(parseInt(installments, 10) || 1, 1), 12);
    const lista = lockInstallments
      ? [{ number: n, total: valorCentavos }]
      : Array.from({ length: n }, (_, i) => ({
          number: i + 1,
          total: valorCentavos,
        }));
    paymentSettings.accepted_payment_methods = ['credit_card'];
    paymentSettings.credit_card_settings = {
      operation_type: 'auth_and_capture',
      installments: lista,
    };
  }
  const body = {
    is_building: false,
    type: 'order',
    name: nome.slice(0, 64),
    payment_settings: paymentSettings,
    cart_settings: {
      items: [
        { amount: valorCentavos, name: nome.slice(0, 64), default_quantity: 1 },
      ],
    },
  };
  const r = await fetch('https://api.pagar.me/core/v5/paymentlinks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: pagarmeAuth() },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!r.ok) {
    throw new Error(
      `Pagar.me recusou o link: ${j?.message || JSON.stringify(j).slice(0, 200)}`,
    );
  }
  return { id: j.id, url: j.url };
}

// POST /pdv/prevenda/fechar
// Body: { branchCode, customerCode, customerName, sellerCode, total,
//         paymentMethod: 'pix'|'cartao'|'dinheiro'|'boleto',
//         operationCode, paymentConditionCode, cfop,
//         items: [{ productCode, quantity, value, discountValue? }],
//         orcamentoId? }
router.post(
  '/pdv/prevenda/fechar',
  asyncHandler(async (req, res) => {
    const {
      branchCode,
      customerCode,
      customerName,
      sellerCode,
      total,
      paymentMethod,
      operationCode,
      paymentConditionCode,
      cfop,
      items,
      orcamentoId,
    } = req.body || {};

    if (
      !branchCode ||
      !customerCode ||
      !sellerCode ||
      !total ||
      !paymentMethod ||
      !operationCode ||
      !paymentConditionCode ||
      !Array.isArray(items) ||
      items.length === 0
    ) {
      return errorResponse(res, 'Payload incompleto', 400, 'INVALID_PAYLOAD');
    }

    // ── BOLETO: confere o limite do cliente no TOTVS ─────────────────────────
    // A rota EXIGE option.branchCodeList (sem ele, 500 "Object reference").
    // O limite pode estar cadastrado na empresa da venda ou na matriz (1) —
    // consulta a empresa da venda e cai para a matriz se não houver limite lá.
    let limite = null;
    if (paymentMethod === 'boleto') {
      const consultarLimite = async (branches) => {
        const balResp = await callTotvs(
          'post',
          `${TOTVS_BASE_URL}/accounts-receivable/v2/customer-financial-balance/search`,
          {
            data: {
              filter: { customerCodeList: [customerCode] },
              option: { branchCodeList: branches },
              page: 1,
              pageSize: 5,
            },
          },
        );
        const values = balResp.data?.items?.[0]?.values || [];
        const limitValue = values.reduce((s, v) => s + (v.limitValue || 0), 0);
        const emAberto = values.reduce(
          (s, v) => s + (v.openInvoiceValue || 0),
          0,
        );
        return { limitValue, emAberto, disponivel: limitValue - emAberto };
      };

      limite = await consultarLimite([parseInt(branchCode, 10)]);
      if (limite.limitValue <= 0 && parseInt(branchCode, 10) !== 1) {
        const matriz = await consultarLimite([1]);
        if (matriz.limitValue > 0) limite = { ...matriz, origem: 'matriz' };
      }

      if (limite.limitValue <= 0 || limite.disponivel < total) {
        return errorResponse(
          res,
          limite.limitValue <= 0
            ? 'Cliente sem limite para boleto'
            : `Limite insuficiente: disponível R$ ${limite.disponivel.toFixed(2)}, orçamento R$ ${Number(total).toFixed(2)}`,
          422,
          'SEM_LIMITE_BOLETO',
          limite,
        );
      }
    }

    // ── PIX / CARTÃO: cria o link de pagamento na Pagar.me ─────────────────
    let paymentLink = null;
    if (paymentMethod === 'pix' || paymentMethod === 'cartao') {
      if (!PAGARME_SK) {
        return errorResponse(
          res,
          'PAGARME_SECRET_KEY não configurada no backend',
          500,
          'PAGARME_NOT_CONFIGURED',
        );
      }
      paymentLink = await criarLinkPagamento({
        nome: `Pedido Crosby${orcamentoId ? ` #${String(orcamentoId).slice(-6)}` : ''} - ${customerName || customerCode}`,
        valorCentavos: Math.round(Number(total) * 100),
        metodo: paymentMethod,
        cardType: req.body.cardType,
        installments: req.body.installments,
        lockInstallments: req.body.lockInstallments,
      });
    }

    // ── Transação "em andamento" no TOTVS (p/ o faturista) ──────────────────
    const trxPayload = {
      branchCode: parseInt(branchCode, 10),
      customerCode: parseInt(customerCode, 10),
      sellerCode: parseInt(sellerCode, 10),
      operationCode: parseInt(operationCode, 10),
      paymentConditionCode: parseInt(paymentConditionCode, 10),
      isPreSale: false,
      status: 1,
      totalAmountTransaction: Number(Number(total).toFixed(2)),
      items: items.map((i) => ({
        productCode: i.productCode,
        quantity: i.quantity,
        value: Number(Number(i.value).toFixed(3)),
        ...(i.discountValue > 0
          ? { discountValue: Number(Number(i.discountValue).toFixed(3)) }
          : {}),
        cfop: parseInt(cfop || '5102', 10),
      })),
    };

    console.log(
      `🧾 [PréVenda] Fechando: filial ${branchCode}, cliente ${customerCode}, ${items.length} itens, ${paymentMethod}, total ${total}`,
    );

    try {
      const resp = await callTotvs(
        'post',
        `${TOTVS_BASE_URL}/general/v2/transactions`,
        { data: trxPayload },
      );
      console.log(`✅ [PréVenda] Transação: ${JSON.stringify(resp.data)}`);
      return successResponse(
        res,
        { transaction: resp.data, paymentLink, limite, paymentMethod },
        'Pré-venda fechada',
      );
    } catch (err) {
      const detail = err.response?.data;
      console.error(
        `❌ [PréVenda] TOTVS recusou a transação:`,
        JSON.stringify(detail || err.message).slice(0, 400),
      );
      return errorResponse(
        res,
        Array.isArray(detail)
          ? detail.map((d) => d.message || d.detailedMessage).join('; ')
          : detail?.message || err.message,
        err.response?.status || 502,
        'TOTVS_TRANSACTION_ERROR',
        { detail, paymentLink },
      );
    }
  }),
);

// GET /pdv/prevenda/pagamento/:linkId — status do pagamento do link
// Quando pago (cartão), devolve autorização e NSU para conciliação.
router.get(
  '/pdv/prevenda/pagamento/:linkId',
  asyncHandler(async (req, res) => {
    const { linkId } = req.params;
    if (!/^pl_[A-Za-z0-9]+$/.test(linkId)) {
      return errorResponse(res, 'linkId inválido', 400, 'INVALID_LINK');
    }
    const r = await fetch(
      `https://api.pagar.me/core/v5/orders?code=${encodeURIComponent(linkId)}`,
      { headers: { Authorization: pagarmeAuth() } },
    );
    const j = await r.json();
    if (!r.ok) {
      return errorResponse(
        res,
        j?.message || 'Falha ao consultar Pagar.me',
        502,
        'PAGARME_ERROR',
      );
    }
    const orders = j?.data || [];
    if (orders.length === 0) {
      return successResponse(
        res,
        { paid: false, status: 'aguardando' },
        'Ainda sem pagamento',
      );
    }
    // Pega o pedido mais recente do link
    const order = orders[0];
    const charge = (order.charges || [])[0] || null;
    const tx = charge?.last_transaction || null;
    return successResponse(
      res,
      {
        paid: order.status === 'paid',
        status: order.status,
        method: charge?.payment_method || null,
        amount: (order.amount || 0) / 100,
        authCode: tx?.acquirer_auth_code || null,
        nsu: tx?.acquirer_nsu || null,
        tid: tx?.acquirer_tid || null,
        cardBrand: tx?.card?.brand || null,
        cardLast4: tx?.card?.last_four_digits || null,
      },
      'Status do pagamento',
    );
  }),
);

export default router;
