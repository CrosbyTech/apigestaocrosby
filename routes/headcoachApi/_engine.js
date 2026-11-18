// ============================================================================
// API HEADCOACH (somente leitura) — motor comum a todos os módulos.
// Yago, 18/11/2026: API de CONSULTA dos dados do HeadCoach para o Dryland (e
// outros sistemas), organizada como a API do TOTVS Moda:
//     /api/headcoach/<módulo>/v1/<recurso>
// Só GET. Nomes de campos em inglês, no padrão do TOTVS (branchCode,
// customerCode, issueDate…). Paginação: page / pageSize na entrada e
// { items, count, totalItems, totalPages, hasNext } na saída.
//
// Cada recurso é DECLARADO (tabela, campos, filtros) e daqui saem a rota, a
// validação dos parâmetros e a documentação (OpenAPI / Swagger), sempre iguais
// ao que a rota faz de verdade.
//
// Acesso: chave de API só de leitura, em HEADCOACH_API_KEYS ("nome:chave,…"),
// enviada em X-API-Key ou Authorization: Bearer. Sem a variável a API fica
// fechada (503).
// ============================================================================
import crypto from 'node:crypto';
import supabase from '../../config/supabase.js';

export const BASE = '/api/headcoach';
export const VERSAO = 'v1';
const PAGE_SIZE_PADRAO = 100;
const PAGE_SIZE_MAX = 1000; // o banco devolve no máximo 1000 linhas por consulta
const FUSO = '-03:00'; // America/Recife

export class ApiError extends Error {
  constructor(status, code, message, detailedMessage = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.detailedMessage = detailedMessage;
  }
}
const erro = (res, status, code, message, detailedMessage = null) => res.status(status).json({ code, message, detailedMessage });

// ─── chave de acesso ─────────────────────────────────────────────────────────
function chavesConfiguradas() {
  return String(process.env.HEADCOACH_API_KEYS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((par) => {
      const i = par.indexOf(':');
      return i > 0 ? { nome: par.slice(0, i).trim(), chave: par.slice(i + 1).trim() } : { nome: 'cliente', chave: par };
    })
    .filter((k) => k.chave.length >= 16);
}
const igual = (a, b) => {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
};
export function exigirChave(req, res, next) {
  const chaves = chavesConfiguradas();
  if (!chaves.length) return erro(res, 503, 'ApiKeyNotConfigured', 'A API do HeadCoach ainda não tem chave de acesso configurada no servidor', 'Defina HEADCOACH_API_KEYS (nome:chave) no ambiente.');
  const auth = String(req.headers.authorization || '');
  const enviada = String(req.headers['x-api-key'] || (auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '')).trim();
  if (!enviada) return erro(res, 401, 'Unauthorized', 'Informe a chave de acesso', 'Envie a chave no cabeçalho X-API-Key ou em Authorization: Bearer <chave>.');
  const quem = chaves.find((k) => igual(k.chave, enviada));
  if (!quem) return erro(res, 401, 'Unauthorized', 'Chave de acesso inválida');
  req.apiCliente = quem.nome;
  return next();
}

// ─── definição de campos e filtros ───────────────────────────────────────────
/**
 * Campo da resposta: f('branchCode', 'empresa', 'integer', 'Código da empresa')
 *  col  → coluna do banco, ou função (linha) => valor (aí informe opts.cols)
 *  type → integer | number | string | boolean | date | date-time | object | array
 *  opts → { map: { valorDoBanco: 'ValorDaApi' }, cols: ['a','b'], example, items }
 */
export const f = (name, col, type, description, opts = {}) => ({ name, col, type, description, ...opts });

/**
 * Filtro (parâmetro da URL): q('branchCodeList', 'intList', 'empresa', 'Códigos das empresas, separados por vírgula')
 *  kind → int | intList | string | stringList | text (contém) | digits | bool
 *         | startDate/endDate (coluna com hora, dia no fuso de Recife)
 *         | startDay/endDay (coluna só data) | enum (opts.map: ValorDaApi → valor(es) do banco)
 *         | custom (opts.apply(query, valor) devolve a query)
 */
export const q = (name, kind, col, description, opts = {}) => ({ name, kind, col, description, ...opts });

const ehDia = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const lista = (v) => String(v).split(',').map((s) => s.trim()).filter(Boolean);

function aplicarFiltro(query, flt, bruto) {
  const v = String(bruto).trim();
  const ruim = (como) => {
    throw new ApiError(400, 'InvalidParameter', `Parâmetro "${flt.name}" inválido`, como);
  };
  switch (flt.kind) {
    case 'int': {
      const n = Number(v);
      if (!Number.isInteger(n)) ruim('Esperado um número inteiro.');
      return query.eq(flt.col, n);
    }
    case 'intList': {
      const ns = lista(v).map(Number);
      if (!ns.length || ns.some((n) => !Number.isInteger(n))) ruim('Esperada uma lista de inteiros separados por vírgula, ex.: 95,99.');
      return query.in(flt.col, ns);
    }
    case 'string':
      return query.eq(flt.col, v);
    case 'stringList':
      return query.in(flt.col, lista(v));
    case 'text':
      return query.ilike(flt.col, `%${v.replace(/[%_]/g, ' ')}%`);
    case 'digits': {
      const d = v.replace(/\D/g, '');
      if (!d) ruim('Esperado um número (CPF, CNPJ ou chave), só dígitos.');
      return query.eq(flt.col, d);
    }
    case 'bool': {
      if (!/^(true|false|1|0)$/i.test(v)) ruim('Esperado true ou false.');
      return query.eq(flt.col, /^(true|1)$/i.test(v));
    }
    case 'startDate':
      if (!ehDia(v)) ruim('Esperada uma data AAAA-MM-DD.');
      return query.gte(flt.col, `${v}T00:00:00${FUSO}`);
    case 'endDate':
      if (!ehDia(v)) ruim('Esperada uma data AAAA-MM-DD.');
      return query.lte(flt.col, `${v}T23:59:59.999${FUSO}`);
    case 'startDay':
      if (!ehDia(v)) ruim('Esperada uma data AAAA-MM-DD.');
      return query.gte(flt.col, v);
    case 'endDay':
      if (!ehDia(v)) ruim('Esperada uma data AAAA-MM-DD.');
      return query.lte(flt.col, v);
    case 'enum': {
      const pedidos = lista(v);
      const banco = [];
      for (const p of pedidos) {
        const achado = Object.keys(flt.map).find((k) => k.toLowerCase() === p.toLowerCase());
        if (!achado) ruim(`Valores aceitos: ${Object.keys(flt.map).join(', ')}.`);
        banco.push(...[].concat(flt.map[achado]));
      }
      return query.in(flt.col, [...new Set(banco)]);
    }
    case 'custom':
      return flt.apply(query, v, ruim);
    default:
      return query;
  }
}

// ─── leitura de um recurso ───────────────────────────────────────────────────
function colunasDe(recurso) {
  const cols = new Set();
  for (const c of recurso.fields) {
    if (typeof c.col === 'string') cols.add(c.col);
    for (const x of c.cols || []) cols.add(x);
  }
  for (const k of recurso.key || []) cols.add(k.col);
  for (const e of Object.values(recurso.expand || {})) cols.add(e.localKey || 'id');
  for (const x of recurso.extraCols || []) cols.add(x);
  return [...cols].join(', ') + (recurso.selectExtra ? `, ${recurso.selectExtra}` : '');
}

export function mapear(recurso, linha) {
  const out = {};
  for (const c of recurso.fields) {
    let v = typeof c.col === 'function' ? c.col(linha) : linha[c.col];
    if (c.map && v !== null && v !== undefined) v = c.map[v] ?? v;
    if (v === undefined) v = null;
    if (v !== null && (c.type === 'number' || c.type === 'integer') && typeof v === 'string' && v !== '' && !Number.isNaN(Number(v))) v = Number(v);
    if (v !== null && c.type === 'date' && typeof v === 'string') v = v.slice(0, 10);
    out[c.name] = v;
  }
  return out;
}

function paginacao(query) {
  const page = query.page === undefined ? 1 : Number(query.page);
  const pageSize = query.pageSize === undefined ? PAGE_SIZE_PADRAO : Number(query.pageSize);
  if (!Number.isInteger(page) || page < 1) throw new ApiError(400, 'InvalidParameter', 'Parâmetro "page" inválido', 'Esperado um inteiro a partir de 1.');
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > PAGE_SIZE_MAX) throw new ApiError(400, 'InvalidParameter', 'Parâmetro "pageSize" inválido', `Esperado um inteiro de 1 a ${PAGE_SIZE_MAX}.`);
  return { page, pageSize };
}

const PARAMS_FIXOS = new Set(['page', 'pageSize', 'expand']);
function conferirParametros(recurso, query) {
  const aceitos = new Set([...PARAMS_FIXOS, ...(recurso.filters || []).map((x) => x.name)]);
  const estranhos = Object.keys(query).filter((k) => !aceitos.has(k));
  if (estranhos.length) throw new ApiError(400, 'UnknownParameter', `Parâmetro desconhecido: ${estranhos.join(', ')}`, `Aceitos neste recurso: ${[...aceitos].join(', ')}.`);
}

async function buscarFilhos(def, ids) {
  const filho = def.resource;
  const linhas = [];
  const sel = colunasDe({ ...filho, extraCols: [...(filho.extraCols || []), def.fk] });
  for (let i = 0; i < ids.length; i += 200) {
    const lote = ids.slice(i, i + 200);
    for (let ini = 0; ; ini += 1000) {
      let qy = supabase.from(filho.table).select(sel).in(def.fk, lote);
      if (filho.baseFilter) qy = filho.baseFilter(qy);
      for (const [col, asc] of filho.order || []) qy = qy.order(col, { ascending: asc });
      const { data, error } = await qy.range(ini, ini + 999);
      if (error) throw new ApiError(500, 'DatabaseError', 'Erro ao consultar o banco', error.message);
      linhas.push(...(data || []));
      if ((data || []).length < 1000) break;
    }
  }
  const porPai = new Map();
  for (const l of linhas) {
    if (!porPai.has(l[def.fk])) porPai.set(l[def.fk], []);
    porPai.get(l[def.fk]).push(mapear(filho, l));
  }
  return porPai;
}

async function expandir(recurso, pedido, linhas, itens) {
  const quais = lista(pedido || '');
  if (!quais.length) return;
  const defs = recurso.expand || {};
  for (const nome of quais) {
    const def = defs[Object.keys(defs).find((k) => k.toLowerCase() === nome.toLowerCase())];
    if (!def) throw new ApiError(400, 'InvalidParameter', 'Parâmetro "expand" inválido', Object.keys(defs).length ? `Aceitos neste recurso: ${Object.keys(defs).join(', ')}.` : 'Este recurso não tem expand.');
    const local = def.localKey || 'id';
    const ids = [...new Set(linhas.map((l) => l[local]).filter((x) => x !== null && x !== undefined))];
    const porPai = ids.length ? await buscarFilhos(def, ids) : new Map();
    const chave = Object.keys(defs).find((k) => defs[k] === def);
    linhas.forEach((l, i) => {
      itens[i][chave] = porPai.get(l[local]) || [];
    });
  }
}

/** GET de lista, com filtros, paginação e expand. `fixo(req)` acrescenta filtros da rota (sub-recurso). */
export function rotaLista(recurso, fixo = null) {
  return async (req, res) => {
    try {
      conferirParametros(recurso, req.query);
      const { page, pageSize } = paginacao(req.query);
      let qy = supabase.from(recurso.table).select(colunasDe(recurso), { count: 'exact' });
      if (recurso.baseFilter) qy = recurso.baseFilter(qy);
      if (fixo) qy = fixo(qy, req);
      for (const flt of recurso.filters || []) {
        const v = req.query[flt.name];
        if (v !== undefined && String(v).trim() !== '') qy = aplicarFiltro(qy, flt, v);
      }
      for (const [col, asc] of recurso.order || []) qy = qy.order(col, { ascending: asc });
      const de = (page - 1) * pageSize;
      const { data, error, count } = await qy.range(de, de + pageSize - 1);
      if (error) {
        // página além do fim: o banco reclama do intervalo → devolve vazio
        if (/range not satisfiable|PGRST103/i.test(`${error.code} ${error.message}`)) return res.json({ items: [], count: 0, totalItems: 0, totalPages: 0, hasNext: false, page, pageSize });
        throw new ApiError(500, 'DatabaseError', 'Erro ao consultar o banco', error.message);
      }
      const linhas = data || [];
      const itens = linhas.map((l) => mapear(recurso, l));
      await expandir(recurso, req.query.expand, linhas, itens);
      const totalItems = count ?? itens.length;
      const totalPages = Math.ceil(totalItems / pageSize);
      return res.json({ items: itens, count: itens.length, totalItems, totalPages, hasNext: page < totalPages, page, pageSize });
    } catch (e) {
      if (e instanceof ApiError) return erro(res, e.status, e.code, e.message, e.detailedMessage);
      console.error(`[api-headcoach] ${req.originalUrl}:`, e.message);
      return erro(res, 500, 'InternalError', 'Erro interno ao consultar', e.message);
    }
  };
}

/** GET de um registro pela(s) chave(s) do recurso (recurso.key). */
export function rotaUm(recurso) {
  return async (req, res) => {
    try {
      const estranhos = Object.keys(req.query).filter((k) => k !== 'expand');
      if (estranhos.length) throw new ApiError(400, 'UnknownParameter', `Parâmetro desconhecido: ${estranhos.join(', ')}`, 'Aceito: expand.');
      let qy = supabase.from(recurso.table).select(colunasDe(recurso));
      if (recurso.baseFilter) qy = recurso.baseFilter(qy);
      for (const k of recurso.key) {
        const bruto = String(req.params[k.param] ?? '').trim();
        const v = k.type === 'integer' ? Number(bruto) : bruto;
        if (k.type === 'integer' && !Number.isInteger(v)) throw new ApiError(400, 'InvalidParameter', `Parâmetro "${k.param}" inválido`, 'Esperado um número inteiro.');
        qy = qy.eq(k.col, v);
      }
      const { data, error } = await qy.limit(1);
      if (error) throw new ApiError(500, 'DatabaseError', 'Erro ao consultar o banco', error.message);
      if (!data?.length) throw new ApiError(404, 'NotFound', 'Registro não encontrado');
      const item = mapear(recurso, data[0]);
      await expandir(recurso, req.query.expand, data, [item]);
      return res.json(item);
    } catch (e) {
      if (e instanceof ApiError) return erro(res, e.status, e.code, e.message, e.detailedMessage);
      console.error(`[api-headcoach] ${req.originalUrl}:`, e.message);
      return erro(res, 500, 'InternalError', 'Erro interno ao consultar', e.message);
    }
  };
}

/** Rota calculada (não é leitura direta de tabela): fn(req) devolve o corpo. */
export function rotaCalculada(fn) {
  return async (req, res) => {
    try {
      return res.json(await fn(req));
    } catch (e) {
      if (e instanceof ApiError) return erro(res, e.status, e.code, e.message, e.detailedMessage);
      console.error(`[api-headcoach] ${req.originalUrl}:`, e.message);
      return erro(res, 500, 'InternalError', 'Erro interno ao consultar', e.message);
    }
  };
}

/** Paginação de uma lista já calculada em memória (agregações). */
export function paginarEmMemoria(req, itens, aceitos = []) {
  const estranhos = Object.keys(req.query).filter((k) => !['page', 'pageSize', ...aceitos].includes(k));
  if (estranhos.length) throw new ApiError(400, 'UnknownParameter', `Parâmetro desconhecido: ${estranhos.join(', ')}`, `Aceitos neste recurso: ${['page', 'pageSize', ...aceitos].join(', ')}.`);
  const { page, pageSize } = paginacao(req.query);
  const totalItems = itens.length;
  const totalPages = Math.ceil(totalItems / pageSize);
  const fatia = itens.slice((page - 1) * pageSize, page * pageSize);
  return { items: fatia, count: fatia.length, totalItems, totalPages, hasNext: page < totalPages, page, pageSize };
}

/** Lê TODAS as linhas de uma consulta (para agregações), de 1000 em 1000. */
export async function lerTudo(montar) {
  const out = [];
  for (let ini = 0; ; ini += 1000) {
    const { data, error } = await montar().range(ini, ini + 999);
    if (error) throw new ApiError(500, 'DatabaseError', 'Erro ao consultar o banco', error.message);
    out.push(...(data || []));
    if ((data || []).length < 1000) break;
  }
  return out;
}

export const diaRecife = (iso) => (iso ? new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Recife' }).format(new Date(iso)) : null);
export const inicioDoDia = (d) => `${d}T00:00:00${FUSO}`;
export const fimDoDia = (d) => `${d}T23:59:59.999${FUSO}`;
export const exigirPeriodo = (req, de = 'startDate', ate = 'endDate') => {
  const a = String(req.query[de] || '');
  const b = String(req.query[ate] || '');
  if (!ehDia(a) || !ehDia(b)) throw new ApiError(400, 'MissingParameter', `Informe ${de} e ${ate}`, 'Datas no formato AAAA-MM-DD.');
  if (a > b) throw new ApiError(400, 'InvalidParameter', `${de} é depois de ${ate}`);
  return { de: a, ate: b };
};
export const listaDeInteiros = (req, nome) => {
  const v = req.query[nome];
  if (v === undefined || String(v).trim() === '') return null;
  const ns = lista(v).map(Number);
  if (!ns.length || ns.some((n) => !Number.isInteger(n))) throw new ApiError(400, 'InvalidParameter', `Parâmetro "${nome}" inválido`, 'Esperada uma lista de inteiros separados por vírgula.');
  return ns;
};
export { supabase };

// ─── registro dos recursos (rotas + documentação) ────────────────────────────
/**
 * Um módulo junta os recursos de um assunto, como no TOTVS (accounts-receivable,
 * fiscal…). `registrar(router)` cria as rotas; `doc` descreve para o OpenAPI.
 */
export function criarModulo({ nome, titulo, descricao }) {
  const rotas = []; // { metodo:'get', caminho, handler, doc }
  const schemas = {};
  const prefixo = `/${nome}/${VERSAO}`;

  const schemaDe = (recurso) => {
    if (schemas[recurso.name]) return recurso.name;
    const props = {};
    for (const c of recurso.fields) props[c.name] = propriedade(c);
    for (const [k, def] of Object.entries(recurso.expand || {})) {
      props[k] = { type: 'array', description: `${def.description} (só vem com expand=${k})`, items: { $ref: `#/components/schemas/${schemaDe(def.resource)}` } };
    }
    schemas[recurso.name] = { type: 'object', description: recurso.description || recurso.summary, properties: props };
    return recurso.name;
  };

  const parametrosDe = (recurso, comPagina = true) => {
    const ps = (recurso.filters || []).map((x) => ({ name: x.name, in: 'query', required: false, description: x.description + (x.kind === 'enum' ? ` Valores: ${Object.keys(x.map).join(', ')}.` : ''), schema: tipoDoFiltro(x) }));
    if (comPagina) {
      ps.push({ name: 'page', in: 'query', required: false, description: 'Página (começa em 1).', schema: { type: 'integer', default: 1, minimum: 1 } });
      ps.push({ name: 'pageSize', in: 'query', required: false, description: `Itens por página (até ${PAGE_SIZE_MAX}).`, schema: { type: 'integer', default: PAGE_SIZE_PADRAO, minimum: 1, maximum: PAGE_SIZE_MAX } });
    }
    if (Object.keys(recurso.expand || {}).length) ps.push({ name: 'expand', in: 'query', required: false, description: `Listas extras para trazer junto, separadas por vírgula: ${Object.keys(recurso.expand).join(', ')}.`, schema: { type: 'string' } });
    return ps;
  };

  const pagina = (nomeSchema) => ({
    type: 'object',
    properties: {
      items: { type: 'array', items: { $ref: `#/components/schemas/${nomeSchema}` } },
      count: { type: 'integer', description: 'Itens nesta página.' },
      totalItems: { type: 'integer', description: 'Total de itens que atendem aos filtros.' },
      totalPages: { type: 'integer' },
      hasNext: { type: 'boolean', description: 'Há próxima página.' },
      page: { type: 'integer' },
      pageSize: { type: 'integer' },
    },
  });

  return {
    nome,
    titulo,
    descricao,
    prefixo,
    schemas,
    rotas,
    /** Lista + (se tiver chave) registro único + sub-recursos. */
    recurso(recurso) {
      const ns = schemaDe(recurso);
      rotas.push({
        caminho: `${prefixo}${recurso.path}`,
        handler: rotaLista(recurso),
        doc: { summary: recurso.summary, description: recurso.description, parameters: parametrosDe(recurso), response: pagina(ns) },
      });
      if (recurso.key?.length) {
        const sufixo = recurso.key.map((k) => `/{${k.param}}`).join('');
        rotas.push({
          caminho: `${prefixo}${recurso.path}${sufixo}`,
          express: `${prefixo}${recurso.path}${recurso.key.map((k) => `/:${k.param}`).join('')}`,
          handler: rotaUm(recurso),
          doc: {
            summary: `${recurso.summary} — um registro`,
            description: recurso.description,
            parameters: [
              ...recurso.key.map((k) => ({ name: k.param, in: 'path', required: true, description: k.description || '', schema: { type: k.type === 'integer' ? 'integer' : 'string' } })),
              ...parametrosDe({ expand: recurso.expand, filters: [] }, false),
            ],
            response: { $ref: `#/components/schemas/${ns}` },
            notFound: true,
          },
        });
      }
      for (const sub of recurso.sub || []) {
        const nsSub = schemaDe(sub.resource);
        const k = recurso.key[0];
        rotas.push({
          caminho: `${prefixo}${recurso.path}/{${k.param}}${sub.path}`,
          express: `${prefixo}${recurso.path}/:${k.param}${sub.path}`,
          handler: rotaLista(sub.resource, (qy, req) => {
            const v = k.type === 'integer' ? Number(req.params[k.param]) : req.params[k.param];
            if (k.type === 'integer' && !Number.isInteger(v)) throw new ApiError(400, 'InvalidParameter', `Parâmetro "${k.param}" inválido`, 'Esperado um número inteiro.');
            return qy.eq(sub.fk, v);
          }),
          doc: {
            summary: sub.summary,
            description: sub.description || sub.resource.description,
            parameters: [{ name: k.param, in: 'path', required: true, description: k.description || '', schema: { type: k.type === 'integer' ? 'integer' : 'string' } }, ...parametrosDe(sub.resource)],
            response: pagina(nsSub),
          },
        });
      }
      return this;
    },
    /** Rota calculada, com a documentação escrita à mão. */
    calculado({ path, express, handler, summary, description, parameters = [], schema, schemaName, paginado = true, notFound = false }) {
      if (schemaName && schema) schemas[schemaName] = schema;
      const ref = schemaName ? { $ref: `#/components/schemas/${schemaName}` } : schema;
      rotas.push({
        caminho: `${prefixo}${path}`,
        express: express ? `${prefixo}${express}` : undefined,
        handler,
        doc: {
          summary,
          description,
          parameters: [
            ...parameters,
            ...(paginado
              ? [
                  { name: 'page', in: 'query', required: false, description: 'Página (começa em 1).', schema: { type: 'integer', default: 1 } },
                  { name: 'pageSize', in: 'query', required: false, description: `Itens por página (até ${PAGE_SIZE_MAX}).`, schema: { type: 'integer', default: PAGE_SIZE_PADRAO } },
                ]
              : []),
          ],
          response: paginado ? { type: 'object', properties: { ...pagina('x').properties, items: { type: 'array', items: ref } } } : ref,
          notFound,
        },
      });
      return this;
    },
    registrar(router) {
      // rotas com parâmetro por último, para /recurso/fixo não cair em /recurso/:id
      const ordenadas = [...rotas].sort((a, b) => (a.express || a.caminho).includes(':') - (b.express || b.caminho).includes(':'));
      for (const r of ordenadas) router.get(r.express || r.caminho, r.handler);
    },
  };
}

function propriedade(c) {
  const p = { description: c.description };
  if (c.type === 'date') Object.assign(p, { type: 'string', format: 'date', example: '2026-11-18' });
  else if (c.type === 'date-time') Object.assign(p, { type: 'string', format: 'date-time', example: '2026-11-18T17:00:00+00:00' });
  else if (c.type === 'array') Object.assign(p, { type: 'array', items: c.items || {} });
  else if (c.type === 'object') Object.assign(p, { type: 'object', ...(c.properties ? { properties: c.properties } : { additionalProperties: true }) });
  else p.type = c.type;
  if (c.map) p.enum = [...new Set(Object.values(c.map))];
  if (c.enum) p.enum = c.enum;
  if (c.example !== undefined) p.example = c.example;
  p.nullable = c.nullable !== false;
  return p;
}
function tipoDoFiltro(x) {
  if (x.kind === 'int') return { type: 'integer' };
  if (x.kind === 'bool') return { type: 'boolean' };
  if (['startDate', 'endDate', 'startDay', 'endDay'].includes(x.kind)) return { type: 'string', format: 'date', example: '2026-11-18' };
  if (x.kind === 'intList') return { type: 'string', example: x.example || (/^branch/i.test(x.name) ? '95,99' : '101,102') };
  if (x.kind === 'enum') return { type: 'string', enum: Object.keys(x.map) };
  return { type: 'string', ...(x.example ? { example: x.example } : {}) };
}

// ─── OpenAPI + página de documentação ────────────────────────────────────────
export function montarOpenApi(modulos, { servidor = '' } = {}) {
  const paths = {};
  const schemas = {
    Error: {
      type: 'object',
      description: 'Erro (mesmo formato em todos os recursos).',
      properties: { code: { type: 'string', example: 'InvalidParameter' }, message: { type: 'string' }, detailedMessage: { type: 'string', nullable: true } },
    },
  };
  const tags = [];
  for (const m of modulos) {
    tags.push({ name: m.titulo, description: m.descricao });
    Object.assign(schemas, m.schemas);
    for (const r of m.rotas) {
      const respostaErro = (d, code, message) => ({ description: d, content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' }, example: { code, message, detailedMessage: null } } } });
      paths[`${BASE}${r.caminho}`] = {
        get: {
          tags: [m.titulo],
          summary: r.doc.summary,
          description: r.doc.description,
          parameters: r.doc.parameters,
          responses: {
            200: { description: 'Sucesso', content: { 'application/json': { schema: r.doc.response } } },
            400: respostaErro('Parâmetro inválido ou desconhecido', 'InvalidParameter', 'Parâmetro "page" inválido'),
            401: respostaErro('Chave de acesso ausente ou inválida', 'Unauthorized', 'Chave de acesso inválida'),
            ...(r.doc.notFound ? { 404: respostaErro('Registro não encontrado', 'NotFound', 'Registro não encontrado') } : {}),
            500: respostaErro('Erro interno', 'InternalError', 'Erro interno ao consultar'),
          },
        },
      };
    }
  }
  return {
    openapi: '3.0.3',
    info: {
      title: 'API HeadCoach — consultas',
      version: '1.0.0',
      description: [
        'API **somente leitura** dos dados que o HeadCoach gera (transações, notas fiscais, contas a receber, caixa, faturamento, devoluções, transferências, estoque…), organizada como a API do TOTVS Moda.',
        '',
        '**Endereço:** `/api/headcoach/<módulo>/v1/<recurso>` — só `GET`.',
        '',
        '**Acesso:** envie a chave em `X-API-Key: <chave>` (ou `Authorization: Bearer <chave>`).',
        '',
        '**Paginação:** `page` (começa em 1) e `pageSize` (padrão 100, até 1000). A resposta de lista é sempre `{ items, count, totalItems, totalPages, hasNext, page, pageSize }`. Para ler tudo, avance `page` enquanto `hasNext` for `true`.',
        '',
        '**Filtros:** na URL. Listas vão separadas por vírgula (`branchCodeList=95,99`). Datas em `AAAA-MM-DD`, no fuso de Recife (UTC−3). Parâmetro que o recurso não conhece devolve erro 400 — nada é ignorado em silêncio.',
        '',
        '**expand:** alguns recursos trazem listas extras junto (`expand=items,payments`).',
        '',
        '**Valores:** dinheiro em reais, com ponto decimal (`1190.5`). Datas com hora em ISO 8601 (UTC). Campo sem valor vem `null`.',
        '',
        '**Sincronização incremental:** os recursos principais aceitam `startChangeDate` (alterados desde).',
        '',
        '**Erros:** `{ code, message, detailedMessage }` com o HTTP correspondente (400, 401, 404, 500).',
      ].join('\n'),
    },
    servers: servidor ? [{ url: servidor }] : [],
    tags,
    security: [{ ApiKey: [] }, { Bearer: [] }],
    components: {
      securitySchemes: { ApiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key' }, Bearer: { type: 'http', scheme: 'bearer' } },
      schemas,
    },
    paths,
  };
}

/** Guia em texto (Markdown) para programador ou IA: o mesmo conteúdo do OpenAPI, corrido. */
export function montarGuia(modulos) {
  const L = [];
  L.push('# API HeadCoach — consultas (somente leitura)', '');
  L.push('Base: `/api/headcoach/<módulo>/v1/<recurso>` · só `GET` · chave em `X-API-Key`.', '');
  L.push('Lista: `{ items, count, totalItems, totalPages, hasNext, page, pageSize }`. Paginação: `page` (1…) e `pageSize` (padrão 100, máx. 1000).');
  L.push('Datas `AAAA-MM-DD` (fuso de Recife). Listas separadas por vírgula. Parâmetro desconhecido = erro 400. Erro: `{ code, message, detailedMessage }`.', '');
  for (const m of modulos) {
    L.push(`## ${m.titulo} — \`${m.nome}\``, '', m.descricao, '');
    for (const r of m.rotas) {
      L.push(`### GET ${BASE}${r.caminho}`, '', r.doc.summary + (r.doc.description ? ` — ${r.doc.description}` : ''), '');
      const ps = r.doc.parameters || [];
      if (ps.length) {
        L.push('Parâmetros:');
        for (const p of ps) L.push(`- \`${p.name}\` (${p.in === 'path' ? 'caminho, obrigatório' : p.schema?.type || 'string'}) — ${p.description || ''}`);
        L.push('');
      }
      const ref = r.doc.response?.properties?.items?.items?.$ref || r.doc.response?.$ref;
      if (ref) L.push(`Resposta: ${r.doc.response?.properties ? 'página de' : ''} \`${ref.split('/').pop()}\``, '');
    }
    const nomes = Object.keys(m.schemas);
    if (nomes.length) L.push('Esquemas:', '');
    for (const n of nomes) {
      L.push(`**${n}** — ${m.schemas[n].description || ''}`, '');
      for (const [k, p] of Object.entries(m.schemas[n].properties || {})) {
        const tipo = p.$ref ? p.$ref.split('/').pop() : p.type === 'array' ? `array${p.items?.$ref ? ` de ${p.items.$ref.split('/').pop()}` : ''}` : p.format || p.type;
        L.push(`- \`${k}\` (${tipo}) — ${p.description || ''}${p.enum ? ` Valores: ${p.enum.join(', ')}.` : ''}`);
      }
      L.push('');
    }
  }
  return L.join('\n');
}

export const paginaDocs = () => `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>API HeadCoach — documentação</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.17.14/swagger-ui.min.css">
<style>body{margin:0;background:#fafafa}.topbar{display:none}</style></head>
<body><div id="swagger-ui"></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.17.14/swagger-ui-bundle.min.js"></script>
<script>window.onload=function(){SwaggerUIBundle({url:'${BASE}/openapi.json',dom_id:'#swagger-ui',docExpansion:'none',defaultModelsExpandDepth:0,persistAuthorization:true,tagsSorter:function(a,b){return 0}})};</script>
</body></html>`;
