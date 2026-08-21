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
async function callTotvs(method, url, { data, params } = {}) {
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
      timeout: 30000,
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

    // Preço do produto na filial (não bloqueia a resposta se falhar —
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

    return successResponse(res, { product: item, prices }, 'Produto encontrado');
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

    // TransactionStatusType é obrigatório no TOTVS (0 é inválido);
    // 1 = InProgress ("Em andamento")
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
      const resp = await callTotvs(
        'post',
        `${TOTVS_BASE_URL}/general/v2/transaction-receiving`,
        { data: payload },
      );
      console.log(`✅ [PDV] Recebimento OK: ${JSON.stringify(resp.data)}`);
      return successResponse(res, resp.data ?? {}, 'Recebimento efetuado');
    } catch (err) {
      const detail = err.response?.data;
      console.error(
        `❌ [PDV] Erro no recebimento:`,
        JSON.stringify(detail || err.message).slice(0, 500),
      );
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

export default router;
