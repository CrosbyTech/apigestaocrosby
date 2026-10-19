// Cliente TOTVS Moda para o sync e o outbox do ERP.
// - token via utils/totvsTokenManager (renova no 401 uma vez)
// - respeita o circuit breaker (usuário bloqueado)
// - paginação genérica (body ou query) com callback por página
// - pausa configurável entre chamadas para não derrubar o TOTVS
import axios from 'axios';
import { getToken, isTotvsBlocked, getBlockInfo } from '../../utils/totvsTokenManager.js';
import { TOTVS_BASE_URL, httpsAgent, httpAgent } from '../../totvsrouter/totvsHelper.js';

export { TOTVS_BASE_URL };

const DELAY_MS = Math.max(0, parseInt(process.env.ERP_TOTVS_DELAY_MS || '150', 10));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class TotvsHttpError extends Error {
  constructor(message, { status, data, method, path } = {}) {
    super(message);
    this.name = 'TotvsHttpError';
    this.status = status;
    this.data = data;
    this.method = method;
    this.path = path;
  }
  // 5xx, timeout, rede, 429 e 408 valem nova tentativa; 400/404/422 não.
  get retryable() {
    if (!this.status) return true;
    return this.status >= 500 || this.status === 408 || this.status === 429;
  }
}

function mensagemTotvs(data, fallback) {
  if (!data) return fallback;
  if (typeof data === 'string') return data.slice(0, 500);
  if (Array.isArray(data)) return data.map((d) => d.message || d.detailedMessage || JSON.stringify(d)).join(' | ').slice(0, 800);
  return (data.message || data.detailedMessage || data.title || JSON.stringify(data)).slice(0, 800);
}

/**
 * Chamada única ao TOTVS.
 * @param {'get'|'post'|'put'|'delete'} method
 * @param {string} path  relativo ao TOTVS_BASE_URL (ex.: '/person/v2/branchesList')
 */
// Leituras (GET, POST .../search e list-balance-bonus) são repetidas em 5xx,
// 408, 429 e falha de rede. Escritas NUNCA são repetidas aqui: o outbox cuida delas.
const ehLeitura = (method, path) =>
  String(method).toLowerCase() === 'get' || /\/search(\b|$)|list-balance-bonus|\/omni-changed-balances/.test(path);
const TENTATIVAS_LEITURA = Math.max(1, parseInt(process.env.ERP_TOTVS_TENTATIVAS || '3', 10));

export async function totvs(method, path, opts = {}) {
  const tentativas = ehLeitura(method, path) ? TENTATIVAS_LEITURA : 1;
  for (let t = 1; ; t++) {
    try {
      return await totvsUmaVez(method, path, opts);
    } catch (e) {
      const retry = e instanceof TotvsHttpError ? e.retryable : true;
      if (!retry || t >= tentativas || isTotvsBlocked()) throw e;
      await sleep(2000 * t * t); // 2s, 8s
    }
  }
}

async function totvsUmaVez(method, path, { data, params, timeout = 120000 } = {}) {
  if (isTotvsBlocked()) {
    const info = getBlockInfo();
    throw new TotvsHttpError(`TOTVS bloqueado até ${info?.blockedUntil || '?'}`, { status: 503, method, path });
  }
  const url = `${TOTVS_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
  const doCall = async (forceNew) => {
    const tk = await getToken(forceNew);
    if (!tk?.access_token) throw new TotvsHttpError('Token TOTVS indisponível', { status: 503, method, path });
    return axios({
      method,
      url,
      data,
      params,
      headers: {
        Authorization: `Bearer ${tk.access_token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      httpsAgent,
      httpAgent,
      timeout,
      validateStatus: () => true,
    });
  };
  let resp = await doCall(false);
  if (resp.status === 401) resp = await doCall(true);
  if (DELAY_MS) await sleep(DELAY_MS);
  if (resp.status >= 400) {
    throw new TotvsHttpError(`TOTVS ${method.toUpperCase()} ${path} → ${resp.status}: ${mensagemTotvs(resp.data, 'erro')}`, {
      status: resp.status,
      data: resp.data,
      method,
      path,
    });
  }
  return resp.data;
}

/**
 * Percorre todas as páginas de um endpoint.
 * - estilo 'body'  → POST com { ...data, page, pageSize }
 * - estilo 'query' → GET  com ?Page=&PageSize=
 * Chama onPage(items, meta) a cada página e devolve { paginas, registros, count }.
 */
export async function paginar({
  method = 'post',
  path,
  data = {},
  params = {},
  pageSize = 500,
  maxPages = 100000,
  estilo = method === 'get' ? 'query' : 'body',
  onPage,
  itemsKey = 'items',
  log = () => {},
  // Registro com dado inválido no TOTVS (ex.: data impossível no cadastro)
  // derruba a página inteira com 400. Com isolarRegistroInvalido, a página é
  // relida em pedaços menores até sobrar só o registro ruim, que é pulado.
  isolarRegistroInvalido = false,
}) {
  let page = 1;
  let registros = 0;
  let count = null;
  let totalPages = null;
  const pulados = [];
  const pedir = (p, size) =>
    totvs(method, path, estilo === 'query' ? { params: { ...params, Page: p, PageSize: size } } : { data: { ...data, page: p, pageSize: size }, params });
  for (;;) {
    let d;
    let items;
    try {
      d = await pedir(page, pageSize);
      items = d?.[itemsKey] || [];
    } catch (e) {
      if (!isolarRegistroInvalido || !ehErroDeRegistro(e)) throw e;
      const r = await lerFaixaTolerante(pedir, itemsKey, page, pageSize);
      items = r.items;
      pulados.push(...r.pulados);
      log(`  página ${page}: ${r.pulados.length} registro(s) inválido(s) pulado(s) no TOTVS`);
      d = { hasNext: totalPages != null ? page < totalPages : items.length + r.pulados.length === pageSize };
    }
    if (count === null && d?.count != null) count = d.count;
    if (d?.totalPages != null) totalPages = d.totalPages;
    registros += items.length;
    if (items.length) await onPage(items, { page, totalPages, count });
    log(`  página ${page}${totalPages ? `/${totalPages}` : ''} — ${items.length} itens`);
    const hasNext = d?.hasNext === true && (items.length > 0 || pulados.length > 0);
    if (!hasNext || page >= maxPages) break;
    page += 1;
  }
  if (pulados.length) log(`  ${pulados.length} registro(s) pulado(s) por dado inválido no TOTVS: ${JSON.stringify(pulados.slice(0, 10))}`);
  return { paginas: page, registros, count, pulados };
}

// 400 de validação por causa de UM registro (e não do filtro que enviamos)
export const ehErroDeRegistro = (e) =>
  e instanceof TotvsHttpError && e.status === 400 && /un-representable|not found|invalid cast|conversion/i.test(e.message);

const proximoTamanho = (n) => (n % 10 === 0 && n > 10 ? n / 10 : n % 2 === 0 && n > 1 ? n / 2 : 1);

/** Lê os registros da página `page` (tamanho `size`) em sub-páginas, pulando o que não dá para ler. */
async function lerFaixaTolerante(pedir, itemsKey, page, size) {
  if (size <= 1) {
    return { items: [], pulados: [{ posicao: page }] };
  }
  const sub = proximoTamanho(size);
  const fator = size / sub;
  const items = [];
  const pulados = [];
  for (let i = 0; i < fator; i++) {
    const p = (page - 1) * fator + i + 1;
    try {
      const d = await pedir(p, sub);
      const lote = d?.[itemsKey] || [];
      items.push(...lote);
      if (lote.length < sub) break; // fim da lista
    } catch (e) {
      if (!ehErroDeRegistro(e)) throw e;
      if (sub === 1) {
        pulados.push({ posicao: p, erro: e.message.slice(0, 160) });
        continue;
      }
      const r = await lerFaixaTolerante(pedir, itemsKey, p, sub);
      items.push(...r.items);
      pulados.push(...r.pulados);
    }
  }
  return { items, pulados };
}

// Janela de alteração no formato que o TOTVS aceita (sem timezone, hora local do servidor dele)
export const fmtTotvsDate = (d) => new Date(d).toISOString().slice(0, 19);
