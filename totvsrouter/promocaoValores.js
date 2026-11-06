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
//   POST /promocao-valores/preview  { branch, promotionCode?, priceCode?, skus[], primeiroLote? } (sem promoção = só preços)
//        → resolve cada SKU (código interno, EAN ou SKU do TOTVS) e devolve
//          nome, preço atual e se já está na promoção
//   POST /promocao-valores/aplicar  { branch, promotionCode, items[], incluirNovos?, primeiroLote? }
//        items: [{ productCode, promotionValue }]
//        → atualiza/insere em lotes e devolve o resultado por item
//   POST /promocao-valores/buscar-produtos  { termos[], tamanhos[] }
//        → produtos cujo nome contém QUALQUER termo E cujo tamanho está na
//          lista (erp_produtos + base importada); vira lote de SKUs na tela
//   (promoções e itens ficam copiados no Supabase — totvs_promocoes /
//    totvs_promocao_itens — e as consultas saem de lá; refresh relê o TOTVS)
//   GET  /promocao-valores/itens?branch&promotionCode&priceCode&refresh=1
//        → todos os itens da promoção com preço atual e valor promocional (para
//          filtrar e zerar o desconto — a API não exclui item de promoção)
//   GET|POST /promocao-valores/base-produtos   situação / carga da base de busca
//        (relatório de produtos acabados do TOTVS em CSV)
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
import supabase from '../config/supabase.js';

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

// ─── Cópia no Supabase (totvs_promocoes / totvs_promocao_itens) ─────────────
// Ler a promoção no TOTVS é lento; toda leitura completa e toda gravação da
// tela ficam salvas no banco, e as consultas seguintes saem de lá.
const STATUS_TOTVS = { Open: 'A', Blocked: 'B', Closed: 'E' };

// Grava o que veio do GET /promotion. As promoções lidas por inteiro têm os
// itens trocados pelos do TOTVS (o que saiu da promoção sai do banco também).
async function salvarLinhasPromocao(branch, linhas) {
  const porPromo = new Map();
  for (const l of linhas) {
    const code = Number(l.promotionCode);
    if (!code) continue;
    if (!porPromo.has(code)) {
      porPromo.set(code, {
        cab: {
          empresa: branch,
          promocao_code: code,
          descricao: l.promotionDescription || null,
          inicio: l.startDate || null,
          fim: l.endDate || null,
          status: l.status || null,
        },
        itens: new Map(),
      });
    }
    if (l.productCode != null) {
      porPromo.get(code).itens.set(Number(l.productCode), {
        empresa: branch,
        promocao_code: code,
        produto_code: Number(l.productCode),
        valor_promocional: l.promotionValue ?? null,
        valor_anterior: l.previousValue ?? null,
        origem: 'totvs',
        atualizado_em: new Date().toISOString(),
      });
    }
  }
  const agora = new Date().toISOString();
  for (const [code, { cab, itens }] of porPromo) {
    const lista = [...itens.values()];
    for (const lote of chunk(lista, 1000)) {
      const { error } = await supabase.from('totvs_promocao_itens').upsert(lote, { onConflict: 'empresa,promocao_code,produto_code' });
      if (error) throw error;
    }
    // tira do banco o que não está mais na promoção do TOTVS
    const noBanco = [];
    for (let de = 0; ; de += 1000) {
      const { data } = await supabase
        .from('totvs_promocao_itens')
        .select('produto_code')
        .eq('empresa', branch)
        .eq('promocao_code', code)
        .order('produto_code')
        .range(de, de + 999);
      noBanco.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
    const sairam = noBanco.map((r) => r.produto_code).filter((c) => !itens.has(c));
    for (const lote of chunk(sairam, 500)) {
      await supabase.from('totvs_promocao_itens').delete().eq('empresa', branch).eq('promocao_code', code).in('produto_code', lote);
    }
    const { error } = await supabase
      .from('totvs_promocoes')
      .upsert({ ...cab, qtd_itens: lista.length, lido_totvs_em: agora, atualizado_em: agora }, { onConflict: 'empresa,promocao_code' });
    if (error) throw error;
  }
}

const salvarEmSegundoPlano = (branch, linhas) =>
  salvarLinhasPromocao(branch, linhas).catch((e) => console.log(`⚠️ [promocao-valores] cópia no banco falhou: ${e.message}`));

async function itensDoBanco(branch, promotionCode) {
  const { data: cab } = await supabase
    .from('totvs_promocoes')
    .select('lido_totvs_em')
    .eq('empresa', branch)
    .eq('promocao_code', promotionCode)
    .maybeSingle();
  if (!cab?.lido_totvs_em) return null; // nunca lida por inteiro: vai ao TOTVS
  const mapa = new Map();
  for (let de = 0; ; de += 1000) {
    const { data, error } = await supabase
      .from('totvs_promocao_itens')
      .select('produto_code, valor_promocional, valor_anterior')
      .eq('empresa', branch)
      .eq('promocao_code', promotionCode)
      .order('produto_code')
      .range(de, de + 999);
    if (error) throw error;
    for (const r of data || []) {
      mapa.set(Number(r.produto_code), {
        previousValue: r.valor_anterior != null ? Number(r.valor_anterior) : null,
        promotionValue: r.valor_promocional != null ? Number(r.valor_promocional) : null,
      });
    }
    if (!data || data.length < 1000) break;
  }
  return { mapa, lidoEm: cab.lido_totvs_em };
}

// Mapa productCode → { previousValue, promotionValue } dos itens da promoção.
// Ordem: memória → banco (Supabase) → TOTVS. totvs: true força o TOTVS (e
// atualiza o banco). Se o banco estiver defasado, gravarLote troca update ↔ insert.
async function itensDaPromocao(branch, promotionCode, { fresco = true, totvs = false, info = null } = {}) {
  const chave = `${branch}:${promotionCode}`;
  const cached = cacheItensPromocao.get(chave);
  if (!totvs && !fresco && cached && Date.now() - cached.at < CACHE_ITENS_TTL) {
    if (info) Object.assign(info, { fonte: 'memoria', lidoEm: cached.lidoEm || null });
    return cached.mapa;
  }
  if (!totvs) {
    try {
      const banco = await itensDoBanco(branch, promotionCode);
      if (banco) {
        cacheItensPromocao.set(chave, { at: Date.now(), mapa: banco.mapa, lidoEm: banco.lidoEm });
        if (info) Object.assign(info, { fonte: 'banco', lidoEm: banco.lidoEm });
        return banco.mapa;
      }
    } catch (e) {
      console.log(`⚠️ [promocao-valores] banco indisponível, lendo o TOTVS: ${e.message}`);
    }
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
  const lidoEm = new Date().toISOString();
  cacheItensPromocao.set(chave, { at: Date.now(), mapa, lidoEm });
  if (info) Object.assign(info, { fonte: 'totvs', lidoEm });
  // promoção sem itens não volta linha nenhuma: só salva quando há o que salvar
  if (linhas.length) await salvarLinhasPromocao(branch, linhas).catch((e) => console.log(`⚠️ [promocao-valores] cópia no banco falhou: ${e.message}`));
  return mapa;
}

// Depois de gravar no TOTVS: o banco fica com o valor novo
async function registrarGravacao(branch, promotionCode, itens) {
  const agora = new Date().toISOString();
  const linhas = itens.map((i) => ({
    empresa: branch,
    promocao_code: promotionCode,
    produto_code: i.productCode,
    valor_promocional: i.promotionValue,
    origem: 'headcoach',
    atualizado_em: agora,
  }));
  for (const lote of chunk(linhas, 1000)) {
    const { error } = await supabase.from('totvs_promocao_itens').upsert(lote, { onConflict: 'empresa,promocao_code,produto_code' });
    if (error) throw error;
  }
  const { count } = await supabase
    .from('totvs_promocao_itens')
    .select('produto_code', { count: 'exact', head: true })
    .eq('empresa', branch)
    .eq('promocao_code', promotionCode);
  if (count != null) {
    await supabase.from('totvs_promocoes').update({ qtd_itens: count, atualizado_em: agora }).eq('empresa', branch).eq('promocao_code', promotionCode);
  }
  const cached = cacheItensPromocao.get(`${branch}:${promotionCode}`);
  if (cached) for (const i of itens) cached.mapa.set(i.productCode, { previousValue: null, promotionValue: i.promotionValue });
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
    // Banco primeiro (rápido); vazio ou refresh → TOTVS
    if (!refresh) {
      let q = supabase.from('totvs_promocoes').select('*').eq('empresa', branch).order('promocao_code', { ascending: false });
      if (STATUS_TOTVS[status]) q = q.eq('status', STATUS_TOTVS[status]);
      const { data, error } = await q;
      if (!error && data?.length) {
        const promocoes = data.map((p) => ({
          branchCode: p.empresa,
          promotionCode: p.promocao_code,
          description: p.descricao || '',
          startDate: p.inicio,
          endDate: p.fim,
          status: p.status,
          statusLabel: STATUS_LABEL[p.status] || p.status || null,
          itens: p.qtd_itens,
        }));
        const lidoEm = data.reduce((m, p) => (p.lido_totvs_em && p.lido_totvs_em > m ? p.lido_totvs_em : m), '');
        return successResponse(
          res,
          { promocoes, cache: true, banco: true, at: lidoEm ? new Date(lidoEm).getTime() : null },
          `${promocoes.length} promoções (banco)`,
        );
      }
    }
    try {
      const linhas = await listarLinhasPromocao({ branch, status });
      salvarEmSegundoPlano(branch, linhas);
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

// Preço pelo Supabase primeiro (erp_precos, cópia do TOTVS mantida pelo sync;
// hoje só empresas 1 e 2 no tipo 1) com nome/cor/tamanho do erp_produtos ou da
// base importada; o que faltar vai ao TOTVS (prices/search, o caminho lento).
async function precosRapidos(productCodes, branch, priceCode) {
  const codigos = [...new Set(productCodes.map(Number).filter((c) => c > 0))];
  const mapa = new Map();
  try {
    const precos = new Map();
    for (const lote of chunk(codigos, 500)) {
      const { data, error } = await supabase
        .from('erp_precos')
        .select('produto_code, preco_code, preco_nome, preco, preco_promocional, promocao')
        .eq('empresa', branch)
        .eq('preco_code', priceCode)
        .in('produto_code', lote);
      if (error) throw error;
      for (const r of data || []) precos.set(Number(r.produto_code), r);
    }
    const nomes = new Map();
    const comPreco = [...precos.keys()];
    for (const lote of chunk(comPreco, 500)) {
      const [erp, base] = await Promise.all([
        supabase.from('erp_produtos').select('code, nome, sku, referencia_code, cor_nome, tamanho').in('code', lote),
        supabase.from('promocao_produtos_base').select('code, nome, referencia_code, cor_nome, tamanho').in('code', lote),
      ]);
      for (const r of base.data || []) nomes.set(Number(r.code), r);
      for (const r of erp.data || []) nomes.set(Number(r.code), r);
    }
    for (const [code, p] of precos) {
      const n = nomes.get(code);
      if (!n) continue; // sem nome: deixa o TOTVS responder
      mapa.set(code, {
        productCode: code,
        productName: n.nome || null,
        productSku: n.sku || null,
        referenceCode: n.referencia_code || null,
        colorName: n.cor_nome || null,
        sizeName: n.tamanho || null,
        priceCode: p.preco_code,
        priceName: p.preco_nome || null,
        price: p.preco != null ? Number(p.preco) : null,
        promotionalPrice: p.preco_promocional != null ? Number(p.preco_promocional) : null,
        promotionalInformation: p.promocao || null,
      });
    }
  } catch (err) {
    console.log(`⚠️ [Preço Promocional] preços do Supabase indisponíveis: ${err.message}`);
  }
  const faltam = codigos.filter((c) => !mapa.has(c));
  if (faltam.length) {
    const doTotvs = await precosPorCodigo(faltam, branch, priceCode);
    for (const [k, v] of doTotvs) mapa.set(k, v);
  }
  return mapa;
}

// Itens de uma promoção do TOTVS já no formato da prévia (para ver, filtrar e
// zerar o desconto: a API não tem exclusão de item, só promotion-values/update)
router.get(
  '/promocao-valores/itens',
  asyncHandler(async (req, res) => {
    const branch = parseInt(req.query.branch, 10);
    const promotionCode = parseInt(req.query.promotionCode, 10);
    const priceCode = parseInt(req.query.priceCode, 10) || 1;
    if (!branch || !promotionCode) return errorResponse(res, 'branch e promotionCode obrigatórios', 400, 'MISSING_PARAMS');
    try {
      const info = {};
      const itens = await itensDaPromocao(branch, promotionCode, { fresco: true, totvs: req.query.refresh === '1', info });
      const precos = await precosRapidos([...itens.keys()], branch, priceCode);
      const rows = [...itens.entries()].map(([productCode, it]) => {
        const p = precos.get(productCode);
        return {
          sku: String(productCode),
          productCode,
          productName: p?.productName || null,
          productSku: p?.productSku || null,
          referenceCode: p?.referenceCode || null,
          colorName: p?.colorName || null,
          sizeName: p?.sizeName || null,
          priceName: p?.priceName || null,
          price: p?.price ?? null,
          naPromocao: true,
          valorPromocaoAtual: it.promotionValue ?? null,
          status: p?.price > 0 ? 'ok' : 'sem_preco',
          erro: p?.price > 0 ? null : 'Produto sem preço nesta empresa/tipo de preço',
        };
      });
      return successResponse(res, { rows, priceCode, fonte: info.fonte, lidoEm: info.lidoEm }, `${rows.length} itens na promoção`);
    } catch (err) {
      return handleTotvsError(res, err, 'ao ler os itens da promoção');
    }
  }),
);

router.post(
  '/promocao-valores/preview',
  asyncHandler(async (req, res) => {
    const branch = parseInt(req.body?.branch, 10);
    const promotionCode = parseInt(req.body?.promotionCode, 10);
    const priceCode = parseInt(req.body?.priceCode, 10) || 1;
    const skusBrutos = Array.isArray(req.body?.skus) ? req.body.skus : [];
    if (!branch) return errorResponse(res, 'branch obrigatório', 400, 'MISSING_BRANCH');
    // Sem promotionCode: prévia só de preços (promoção do PDV Crosby)
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
      let precos = await precosRapidos([...porSku.values()], branch, priceCode);

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
      const naPromocao = promotionCode
        ? await itensDaPromocao(branch, promotionCode, { fresco: req.body?.primeiroLote !== false })
        : new Map();

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

// ─── Busca no cadastro por nome / tamanho (lotes sem planilha) ───────────────
// Duas fontes: erp_produtos (cópia do TOTVS, ainda incompleta) e
// promocao_produtos_base (relatório de produtos acabados importado em CSV).
// Junta as duas pelo código; o que o erp_produtos marca como inativo/bloqueado
// sai mesmo que esteja na base.
const limparFiltro = (v) => String(v || '').trim().toUpperCase();
const filtroSeguro = (t) => t.replace(/[,()*%]/g, ' ').trim();

async function buscarTabela(tabela, colunas, { termos, tamanhos }) {
  const out = [];
  const PAGINA = 1000;
  for (let de = 0; ; de += PAGINA) {
    let q = supabase.from(tabela).select(colunas).order('code').range(de, de + PAGINA - 1);
    if (tamanhos.length) q = q.in('tamanho', tamanhos);
    if (termos.length) q = q.or(termos.map((t) => `nome.ilike.%${filtroSeguro(t)}%`).join(','));
    const { data, error } = await q;
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < PAGINA) break;
  }
  return out;
}

router.post(
  '/promocao-valores/buscar-produtos',
  asyncHandler(async (req, res) => {
    const termos = [...new Set((Array.isArray(req.body?.termos) ? req.body.termos : []).map(limparFiltro).filter(Boolean))];
    const tamanhos = [...new Set((Array.isArray(req.body?.tamanhos) ? req.body.tamanhos : []).map(limparFiltro).filter(Boolean))];
    if (!termos.length && !tamanhos.length) {
      return errorResponse(res, 'Informe ao menos um termo do nome ou um tamanho', 400, 'MISSING_FILTER');
    }
    try {
      const [erp, base] = await Promise.all([
        buscarTabela('erp_produtos', 'code, nome, referencia_code, cor_nome, tamanho, ativo, bloqueado', { termos, tamanhos }),
        buscarTabela('promocao_produtos_base', 'code, nome, referencia_code, cor_nome, tamanho', { termos, tamanhos }).catch(() => []),
      ]);
      const porCodigo = new Map();
      const fora = new Set();
      for (const p of erp) {
        if (!p.ativo || p.bloqueado) fora.add(p.code);
        else porCodigo.set(p.code, { ...p, fonte: 'totvs' });
      }
      for (const p of base) {
        if (!fora.has(p.code) && !porCodigo.has(p.code)) porCodigo.set(p.code, { ...p, fonte: 'base' });
      }
      const itens = [...porCodigo.values()]
        .map(({ ativo, bloqueado, ...p }) => p)
        .sort((a, b) => a.code - b.code);
      return successResponse(res, { itens, termos, tamanhos, inativosFora: fora.size }, `${itens.length} produto(s)`);
    } catch (err) {
      return errorResponse(res, err.message, 500, 'DB_ERROR');
    }
  }),
);

// Atualiza a base de busca com o relatório de produtos do TOTVS (a página lê o
// CSV e manda em lotes). Produto que já existe tem os dados trocados.
router.post(
  '/promocao-valores/base-produtos',
  asyncHandler(async (req, res) => {
    const linhas = (Array.isArray(req.body?.linhas) ? req.body.linhas : [])
      .map((l) => ({
        code: parseInt(l.code, 10),
        nome: String(l.nome || '').trim(),
        unidade: l.unidade ? String(l.unidade).trim() : null,
        referencia_code: l.referencia_code ? String(l.referencia_code).trim() : null,
        fisico: Number.isFinite(Number(l.fisico)) ? Number(l.fisico) : null,
        cor_code: l.cor_code ? String(l.cor_code).trim() : null,
        cor_nome: l.cor_nome ? String(l.cor_nome).trim() : null,
        tamanho: l.tamanho ? String(l.tamanho).trim().toUpperCase() : null,
        fonte: req.body?.fonte ? String(req.body.fonte).slice(0, 120) : null,
        importado_em: new Date().toISOString(),
      }))
      .filter((l) => l.code > 0 && l.nome);
    if (!linhas.length) return errorResponse(res, 'Nenhuma linha válida', 400, 'EMPTY');
    for (let k = 0; k < linhas.length; k += 1000) {
      const { error } = await supabase.from('promocao_produtos_base').upsert(linhas.slice(k, k + 1000), { onConflict: 'code' });
      if (error) return errorResponse(res, error.message, 500, 'DB_ERROR');
    }
    return successResponse(res, { gravados: linhas.length }, `${linhas.length} produto(s) na base`);
  }),
);

router.get(
  '/promocao-valores/base-produtos',
  asyncHandler(async (req, res) => {
    const { count, error } = await supabase.from('promocao_produtos_base').select('code', { count: 'exact', head: true });
    if (error) return errorResponse(res, error.message, 500, 'DB_ERROR');
    const { data } = await supabase.from('promocao_produtos_base').select('importado_em, fonte').order('importado_em', { ascending: false }).limit(1);
    return successResponse(res, { total: count || 0, atualizadoEm: data?.[0]?.importado_em || null, fonte: data?.[0]?.fonte || null }, 'Base de produtos');
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

      const gravados = new Set([...resultado.atualizados, ...resultado.inseridos].map(Number));
      if (gravados.size) {
        await registrarGravacao(branch, promotionCode, itens.filter((i) => gravados.has(i.productCode))).catch((e) =>
          console.log(`⚠️ [promocao-valores] gravado no TOTVS, mas a cópia no banco falhou: ${e.message}`),
        );
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
