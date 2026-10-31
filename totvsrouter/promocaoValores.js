// =============================================================================
// Preço Promocional em lote (PRDFM002) — importação de SKUs do Excel
//
// Página /promocoes/valores do HeadCoach: o usuário sobe uma planilha com os
// SKUs, escolhe a empresa, a promoção e o percentual de desconto; a página
// mostra o preço atual e o valor promocional calculado e, ao confirmar, grava
// no TOTVS via product/v2/promotion-values/update (item já na promoção) ou
// product/v2/promotion-items (item ainda fora da promoção).
//
// Rotas (montadas em /api/totvs):
//   GET  /promocao-valores/promocoes?branch=N&status=Open|Blocked|Closed|all
//        → promoções da empresa (uma linha por promoção, com qtde de itens)
//   POST /promocao-valores/preview  { branch, promotionCode, priceCode?, skus[], primeiroLote? }
//        → resolve cada SKU (código interno, EAN ou SKU do TOTVS) e devolve
//          nome, preço atual e se já está na promoção
//   POST /promocao-valores/aplicar  { branch, promotionCode, items[], incluirNovos?, primeiroLote? }
//        items: [{ productCode, promotionValue }]
//        → atualiza/insere em lotes e devolve o resultado por item
//
// Sem limite de SKUs: a página divide a planilha em lotes e chama estas rotas
// em loop (primeiroLote: false nos lotes seguintes reaproveita os itens lidos).
//
// Pegadinhas da API TOTVS:
//   - promotion-values/update só aceita produto que JÁ está na promoção; o
//     que não está precisa ir por promotion-items (inserção).
//   - GET /promotion devolve UMA LINHA POR ITEM da promoção (não por promoção).
//   - prices/search não filtra por SKU/EAN — só por productCode/referenceCode;
//     o EAN/SKU é resolvido por products/{code}/{branch} (mesmo caminho do PDV).
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

const PRODUCT_BASE = `${TOTVS_BASE_URL}/product/v2`;
const PAGE_SIZE = 100; // GET /promotion limita PageSize a 100 (apesar do swagger dizer 500)
const CHUNK_PRECOS = 100; // productCodeList por chamada de prices/search
const CHUNK_GRAVACAO = 50; // itens por POST de update/insert
const CONCORRENCIA = 4; // lookups simultâneos de SKU/EAN

// ─── HTTP ────────────────────────────────────────────────────────────────────

// Queda de conexão e 429/502/503/504 são passageiros: numa planilha de 50 mil
// SKUs seriam milhares de chamadas, e uma "socket hang up" não pode derrubar o
// lote inteiro. Repetir é seguro: update regrava o mesmo valor, e insert que já
// entrou cai no fallback para update em gravarLote.
const ESPERAS_RETENTATIVA_MS = [2000, 5000];

export function erroTransitorio(err) {
  const status = err?.response?.status;
  if (status) return [429, 502, 503, 504].includes(status);
  return Boolean(err?.request);
}

export async function comRetentativa(fn, esperas = ESPERAS_RETENTATIVA_MS) {
  for (let tentativa = 0; ; tentativa++) {
    try {
      return await fn();
    } catch (err) {
      if (tentativa >= esperas.length || !erroTransitorio(err)) throw err;
      console.warn(
        `⚠️ [promocao-valores] TOTVS instável (${err.message}), nova tentativa em ${esperas[tentativa]} ms`,
      );
      await new Promise((r) => setTimeout(r, esperas[tentativa]));
    }
  }
}

async function callTotvs(method, url, opts) {
  return comRetentativa(() => chamarTotvs(method, url, opts));
}

async function chamarTotvs(method, url, { data, params, timeout = 60000 } = {}) {
  const doCall = async (token) =>
    axios({
      method,
      url,
      data,
      params,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      httpsAgent,
      httpAgent,
      timeout,
    });
  let tokenData = await getToken();
  if (!tokenData?.access_token) {
    throw Object.assign(new Error('Token TOTVS indisponível'), {
      code: 'TOKEN_UNAVAILABLE',
    });
  }
  try {
    return await doCall(tokenData.access_token);
  } catch (err) {
    if (err.response?.status === 401) {
      tokenData = await getToken(true);
      return doCall(tokenData.access_token);
    }
    throw err;
  }
}

function mensagemTotvs(err) {
  const d = err?.response?.data;
  if (!d) return err?.message || 'erro desconhecido';
  if (typeof d === 'string') return d;
  return (
    d.detailedMessage ||
    d.message ||
    d.errors?.[0]?.message ||
    d.title ||
    JSON.stringify(d)
  );
}

function handleTotvsError(res, err, contexto) {
  console.error(`❌ [promocao-valores] ${contexto}:`, {
    message: err.message,
    status: err.response?.status,
    data: err.response?.data,
  });
  if (err.code === 'TOKEN_UNAVAILABLE') {
    return errorResponse(res, err.message, 503, 'TOKEN_UNAVAILABLE');
  }
  if (err.response) {
    return errorResponse(
      res,
      mensagemTotvs(err),
      err.response.status || 500,
      'TOTVS_API_ERROR',
    );
  }
  if (err.request) {
    return errorResponse(
      res,
      'Não foi possível conectar à API TOTVS',
      503,
      'TOTVS_CONNECTION_ERROR',
    );
  }
  throw err;
}

async function mapConcorrente(lista, fn, limite = CONCORRENCIA) {
  const out = new Array(lista.length);
  let i = 0;
  const worker = async () => {
    while (i < lista.length) {
      const idx = i++;
      out[idx] = await fn(lista[idx], idx);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limite, lista.length) }, worker));
  return out;
}

const chunk = (arr, n) => {
  const r = [];
  for (let i = 0; i < arr.length; i += n) r.push(arr.slice(i, i + n));
  return r;
};

const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;

// Normaliza o que veio da planilha: tira espaços, ".0" do Excel, separadores.
export function normalizarSku(v) {
  if (v === null || v === undefined) return '';
  let s = String(v).trim();
  if (/^\d+\.0+$/.test(s)) s = s.replace(/\.0+$/, '');
  if (/^\d+(\.\d+)?e\+\d+$/i.test(s)) {
    // notação científica do Excel (ex.: 7.89E+12)
    s = Number(s).toLocaleString('fullwide', { useGrouping: false });
  }
  return s;
}

// ─── Promoções da empresa ────────────────────────────────────────────────────

// Lê GET /product/v2/promotion paginado (uma linha por item da promoção).
async function listarLinhasPromocao({ branch, promotionCode, status }) {
  const linhas = [];
  for (let page = 1; ; page++) {
    const params = { BranchCode: branch, Page: page, PageSize: PAGE_SIZE };
    if (promotionCode) params.PromotionCode = promotionCode;
    if (status && status !== 'all') params.Status = status;
    const resp = await callTotvs('get', `${PRODUCT_BASE}/promotion`, { params });
    const items = resp.data?.items || [];
    linhas.push(...items);
    if (!resp.data?.hasNext || items.length === 0) break;
  }
  return linhas;
}

// A planilha chega em lotes e reler a promoção a cada lote custaria minutos
// (100 linhas por página). O 1º lote relê do TOTVS (fresco) e os seguintes usam
// esta cópia; se ela estiver defasada, gravarLote troca update ↔ insert.
const cacheItensPromocao = new Map(); // `${branch}:${promotionCode}` → { at, mapa }
const CACHE_ITENS_TTL = 30 * 60 * 1000;

// Mapa productCode → { previousValue, promotionValue } dos itens da promoção.
async function itensDaPromocao(branch, promotionCode, { fresco = true } = {}) {
  const chave = `${branch}:${promotionCode}`;
  const cached = cacheItensPromocao.get(chave);
  if (!fresco && cached && Date.now() - cached.at < CACHE_ITENS_TTL) {
    return cached.mapa;
  }
  const linhas = await listarLinhasPromocao({ branch, promotionCode, status: 'all' });
  const mapa = new Map();
  for (const l of linhas) {
    if (l.productCode == null) continue;
    mapa.set(Number(l.productCode), {
      previousValue: l.previousValue ?? null,
      promotionValue: l.promotionValue ?? null,
    });
  }
  cacheItensPromocao.set(chave, { at: Date.now(), mapa });
  return mapa;
}

const STATUS_LABEL = { A: 'Aberta', B: 'Bloqueada', E: 'Encerrada' };

// A listagem lê TODOS os itens de todas as promoções da empresa (páginas de
// 100) — 30 s a 2 min. Cache em memória por empresa+status, 10 min.
const cacheListagem = new Map(); // `${branch}:${status}` → { at, promocoes }
const CACHE_LISTAGEM_TTL = 10 * 60 * 1000;

router.get(
  '/promocao-valores/promocoes',
  asyncHandler(async (req, res) => {
    const branch = parseInt(req.query.branch, 10);
    if (!branch) return errorResponse(res, 'Informe ?branch=', 400, 'MISSING_BRANCH');
    const status = String(req.query.status || 'Open');
    const chave = `${branch}:${status}`;
    const refresh = req.query.refresh === '1' || req.query.refresh === 'true';
    const cached = cacheListagem.get(chave);
    if (!refresh && cached && Date.now() - cached.at < CACHE_LISTAGEM_TTL) {
      return successResponse(
        res,
        { promocoes: cached.promocoes, cache: true, at: cached.at },
        `${cached.promocoes.length} promoções (cache)`,
      );
    }
    try {
      const linhas = await listarLinhasPromocao({ branch, status });
      const porCodigo = new Map();
      for (const l of linhas) {
        const code = Number(l.promotionCode);
        let p = porCodigo.get(code);
        if (!p) {
          p = {
            branchCode: Number(l.branchCode),
            promotionCode: code,
            description: l.promotionDescription || '',
            startDate: l.startDate || null,
            endDate: l.endDate || null,
            status: l.status || null,
            statusLabel: STATUS_LABEL[l.status] || l.status || null,
            itens: 0,
          };
          porCodigo.set(code, p);
        }
        if (l.productCode != null) p.itens += 1;
      }
      const promocoes = [...porCodigo.values()].sort(
        (a, b) => b.promotionCode - a.promotionCode,
      );
      cacheListagem.set(chave, { at: Date.now(), promocoes });
      return successResponse(
        res,
        { promocoes, cache: false, at: Date.now() },
        `${promocoes.length} promoções`,
      );
    } catch (err) {
      return handleTotvsError(res, err, 'ao listar promoções');
    }
  }),
);

// ─── Resolução dos SKUs e preços ─────────────────────────────────────────────

// Resolve EAN / SKU / EPC → produto (mesmo endpoint que o PDV usa).
async function produtoPorCodigo(code, branch) {
  try {
    const resp = await callTotvs(
      'get',
      `${PRODUCT_BASE}/products/${encodeURIComponent(code)}/${branch}`,
      { timeout: 30000 },
    );
    const item = resp.data?.items?.[0];
    if (!item?.productCode) return null;
    return {
      productCode: Number(item.productCode),
      productName: item.productName || item.name || null,
      productSku: item.productSku || item.sku || null,
      referenceCode: item.referenceCode || null,
    };
  } catch (err) {
    if (err.response?.status === 400 || err.response?.status === 404) return null;
    throw err;
  }
}

// prices/search por lista de códigos internos → mapa productCode → dados+preço.
async function precosPorCodigo(productCodes, branch, priceCode) {
  const mapa = new Map();
  for (const lote of chunk([...new Set(productCodes)], CHUNK_PRECOS)) {
    const resp = await callTotvs('post', `${PRODUCT_BASE}/prices/search`, {
      data: {
        filter: { productCodeList: lote },
        option: {
          prices: [
            { branchCode: branch, priceCodeList: [priceCode], isPromotionalPrice: true },
          ],
        },
        page: 1,
        pageSize: 1000,
      },
      timeout: 120000,
    });
    for (const it of resp.data?.items || []) {
      const p = (it.prices || []).find((x) => Number(x.priceCode) === priceCode) || it.prices?.[0];
      mapa.set(Number(it.productCode), {
        productCode: Number(it.productCode),
        productName: it.productName || null,
        productSku: it.productSku || null,
        referenceCode: it.referenceCode || null,
        colorName: it.colorName || null,
        sizeName: it.sizeName || null,
        priceCode: p?.priceCode ?? null,
        priceName: p?.priceName ?? null,
        price: p?.price != null ? Number(p.price) : null,
        promotionalPrice: p?.promotionalPrice != null ? Number(p.promotionalPrice) : null,
        promotionalInformation: p?.promotionalInformation || null,
      });
    }
  }
  return mapa;
}

router.post(
  '/promocao-valores/preview',
  asyncHandler(async (req, res) => {
    const branch = parseInt(req.body?.branch, 10);
    const promotionCode = parseInt(req.body?.promotionCode, 10);
    const priceCode = parseInt(req.body?.priceCode, 10) || 1;
    const skusBrutos = Array.isArray(req.body?.skus) ? req.body.skus : [];
    if (!branch) return errorResponse(res, 'branch obrigatório', 400, 'MISSING_BRANCH');
    if (!promotionCode) {
      return errorResponse(res, 'promotionCode obrigatório', 400, 'MISSING_PROMOTION');
    }
    if (skusBrutos.length === 0) {
      return errorResponse(res, 'Informe ao menos um SKU', 400, 'MISSING_SKUS');
    }

    // Dedup mantendo a ordem da planilha
    const vistos = new Set();
    const skus = [];
    for (const b of skusBrutos) {
      const s = normalizarSku(b);
      if (!s || vistos.has(s)) continue;
      vistos.add(s);
      skus.push(s);
    }

    try {
      // 1) Códigos internos "na cara" (até 9 dígitos) vão direto; o resto
      //    (EAN 13, SKU alfanumérico, EPC) passa pelo lookup do produto.
      const porSku = new Map(); // sku → productCode
      const lookupPendentes = [];
      for (const s of skus) {
        if (/^\d{1,9}$/.test(s)) porSku.set(s, Number(s));
        else lookupPendentes.push(s);
      }

      const resolverLookup = async (s) => {
        const prod = await produtoPorCodigo(s, branch);
        if (prod) porSku.set(s, prod.productCode);
      };
      await mapConcorrente(lookupPendentes, resolverLookup);

      // 2) Preço atual na empresa/tipo de preço
      let precos = await precosPorCodigo([...porSku.values()], branch, priceCode);

      // 3) Numéricos que não acharam preço: podem ser EAN curto / SKU — tenta
      //    o lookup e busca o preço de novo.
      const numericosSemPreco = skus.filter(
        (s) => /^\d{1,9}$/.test(s) && !precos.has(porSku.get(s)),
      );
      if (numericosSemPreco.length) {
        const achados = [];
        await mapConcorrente(numericosSemPreco, async (s) => {
          const prod = await produtoPorCodigo(s, branch);
          if (prod && prod.productCode !== porSku.get(s)) {
            porSku.set(s, prod.productCode);
            achados.push(prod.productCode);
          }
        });
        if (achados.length) {
          const extra = await precosPorCodigo(achados, branch, priceCode);
          precos = new Map([...precos, ...extra]);
        }
      }

      // 4) Itens já na promoção
      const naPromocao = await itensDaPromocao(branch, promotionCode, {
        fresco: req.body?.primeiroLote !== false,
      });

      const rows = skus.map((sku) => {
        const productCode = porSku.get(sku);
        const p = productCode != null ? precos.get(productCode) : null;
        if (!p) {
          return {
            sku,
            productCode: productCode ?? null,
            status: 'nao_encontrado',
            erro: 'Produto não encontrado no TOTVS',
          };
        }
        const item = naPromocao.get(productCode) || null;
        return {
          sku,
          productCode,
          productName: p.productName,
          productSku: p.productSku,
          referenceCode: p.referenceCode,
          colorName: p.colorName,
          sizeName: p.sizeName,
          priceName: p.priceName,
          price: p.price,
          promotionalPrice: p.promotionalPrice,
          promocaoAtual: p.promotionalInformation
            ? {
                code: p.promotionalInformation.code,
                description: p.promotionalInformation.description,
                endDate: p.promotionalInformation.endDate,
              }
            : null,
          naPromocao: !!item,
          valorPromocaoAtual: item?.promotionValue ?? null,
          status: p.price > 0 ? 'ok' : 'sem_preco',
          erro: p.price > 0 ? null : 'Produto sem preço nesta empresa/tipo de preço',
        };
      });

      const resumo = {
        total: rows.length,
        ok: rows.filter((r) => r.status === 'ok').length,
        naoEncontrados: rows.filter((r) => r.status === 'nao_encontrado').length,
        semPreco: rows.filter((r) => r.status === 'sem_preco').length,
        jaNaPromocao: rows.filter((r) => r.naPromocao).length,
        itensNaPromocao: naPromocao.size,
        duplicadosRemovidos: skusBrutos.length - skus.length,
      };
      return successResponse(res, { rows, resumo, priceCode }, `${rows.length} SKUs`);
    } catch (err) {
      return handleTotvsError(res, err, 'ao montar prévia');
    }
  }),
);

// ─── Gravação ────────────────────────────────────────────────────────────────

const URL_UPDATE = `${PRODUCT_BASE}/promotion-values/update`;
const URL_INSERT = `${PRODUCT_BASE}/promotion-items`;

// Grava um lote; se o lote falhar, tenta item a item para apontar o culpado.
// Item a item, se o TOTVS recusar (ex.: "não está na promoção" / "já existe"),
// tenta a outra operação antes de dar o item como erro — a paginação do
// GET /promotion não é estável e a lista de itens existentes pode vir furada.
async function gravarLote(url, branch, promotionCode, itens) {
  const resultado = { ok: [], okAlternativo: [], erros: [] };
  const post = (u, items) =>
    callTotvs('post', u, {
      data: { branchCode: branch, promotionCode, items },
      timeout: 120000,
    });
  try {
    await post(url, itens);
    resultado.ok.push(...itens.map((i) => i.productCode));
    return resultado;
  } catch (err) {
    if (!err.response) {
      const msg = mensagemTotvs(err);
      resultado.erros.push(...itens.map((i) => ({ productCode: i.productCode, erro: msg })));
      return resultado;
    }
  }
  const alternativa = url === URL_UPDATE ? URL_INSERT : URL_UPDATE;
  for (const it of itens) {
    try {
      await post(url, [it]);
      resultado.ok.push(it.productCode);
    } catch (err) {
      const erro1 = mensagemTotvs(err);
      try {
        await post(alternativa, [it]);
        resultado.okAlternativo.push(it.productCode);
      } catch (err2) {
        resultado.erros.push({
          productCode: it.productCode,
          erro: `${erro1} | alternativa: ${mensagemTotvs(err2)}`,
        });
      }
    }
  }
  return resultado;
}

router.post(
  '/promocao-valores/aplicar',
  asyncHandler(async (req, res) => {
    const branch = parseInt(req.body?.branch, 10);
    const promotionCode = parseInt(req.body?.promotionCode, 10);
    const incluirNovos = req.body?.incluirNovos !== false;
    const itensBrutos = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!branch) return errorResponse(res, 'branch obrigatório', 400, 'MISSING_BRANCH');
    if (!promotionCode) {
      return errorResponse(res, 'promotionCode obrigatório', 400, 'MISSING_PROMOTION');
    }
    if (itensBrutos.length === 0) {
      return errorResponse(res, 'Nenhum item para gravar', 400, 'MISSING_ITEMS');
    }

    const invalidos = [];
    const porCodigo = new Map();
    for (const it of itensBrutos) {
      const productCode = parseInt(it?.productCode, 10);
      const promotionValue = round2(it?.promotionValue);
      if (!productCode || !Number.isFinite(promotionValue) || promotionValue <= 0) {
        invalidos.push({ productCode: it?.productCode ?? null, erro: 'Código ou valor inválido' });
        continue;
      }
      porCodigo.set(productCode, { productCode, promotionValue });
    }
    const itens = [...porCodigo.values()];
    if (itens.length === 0) {
      return errorResponse(res, 'Nenhum item válido para gravar', 400, 'INVALID_ITEMS');
    }

    try {
      const existentes = await itensDaPromocao(branch, promotionCode, {
        fresco: req.body?.primeiroLote !== false,
      });
      const atualizar = itens.filter((i) => existentes.has(i.productCode));
      const inserir = itens.filter((i) => !existentes.has(i.productCode));

      const resultado = {
        atualizados: [],
        inseridos: [],
        ignorados: incluirNovos ? [] : inserir.map((i) => i.productCode),
        erros: [...invalidos],
      };

      for (const lote of chunk(atualizar, CHUNK_GRAVACAO)) {
        const r = await gravarLote(URL_UPDATE, branch, promotionCode, lote);
        resultado.atualizados.push(...r.ok);
        resultado.inseridos.push(...r.okAlternativo);
        resultado.erros.push(...r.erros.map((e) => ({ ...e, operacao: 'update' })));
      }
      if (incluirNovos) {
        for (const lote of chunk(inserir, CHUNK_GRAVACAO)) {
          const r = await gravarLote(URL_INSERT, branch, promotionCode, lote);
          resultado.inseridos.push(...r.ok);
          resultado.atualizados.push(...r.okAlternativo);
          resultado.erros.push(...r.erros.map((e) => ({ ...e, operacao: 'insert' })));
        }
      }

      console.log(
        `✅ [promocao-valores] empresa ${branch} promoção ${promotionCode}: ` +
          `${resultado.atualizados.length} atualizados, ${resultado.inseridos.length} inseridos, ` +
          `${resultado.ignorados.length} ignorados, ${resultado.erros.length} erros`,
      );
      return successResponse(
        res,
        resultado,
        `${resultado.atualizados.length + resultado.inseridos.length} itens gravados`,
      );
    } catch (err) {
      return handleTotvsError(res, err, 'ao gravar valores promocionais');
    }
  }),
);

export default router;
