import express from 'express';
import axios from 'axios';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import cron from 'node-cron';
import evolutionPool from '../config/evolution.js';
import {
  listUazapiInstances,
  listUazapiInstancesRaw,
  uazapiGetMessages,
  uazapiSearchMessages,
  uazapiPhoneHasChat,
  uazapiLastContactForPhone,
  uazapiTurnoForInstance,
  isUazapiConfigured,
} from '../config/uazapi.js';
import {
  VAREJO_BRANCHES,
  VAREJO_BRANCH_CODES,
  getMetaMensal,
  getMetaSemanal,
  getMetaPeriodo,
} from '../config/varejoMetas.js';
import supabase from '../config/supabase.js';
import supabaseFiscal from '../config/supabaseFiscal.js';
import {
  asyncHandler,
  successResponse,
  errorResponse,
} from '../utils/errorHandler.js';
import { getToken } from '../utils/totvsTokenManager.js';
import { fetchAndMapPersons } from '../utils/syncPesPessoa.js';
import {
  getBranchCodes,
  fetchBranchTotalsFromTotvs,
} from '../totvsrouter/totvsHelper.js';

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const CLICKUP_API_KEY = process.env.CLICKUP_API_KEY || '';
const CLICKUP_LIST_ID = process.env.CLICKUP_LIST_ID || '901113004805'; // CRM 26
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

// TOTVS para buscar movimento fiscal (transações de clientes)
const TOTVS_BASE_URL =
  process.env.TOTVS_BASE_URL || 'https://www30.bhan.com.br:9443/api/totvsmoda';

const totvsHttpsAgent = new https.Agent({
  keepAlive: true,
  rejectUnauthorized: false,
  timeout: 60000,
});

// Cache em memória do ERP (evita reconsultar a cada request)
let ERP_CACHE = { data: null, timestamp: 0, key: '' };
const ERP_CACHE_TTL = 4 * 60 * 60 * 1000; // 4 horas (era 30 min)
let ERP_LOADING = false; // indica se já há uma carga em andamento
let ERP_LOADING_PROGRESS = { step: '', page: 0, total: 0 }; // progresso da carga

// Persistência em disco do cache ERP (sobrevive a restarts)
const __dirname_crm = path.dirname(fileURLToPath(import.meta.url));
const ERP_DISK_CACHE_PATH = path.join(__dirname_crm, '..', '.erp_cache.json');
const ERP_DISK_CACHE_MAX_AGE = 4 * 60 * 60 * 1000; // 4 horas

function saveErpCacheToDisk() {
  try {
    fs.writeFileSync(ERP_DISK_CACHE_PATH, JSON.stringify(ERP_CACHE), 'utf8');
    console.log('💾 [erp-cache] Cache salvo em disco.');
  } catch (e) {
    console.warn('⚠️ [erp-cache] Falha ao salvar cache em disco:', e.message);
  }
}

function loadErpCacheFromDisk() {
  try {
    if (!fs.existsSync(ERP_DISK_CACHE_PATH)) return;
    const raw = fs.readFileSync(ERP_DISK_CACHE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed?.data || !parsed?.timestamp) return;
    if (Date.now() - parsed.timestamp > ERP_DISK_CACHE_MAX_AGE) {
      console.log('💾 [erp-cache] Cache em disco expirado, ignorando.');
      return;
    }
    ERP_CACHE = parsed;
    console.log(
      `💾 [erp-cache] Cache restaurado do disco (${Math.round((Date.now() - parsed.timestamp) / 60000)}min atrás).`,
    );
  } catch (e) {
    console.warn('⚠️ [erp-cache] Falha ao carregar cache do disco:', e.message);
  }
}

// Carrega cache do disco imediatamente ao iniciar
loadErpCacheFromDisk();

// Se não há cache válido em disco, inicia pré-carga automática 8s após o boot
// (evita que o usuário espere 2min na primeira visita)
if (!ERP_CACHE.data) {
  setTimeout(() => {
    console.log(
      '🔄 [erp-cache] Nenhum cache em disco — iniciando pré-carga automática...',
    );
    carregarErpBackground('12-', 12, '');
  }, 8000);
}

// ─── Cache para ClickUp leads (TTL = 10 min) ─────────────────────────────────
const LEADS_CACHE = new Map(); // key: "de|ate" → { data, ts }
const LEADS_INFLIGHT = new Map(); // key → Promise pendente (evita race)
const LEADS_CACHE_TTL = 10 * 60 * 1000; // 10 min
let TOTVS_PHONE_PERSON_CACHE = { data: null, ts: 0 };
const TOTVS_PHONE_PERSON_CACHE_TTL = 30 * 60 * 1000; // 30 min

// ─── Cache para bearer map TOTVS (TTL = 5 min) ───────────────────────────────
const AR_BEARER_CACHE = new Map(); // key: "bc1,bc2|datemin|datemax" → { map, ts }
const AR_BEARER_CACHE_TTL = 5 * 60 * 1000; // 5 min

// ─── Busca mapa invoiceSequence → bearerName do contas a receber TOTVS ────────
// Paraleliza por filial para evitar paginação sequencial excessiva.
async function fetchARBearerMap(branchCodes, datemin, datemax) {
  if (!branchCodes.length) return new Map();

  const cacheKey = `${[...branchCodes].sort().join(',')}|${datemin}|${datemax}`;
  const cached = AR_BEARER_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.ts < AR_BEARER_CACHE_TTL) return cached.map;

  const bearerMap = new Map();
  const endpoint = `${TOTVS_BASE_URL}/accounts-receivable/v2/documents/search`;

  async function fetchBranch(branchCode) {
    try {
      const tokenData = await getToken();
      if (!tokenData?.access_token) return;
      const filter = {
        branchCodeList: [branchCode],
        startIssueDate: `${datemin}T00:00:00.000Z`,
        endIssueDate: `${datemax}T23:59:59.000Z`,
      };
      let page = 1;
      while (true) {
        const payload = { filter, page, pageSize: 100, expand: 'invoice' };
        let resp;
        try {
          resp = await axios.post(endpoint, payload, {
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${tokenData.access_token}`,
            },
            httpsAgent: totvsHttpsAgent,
            timeout: 60000,
          });
        } catch (err) {
          if (err.response?.status === 401) {
            const newTok = await getToken(true);
            resp = await axios.post(endpoint, payload, {
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${newTok.access_token}`,
              },
              httpsAgent: totvsHttpsAgent,
              timeout: 60000,
            });
          } else {
            console.error(
              `[fetchARBearerMap] branch ${branchCode}:`,
              err.message,
            );
            break;
          }
        }
        const items = resp?.data?.items || [];
        for (const item of items) {
          for (const inv of item.invoice || []) {
            const seq = inv?.invoiceSequence;
            if (seq != null && !bearerMap.has(seq)) {
              bearerMap.set(seq, item.bearerName || null);
            }
          }
        }
        if (!resp?.data?.hasNext) break;
        page++;
        if (page > 50) break;
      }
    } catch (err) {
      console.error(
        `[fetchARBearerMap] outer branch ${branchCode}:`,
        err.message,
      );
    }
  }

  // Dispara todas as filiais em paralelo com limite de concorrência e timeout global de 8s
  const sem = new Array(5).fill(Promise.resolve());
  let idx = 0;
  const allTasks = branchCodes.map((bc) => {
    const slot = idx % 5;
    idx++;
    sem[slot] = sem[slot].then(() => fetchBranch(bc));
    return sem[slot];
  });
  await Promise.race([
    Promise.all(allTasks),
    new Promise((resolve) => setTimeout(resolve, 8000)),
  ]);

  AR_BEARER_CACHE.set(cacheKey, { map: bearerMap, ts: Date.now() });
  return bearerMap;
}

// ─── Mapeamento de vendedores (Supabase + Evolution) ──────────────────────────
const VENDOR_FIELD_ID = '4280c337-3187-45ae-b35c-bf558260da53'; // ClickUp "Vendedor" dropdown
const PHONE_FIELD_ID = 'a5b29e7e-f1c6-466a-8d2b-d6b92206cf81'; // ClickUp campo de telefone (por ID)
let VENDEDORES_CACHE = { data: null, ts: 0 };
const VENDEDORES_CACHE_TTL = 30 * 60 * 1000; // 30 min

async function loadVendedoresMap() {
  if (
    VENDEDORES_CACHE.data &&
    Date.now() - VENDEDORES_CACHE.ts < VENDEDORES_CACHE_TTL
  ) {
    return VENDEDORES_CACHE.data;
  }

  const { data: vendedores, error } = await supabase
    .from('v_vendedores_integracao')
    .select('*');

  if (error) {
    console.warn('[vendedores] Erro ao carregar:', error.message);
    return VENDEDORES_CACHE.data || { byClickupId: {}, byTotvsId: {} };
  }

  const byClickupId = {};
  const byTotvsId = {};

  for (const v of vendedores) {
    const info = {
      nome: v.nome_vendedor,
      totvs_id: v.totvs_id,
      clickup_id: v.clickup_id,
      evolution_id: v.evolution_id,
      evolution_inst: null,
      modulo: v.modulo || null,
      ativo: v.ativo !== false,
    };
    if (v.clickup_id) byClickupId[v.clickup_id] = info;
    if (v.totvs_id) byTotvsId[v.totvs_id] = info;
  }

  // Resolver evolution_id UUID → nome da instância Evolution
  try {
    const uuids = vendedores
      .filter((v) => v.evolution_id)
      .map((v) => v.evolution_id);
    if (uuids.length > 0) {
      const placeholders = uuids.map((_, i) => `$${i + 1}`).join(', ');
      const result = await evolutionPool.query(
        `SELECT id, name FROM "Instance" WHERE id IN (${placeholders})`,
        uuids,
      );
      const instMap = {};
      for (const row of result.rows) instMap[row.id] = row.name;
      for (const info of Object.values(byClickupId)) {
        if (info.evolution_id && instMap[info.evolution_id]) {
          info.evolution_inst = instMap[info.evolution_id];
        }
      }
      for (const info of Object.values(byTotvsId)) {
        if (info.evolution_id && instMap[info.evolution_id]) {
          info.evolution_inst = instMap[info.evolution_id];
        }
      }
    }
  } catch (err) {
    console.warn('[vendedores] Erro ao resolver inst Evolution:', err.message);
  }

  const map = { byClickupId, byTotvsId };
  VENDEDORES_CACHE = { data: map, ts: Date.now() };
  console.log(`✅ [vendedores] ${vendedores.length} vendedores carregados`);
  return map;
}

// Para uma lista de person_codes, retorna o ÚLTIMO vendedor que atendeu
// (dealer_code da NF Output mais recente). Map<personCode, {dealer_code, dealer_name, issue_date}>.
// opts.branch:         filtra NFs por branch_code
// opts.allowedDealers: Set/Array de dealer_codes válidos (descarta NFs de outros)
// opts.opCodes:        Array de operation_codes válidos
async function getUltimoVendedorPorCliente(personCodes, opts = {}) {
  const out = new Map();
  if (!Array.isArray(personCodes) || personCodes.length === 0) return out;
  const codes = [...new Set(personCodes.map(Number).filter(Boolean))];
  if (codes.length === 0) return out;

  const branchFilter = opts.branch ? Number(opts.branch) : null;
  const allowedDealers =
    opts.allowedDealers instanceof Set
      ? opts.allowedDealers
      : Array.isArray(opts.allowedDealers)
        ? new Set(opts.allowedDealers.map(Number))
        : null;
  const opCodes = Array.isArray(opts.opCodes) ? opts.opCodes : null;

  const PAGE = 5000;
  const CHUNK = 500;
  for (let i = 0; i < codes.length; i += CHUNK) {
    const chunk = codes.slice(i, i + CHUNK);
    let offset = 0;
    while (true) {
      let q = supabaseFiscal
        .from('notas_fiscais')
        .select('person_code, dealer_code, issue_date, items, branch_code')
        .eq('operation_type', 'Output')
        .not('invoice_status', 'eq', 'Canceled')
        .not('invoice_status', 'eq', 'Deleted')
        .in('person_code', chunk)
        .order('issue_date', { ascending: false });
      if (branchFilter) q = q.eq('branch_code', branchFilter);
      if (opCodes && opCodes.length > 0) q = q.in('operation_code', opCodes);
      const { data, error } = await q.range(offset, offset + PAGE - 1);
      if (error || !data || data.length === 0) break;
      for (const nf of data) {
        const p = nf.person_code;
        if (out.has(p)) continue; // já tem (mais recente)
        // Resolve dealer dominante (do items.products) ou usa nf.dealer_code
        let dealer = nf.dealer_code;
        if (Array.isArray(nf.items) && nf.items.length > 0) {
          const netByDealer = {};
          for (const item of nf.items) {
            for (const prod of item.products || []) {
              const dc = Number(prod.dealerCode);
              if (!dc) continue;
              netByDealer[dc] =
                (netByDealer[dc] || 0) + (parseFloat(prod.netValue) || 0);
            }
          }
          const entries = Object.entries(netByDealer);
          if (entries.length > 0) {
            dealer = Number(entries.sort((a, b) => b[1] - a[1])[0][0]);
          }
        }
        // Aplica filtro de dealers permitidos (se passado)
        if (allowedDealers && !allowedDealers.has(Number(dealer))) continue;
        out.set(p, {
          dealer_code: dealer,
          issue_date: nf.issue_date,
        });
      }
      if (data.length < PAGE) break;
      offset += PAGE;
    }
  }

  // Resolve nomes dos vendedores: vendedoresMap (Supabase) → ERP cache → fallback
  try {
    const map = await loadVendedoresMap();
    const erpSellers = ERP_CACHE.data?.sellersMap || {};
    for (const [, rec] of out) {
      const code = rec.dealer_code;
      const info = map.byTotvsId?.[code];
      const erp = erpSellers[code];
      rec.dealer_name = info?.nome || erp?.name || `Vendedor ${code}`;
    }
  } catch {}

  return out;
}

function getClickupField(task, fieldName) {
  const cf = (task.custom_fields || []).find(
    (f) => f.name && f.name.toLowerCase() === fieldName.toLowerCase(),
  );
  if (!cf || cf.value == null || cf.value === '') return '';
  if (cf.type === 'drop_down' && cf.type_config?.options) {
    const opt = cf.type_config.options.find(
      (o) => String(o.orderindex) === String(cf.value) || o.id === cf.value,
    );
    return opt?.name || '';
  }
  if (cf.type === 'labels' && Array.isArray(cf.value)) {
    const opts = cf.type_config?.options || [];
    return cf.value
      .map((v) => opts.find((o) => o.id === v)?.label || v)
      .join(', ');
  }
  if (cf.type === 'users' && Array.isArray(cf.value)) {
    return cf.value.map((u) => u.username || u.email || '').join(', ');
  }
  if (cf.type === 'location' && cf.value?.formatted_address) {
    return cf.value.formatted_address;
  }
  return cf.value;
}

function getClickupDropdownOption(task, fieldId) {
  const cf = (task.custom_fields || []).find((f) => f.id === fieldId);
  if (!cf || cf.value == null || cf.value === '') return null;
  if (cf.type === 'drop_down' && cf.type_config?.options) {
    const opt = cf.type_config.options.find(
      (o) => String(o.orderindex) === String(cf.value) || o.id === cf.value,
    );
    return opt ? { name: opt.name, id: opt.id } : null;
  }
  return null;
}

// Gera todas as variações plausíveis de um telefone brasileiro para tolerar:
//  - prefixo 55 (com/sem)
//  - dígito 9 do celular (com/sem) — bug muito comum em cadastros antigos
//  - zero à esquerda no DDD (cadastros legados "083 9..." ou "83 09...")
//  - número sem DDD (8 dígitos fixo / 9 dígitos celular) — fallback fraco
// Ex.: "(83) 9 9876-5432" → ["83998765432", "5583998765432", "8398765432",
//      "558398765432", "998765432", "98765432"]
function buildPhoneVariants(rawPhone) {
  const digitsRaw = String(rawPhone || '').replace(/\D/g, '');
  if (!digitsRaw) return [];

  // Remove zeros à esquerda (DDDs legados "083")
  let digits = digitsRaw.replace(/^0+/, '');
  if (!digits) return [];

  // Normaliza para "local" (sem 55 inicial)
  let local = digits;
  if (local.startsWith('55') && (local.length === 12 || local.length === 13)) {
    local = local.slice(2);
  }

  const variants = new Set();
  const addLocal = (value) => {
    if (!value || value.length < 8) return;
    variants.add(value);
    variants.add(`55${value}`);
    // Mobile com 9: 11 dígitos (DDD + 9 + 8 dígitos)
    if (value.length === 11) {
      const ddd = value.slice(0, 2);
      const num = value.slice(2);
      // Remove o 9 do início → 10 dígitos (formato antigo)
      if (num.startsWith('9')) {
        const withoutNine = ddd + num.slice(1);
        variants.add(withoutNine);
        variants.add(`55${withoutNine}`);
        // Só os últimos 8 dígitos (fallback fraco — sem DDD nem 9)
        variants.add(num.slice(1));
      }
      // Só os últimos 9 dígitos (mobile sem DDD, com 9)
      variants.add(num);
    } else if (value.length === 10) {
      // Fixo (DDD + 8 dígitos) OU mobile antigo sem 9
      const ddd = value.slice(0, 2);
      const num = value.slice(2);
      // Adiciona o 9 (assume que pode ser celular antigo sem 9)
      const withNine = ddd + '9' + num;
      variants.add(withNine);
      variants.add(`55${withNine}`);
      // Só os últimos 8 dígitos (sem DDD)
      variants.add(num);
    } else if (value.length === 9) {
      // Mobile sem DDD (com 9) — fallback
      variants.add(value);
      if (value.startsWith('9')) variants.add(value.slice(1));
    } else if (value.length === 8) {
      // Fixo sem DDD — fallback fraco
      variants.add(value);
      variants.add(`9${value}`);
    }
  };

  // Adiciona o local se tiver tamanho plausível (8-11 dígitos)
  if (local.length >= 8 && local.length <= 11) addLocal(local);
  // Também tenta variar a partir dos últimos 11 / 10 dígitos (caso tenha lixo)
  if (digits.length >= 11) addLocal(digits.slice(-11));
  if (digits.length >= 10) addLocal(digits.slice(-10));
  if (digits.length >= 9) addLocal(digits.slice(-9));
  if (digits.length >= 8) addLocal(digits.slice(-8));

  variants.add(digits);
  if (digits.startsWith('55') && digits.length > 2)
    variants.add(digits.slice(2));

  return [...variants].filter((v) => v && v.length >= 8);
}

function isClosedClickupStatus(status) {
  const normalized = String(status || '')
    .trim()
    .toLowerCase();
  if (!normalized) return false;
  return (
    normalized.includes('fechado') ||
    normalized === 'closed' ||
    normalized === 'comprou'
  );
}

async function loadClickupLeads({
  de = null,
  ate = null,
  allHistory = false,
  forceRefresh = false,
} = {}) {
  if (!CLICKUP_API_KEY || !CLICKUP_LIST_ID) {
    return {
      total: 0,
      canais: [],
      message:
        'ClickUp não configurado (CLICKUP_API_KEY / CLICKUP_LIST_ID ausente)',
    };
  }

  if (!allHistory && (!de || !ate)) {
    throw new Error('Período do ClickUp inválido');
  }

  const leadsCacheKey = allHistory ? '__all__' : `${de}|${ate}`;
  if (forceRefresh) {
    LEADS_CACHE.delete(leadsCacheKey);
    LEADS_INFLIGHT.delete(leadsCacheKey);
  }
  const cachedLeads = LEADS_CACHE.get(leadsCacheKey);
  if (cachedLeads && Date.now() - cachedLeads.ts < LEADS_CACHE_TTL) {
    return cachedLeads.data;
  }
  // Se já tem fetch em curso pra essa chave, aguarda o mesmo resultado
  // (evita N requisições paralelas do mesmo allHistory).
  if (LEADS_INFLIGHT.has(leadsCacheKey)) {
    return LEADS_INFLIGHT.get(leadsCacheKey);
  }

  const dMs = allHistory ? null : new Date(de).getTime();
  const aMs = allHistory ? null : new Date(ate).getTime() + 86400000 - 1;
  let vendedoresMap;
  try {
    vendedoresMap = await loadVendedoresMap();
  } catch (e) {
    console.warn('[leads] Erro ao carregar vendedores:', e.message);
    vendedoresMap = { byClickupId: {}, byTotvsId: {} };
  }

  const fetchPage = async (page) => {
    const { data } = await axios.get(
      `https://api.clickup.com/api/v2/list/${CLICKUP_LIST_ID}/task`,
      {
        params: {
          subtasks: true,
          include_closed: true,
          page,
          order_by: 'created',
          reverse: true,
          ...(allHistory
            ? {}
            : {
                date_created_gt: dMs,
                date_created_lt: aMs,
              }),
        },
        headers: { Authorization: CLICKUP_API_KEY },
        timeout: 30000,
      },
    );
    return data.tasks || [];
  };

  const firstPage = await fetchPage(0);
  const allTasks = [...firstPage];

  if (firstPage.length >= 100) {
    const CONCURRENCY = 5;
    const MAX_PAGES = 200; // 200 × 100 = 20.000 leads máx
    let page = 1;
    let keepGoing = true;
    while (keepGoing && page < MAX_PAGES) {
      const batch = Array.from(
        { length: CONCURRENCY },
        (_, i) => page + i,
      ).filter((p) => p < MAX_PAGES);
      const results = await Promise.all(batch.map((p) => fetchPage(p)));
      for (const tasks of results) {
        allTasks.push(...tasks);
        if (tasks.length < 100) {
          keepGoing = false;
          break;
        }
      }
      page += CONCURRENCY;
    }
  }

  console.log(
    `📋 leads: ${allTasks.length} tarefas em ${Math.ceil(allTasks.length / 100)} páginas`,
  );

  const canaisMap = {};
  for (const task of allTasks) {
    const categoria =
      getClickupField(task, 'Categoria do Lead') || 'Sem Categoria';
    const vendedorOpt = getClickupDropdownOption(task, VENDOR_FIELD_ID);
    const vendedorInfo = vendedorOpt?.id
      ? vendedoresMap.byClickupId[vendedorOpt.id] || null
      : null;
    // Busca telefone: primeiro pelo ID fixo do campo, depois fallback por nome
    const telefoneById = (() => {
      const cf = (task.custom_fields || []).find(
        (f) => f.id === PHONE_FIELD_ID,
      );
      return cf?.value ? String(cf.value) : '';
    })();
    const telefone =
      telefoneById ||
      getClickupField(task, 'Telefone Pessoal') ||
      getClickupField(task, 'Telefone') ||
      getClickupField(task, 'Phone') ||
      '';

    if (!canaisMap[categoria]) {
      canaisMap[categoria] = { nome: categoria, tarefas: [] };
    }

    // Safra (campo do "passo a passo"): tenta variações comuns
    const safra =
      getClickupField(task, 'SAFRA') ||
      getClickupField(task, 'Safra') ||
      getClickupField(task, 'safra') ||
      '';

    canaisMap[categoria].tarefas.push({
      id: task.id,
      nome: task.name || '',
      telefone: String(telefone).replace(/\D/g, ''),
      vendedor: vendedorOpt?.name || '',
      vendedorClickupId: vendedorOpt?.id || '',
      vendedorTotvsId: vendedorInfo?.totvs_id || '',
      vendedorEvolutionInst: vendedorInfo?.evolution_inst || '',
      vendedorModulo: vendedorInfo?.modulo || '',
      status: task.status?.status || '',
      origem:
        getClickupField(task, 'Origem') ||
        getClickupField(task, 'origem') ||
        '',
      qualidade:
        getClickupField(task, 'MQL') ||
        getClickupField(task, 'qualidade') ||
        '',
      etiqueta: getClickupField(task, 'ETIQUETA') || '',
      cidade: getClickupField(task, 'CIDADE') || '',
      estado:
        getClickupField(task, 'ESTADO') ||
        getClickupField(task, 'ESTADO OFC') ||
        '',
      safra: typeof safra === 'string' ? safra : String(safra ?? ''),
      dataCriacao: task.date_created
        ? new Date(Number(task.date_created)).toISOString()
        : '',
      closerInst: vendedorInfo?.evolution_inst || '',
      lojaInst: '',
      canalDetalhe: categoria,
      clickupUrl: task.url || `https://app.clickup.com/t/${task.id}`,
    });
  }

  const responseData = {
    total: allTasks.length,
    canais: Object.values(canaisMap),
  };

  LEADS_CACHE.set(leadsCacheKey, { data: responseData, ts: Date.now() });
  if (LEADS_CACHE.size > 5) {
    const oldest = [...LEADS_CACHE.entries()].sort(
      (a, b) => a[1].ts - b[1].ts,
    )[0];
    LEADS_CACHE.delete(oldest[0]);
  }

  return responseData;
}

// Extrai TODOS os telefones de um registro pes_pessoa:
//  - campo telefone (primário)
//  - phones[] JSONB (todos os telefones secundários, incl. WhatsApp)
function extractAllPhonesFromPessoa(row) {
  const all = new Set();
  if (row.telefone) all.add(String(row.telefone));
  if (Array.isArray(row.phones)) {
    for (const p of row.phones) {
      if (!p) continue;
      // Combina DDD + number quando presente; senão usa número solto
      const ddd = p.ddd ? String(p.ddd) : '';
      const num = p.number || p.phoneNumber || '';
      if (num) {
        all.add(`${ddd}${num}`);
        all.add(String(num));
      }
    }
  }
  return [...all];
}

async function loadTotvsPhonePersonMap() {
  if (
    TOTVS_PHONE_PERSON_CACHE.data &&
    Date.now() - TOTVS_PHONE_PERSON_CACHE.ts < TOTVS_PHONE_PERSON_CACHE_TTL
  ) {
    return TOTVS_PHONE_PERSON_CACHE.data;
  }

  // Map: variantKey → [{code, name, source: 'primary'|'array'}]
  const phoneMap = new Map();
  const PAGE = 10000;
  let offset = 0;
  let totalPessoasComTelefone = 0;
  let totalTelefonesIndexados = 0;

  while (true) {
    // NOTA: NÃO filtra por telefone na query (Supabase OR + JSONB tem
    // comportamento inconsistente). Filtramos em JS após o fetch.
    const { data: rows, error } = await supabase
      .from('pes_pessoa')
      .select('code, nm_pessoa, fantasy_name, telefone, phones')
      .range(offset, offset + PAGE - 1);

    if (error) {
      throw new Error(error.message || 'Erro ao carregar telefones do TOTVS');
    }
    if (!rows || rows.length === 0) break;

    for (const row of rows) {
      const code = Number(row.code);
      if (!code) continue;
      const allPhones = extractAllPhonesFromPessoa(row);
      if (allPhones.length === 0) continue;
      totalPessoasComTelefone++;
      totalTelefonesIndexados += allPhones.length;

      const person = {
        code,
        name: row.fantasy_name || row.nm_pessoa || `Cliente ${code}`,
      };

      // Indexa TODAS as variantes de TODOS os telefones desta pessoa
      const seenVariants = new Set();
      for (const rawPhone of allPhones) {
        for (const variant of buildPhoneVariants(rawPhone)) {
          if (seenVariants.has(variant)) continue;
          seenVariants.add(variant);
          if (!phoneMap.has(variant)) phoneMap.set(variant, []);
          const list = phoneMap.get(variant);
          if (!list.some((item) => item.code === code)) list.push(person);
        }
      }
    }

    if (rows.length < PAGE) break;
    offset += PAGE;
  }

  TOTVS_PHONE_PERSON_CACHE = { data: phoneMap, ts: Date.now() };
  console.log(
    `✅ [totvs-phones] ${phoneMap.size} variantes únicas indexadas ` +
      `(${totalPessoasComTelefone} pessoas, ${totalTelefonesIndexados} telefones brutos)`,
  );
  return phoneMap;
}

async function findTotvsPeopleByPhone(rawPhone, cache = new Map()) {
  const cacheKey = String(rawPhone || '').replace(/\D/g, '');
  if (!cacheKey) return [];
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const variants = buildPhoneVariants(rawPhone);
  if (variants.length === 0) {
    cache.set(cacheKey, []);
    return [];
  }

  const orFilter = variants.map((value) => `telefone.eq.${value}`).join(',');
  const { data, error } = await supabase
    .from('pes_pessoa')
    .select('code, nm_pessoa, fantasy_name, telefone')
    .or(orFilter)
    .limit(10);

  if (error) {
    throw new Error(error.message || 'Erro ao buscar telefone no TOTVS');
  }

  const dedup = new Map();
  for (const row of data || []) {
    const code = Number(row.code);
    if (!code || dedup.has(code)) continue;
    dedup.set(code, {
      code,
      name: row.fantasy_name || row.nm_pessoa || `Cliente ${code}`,
      phone: row.telefone || '',
    });
  }

  const result = [...dedup.values()];
  cache.set(cacheKey, result);
  return result;
}

// Operações TOTVS válidas para considerar "compra real" do cliente.
// Usadas para classificar cliente como Ativo/A Inativar/Inativo.
const OPERACOES_VAREJO = [
  545, 546, 9001, 9009, 510, 521, 511, 522, 9017, 9027, 1,
];
const OPERACOES_REVENDA = [
  5102, 5202, 1407, 9120, 9121, 9122, 9113, 9111, 9001, 9009, 9061, 9067, 9400,
  9401, 9420, 9404, 7806, 7809, 7236, 7242, 512,
];

// Operações por módulo: usadas para FILTRAR transações ao classificar cliente.
const OPERACOES_POR_MODULO = {
  varejo: OPERACOES_VAREJO,
  revenda: OPERACOES_REVENDA,
  multimarcas: OPERACOES_REVENDA, // multimarcas usa as mesmas de revenda
  business: OPERACOES_REVENDA, // business idem
  franquia: OPERACOES_REVENDA, // franquia idem
};
const OPERACOES_VALIDAS = new Set([...OPERACOES_VAREJO, ...OPERACOES_REVENDA]);

// ---------------------------------------------------------------------------
// 0. GET /api/crm/instances
//    Lista unificada de instâncias WhatsApp (Evolution + UAzapi).
//    Cada item: { name, label, provider, status?, owner? }
// ---------------------------------------------------------------------------
router.get(
  '/instances',
  asyncHandler(async (req, res) => {
    // Evolution: lê do Postgres
    const evolutionList = [];
    try {
      const r = await evolutionPool.query(
        'SELECT name FROM "Instance" ORDER BY name',
      );
      for (const row of r.rows) {
        evolutionList.push({
          name: row.name,
          label: row.name,
          provider: 'evolution',
        });
      }
    } catch (err) {
      console.warn('[instances] Evolution falhou:', err.message);
    }

    // UAzapi
    let uazapiList = [];
    if (isUazapiConfigured()) {
      try {
        uazapiList = await listUazapiInstances();
      } catch (err) {
        console.warn('[instances] UAzapi falhou:', err.message);
      }
    }

    // Merge e remove duplicidades por name (provider Evolution prevalece)
    const seen = new Set();
    const merged = [];
    for (const i of [...evolutionList, ...uazapiList]) {
      const key = String(i.name).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(i);
    }

    return successResponse(res, { instances: merged });
  }),
);

// ---------------------------------------------------------------------------
// 0b. GET /api/crm/lead-instances/:phone
//    Para um telefone, retorna instâncias (Evolution + UAzapi) que tem chat,
//    formato unificado: [{name, provider, count?}].
// ---------------------------------------------------------------------------
router.get(
  '/lead-instances/:phone',
  asyncHandler(async (req, res) => {
    let phone = (req.params.phone || '').replace(/\D/g, '');
    if (!phone || phone.length < 10) {
      return errorResponse(res, 'Telefone inválido', 400);
    }
    if (!phone.startsWith('55')) phone = '55' + phone;

    const out = [];

    // Evolution (Postgres)
    try {
      const r = await evolutionPool.query(
        `SELECT i.name AS name, COUNT(*)::int AS count
         FROM "Message" m
         LEFT JOIN "Instance" i ON i.id = m."instanceId"
         WHERE m.msisdn_55_v2 = $1
         GROUP BY i.name
         ORDER BY count DESC`,
        [phone],
      );
      for (const row of r.rows) {
        if (!row.name) continue;
        out.push({
          name: row.name,
          provider: 'evolution',
          count: row.count,
        });
      }
    } catch (err) {
      console.warn('[lead-instances] Evolution falhou:', err.message);
    }

    // UAzapi: checa cada instância em paralelo
    if (isUazapiConfigured()) {
      try {
        const list = await listUazapiInstancesRaw();
        const checks = await Promise.allSettled(
          list.map(async (i) => {
            const { exists } = await uazapiPhoneHasChat(i.name, phone);
            return { name: i.name, exists };
          }),
        );
        for (const r of checks) {
          if (r.status !== 'fulfilled') continue;
          if (!r.value.exists) continue;
          out.push({
            name: r.value.name,
            provider: 'uazapi',
            count: null,
          });
        }
      } catch (err) {
        console.warn('[lead-instances] UAzapi falhou:', err.message);
      }
    }

    return successResponse(res, { instances: out, phone });
  }),
);

// ---------------------------------------------------------------------------
// 0c. POST /api/crm/uazapi-last-contacts
//    Para um array de telefones, retorna { phone: { last_ts, instance } }
//    com o timestamp da mensagem mais recente em qualquer instância UAzapi
//    conectada. Usado on-demand pela aba Último Contato.
// ---------------------------------------------------------------------------
router.post(
  '/uazapi-last-contacts',
  asyncHandler(async (req, res) => {
    const { phones } = req.body;
    if (!Array.isArray(phones) || phones.length === 0) {
      return errorResponse(res, 'phones obrigatório', 400, 'MISSING_PHONES');
    }
    if (!isUazapiConfigured()) {
      return successResponse(res, {});
    }

    // Normaliza
    const norm = phones
      .map((p) => String(p).replace(/\D/g, ''))
      .filter(Boolean);

    const out = {};
    const CONC = 5;
    for (let i = 0; i < norm.length; i += CONC) {
      const batch = norm.slice(i, i + CONC);
      const results = await Promise.allSettled(
        batch.map(async (p) => ({
          phone: p,
          best: await uazapiLastContactForPhone(p),
        })),
      );
      for (const r of results) {
        if (r.status !== 'fulfilled' || !r.value.best) continue;
        out[r.value.phone] = {
          last_ts: r.value.best.ts,
          instance: r.value.best.instance,
        };
      }
    }
    return successResponse(res, out);
  }),
);

// ---------------------------------------------------------------------------
// 1. POST /api/crm/inst-check-bulk
//    Verifica em quais instâncias cada telefone tem mensagens
// ---------------------------------------------------------------------------
router.post(
  '/inst-check-bulk',
  asyncHandler(async (req, res) => {
    const { phones } = req.body;

    if (!phones || !Array.isArray(phones) || phones.length === 0) {
      return errorResponse(
        res,
        'phones deve ser um array com pelo menos um número',
        400,
      );
    }

    // Normalizar telefones (garantir prefixo 55)
    const normalized = phones.map((p) => {
      const clean = String(p).replace(/\D/g, '');
      return clean.startsWith('55') ? clean : '55' + clean;
    });

    const placeholders = normalized.map((_, i) => `$${i + 1}`).join(', ');

    // Usa msisdn_55_v2 (normalizado, tolera com/sem 9) e MAX(messageTimestamp) por instância
    const result = await evolutionPool.query(
      `SELECT
        m.msisdn_55_v2 AS phone,
        i.name AS instance_name,
        COUNT(*)::int AS total,
        MAX(m."messageTimestamp")::bigint AS last_ts
      FROM "Message" m
      JOIN "Instance" i ON i.id = m."instanceId"
      WHERE m.msisdn_55_v2 IN (${placeholders})
      GROUP BY m.msisdn_55_v2, i.name`,
      normalized,
    );

    // Agrupar por telefone
    const map = {};
    for (const phone of normalized) {
      map[phone] = {
        closer: 0,
        prosp: 0,
        instances: [],
        last_ts: 0,
        last_inst: null,
      };
    }

    for (const row of result.rows) {
      const phone = row.phone;
      if (!map[phone]) continue;
      map[phone].instances.push(row.instance_name);
      map[phone][row.instance_name] = row.total;

      // Classificar: instâncias com "prosp" no nome contam como prosp, resto closer
      if (row.instance_name.toLowerCase().includes('prosp')) {
        map[phone].prosp += row.total;
      } else {
        map[phone].closer += row.total;
      }

      // Evolution armazena messageTimestamp em segundos; normaliza para ms
      const tsRaw = Number(row.last_ts) || 0;
      const ts = tsRaw > 0 && tsRaw < 1e12 ? tsRaw * 1000 : tsRaw;
      if (ts > map[phone].last_ts) {
        map[phone].last_ts = ts;
        map[phone].last_inst = row.instance_name;
      }
    }

    return successResponse(res, map);
  }),
);

// ---------------------------------------------------------------------------
// 1c. POST /api/crm/leads-totvs-match
//     Cruzamento bulk: telefones de leads → pes_pessoa → notas_fiscais.
//     Body: { phones: ['82987402471', ...] }
//     Resposta: { [phone]: {
//                   matched, person_code?, person_name?,
//                   has_purchase, purchase_count, purchase_total, last_purchase_date
//               } }
// ---------------------------------------------------------------------------
router.post(
  '/leads-totvs-match',
  asyncHandler(async (req, res) => {
    const { phones } = req.body;
    if (!Array.isArray(phones) || phones.length === 0) {
      return errorResponse(res, 'phones obrigatório', 400, 'MISSING_PHONES');
    }

    // 1) Variantes de telefone (com/sem 9, com/sem 55) por phone original
    const phoneToVariants = new Map();
    const allVariants = new Set();
    for (const p of phones) {
      const clean = String(p).replace(/\D/g, '');
      if (!clean) continue;
      const vs = buildPhoneVariants(clean);
      phoneToVariants.set(clean, vs);
      vs.forEach((v) => allVariants.add(v));
    }

    // 2) Bulk lookup pes_pessoa por telefone
    const telToPersons = new Map(); // telefone → [{code, name}]
    const variantList = [...allVariants];
    for (let i = 0; i < variantList.length; i += 1000) {
      const chunk = variantList.slice(i, i + 1000);
      const { data, error } = await supabase
        .from('pes_pessoa')
        .select('code, nm_pessoa, fantasy_name, telefone')
        .in('telefone', chunk);
      if (error) {
        return errorResponse(res, error.message, 500, 'SUPABASE_ERROR');
      }
      for (const row of data || []) {
        const tel = row.telefone;
        if (!tel) continue;
        if (!telToPersons.has(tel)) telToPersons.set(tel, []);
        telToPersons.get(tel).push({
          code: Number(row.code),
          name: row.fantasy_name || row.nm_pessoa || `Cliente ${row.code}`,
        });
      }
    }

    // 3) Coleta person_codes únicos
    const allCodes = new Set();
    for (const arr of telToPersons.values()) {
      for (const p of arr) if (p.code) allCodes.add(p.code);
    }

    // 4) Bulk lookup notas_fiscais (Output, não canceladas) por person_code
    const codePurchase = new Map();
    const codesList = [...allCodes];
    const NF_CHUNK = 500;
    for (let i = 0; i < codesList.length; i += NF_CHUNK) {
      const chunk = codesList.slice(i, i + NF_CHUNK);
      let offset = 0;
      const PAGE = 5000;
      while (true) {
        const { data, error } = await supabaseFiscal
          .from('notas_fiscais')
          .select('person_code, issue_date, total_value')
          .eq('operation_type', 'Output')
          .not('invoice_status', 'eq', 'Canceled')
          .not('invoice_status', 'eq', 'Deleted')
          .in('person_code', chunk)
          .range(offset, offset + PAGE - 1);
        if (error) {
          return errorResponse(res, error.message, 500, 'FISCAL_ERROR');
        }
        if (!data || data.length === 0) break;
        for (const nf of data) {
          const c = nf.person_code;
          if (!codePurchase.has(c)) {
            codePurchase.set(c, { count: 0, total: 0, last: null });
          }
          const rec = codePurchase.get(c);
          rec.count += 1;
          rec.total += parseFloat(nf.total_value) || 0;
          if (!rec.last || nf.issue_date > rec.last) {
            rec.last = nf.issue_date;
          }
        }
        if (data.length < PAGE) break;
        offset += PAGE;
      }
    }

    // 5) Monta resposta por phone original
    const out = {};
    for (const p of phones) {
      const clean = String(p).replace(/\D/g, '');
      if (!clean) {
        out[p] = { matched: false };
        continue;
      }
      const variants = phoneToVariants.get(clean) || [];
      let person = null;
      for (const v of variants) {
        const arr = telToPersons.get(v);
        if (arr && arr.length > 0) {
          person = arr[0];
          break;
        }
      }
      if (!person) {
        out[clean] = { matched: false };
        continue;
      }
      const rec = codePurchase.get(person.code);
      out[clean] = {
        matched: true,
        person_code: person.code,
        person_name: person.name,
        has_purchase: !!rec,
        purchase_count: rec?.count || 0,
        purchase_total: Math.round((rec?.total || 0) * 100) / 100,
        last_purchase_date: rec?.last || null,
      };
    }

    return successResponse(res, out);
  }),
);

// ---------------------------------------------------------------------------
// 0e. POST /api/crm/cashback-balances
//     Consulta saldo de bonus/cashback no TOTVS para uma lista de clientes.
//     Body: { persons: [{ code, branches?: [int] }] }
//          - code: person_code (Supabase pes_pessoa)
//          - branches: lista opcional de branchCodes; default = filiais varejo
//     Retorna: { [code]: { cpf, balance, raw } }
//     Apenas clientes com balance > 0 são incluídos.
// ---------------------------------------------------------------------------
router.post(
  '/cashback-balances',
  asyncHandler(async (req, res) => {
    const { persons, modulo } = req.body;
    if (!Array.isArray(persons) || persons.length === 0) {
      return errorResponse(res, 'persons obrigatório', 400, 'MISSING_PERSONS');
    }

    // 0) Em revenda: filtra persons pra quem tem NF com ops de revenda em
    // QUALQUER filial 1-990 (não só 99 — cobre vendas em CD, JPA, etc).
    let personsFiltered = persons;
    if (modulo === 'revenda') {
      const REVENDA_OPS = [7236, 9122, 5102, 7242, 9061, 9001, 9121];
      const inputCodes = [
        ...new Set(persons.map((p) => Number(p.code)).filter(Boolean)),
      ];
      const compradoresSet = new Set();
      const PAGE = 5000;
      const CHUNK = 500;
      for (let i = 0; i < inputCodes.length; i += CHUNK) {
        const chunk = inputCodes.slice(i, i + CHUNK);
        let offset = 0;
        while (true) {
          const { data: nfs } = await supabaseFiscal
            .from('notas_fiscais')
            .select('person_code')
            .eq('operation_type', 'Output')
            .not('invoice_status', 'eq', 'Canceled')
            .not('invoice_status', 'eq', 'Deleted')
            .gt('branch_code', 0)
            .lt('branch_code', 991)
            .in('operation_code', REVENDA_OPS)
            .in('person_code', chunk)
            .range(offset, offset + PAGE - 1);
          if (!nfs || nfs.length === 0) break;
          for (const n of nfs) compradoresSet.add(Number(n.person_code));
          if (nfs.length < PAGE) break;
          offset += PAGE;
        }
      }
      personsFiltered = persons.filter((p) =>
        compradoresSet.has(Number(p.code)),
      );
    }

    if (personsFiltered.length === 0) {
      return successResponse(res, { total: 0, clientes: {} });
    }

    // 1) Bulk lookup CPF + telefone por person_code
    const codes = [
      ...new Set(personsFiltered.map((p) => Number(p.code)).filter(Boolean)),
    ];
    const codeToCpf = new Map();
    const codeToName = new Map();
    const codeToFone = new Map();
    for (let i = 0; i < codes.length; i += 500) {
      const chunk = codes.slice(i, i + 500);
      const { data, error } = await supabase
        .from('pes_pessoa')
        .select('code, cpf, nm_pessoa, fantasy_name, telefone')
        .in('code', chunk);
      if (error) {
        return errorResponse(res, error.message, 500, 'SUPABASE_ERROR');
      }
      for (const row of data || []) {
        const cpf = String(row.cpf || '').replace(/\D/g, '');
        if (cpf) codeToCpf.set(Number(row.code), cpf);
        codeToName.set(
          Number(row.code),
          row.fantasy_name || row.nm_pessoa || `Cliente ${row.code}`,
        );
        if (row.telefone) {
          codeToFone.set(Number(row.code), String(row.telefone));
        }
      }
    }

    // 2) Token TOTVS
    const tokenData = await getToken();
    if (!tokenData?.access_token) {
      return errorResponse(
        res,
        'Não foi possível obter token TOTVS',
        503,
        'TOKEN_UNAVAILABLE',
      );
    }
    let token = tokenData.access_token;

    // Branches default (varejo) — caso o front não passe
    const defaultBranches = [
      2, 5, 55, 65, 87, 88, 90, 93, 94, 95, 97, 98, 99, 1,
    ].map((c) => ({ branchCode: c }));

    // 3) Concurrent fetch — limit pra não estourar TOTVS
    const out = {};
    const CONC = 6;
    for (let i = 0; i < personsFiltered.length; i += CONC) {
      const batch = personsFiltered.slice(i, i + CONC);
      await Promise.allSettled(
        batch.map(async (p) => {
          const code = Number(p.code);
          const cpf = codeToCpf.get(code);
          if (!cpf) return;
          const branchList =
            Array.isArray(p.branches) && p.branches.length
              ? p.branches.map((c) => ({ branchCode: Number(c) }))
              : defaultBranches;
          try {
            const { data } = await axios.post(
              `${TOTVS_BASE_URL}/person/v2/list-balance-bonus`,
              { personCpf: cpf, branchList },
              {
                headers: {
                  Authorization: `Bearer ${token}`,
                  'Content-Type': 'application/json',
                },
                httpsAgent: totvsHttpsAgent,
                timeout: 20000,
              },
            );
            // Resposta TOTVS: { balanceBonus: [{ branchCode, branchCnpj, balanceValue }] }
            const items = Array.isArray(data?.balanceBonus)
              ? data.balanceBonus
              : Array.isArray(data?.items)
                ? data.items
                : [];
            let balance = 0;
            const breakdown = [];
            for (const it of items) {
              const v = Number(it?.balanceValue) || Number(it?.balance) || 0;
              if (v > 0) {
                balance += v;
                breakdown.push({
                  branchCode: it.branchCode,
                  branchCnpj: it.branchCnpj,
                  balance: v,
                });
              }
            }
            if (balance > 0) {
              out[code] = {
                code,
                cpf,
                nome: codeToName.get(code) || '',
                telefone: codeToFone.get(code) || '',
                balance: Math.round(balance * 100) / 100,
                breakdown,
              };
            }
          } catch (err) {
            if (err.response?.status === 401) {
              try {
                const t = await getToken(true);
                token = t.access_token;
              } catch {}
            }
            // ignora erros individuais; cliente fica sem saldo
          }
        }),
      );
    }

    // Enriquece com último vendedor que atendeu cada cliente.
    // Cashback é usado só em revenda → filtra branch 99 + dealers canônicos + ops revenda.
    try {
      const ultMap = await getUltimoVendedorPorCliente(
        Object.keys(out).map(Number),
        {
          branch: 99,
          allowedDealers: new Set([25, 15, 161, 165, 241]),
          opCodes: [7236, 9122, 5102, 7242, 9061, 9001, 9121],
        },
      );
      for (const code of Object.keys(out)) {
        const u = ultMap.get(Number(code));
        if (u) {
          out[code].ultimo_vendedor = {
            dealer_code: u.dealer_code,
            dealer_name: u.dealer_name,
            issue_date: u.issue_date,
          };
        }
      }
    } catch (err) {
      console.warn('[cashback] último vendedor falhou:', err.message);
    }

    return successResponse(res, {
      total: Object.keys(out).length,
      clientes: out,
    });
  }),
);

// ---------------------------------------------------------------------------
// 0d. GET /api/crm/aniversariantes-hoje
//     Retorna clientes (is_customer=true) com aniversário no dia.
//     Query opcional: ?date=YYYY-MM-DD (default: hoje em America/Sao_Paulo).
// ---------------------------------------------------------------------------
router.get(
  '/aniversariantes-hoje',
  asyncHandler(async (req, res) => {
    let target;
    if (req.query.date && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)) {
      target = new Date(req.query.date + 'T12:00:00-03:00');
    } else {
      // hoje em America/Sao_Paulo
      const now = new Date();
      target = new Date(
        now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }),
      );
    }
    const month = target.getMonth() + 1;
    const day = target.getDate();
    // Opcional: ?branch=99 → só clientes que compraram naquela filial
    const branchFilter = req.query.branch ? Number(req.query.branch) : null;

    const { data, error } = await supabase.rpc('aniversariantes_do_dia', {
      target_month: month,
      target_day: day,
    });
    if (error) {
      return errorResponse(res, error.message, 500, 'SUPABASE_ERROR');
    }

    // Filtra: para revenda (branch=99 sinaliza modo revenda), inclui clientes que
    // compraram em QUALQUER filial 1-990 com operação de revenda.
    // Para outras branches, mantém o filtro tradicional por filial específica.
    const REVENDA_OP_CODES = [7236, 9122, 5102, 7242, 9061, 9001, 9121];
    let filtered = data || [];
    // lastPurchaseMap: person_code → MAX(issue_date) in revenda (pra status)
    const lastPurchaseMap = new Map();

    if (branchFilter && filtered.length > 0) {
      const codes = filtered.map((p) => Number(p.code)).filter(Boolean);
      const compradoresSet = new Set();
      const PAGE = 5000;
      const CHUNK = 500;
      const isRevendaMode = branchFilter === 99;
      for (let i = 0; i < codes.length; i += CHUNK) {
        const chunk = codes.slice(i, i + CHUNK);
        let offset = 0;
        while (true) {
          let q = supabaseFiscal
            .from('notas_fiscais')
            .select('person_code, issue_date')
            .eq('operation_type', 'Output')
            .not('invoice_status', 'eq', 'Canceled')
            .not('invoice_status', 'eq', 'Deleted')
            .in('person_code', chunk);
          if (isRevendaMode) {
            // Modo revenda: TODAS branches 1-990 + ops de revenda
            q = q
              .gt('branch_code', 0)
              .lt('branch_code', 991)
              .in('operation_code', REVENDA_OP_CODES);
          } else {
            // Modo padrão: filial específica
            q = q.eq('branch_code', branchFilter);
          }
          const { data: nfs, error: nfErr } = await q.range(
            offset,
            offset + PAGE - 1,
          );
          if (nfErr || !nfs || nfs.length === 0) break;
          for (const n of nfs) {
            const pc = Number(n.person_code);
            compradoresSet.add(pc);
            const prev = lastPurchaseMap.get(pc);
            if (!prev || n.issue_date > prev) {
              lastPurchaseMap.set(pc, n.issue_date);
            }
          }
          if (nfs.length < PAGE) break;
          offset += PAGE;
        }
      }
      filtered = filtered.filter((p) => compradoresSet.has(Number(p.code)));
    }

    // Regras de status (mesmas do CarteiraView)
    const STATUS_REGRAS = {
      revenda: { alerta: 60, inativo: 90 },
      multimarcas: { alerta: 180, inativo: 210 },
      varejo: { alerta: 180, inativo: 210 },
    };
    const statusModulo = branchFilter === 99 ? 'revenda' : 'varejo';
    const regras = STATUS_REGRAS[statusModulo];
    const hojeMs = Date.now();

    // Calcula idade (se ano ≥ 1900) e formata.
    const out = filtered.map((p) => {
      let idade = null;
      if (p.dt_nascimento) {
        const birth = new Date(p.dt_nascimento);
        const now = new Date();
        idade = now.getFullYear() - birth.getFullYear();
        const ainda =
          now.getMonth() < birth.getMonth() ||
          (now.getMonth() === birth.getMonth() &&
            now.getDate() < birth.getDate());
        if (ainda) idade -= 1;
      }
      // Status do cliente baseado em última compra (modo revenda)
      const lastDate = lastPurchaseMap.get(Number(p.code));
      let status = 'inativo';
      let dias = null;
      if (lastDate) {
        dias = Math.floor((hojeMs - new Date(lastDate).getTime()) / 86400000);
        if (dias < regras.alerta) status = 'ativo';
        else if (dias < regras.inativo) status = 'aInativar';
        else status = 'inativo';
      }
      return {
        code: p.code,
        nome: p.fantasy_name || p.nm_pessoa || `Cliente ${p.code}`,
        telefone: p.telefone || '',
        dt_nascimento: p.dt_nascimento,
        idade,
        classifications: p.classifications || [],
        status,
        dias_sem_comprar: dias,
        last_purchase_date: lastDate || null,
      };
    });

    // Enriquece com último vendedor que atendeu cada cliente.
    // Em revenda (branch=99): considera QUALQUER filial 1-990 com ops de revenda.
    try {
      const opts = {};
      if (branchFilter === 99) {
        // Modo revenda: any branch + revenda op codes + B2R dealers
        opts.allowedDealers = new Set([
          25, 15, 161, 165, 241, 779, 288, 251, 131,
        ]);
        opts.opCodes = REVENDA_OP_CODES;
      } else if (branchFilter) {
        opts.branch = branchFilter;
      }
      const ultMap = await getUltimoVendedorPorCliente(
        out.map((c) => c.code),
        opts,
      );
      for (const c of out) {
        const u = ultMap.get(c.code);
        if (u) {
          c.ultimo_vendedor = {
            dealer_code: u.dealer_code,
            dealer_name: u.dealer_name,
            issue_date: u.issue_date,
          };
        }
      }
    } catch (err) {
      console.warn('[aniversariantes] último vendedor falhou:', err.message);
    }

    return successResponse(res, {
      total: out.length,
      date: `${target.getFullYear()}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      clientes: out,
    });
  }),
);

// ---------------------------------------------------------------------------
// 1d. POST /api/crm/conversao-cruzada
//     Cruzamento ClickUp ↔ TOTVS por vendedor.
//     Body: { leads: [{ phone, vendedor_clickup_id, vendedor_totvs_id,
//                       vendedor_name, status }] }
//     Resposta: { byVendedor: { [clickup_id]: { ... metrics } } }
//
//     Métricas por vendedor:
//       crm_total            — leads atribuídos no ClickUp
//       crm_closed_status    — leads com status "comprou/fechado/closed"
//       crm_perdidos         — leads com status "invalido/desqualificado/etc"
//       crm_validated        — leads cujo cliente tem NF Output do dealer_code
//                              do vendedor (= venda real no TOTVS)
//       external_closed      — clientes com NF Output do dealer_code do vendedor
//                              que NÃO estão entre os leads do CRM dele
//       external_revenue     — soma total_value das NFs do dealer_code
//       external_nfs         — count NFs do dealer_code
// ---------------------------------------------------------------------------
router.post(
  '/conversao-cruzada',
  asyncHandler(async (req, res) => {
    const { leads } = req.body;
    if (!Array.isArray(leads) || leads.length === 0) {
      return errorResponse(res, 'leads obrigatório', 400, 'MISSING_LEADS');
    }

    const closedRe = /(fechado|comprou|closed)/i;
    const lostRe = /(invalido|inválido|desqualific|perdido|descart|spam)/i;

    // 1) Coleta variantes de telefone
    const phoneToVariants = new Map();
    const allVariants = new Set();
    for (const l of leads) {
      const clean = String(l.phone || '').replace(/\D/g, '');
      if (!clean) continue;
      const vs = buildPhoneVariants(clean);
      phoneToVariants.set(clean, vs);
      vs.forEach((v) => allVariants.add(v));
    }

    // 2) Bulk lookup pes_pessoa por telefone
    const telToPersons = new Map();
    const variantList = [...allVariants];
    for (let i = 0; i < variantList.length; i += 1000) {
      const chunk = variantList.slice(i, i + 1000);
      const { data, error } = await supabase
        .from('pes_pessoa')
        .select('code, telefone')
        .in('telefone', chunk);
      if (error)
        return errorResponse(res, error.message, 500, 'SUPABASE_ERROR');
      for (const row of data || []) {
        const tel = row.telefone;
        if (!tel) continue;
        if (!telToPersons.has(tel)) telToPersons.set(tel, []);
        telToPersons.get(tel).push(Number(row.code));
      }
    }

    // 3) Per lead: resolve person_code, agrega por vendedor
    const byVendedor = {};
    for (const l of leads) {
      const clean = String(l.phone || '').replace(/\D/g, '');
      const vId = l.vendedor_clickup_id || '__sem_vendedor__';
      if (!byVendedor[vId]) {
        byVendedor[vId] = {
          clickup_id: vId,
          totvs_id: Number(l.vendedor_totvs_id) || null,
          nome: l.vendedor_name || '',
          crm_total: 0,
          crm_closed_status: 0,
          crm_perdidos: 0,
          crm_persons: new Set(),
        };
      }
      const v = byVendedor[vId];
      v.crm_total += 1;
      const status = String(l.status || '');
      if (closedRe.test(status)) v.crm_closed_status += 1;
      if (lostRe.test(status)) v.crm_perdidos += 1;

      const variants = phoneToVariants.get(clean) || [];
      for (const x of variants) {
        const codes = telToPersons.get(x);
        if (codes && codes.length > 0) {
          for (const c of codes) v.crm_persons.add(c);
          break;
        }
      }
    }

    // 4) Bulk NFs Output por dealer_code (todos os totvs_ids únicos)
    const dealerIds = [
      ...new Set(
        Object.values(byVendedor)
          .map((v) => v.totvs_id)
          .filter((x) => x),
      ),
    ];
    // dealerStats: dealer_code → Map<person_code, {count, revenue}>
    const dealerStats = new Map();
    for (const d of dealerIds) dealerStats.set(d, new Map());

    if (dealerIds.length > 0) {
      let offset = 0;
      const PAGE = 5000;
      while (true) {
        const { data, error } = await supabaseFiscal
          .from('notas_fiscais')
          .select('dealer_code, person_code, total_value')
          .eq('operation_type', 'Output')
          .not('invoice_status', 'eq', 'Canceled')
          .not('invoice_status', 'eq', 'Deleted')
          .in('dealer_code', dealerIds)
          .lt('person_code', 100000000)
          .range(offset, offset + PAGE - 1);
        if (error)
          return errorResponse(res, error.message, 500, 'FISCAL_ERROR');
        if (!data || data.length === 0) break;
        for (const nf of data) {
          const personMap = dealerStats.get(nf.dealer_code);
          if (!personMap) continue;
          const p = nf.person_code;
          if (!p) continue;
          if (!personMap.has(p)) personMap.set(p, { count: 0, revenue: 0 });
          const rec = personMap.get(p);
          rec.count += 1;
          rec.revenue += parseFloat(nf.total_value) || 0;
        }
        if (data.length < PAGE) break;
        offset += PAGE;
      }
    }

    // 5) Pra cada person (em qualquer dealerStats), descobre a PRIMEIRA NF
    //    Output de qualquer dealer → identifica quem abriu o cadastro.
    const allPersons = new Set();
    for (const personMap of dealerStats.values()) {
      for (const p of personMap.keys()) allPersons.add(p);
    }
    const personFirstNf = new Map(); // person_code → { date, dealer }
    const personsList = [...allPersons];
    const PERSON_CHUNK = 500;
    for (let i = 0; i < personsList.length; i += PERSON_CHUNK) {
      const chunk = personsList.slice(i, i + PERSON_CHUNK);
      let offset = 0;
      const PAGE = 5000;
      while (true) {
        const { data, error } = await supabaseFiscal
          .from('notas_fiscais')
          .select('person_code, dealer_code, issue_date')
          .eq('operation_type', 'Output')
          .not('invoice_status', 'eq', 'Canceled')
          .not('invoice_status', 'eq', 'Deleted')
          .in('person_code', chunk)
          .order('issue_date', { ascending: true })
          .range(offset, offset + PAGE - 1);
        if (error)
          return errorResponse(res, error.message, 500, 'FISCAL_ERROR');
        if (!data || data.length === 0) break;
        for (const nf of data) {
          const p = nf.person_code;
          if (!p) continue;
          if (!personFirstNf.has(p)) {
            personFirstNf.set(p, {
              date: nf.issue_date,
              dealer: nf.dealer_code,
            });
          }
        }
        if (data.length < PAGE) break;
        offset += PAGE;
      }
    }

    // 6) Cruza tudo: vendas por vendedor, separando aberturas (1ª compra) e
    //    clientes que ele só revendeu (alguém abriu antes).
    const out = {};
    for (const [vId, v] of Object.entries(byVendedor)) {
      const personMap = v.totvs_id ? dealerStats.get(v.totvs_id) : null;

      // Sales metrics (ANY NF do dealer)
      let crmSalesClients = 0;
      let crmSalesRevenue = 0;
      let crmSalesNfs = 0;
      let externalSalesClients = 0;
      let externalSalesRevenue = 0;
      let externalSalesNfs = 0;

      // Opening metrics (1ª compra do cliente foi por este dealer)
      let crmOpenings = 0;
      let externalOpenings = 0;
      let crmOpeningsRevenue = 0;
      let externalOpeningsRevenue = 0;

      if (personMap) {
        for (const [p, rec] of personMap) {
          const inCrm = v.crm_persons.has(p);
          const first = personFirstNf.get(p);
          const isOpener = first && first.dealer === v.totvs_id;
          if (inCrm) {
            crmSalesClients += 1;
            crmSalesRevenue += rec.revenue;
            crmSalesNfs += rec.count;
            if (isOpener) {
              crmOpenings += 1;
              crmOpeningsRevenue += rec.revenue;
            }
          } else {
            externalSalesClients += 1;
            externalSalesRevenue += rec.revenue;
            externalSalesNfs += rec.count;
            if (isOpener) {
              externalOpenings += 1;
              externalOpeningsRevenue += rec.revenue;
            }
          }
        }
      }

      out[vId] = {
        clickup_id: vId,
        totvs_id: v.totvs_id,
        nome: v.nome,
        crm_total: v.crm_total,
        crm_closed_status: v.crm_closed_status,
        crm_perdidos: v.crm_perdidos,
        // Vendas (qualquer NF) — backward-compat
        crm_validated: crmSalesClients,
        crm_validated_revenue: Math.round(crmSalesRevenue * 100) / 100,
        crm_validated_nfs: crmSalesNfs,
        external_closed: externalSalesClients,
        external_revenue: Math.round(externalSalesRevenue * 100) / 100,
        external_nfs: externalSalesNfs,
        // Aberturas (1ª compra do cliente por este dealer)
        crm_openings: crmOpenings,
        crm_openings_revenue: Math.round(crmOpeningsRevenue * 100) / 100,
        external_openings: externalOpenings,
        external_openings_revenue:
          Math.round(externalOpeningsRevenue * 100) / 100,
        total_revenue:
          Math.round((crmSalesRevenue + externalSalesRevenue) * 100) / 100,
      };
    }

    return successResponse(res, { byVendedor: out });
  }),
);

// ---------------------------------------------------------------------------
// 1b. POST /api/crm/turno-by-seller
//     Distribuição de mensagens por hora do dia (0-23) por instância Evolution.
//     Body: { instances: ['walter', 'rafael', ...], onlyReceived?: bool }
//     Resposta: { [instance]: { hours: [24 ints], peak: number|null, total: number } }
// ---------------------------------------------------------------------------
router.post(
  '/turno-by-seller',
  asyncHandler(async (req, res) => {
    const { instances, onlyReceived } = req.body;
    if (!Array.isArray(instances) || instances.length === 0) {
      return errorResponse(
        res,
        'instances obrigatório',
        400,
        'MISSING_INSTANCES',
      );
    }
    const names = instances.filter((n) => typeof n === 'string' && n.trim());
    if (names.length === 0) {
      return successResponse(res, {});
    }
    const placeholders = names.map((_, i) => `$${i + 1}`).join(', ');
    const directionFilter = onlyReceived
      ? `AND (m."key"->>'fromMe')::boolean = false`
      : '';

    const result = await evolutionPool.query(
      `SELECT
         i.name AS instance,
         EXTRACT(HOUR FROM (TO_TIMESTAMP(m."messageTimestamp") AT TIME ZONE 'America/Sao_Paulo'))::int AS hora,
         COUNT(*)::int AS total
       FROM "Message" m
       JOIN "Instance" i ON i.id = m."instanceId"
       WHERE i.name IN (${placeholders})
         AND m."messageTimestamp" IS NOT NULL
         ${directionFilter}
       GROUP BY i.name, hora
       ORDER BY i.name, hora`,
      names,
    );

    const out = {};
    for (const inst of names) {
      out[inst] = {
        hours: Array(24).fill(0),
        peak: null,
        total: 0,
        evolution_total: 0,
        uazapi_total: 0,
      };
    }
    for (const row of result.rows) {
      const item = out[row.instance];
      if (!item) continue;
      const h = Number(row.hora);
      if (h < 0 || h > 23) continue;
      item.hours[h] += row.total;
      item.evolution_total += row.total;
      item.total += row.total;
    }

    // ── UAzapi: amostra 5k mensagens recentes por instância e bucketiza ──
    if (isUazapiConfigured()) {
      const CONC = 3;
      for (let i = 0; i < names.length; i += CONC) {
        const batch = names.slice(i, i + CONC);
        const results = await Promise.allSettled(
          batch.map(async (n) => ({
            name: n,
            data: await uazapiTurnoForInstance(n, { onlyReceived }),
          })),
        );
        for (const r of results) {
          if (r.status !== 'fulfilled' || !r.value.data) continue;
          const item = out[r.value.name];
          if (!item) continue;
          const ua = r.value.data;
          for (let h = 0; h < 24; h++) {
            item.hours[h] += ua.hours[h] || 0;
          }
          item.uazapi_total += ua.total;
          item.total += ua.total;
        }
      }
    }

    // Recalcula peak após merge
    for (const item of Object.values(out)) {
      let max = 0;
      let peak = null;
      for (let h = 0; h < 24; h++) {
        if (item.hours[h] > max) {
          max = item.hours[h];
          peak = h;
        }
      }
      item.peak = peak;
    }

    return successResponse(res, out);
  }),
);

// ---------------------------------------------------------------------------
// 2. GET /api/crm/msgs
//    Busca mensagens entre um telefone e uma instância
// ---------------------------------------------------------------------------
router.get(
  '/msgs',
  asyncHandler(async (req, res) => {
    const { tel, inst, provider } = req.query;

    if (!tel || !inst) {
      return errorResponse(res, 'Parâmetros tel e inst são obrigatórios', 400);
    }

    // Dispatch UAzapi
    if (provider === 'uazapi') {
      try {
        const mensagens = await uazapiGetMessages(inst, tel);
        return successResponse(res, { mensagens });
      } catch (err) {
        return errorResponse(
          res,
          err.message || 'Erro ao buscar mensagens UAzapi',
          err.response?.status || 500,
        );
      }
    }

    let phone = String(tel).replace(/\D/g, '');
    if (!phone.startsWith('55')) phone = '55' + phone;

    // Usa coluna normalizada msisdn_55_v2 (mesma da rota de discovery),
    // tolera variações (com/sem 9, jid lid, etc).
    const result = await evolutionPool.query(
      `SELECT
        m."key",
        m.message,
        m."messageTimestamp"
      FROM "Message" m
      JOIN "Instance" i ON i.id = m."instanceId"
      WHERE m.msisdn_55_v2 = $1
        AND i.name = $2
      ORDER BY m."messageTimestamp" ASC
      LIMIT 500`,
      [phone, inst],
    );

    const mensagens = result.rows.map((row) => {
      const texto =
        row.message?.conversation ||
        row.message?.extendedTextMessage?.text ||
        '';
      return {
        texto,
        quem: row.key?.fromMe ? 'EU' : 'lead',
        tempo: Number(row.messageTimestamp),
      };
    });

    return successResponse(res, { mensagens });
  }),
);

// ---------------------------------------------------------------------------
// 3. POST /api/crm/buscar-msgs
//    Pesquisa textual em mensagens de múltiplas instâncias
// ---------------------------------------------------------------------------
router.post(
  '/buscar-msgs',
  asyncHandler(async (req, res) => {
    const { expr, instances, direcao } = req.body;

    if (
      !expr ||
      !instances ||
      !Array.isArray(instances) ||
      instances.length === 0
    ) {
      return errorResponse(res, 'expr e instances são obrigatórios', 400);
    }

    // Aceita instances como ['name'] (legado, Evolution) ou [{name, provider}]
    const evolutionNames = [];
    const uazapiNames = [];
    for (const i of instances) {
      if (typeof i === 'string') {
        evolutionNames.push(i);
      } else if (i?.name) {
        if (i.provider === 'uazapi') uazapiNames.push(i.name);
        else evolutionNames.push(i.name);
      }
    }

    const results = [];

    // ── Evolution (Postgres) ──────────────────────────────────────────────
    if (evolutionNames.length > 0) {
      let direcaoFilter = '';
      if (direcao === 'recebidas') {
        direcaoFilter = `AND (m."key"->>'fromMe')::boolean = false`;
      } else if (direcao === 'enviadas') {
        direcaoFilter = `AND (m."key"->>'fromMe')::boolean = true`;
      }
      const instPlaceholders = evolutionNames
        .map((_, i) => `$${i + 2}`)
        .join(', ');
      const result = await evolutionPool.query(
        `SELECT
          m."key",
          m.message,
          m."messageTimestamp",
          m."pushName",
          i.name AS instance_name
        FROM "Message" m
        JOIN "Instance" i ON i.id = m."instanceId"
        WHERE i.name IN (${instPlaceholders})
          AND (
            m.message->>'conversation' ILIKE $1
            OR m.message->'extendedTextMessage'->>'text' ILIKE $1
          )
          ${direcaoFilter}
        ORDER BY m."messageTimestamp" DESC
        LIMIT 300`,
        [`%${expr}%`, ...evolutionNames],
      );

      const leadsMap = {};
      for (const row of result.rows) {
        const fone = row.key?.remoteJid?.replace('@s.whatsapp.net', '') || '';
        if (!fone) continue;
        const chave = `${fone}_${row.instance_name}`;
        const texto =
          row.message?.conversation ||
          row.message?.extendedTextMessage?.text ||
          '';
        const tempo = Number(row.messageTimestamp) || 0;
        if (!leadsMap[chave]) {
          leadsMap[chave] = {
            instance: row.instance_name,
            provider: 'evolution',
            fone,
            nome: row.pushName || '',
            msgCount: 0,
            messages: [],
          };
        }
        leadsMap[chave].messages.push({
          texto,
          fromMe: !!row.key?.fromMe,
          tempo,
          dataStr: tempo ? new Date(tempo).toLocaleString('pt-BR') : '',
        });
        leadsMap[chave].msgCount += 1;
      }
      results.push(...Object.values(leadsMap));
    }

    // ── UAzapi (REST, por instância) ──────────────────────────────────────
    for (const instName of uazapiNames) {
      try {
        const lista = await uazapiSearchMessages(
          instName,
          expr,
          direcao || 'todas',
        );
        for (const item of lista) {
          const messages = (item.messages || []).map((m) => ({
            texto: m.texto,
            fromMe: m.quem === 'EU',
            tempo: m.tempo,
            dataStr: m.tempo ? new Date(m.tempo).toLocaleString('pt-BR') : '',
          }));
          results.push({
            instance: instName,
            provider: 'uazapi',
            fone: item.fone,
            nome: item.nome || '',
            msgCount: messages.length,
            messages,
          });
        }
      } catch (err) {
        console.warn(`[buscar-msgs] UAzapi ${instName} falhou:`, err.message);
      }
    }

    return successResponse(res, { results });
  }),
);

// ---------------------------------------------------------------------------
// 4. POST /api/crm/leads
//    Busca tarefas do ClickUp em um período
// ---------------------------------------------------------------------------
router.post(
  '/leads',
  asyncHandler(async (req, res) => {
    const { de, ate, allHistory } = req.body;

    if (!CLICKUP_API_KEY || !CLICKUP_LIST_ID) {
      return successResponse(res, {
        canais: [],
        message:
          'ClickUp não configurado (CLICKUP_API_KEY / CLICKUP_LIST_ID ausente)',
      });
    }

    if (!allHistory && (!de || !ate)) {
      return errorResponse(
        res,
        'Parâmetros de e ate são obrigatórios (YYYY-MM-DD), ou use allHistory:true',
        400,
      );
    }

    try {
      const responseData = await loadClickupLeads({
        de,
        ate,
        allHistory: !!allHistory,
      });
      return successResponse(res, responseData);
    } catch (error) {
      console.error('Erro ao buscar leads do ClickUp:', error.message);
      return errorResponse(
        res,
        error.response?.data?.err || error.message || 'Erro ao buscar tarefas',
        error.response?.status || 500,
      );
    }
  }),
);

// ---------------------------------------------------------------------------
// 4b. GET /api/crm/dashboard-overview
//     Painel geral: agrega TODOS os leads do CRM 26 (lista CLICKUP_LIST_ID)
//     e retorna métricas pré-calculadas (sem mandar lista de leads pro front).
//     Usa o cache do loadClickupLeads (5 min TTL) — chamadas frequentes não
//     pesam no ClickUp.
// ---------------------------------------------------------------------------
router.get(
  '/dashboard-overview',
  asyncHandler(async (req, res) => {
    if (!CLICKUP_API_KEY || !CLICKUP_LIST_ID) {
      return successResponse(res, {
        enabled: false,
        message: 'ClickUp não configurado',
      });
    }

    try {
      const forceRefresh = req.query.force === '1';
      const data = await loadClickupLeads({ allHistory: true, forceRefresh });
      const tarefas = (data.canais || []).flatMap((c) => c.tarefas || []);

      // ── Carrega índice de telefones (cache 30 min) para detectar leads
      // que viraram cadastros em pes_pessoa ──
      let phoneMap = null;
      if (forceRefresh) {
        TOTVS_PHONE_PERSON_CACHE = { data: null, ts: 0 };
      }
      try {
        phoneMap = await loadTotvsPhonePersonMap();
      } catch (err) {
        console.warn('[dashboard] phoneMap falhou:', err.message);
      }

      // ── Helpers de bucket ──
      const inc = (obj, key) => {
        if (!key) return;
        obj[key] = (obj[key] || 0) + 1;
      };
      const norm = (s) =>
        String(s || '')
          .trim()
          .toUpperCase();

      // ── Por canal (varejo / revenda / multimarcas) ──
      // Sem franquia (não usada no CRM 26). Tudo que não é varejo/revenda/multimarcas
      // entra em "outras_categorias" com nome original preservado.
      const porCanal = {
        varejo: 0,
        revenda: 0,
        multimarcas: 0,
        sem_categoria: 0,
      };
      const porOutrasCategorias = {}; // nome original → count
      // ── Por status do funil (sql, 1º contato, comprou, etc.) ──
      const porStatus = {};
      // ── Por vendedor ──
      const porVendedor = {};
      // ── Por estado / cidade ──
      const porEstado = {};
      const porCidade = {}; // formato "CIDADE/UF"
      // ── Por origem ──
      const porOrigem = {};
      // ── Por qualidade (MQL) ──
      const porQualidade = {};
      // ── Por etiqueta ──
      const porEtiqueta = {};
      // ── Safra (passo a passo) ──
      const porSafra = {};
      let comSafra = 0;
      let semSafra = 0;
      // ── Cadastros (lead virou cliente em pes_pessoa) ──
      let cadastrosAbertos = 0; // leads com phone match em pes_pessoa (forte)
      let cadastrosAbertosFracos = 0; // matches fracos (DDD ausente — possível ruído)
      let cadastrosPassoAPasso = 0; // os que ALÉM disso têm safra preenchida
      // ── Tempo / leads novos vs antigos ──
      const agora = Date.now();
      const DIA = 86400000;
      let leadsUlt7d = 0;
      let leadsUlt30d = 0;
      let leadsUlt90d = 0;
      const porMes = {}; // YYYY-MM → count

      for (const t of tarefas) {
        // Canal
        const cat = norm(t.canalDetalhe);
        const catOriginal = (t.canalDetalhe || '').toString().trim();
        if (cat.includes('VAREJO')) porCanal.varejo++;
        else if (cat.includes('REVENDA') || cat.includes('REVENDEDOR'))
          porCanal.revenda++;
        else if (cat.includes('MULTIMARCA') || cat.includes('INBOUND'))
          porCanal.multimarcas++;
        else if (!cat || cat === 'SEM CATEGORIA') porCanal.sem_categoria++;
        else {
          // Outra categoria — preserva o nome original (ex: Franquia, Business, B2B)
          inc(porOutrasCategorias, catOriginal || 'Outros');
        }

        // Status
        inc(porStatus, (t.status || 'sem_status').toLowerCase());

        // Vendedor
        const vName = t.vendedor || 'Sem Vendedor';
        if (!porVendedor[vName]) {
          porVendedor[vName] = {
            nome: vName,
            clickup_id: t.vendedorClickupId || '',
            modulo: t.vendedorModulo || '',
            total: 0,
          };
        }
        porVendedor[vName].total++;

        // Estado / Cidade
        const uf = norm(t.estado);
        if (uf) inc(porEstado, uf);
        const cid = norm(t.cidade);
        if (cid) inc(porCidade, uf ? `${cid}/${uf}` : cid);

        // Origem / Qualidade / Etiqueta
        if (t.origem) inc(porOrigem, t.origem);
        if (t.qualidade) inc(porQualidade, t.qualidade);
        if (t.etiqueta) inc(porEtiqueta, t.etiqueta);

        // Safra
        const sf = (t.safra || '').toString().trim();
        const temSafra = !!sf;
        if (temSafra) {
          comSafra++;
          inc(porSafra, sf);
        } else {
          semSafra++;
        }

        // Cadastro (lead já tem registro em pes_pessoa) — distingue strong/weak
        if (phoneMap && t.telefone) {
          const pessoa = lookupPersonByPhone(phoneMap, t.telefone);
          if (pessoa) {
            if (pessoa.confidence === 'strong') {
              cadastrosAbertos++;
              if (temSafra) cadastrosPassoAPasso++;
            } else {
              cadastrosAbertosFracos++;
            }
          }
        }

        // Datas
        if (t.dataCriacao) {
          const ts = new Date(t.dataCriacao).getTime();
          if (Number.isFinite(ts)) {
            const idade = agora - ts;
            if (idade <= 7 * DIA) leadsUlt7d++;
            if (idade <= 30 * DIA) leadsUlt30d++;
            if (idade <= 90 * DIA) leadsUlt90d++;
            const ym = t.dataCriacao.slice(0, 7);
            inc(porMes, ym);
          }
        }
      }

      // ── Helpers de transformação para arrays ordenados ──
      const asArrayDesc = (obj, limit = 0) => {
        const arr = Object.entries(obj)
          .map(([k, v]) => ({ name: k, total: v }))
          .sort((a, b) => b.total - a.total);
        return limit > 0 ? arr.slice(0, limit) : arr;
      };

      const total = tarefas.length;
      const overview = {
        total,
        por_canal: porCanal,
        outras_categorias: asArrayDesc(porOutrasCategorias),
        por_status: asArrayDesc(porStatus),
        por_vendedor: Object.values(porVendedor)
          .sort((a, b) => b.total - a.total)
          .slice(0, 30),
        top_estados: asArrayDesc(porEstado, 15),
        top_cidades: asArrayDesc(porCidade, 20),
        por_origem: asArrayDesc(porOrigem),
        por_qualidade: asArrayDesc(porQualidade),
        por_etiqueta: asArrayDesc(porEtiqueta, 15),
        passo_a_passo: {
          com_safra: comSafra,
          sem_safra: semSafra,
          pct_com_safra:
            total > 0 ? Math.round((comSafra / total) * 1000) / 10 : 0,
          por_safra: asArrayDesc(porSafra, 20),
        },
        cadastros: {
          abertos: cadastrosAbertos,
          abertos_fracos: cadastrosAbertosFracos,
          do_passo_a_passo: cadastrosPassoAPasso,
          pct_abertos:
            total > 0 ? Math.round((cadastrosAbertos / total) * 1000) / 10 : 0,
          pct_passo_a_passo:
            comSafra > 0
              ? Math.round((cadastrosPassoAPasso / comSafra) * 1000) / 10
              : 0,
          phone_map_loaded: !!phoneMap,
          phone_map_size: phoneMap ? phoneMap.size : 0,
        },
        recentes: {
          ult_7d: leadsUlt7d,
          ult_30d: leadsUlt30d,
          ult_90d: leadsUlt90d,
        },
        por_mes: Object.entries(porMes)
          .map(([k, v]) => ({ mes: k, total: v }))
          .sort((a, b) => a.mes.localeCompare(b.mes))
          .slice(-12), // últimos 12 meses
        list_id: CLICKUP_LIST_ID,
        loaded_at: new Date().toISOString(),
      };

      return successResponse(res, overview);
    } catch (err) {
      console.error('[dashboard-overview] erro:', err.message);
      return errorResponse(
        res,
        err.response?.data?.err || err.message || 'Erro ao montar dashboard',
        500,
      );
    }
  }),
);

// ---------------------------------------------------------------------------
// 4c. GET /api/crm/dashboard-overview-leads
//     Lista leads filtrados — usado pelos modais de drill-down do Painel Geral.
//     Query params:
//       filter: 'canal' | 'vendedor' | 'estado' | 'cidade' | 'origem' |
//               'qualidade' | 'etiqueta' | 'safra' | 'status' | 'mes' |
//               'recente7' | 'recente30' | 'recente90' | 'sem_categoria' |
//               'outra_categoria'
//       value: string (ex: 'varejo', 'PB', 'JOÃO PESSOA/PB', '2026-04', etc.)
//     Retorna: { leads: [...], total: N, filter, value }
// ---------------------------------------------------------------------------
router.get(
  '/dashboard-overview-leads',
  asyncHandler(async (req, res) => {
    if (!CLICKUP_API_KEY || !CLICKUP_LIST_ID) {
      return successResponse(res, {
        enabled: false,
        leads: [],
        total: 0,
        message: 'ClickUp não configurado',
      });
    }
    const filter = String(req.query.filter || '').toLowerCase();
    const value = String(req.query.value || '');
    if (!filter) {
      return errorResponse(res, 'filter obrigatório', 400, 'MISSING_FILTER');
    }

    try {
      const data = await loadClickupLeads({ allHistory: true });
      const tarefas = (data.canais || []).flatMap((c) => c.tarefas || []);

      const norm = (s) =>
        String(s || '')
          .trim()
          .toUpperCase();
      const NOW = Date.now();
      const DIA = 86400000;
      const valNorm = norm(value);

      // Carrega phoneMap só se o filtro precisar (cadastro_aberto/passo)
      let phoneMapDetail = null;
      if (filter === 'cadastro_aberto' || filter === 'cadastro_passo') {
        try {
          phoneMapDetail = await loadTotvsPhonePersonMap();
        } catch (err) {
          console.warn('[dashboard-leads] phoneMap falhou:', err.message);
        }
      }

      const matchCanal = (t) => {
        const cat = norm(t.canalDetalhe);
        if (value === 'varejo') return cat.includes('VAREJO');
        if (value === 'revenda')
          return cat.includes('REVENDA') || cat.includes('REVENDEDOR');
        if (value === 'multimarcas')
          return cat.includes('MULTIMARCA') || cat.includes('INBOUND');
        return false;
      };
      const matchOutraCategoria = (t) => {
        const cat = norm(t.canalDetalhe);
        if (!cat || cat === 'SEM CATEGORIA') return false;
        if (
          cat.includes('VAREJO') ||
          cat.includes('REVENDA') ||
          cat.includes('REVENDEDOR') ||
          cat.includes('MULTIMARCA') ||
          cat.includes('INBOUND')
        )
          return false;
        // Se value foi passado, filtra pela categoria específica
        if (value) return cat === valNorm;
        return true;
      };
      const matchSemCategoria = (t) => {
        const cat = norm(t.canalDetalhe);
        return !cat || cat === 'SEM CATEGORIA';
      };

      const filtered = tarefas.filter((t) => {
        switch (filter) {
          case 'canal':
            return matchCanal(t);
          case 'sem_categoria':
            return matchSemCategoria(t);
          case 'outra_categoria':
            return matchOutraCategoria(t);
          case 'vendedor':
            return (t.vendedor || 'Sem Vendedor') === value;
          case 'estado':
            return norm(t.estado) === valNorm;
          case 'cidade':
            // value formato "CIDADE/UF" ou "CIDADE"
            if (valNorm.includes('/')) {
              const [c, u] = valNorm.split('/');
              return norm(t.cidade) === c && norm(t.estado) === u;
            }
            return norm(t.cidade) === valNorm;
          case 'origem':
            return (t.origem || '') === value;
          case 'qualidade':
            return (t.qualidade || '') === value;
          case 'etiqueta':
            return (t.etiqueta || '') === value;
          case 'safra':
            return (t.safra || '').trim() === value;
          case 'status':
            return (
              (t.status || 'sem_status').toLowerCase() === value.toLowerCase()
            );
          case 'mes':
            return (t.dataCriacao || '').startsWith(value);
          case 'recente7':
          case 'recente30':
          case 'recente90': {
            if (!t.dataCriacao) return false;
            const dias =
              filter === 'recente7' ? 7 : filter === 'recente30' ? 30 : 90;
            const ts = new Date(t.dataCriacao).getTime();
            return Number.isFinite(ts) && NOW - ts <= dias * DIA;
          }
          case 'cadastro_aberto': {
            if (!phoneMapDetail || !t.telefone) return false;
            // Só strong (DDD presente) — protege contra ruído
            const p = lookupPersonByPhone(phoneMapDetail, t.telefone, {
              allowWeak: false,
            });
            return !!p;
          }
          case 'cadastro_passo': {
            if (!phoneMapDetail || !t.telefone) return false;
            const semSafra = !(t.safra || '').toString().trim();
            if (semSafra) return false;
            const p = lookupPersonByPhone(phoneMapDetail, t.telefone, {
              allowWeak: false,
            });
            return !!p;
          }
          case 'cadastro_aberto_fraco': {
            // Para debug — mostra só matches fracos (sem DDD)
            if (!phoneMapDetail || !t.telefone) return false;
            const strong = lookupPersonByPhone(phoneMapDetail, t.telefone, {
              allowWeak: false,
            });
            if (strong) return false;
            const weak = lookupPersonByPhone(phoneMapDetail, t.telefone, {
              allowWeak: true,
            });
            return !!weak && weak.confidence === 'weak';
          }
          default:
            return false;
        }
      });

      // Ordena por data desc (mais recentes primeiro)
      filtered.sort((a, b) =>
        String(b.dataCriacao || '').localeCompare(String(a.dataCriacao || '')),
      );

      // Limita a 500 para não pesar a UI
      const limit = Math.min(parseInt(req.query.limit) || 500, 1000);
      const leads = filtered.slice(0, limit).map((t) => ({
        id: t.id,
        nome: t.nome,
        telefone: t.telefone,
        vendedor: t.vendedor || 'Sem Vendedor',
        status: t.status,
        canal: t.canalDetalhe,
        cidade: t.cidade,
        estado: t.estado,
        origem: t.origem,
        safra: t.safra,
        dataCriacao: t.dataCriacao,
        clickupUrl: t.clickupUrl,
      }));

      return successResponse(res, {
        leads,
        total: filtered.length,
        truncated: filtered.length > limit,
        filter,
        value,
      });
    } catch (err) {
      console.error('[dashboard-overview-leads] erro:', err.message);
      return errorResponse(res, err.message, 500);
    }
  }),
);

// ---------------------------------------------------------------------------
// 4d. POST /api/crm/sync-leads-compras
//     Reproduz a automação n8n que cruza leads do CRM 26 com notas_fiscais
//     e atualiza no ClickUp os campos de compra (LTV, primeira compra, etc).
//     Lógica:
//       1. Busca leads SEM status "comprou" (ignora os já marcados)
//       2. Para cada lead, normaliza telefone e busca person_code em pes_pessoa
//       3. Agrega notas_fiscais (Sales / Output) do person_code:
//          - dt_primeira_compra (geral) + vl_primeira_compra
//          - ltv_total
//          - dt_primeira_compra_pos_auto (após dataCriacao do lead)
//          - vl_primeira_compra_pos_auto + ltv_pos_automacao
//       4. Filtra: ltv_pos_automacao > 0 (compra após o lead virar lead)
//       5. Atualiza ClickUp: status=comprou + 6 custom fields
//
//     Body opcional: { dryRun: true } → não atualiza ClickUp, só retorna
//                                        o que seria atualizado (preview)
//     Body opcional: { limit: N } → processa só os N primeiros (debug)
// ---------------------------------------------------------------------------

// IDs dos custom fields no ClickUp (extraídos da automação n8n)
const CRM_SYNC_FIELDS = {
  COD_CLIENTE: '28cc2af7-acab-410e-9652-c718eedd04ca',
  LTV: '3b473059-d633-410b-9a56-c8b6ab5606db',
  VL_PRIMEIRA_COMPRA: 'fef70b59-cdf6-4340-a116-8484ec4e36e4',
  DATA_PRIMEIRA_COMPRA: '27bf657e-1581-468b-83ea-6268d82350cc',
  DATA_PRIMEIRA_COMPRA_POS_CRM: '6078c4ed-8528-419e-b0f7-883a960f5a88',
  VL_PRIMEIRA_COMPRA_POS_CRM: '57728b6d-690f-4f9a-b641-9c096c004f63',
};

// Operações de venda válidas (mesma lista do n8n + ops de revenda)
// Output / Sales — exclui devoluções, transferências, bonificações
const SYNC_OPERATIONS_VENDA = new Set([
  // Varejo
  545, 546, 510, 521, 511, 522, 9001, 9009, 9017, 9027, 1, 7235, 7241, 4112,
  // Revenda
  5102, 1407, 9120, 9121, 9113, 9111, 7806, 7809, 7236, 7242, 9061, 9122,
  // Multimarcas / outras
  9067, 9400, 9401, 9420, 9404, 7246, 7279, 512,
]);

// Helper: encontra o person_code mais provável dado um telefone usando o
// índice de variantes (loadTotvsPhonePersonMap).
// Retorna { code, name, confidence: 'strong'|'weak', matchedVariant } ou null.
//
// confidence:
//   - 'strong'  → match em variante com 10+ dígitos (DDD presente)
//   - 'weak'    → match em variante curta (8-9 dígitos, sem DDD) — possível false-positive
function lookupPersonByPhone(phoneMap, rawPhone, opts = {}) {
  const { allowWeak = true } = opts;
  const variants = buildPhoneVariants(rawPhone);
  // Primeiro passa: variantes "fortes" (com DDD, 10+ dígitos)
  // Isso evita preferir um match fraco (8 dig) sobre um forte (11 dig)
  const strongVariants = variants.filter((v) => v.length >= 10);
  const weakVariants = variants.filter((v) => v.length < 10);

  const tryVariants = (list, confidence) => {
    for (const v of list) {
      if (phoneMap.has(v)) {
        const persons = phoneMap.get(v);
        if (persons && persons.length > 0) {
          const chosen = persons.slice().sort((a, b) => a.code - b.code)[0];
          return { ...chosen, confidence, matchedVariant: v };
        }
      }
    }
    return null;
  };

  const strong = tryVariants(strongVariants, 'strong');
  if (strong) return strong;
  if (!allowWeak) return null;
  return tryVariants(weakVariants, 'weak');
}

// Estado em memória do último sync (pra UI consultar status)
let LAST_SYNC_STATUS = {
  running: false,
  startedAt: null,
  finishedAt: null,
  result: null,
  source: null, // 'manual' | 'cron'
};

async function executarSyncLeadsCompras({
  dryRun = false,
  limit = 0,
  source = 'manual',
} = {}) {
  if (LAST_SYNC_STATUS.running) {
    throw new Error('Sync já em execução — aguarde terminar');
  }
  LAST_SYNC_STATUS = {
    running: true,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    result: null,
    source,
  };

  const startTs = Date.now();
  const stats = {
    total_leads: 0,
    leads_sem_comprou: 0,
    leads_com_telefone: 0,
    leads_com_match: 0,
    leads_com_compra_pos_auto: 0,
    leads_atualizados: 0,
    leads_falhou: 0,
    samples: [], // amostras (até 20) das atualizações pra UI
  };

  try {
    // 1. Carrega leads do ClickUp (cache 5min)
    console.log('🔄 [sync-leads-compras] Carregando leads do ClickUp...');
    const data = await loadClickupLeads({ allHistory: true });
    const todasTarefas = (data.canais || []).flatMap((c) => c.tarefas || []);
    stats.total_leads = todasTarefas.length;

    // 2. Filtra apenas leads SEM status "comprou"
    const tarefas = todasTarefas.filter(
      (t) => String(t.status || '').toLowerCase() !== 'comprou',
    );
    stats.leads_sem_comprou = tarefas.length;

    // Limita pra debug se requisitado
    const tarefasParaProcessar = limit > 0 ? tarefas.slice(0, limit) : tarefas;

    // 3. Carrega o índice de telefones (cache 30min)
    console.log(`📞 [sync-leads-compras] Carregando índice de telefones...`);
    const phoneMap = await loadTotvsPhonePersonMap();
    console.log(
      `✅ [sync-leads-compras] ${phoneMap.size} variantes de telefone indexadas`,
    );

    // 4. Match telefone → person_code (SOMENTE matches strong — DDD presente)
    // Matches "weak" (só últimos 8-9 dígitos batem) são DESCARTADOS aqui
    // pra não atualizar ClickUp com pessoa errada (mesmo número, DDD diferente).
    const leadsComMatch = [];
    let descartadosFracos = 0;
    for (const t of tarefasParaProcessar) {
      if (!t.telefone) continue;
      stats.leads_com_telefone++;
      const pessoa = lookupPersonByPhone(phoneMap, t.telefone, {
        allowWeak: false,
      });
      if (pessoa) {
        leadsComMatch.push({
          task: t,
          person_code: pessoa.code,
          person_name: pessoa.name,
          match_variant: pessoa.matchedVariant,
        });
      } else {
        // Tenta match fraco só pra contar (mas não usa)
        const fraco = lookupPersonByPhone(phoneMap, t.telefone, {
          allowWeak: true,
        });
        if (fraco?.confidence === 'weak') descartadosFracos++;
      }
    }
    stats.leads_com_match = leadsComMatch.length;
    stats.leads_match_fraco_descartado = descartadosFracos;
    console.log(
      `🔗 [sync-leads-compras] ${stats.leads_com_match} matches strong / ` +
        `${descartadosFracos} weak descartados / ${stats.leads_com_telefone} com tel`,
    );

    if (leadsComMatch.length === 0) {
      LAST_SYNC_STATUS.running = false;
      LAST_SYNC_STATUS.finishedAt = new Date().toISOString();
      LAST_SYNC_STATUS.result = { ...stats, duration_ms: Date.now() - startTs };
      return LAST_SYNC_STATUS.result;
    }

    // 5. Agrega notas_fiscais por person_code (em batches de 200)
    const personCodes = leadsComMatch.map((l) => l.person_code);
    const aggByPerson = new Map(); // code → { ltv_total, dt_primeira, vl_primeira }
    const PAGE = 1000;
    const BATCH_PC = 200;

    for (let i = 0; i < personCodes.length; i += BATCH_PC) {
      const chunk = personCodes.slice(i, i + BATCH_PC);
      let off = 0;
      while (true) {
        const { data: rows, error } = await supabaseFiscal
          .from('notas_fiscais')
          .select(
            'person_code, total_value, issue_date, operation_code, operation_type, invoice_status',
          )
          .in('person_code', chunk)
          .eq('operation_type', 'Output')
          .not('invoice_status', 'eq', 'Canceled')
          .not('invoice_status', 'eq', 'Deleted')
          .gt('total_value', 0)
          .order('issue_date', { ascending: true })
          .range(off, off + PAGE - 1);
        if (error) {
          console.warn(`[sync-leads-compras] erro NF: ${error.message}`);
          break;
        }
        if (!rows || rows.length === 0) break;
        for (const nf of rows) {
          const op = parseInt(nf.operation_code);
          if (!SYNC_OPERATIONS_VENDA.has(op)) continue;
          const pc = nf.person_code;
          const val = parseFloat(nf.total_value) || 0;
          if (val <= 0) continue;
          const dt = nf.issue_date;
          const ex = aggByPerson.get(pc) || {
            ltv_total: 0,
            dt_primeira: null,
            vl_primeira: null,
            // Lista de NFs cronologicamente ordenadas (pra calcular pós-auto)
            nfs: [],
          };
          ex.ltv_total += val;
          if (!ex.dt_primeira || dt < ex.dt_primeira) {
            ex.dt_primeira = dt;
            ex.vl_primeira = val;
          }
          ex.nfs.push({ dt, val });
          aggByPerson.set(pc, ex);
        }
        if (rows.length < PAGE) break;
        off += PAGE;
      }
    }

    // 6. Para cada lead com match, calcula LTV pós-automação e prepara update
    const updatesParaClickUp = [];
    for (const lm of leadsComMatch) {
      const agg = aggByPerson.get(lm.person_code);
      if (!agg || agg.ltv_total <= 0) continue;

      // dt_primeira_compra_pos_auto e vl: primeira NF >= dataCriacao do lead
      const dataCriadaLead = (lm.task.dataCriacao || '').slice(0, 10);
      let ltv_pos_auto = 0;
      let dt_primeira_pos_auto = null;
      let vl_primeira_pos_auto = null;
      if (dataCriadaLead) {
        for (const nf of agg.nfs) {
          if (nf.dt >= dataCriadaLead) {
            ltv_pos_auto += nf.val;
            if (!dt_primeira_pos_auto) {
              dt_primeira_pos_auto = nf.dt;
              vl_primeira_pos_auto = nf.val;
            }
          }
        }
      }

      // Filtro do n8n: só processa quem teve compra APÓS virar lead
      if (ltv_pos_auto <= 0) continue;
      stats.leads_com_compra_pos_auto++;

      updatesParaClickUp.push({
        task_id: lm.task.id,
        task_name: lm.task.nome,
        person_code: lm.person_code,
        person_name: lm.person_name,
        telefone: lm.task.telefone,
        data_lead: dataCriadaLead,
        ltv_total: Math.round(agg.ltv_total * 100) / 100,
        dt_primeira: agg.dt_primeira,
        vl_primeira: Math.round(agg.vl_primeira * 100) / 100,
        ltv_pos_auto: Math.round(ltv_pos_auto * 100) / 100,
        dt_primeira_pos_auto,
        vl_primeira_pos_auto: Math.round(vl_primeira_pos_auto * 100) / 100,
      });
    }

    console.log(
      `🛒 [sync-leads-compras] ${updatesParaClickUp.length} leads com compra pós-auto detectada`,
    );

    // 7. Atualiza ClickUp (a menos que dryRun)
    if (!dryRun && updatesParaClickUp.length > 0) {
      // Para não estourar rate limit (100 req/min do ClickUp), processamos
      // em batches de 5 atualizações concorrentes (cada uma faz 7 req: 1 status + 6 fields)
      const CONC = 5;
      for (let i = 0; i < updatesParaClickUp.length; i += CONC) {
        const batch = updatesParaClickUp.slice(i, i + CONC);
        const results = await Promise.allSettled(
          batch.map((u) => atualizarLeadClickUp(u)),
        );
        for (let j = 0; j < results.length; j++) {
          if (results[j].status === 'fulfilled') {
            stats.leads_atualizados++;
            if (stats.samples.length < 20) {
              stats.samples.push({
                ...batch[j],
                ok: true,
              });
            }
          } else {
            stats.leads_falhou++;
            console.warn(
              `[sync-leads-compras] falhou task ${batch[j].task_id}: ${results[j].reason?.message}`,
            );
            if (stats.samples.length < 20) {
              stats.samples.push({
                ...batch[j],
                ok: false,
                error: results[j].reason?.message,
              });
            }
          }
        }
        // Pequeno delay entre batches pra evitar rate limit
        if (i + CONC < updatesParaClickUp.length) {
          await new Promise((r) => setTimeout(r, 800));
        }
      }
    } else if (dryRun) {
      // Em dryRun, apenas amostra
      stats.samples = updatesParaClickUp.slice(0, 20);
      stats.leads_atualizados = 0;
      stats.dry_run_count = updatesParaClickUp.length;
    }

    const duration_ms = Date.now() - startTs;
    const result = {
      ...stats,
      dry_run: dryRun,
      duration_ms,
      duration_human: `${(duration_ms / 1000).toFixed(1)}s`,
      finished_at: new Date().toISOString(),
    };

    console.log(
      `✅ [sync-leads-compras] Concluído em ${result.duration_human}: ` +
        `${stats.leads_atualizados} atualizados, ${stats.leads_falhou} falhas`,
    );

    LAST_SYNC_STATUS.running = false;
    LAST_SYNC_STATUS.finishedAt = result.finished_at;
    LAST_SYNC_STATUS.result = result;
    return result;
  } catch (err) {
    LAST_SYNC_STATUS.running = false;
    LAST_SYNC_STATUS.finishedAt = new Date().toISOString();
    LAST_SYNC_STATUS.result = { error: err.message };
    throw err;
  }
}

// Atualiza UMA task no ClickUp: status + 6 custom fields
async function atualizarLeadClickUp(u) {
  const headers = {
    Authorization: CLICKUP_API_KEY,
    'Content-Type': 'application/json',
  };
  const setField = (fieldId, value) =>
    axios.post(
      `https://api.clickup.com/api/v2/task/${u.task_id}/field/${fieldId}`,
      { value },
      { headers, timeout: 15000 },
    );

  // 1. Status → "comprou"
  await axios.put(
    `https://api.clickup.com/api/v2/task/${u.task_id}`,
    { status: 'comprou' },
    { headers, timeout: 15000 },
  );

  // 2-7. Custom fields (em paralelo)
  await Promise.all([
    setField(CRM_SYNC_FIELDS.COD_CLIENTE, `Cod. ${u.person_code}`),
    setField(CRM_SYNC_FIELDS.LTV, u.ltv_total),
    setField(CRM_SYNC_FIELDS.VL_PRIMEIRA_COMPRA, u.vl_primeira),
    u.dt_primeira
      ? setField(
          CRM_SYNC_FIELDS.DATA_PRIMEIRA_COMPRA,
          new Date(u.dt_primeira).getTime(),
        )
      : Promise.resolve(),
    u.dt_primeira_pos_auto
      ? setField(
          CRM_SYNC_FIELDS.DATA_PRIMEIRA_COMPRA_POS_CRM,
          new Date(u.dt_primeira_pos_auto).getTime(),
        )
      : Promise.resolve(),
    setField(
      CRM_SYNC_FIELDS.VL_PRIMEIRA_COMPRA_POS_CRM,
      u.vl_primeira_pos_auto,
    ),
  ]);
}

router.post(
  '/sync-leads-compras',
  asyncHandler(async (req, res) => {
    if (!CLICKUP_API_KEY || !CLICKUP_LIST_ID) {
      return errorResponse(res, 'ClickUp não configurado', 503, 'CLICKUP_OFF');
    }
    const dryRun = req.body?.dryRun === true;
    const limit = parseInt(req.body?.limit) || 0;
    const wait = req.body?.wait === true;

    if (LAST_SYNC_STATUS.running) {
      return successResponse(res, {
        running: true,
        startedAt: LAST_SYNC_STATUS.startedAt,
        message: 'Sync já está em execução',
      });
    }

    if (wait) {
      // Síncrono — aguarda concluir (uso pelo botão da UI quando dryRun)
      const result = await executarSyncLeadsCompras({
        dryRun,
        limit,
        source: 'manual',
      });
      return successResponse(res, result, 'Sync concluído');
    }

    // Default: dispara em background e retorna 202
    setImmediate(() => {
      executarSyncLeadsCompras({ dryRun, limit, source: 'manual' }).catch(
        (err) => {
          console.error('[sync-leads-compras] erro background:', err.message);
        },
      );
    });
    return successResponse(
      res,
      {
        running: true,
        message:
          'Sync iniciado em background. Use /sync-leads-compras-status para acompanhar.',
      },
      'Sync iniciado',
    );
  }),
);

router.get(
  '/sync-leads-compras-status',
  asyncHandler(async (req, res) => {
    return successResponse(res, LAST_SYNC_STATUS);
  }),
);

// ---------------------------------------------------------------------------
// 5. GET + POST /api/crm/roubos
//    Gerenciamento de disputas de leads entre instâncias (Supabase)
// ---------------------------------------------------------------------------
router.get(
  '/roubos',
  asyncHandler(async (req, res) => {
    try {
      const { data, error } = await supabase
        .from('crm_roubos')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return successResponse(res, data || []);
    } catch (err) {
      // Se a tabela não existir, retornar array vazio
      console.warn('crm_roubos: ', err.message);
      return successResponse(res, []);
    }
  }),
);

router.post(
  '/roubos',
  asyncHandler(async (req, res) => {
    const { action, tel, nome, deInst, paraInst, id } = req.body;

    if (!action) {
      return errorResponse(res, 'action é obrigatório', 400);
    }

    try {
      if (action === 'solicitar') {
        if (!tel || !deInst || !paraInst) {
          return errorResponse(
            res,
            'tel, deInst e paraInst são obrigatórios para solicitar',
            400,
          );
        }

        const { data, error } = await supabase
          .from('crm_roubos')
          .insert({
            tel,
            nome: nome || '',
            de_inst: deInst,
            para_inst: paraInst,
            status: 'disputa',
            created_at: new Date().toISOString(),
          })
          .select();

        if (error) throw error;
        return successResponse(res, data?.[0] || {}, 'Disputa criada');
      }

      if (action === 'ceder') {
        if (!id) return errorResponse(res, 'id é obrigatório para ceder', 400);

        const { data, error } = await supabase
          .from('crm_roubos')
          .update({ status: 'cedido', updated_at: new Date().toISOString() })
          .eq('id', id)
          .select();

        if (error) throw error;
        return successResponse(res, data?.[0] || {}, 'Lead cedido');
      }

      if (action === 'recusar') {
        if (!id)
          return errorResponse(res, 'id é obrigatório para recusar', 400);

        const { data, error } = await supabase
          .from('crm_roubos')
          .update({ status: 'evitado', updated_at: new Date().toISOString() })
          .eq('id', id)
          .select();

        if (error) throw error;
        return successResponse(res, data?.[0] || {}, 'Disputa recusada');
      }

      return errorResponse(
        res,
        'action inválida. Use: solicitar, ceder ou recusar',
        400,
      );
    } catch (err) {
      console.error('Erro em /roubos:', err.message);
      return successResponse(
        res,
        [],
        'Tabela crm_roubos pode não existir ainda',
      );
    }
  }),
);

// ---------------------------------------------------------------------------
// 5b. POST /api/crm/transferir-lead
//     Transfere um lead (task ClickUp) de um vendedor para outro.
//     Regras:
//       - Status do lead deve ser 'sql' ou '1º contato feito'
//       - Vendedor origem ≠ destino
//       - Mesma "Categoria do Lead" (mesmo canal de vendas)
//       - Atualiza ClickUp (custom field Vendedor) e registra em crm_roubos
// ---------------------------------------------------------------------------
const TRANSFER_VALID_STATUS = new Set([
  'sql',
  '1º contato feito',
  '1° contato feito',
  '1 contato feito',
]);

router.post(
  '/transferir-lead',
  asyncHandler(async (req, res) => {
    const { taskId, deVendedorClickupId, paraVendedorClickupId } = req.body;
    if (!taskId || !deVendedorClickupId || !paraVendedorClickupId) {
      return errorResponse(
        res,
        'taskId, deVendedorClickupId e paraVendedorClickupId obrigatórios',
        400,
        'MISSING_PARAMS',
      );
    }
    if (deVendedorClickupId === paraVendedorClickupId) {
      return errorResponse(
        res,
        'Vendedor de origem e destino são iguais',
        400,
        'SAME_VENDOR',
      );
    }
    if (!CLICKUP_API_KEY) {
      return errorResponse(
        res,
        'ClickUp não configurado (CLICKUP_API_KEY ausente)',
        500,
        'CLICKUP_MISSING_KEY',
      );
    }

    // 1) Fetch atual do lead no ClickUp (sempre fresco — não confia no front)
    let task;
    try {
      const { data } = await axios.get(
        `https://api.clickup.com/api/v2/task/${taskId}`,
        {
          headers: { Authorization: CLICKUP_API_KEY },
          timeout: 30000,
        },
      );
      task = data;
    } catch (err) {
      return errorResponse(
        res,
        `Falha ao buscar task no ClickUp: ${err.response?.data?.err || err.message}`,
        err.response?.status || 500,
        'CLICKUP_FETCH_FAIL',
      );
    }

    // 2) Status válido
    const statusName = String(task.status?.status || '')
      .trim()
      .toLowerCase();
    if (!TRANSFER_VALID_STATUS.has(statusName)) {
      return errorResponse(
        res,
        `Status "${task.status?.status || 'sem status'}" não permite roubo. Apenas SQL ou 1º Contato Feito.`,
        400,
        'INVALID_STATUS',
      );
    }

    // 3) Vendedor atual deve bater com o "de"
    const currentVendor = getClickupDropdownOption(task, VENDOR_FIELD_ID);
    if (!currentVendor || currentVendor.id !== deVendedorClickupId) {
      return errorResponse(
        res,
        `Vendedor atual do lead não confere (atual: ${currentVendor?.name || 'sem vendedor'}). O lead pode ter sido alterado.`,
        409,
        'VENDOR_MISMATCH',
      );
    }

    // 4) Mesma Categoria do Lead (canal de vendas no ClickUp)
    //    Validamos via mapeamento de vendedores: ambos devem atender a categoria do lead.
    //    A regra mínima: mesma categoria (a categoria não muda na transferência).
    //    Validação adicional: ambos vendedores existem no mapa.
    const vendedoresMap = await loadVendedoresMap();
    const deInfo = vendedoresMap.byClickupId[deVendedorClickupId];
    const paraInfo = vendedoresMap.byClickupId[paraVendedorClickupId];
    if (!deInfo || !paraInfo) {
      return errorResponse(
        res,
        'Vendedor de origem ou destino não encontrado no cadastro',
        400,
        'VENDOR_NOT_FOUND',
      );
    }

    const categoria =
      getClickupField(task, 'Categoria do Lead') || 'Sem Categoria';

    // 5) Atualiza Vendedor no ClickUp
    try {
      await axios.post(
        `https://api.clickup.com/api/v2/task/${taskId}/field/${VENDOR_FIELD_ID}`,
        { value: paraVendedorClickupId },
        {
          headers: {
            Authorization: CLICKUP_API_KEY,
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        },
      );
    } catch (err) {
      return errorResponse(
        res,
        `Falha ao atualizar vendedor no ClickUp: ${err.response?.data?.err || err.message}`,
        err.response?.status || 500,
        'CLICKUP_UPDATE_FAIL',
      );
    }

    // 6) Registra em crm_roubos (status='cedido' → conta como Ganho/Perdido nos cards)
    const phoneById = (() => {
      const cf = (task.custom_fields || []).find(
        (f) => f.id === PHONE_FIELD_ID,
      );
      return cf?.value ? String(cf.value).replace(/\D/g, '') : '';
    })();

    try {
      await supabase.from('crm_roubos').insert({
        task_id: taskId,
        canal_lead: categoria,
        tel: phoneById,
        nome: task.name || '',
        de_inst: deInfo.evolution_inst || deInfo.nome || '',
        para_inst: paraInfo.evolution_inst || paraInfo.nome || '',
        status: 'cedido',
        created_at: new Date().toISOString(),
      });
    } catch (err) {
      console.warn('[transferir-lead] Insert crm_roubos falhou:', err.message);
      // não bloqueia — ClickUp já foi atualizado
    }

    // 7) Invalida cache de leads pra próxima leitura refletir a mudança
    LEADS_CACHE.clear();

    return successResponse(
      res,
      {
        taskId,
        categoria,
        status: task.status?.status,
        de: {
          clickupId: deVendedorClickupId,
          nome: deInfo.nome,
          inst: deInfo.evolution_inst,
        },
        para: {
          clickupId: paraVendedorClickupId,
          nome: paraInfo.nome,
          inst: paraInfo.evolution_inst,
        },
      },
      'Lead transferido com sucesso',
    );
  }),
);

// ---------------------------------------------------------------------------
// 6. POST /api/crm/gerar-analise
//    Gera análise de cliente via IA (Groq ou OpenAI)
// ---------------------------------------------------------------------------
router.post(
  '/gerar-analise',
  asyncHandler(async (req, res) => {
    const { tel, nome, compras } = req.body;

    if (!tel) {
      return errorResponse(res, 'tel é obrigatório', 400);
    }

    const apiKey = GROQ_API_KEY || OPENAI_API_KEY;
    if (!apiKey) {
      return successResponse(res, {
        analise: {
          perfil:
            'Cliente sem histórico de análise (API de IA não configurada)',
          potencial: 'Médio',
          sugestao:
            'Configurar GROQ_API_KEY ou OPENAI_API_KEY para habilitar análises automáticas.',
        },
      });
    }

    const isGroq = !!GROQ_API_KEY;
    const baseUrl = isGroq
      ? 'https://api.groq.com/openai/v1/chat/completions'
      : 'https://api.openai.com/v1/chat/completions';
    const model = isGroq ? 'llama-3.1-70b-versatile' : 'gpt-4o-mini';

    const comprasTexto = Array.isArray(compras)
      ? compras
          .map((c) => `- ${c.produto || c.descricao || JSON.stringify(c)}`)
          .join('\n')
      : String(compras || 'Sem dados de compras');

    const prompt = `Analise o perfil deste cliente de atacado/varejo:
Nome: ${nome || 'Não informado'}
Telefone: ${tel}
Histórico de compras:
${comprasTexto}

Responda EXATAMENTE em JSON com estas 3 chaves:
{
  "perfil": "descrição breve do perfil de compra do cliente",
  "potencial": "Alto|Médio|Baixo",
  "sugestao": "sugestão de abordagem comercial"
}`;

    try {
      const { data } = await axios.post(
        baseUrl,
        {
          model,
          messages: [
            {
              role: 'system',
              content:
                'Você é um analista comercial. Responda apenas em JSON válido.',
            },
            { role: 'user', content: prompt },
          ],
          temperature: 0.4,
          max_tokens: 500,
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        },
      );

      const content = data.choices?.[0]?.message?.content || '{}';
      let analise;
      try {
        analise = JSON.parse(content);
      } catch {
        analise = { perfil: content, potencial: 'Indefinido', sugestao: '' };
      }

      return successResponse(res, { analise });
    } catch (error) {
      console.error('Erro ao gerar análise IA:', error.message);
      return errorResponse(
        res,
        error.response?.data?.error?.message ||
          error.message ||
          'Erro ao gerar análise',
        error.response?.status || 500,
      );
    }
  }),
);

// ---------------------------------------------------------------------------
// 7. GET /api/crm/erp-data
//    Carrega dados do ERP (clientes + transações) direto da API TOTVS,
//    substituindo o upload manual de XLSX. Retorna estrutura compatível
//    com CarteiraView, PerformanceView e UltimoContatoView.
//
//    Query params:
//      meses=12  (quantos meses de transações fiscais buscar, default 12)
//      modulo=multimarcas|revenda|business|franquia|varejo (filtra por canal)
//      force=1   (ignora cache)
// ---------------------------------------------------------------------------
router.get(
  '/erp-data',
  asyncHandler(async (req, res) => {
    const periodo = req.query.periodo || '';
    let dias = req.query.dias
      ? Math.min(365, Math.max(1, parseInt(req.query.dias, 10) || 0))
      : 0;
    let meses = 0;
    if (periodo === 'thisMonth') {
      // Do dia 1 do mês atual até hoje
      dias = new Date().getDate(); // dia atual = quantidade de dias desde o início do mês
    } else if (periodo === 'lastMonth') {
      // Mês anterior inteiro
      const hoje = new Date();
      const inicioMesPassado = new Date(
        hoje.getFullYear(),
        hoje.getMonth() - 1,
        1,
      );
      const fimMesPassado = new Date(hoje.getFullYear(), hoje.getMonth(), 0);
      dias =
        Math.ceil((fimMesPassado - inicioMesPassado) / (1000 * 60 * 60 * 24)) +
        hoje.getDate();
    } else if (!dias) {
      meses = Math.min(36, Math.max(1, parseInt(req.query.meses, 10) || 12));
    }
    const modulo = (req.query.modulo || '').toLowerCase();
    const force = req.query.force === '1';
    const startTime = Date.now();

    const cacheKey = `${periodo || (dias ? dias + 'd' : meses)}-${modulo}`;

    // Se há cache válido, retorna imediatamente (mesmo que force=1, primeiro responde depois recarrega)
    if (
      ERP_CACHE.data &&
      ERP_CACHE.key === cacheKey &&
      Date.now() - ERP_CACHE.timestamp < ERP_CACHE_TTL
    ) {
      // Se force=1, dispara reload em background sem bloquear
      if (force && !ERP_LOADING) {
        setImmediate(() =>
          carregarErpBackground(cacheKey, meses, modulo, dias),
        );
      }
      return successResponse(
        res,
        {
          ...ERP_CACHE.data,
          cached: true,
          cacheAge: Math.floor((Date.now() - ERP_CACHE.timestamp) / 1000),
        },
        'ERP carregado do cache',
      );
    }

    // Se já está carregando em background, retorna status
    if (ERP_LOADING) {
      return successResponse(
        res,
        {
          loading: true,
          progress: ERP_LOADING_PROGRESS,
          message: 'ERP está sendo carregado em background...',
        },
        'ERP em carregamento',
      );
    }

    // Sem cache e sem carga em andamento — dispara em background e responde com status
    if (!force) {
      setImmediate(() => carregarErpBackground(cacheKey, meses, modulo, dias));
      return successResponse(
        res,
        {
          loading: true,
          progress: ERP_LOADING_PROGRESS,
          message:
            'ERP iniciado em background. Chame /api/crm/erp-status para acompanhar.',
        },
        'ERP iniciando',
      );
    }
    // force=1 sem cache: dispara background também
    setImmediate(() => carregarErpBackground(cacheKey, meses, modulo, dias));
    return successResponse(
      res,
      {
        loading: true,
        progress: ERP_LOADING_PROGRESS,
        message:
          'ERP iniciado em background. Use /api/crm/erp-status para acompanhar.',
      },
      'ERP iniciando',
    );
  }),
);

// ---------------------------------------------------------------------------
// Função de carregamento ERP em background
// ---------------------------------------------------------------------------
async function carregarErpBackground(cacheKey, meses, modulo, dias = 0) {
  if (ERP_LOADING) return; // já rodando
  ERP_LOADING = true;
  ERP_LOADING_PROGRESS = { step: 'iniciando', page: 0, total: 0 };
  const startTime = Date.now();

  try {
    const tokenData = await getToken();
    if (!tokenData?.access_token) {
      console.error('❌ [erp-bg] Token TOTVS indisponível');
      return;
    }
    const token = tokenData.access_token;

    const hoje = new Date();
    let dataIni;
    if (dias > 0) {
      dataIni = new Date(hoje);
      dataIni.setDate(dataIni.getDate() - dias);
    } else {
      dataIni = new Date(hoje.getFullYear(), hoje.getMonth() - meses + 1, 1);
    }
    const startMov = dataIni.toISOString().slice(0, 10);
    const endMov = hoje.toISOString().slice(0, 10);

    // ─── 1+2+3) Vendedores, Clientes e Branches em PARALELO ──────────────
    ERP_LOADING_PROGRESS = {
      step: 'vendedores+clientes+branches',
      page: 0,
      total: 0,
    };
    console.log(`🚀 [erp-data] Buscando clientes + branches em paralelo...`);

    // Promise 1: Clientes Supabase (pageSize 10000 = ~10x menos queries)
    const clientesPromise = (async () => {
      const clientesRaw = [];
      const PAGE_SIZE_SUP = 10000;
      let supPage = 0;
      let supHasMore = true;
      while (supHasMore) {
        const { data: rows, error: supErr } = await supabase
          .from('pes_pessoa')
          .select(
            'code, nm_pessoa, fantasy_name, tipo_pessoa, uf, telefone, cpf, insert_date, addresses, is_customer',
          )
          .range(supPage * PAGE_SIZE_SUP, (supPage + 1) * PAGE_SIZE_SUP - 1);
        if (supErr) {
          console.warn(
            `⚠️ [erp-data] Supabase clientes pág ${supPage}: ${supErr.message}`,
          );
          break;
        }
        if (!rows || rows.length === 0) break;
        clientesRaw.push(...rows);
        supHasMore = rows.length === PAGE_SIZE_SUP;
        supPage++;
      }
      console.log(
        `✅ [erp-data] ${clientesRaw.length} clientes carregados do Supabase`,
      );
      return clientesRaw;
    })();

    // Promise 2: Branches (filiais)
    const branchesPromise = (async () => {
      let codes = [];
      try {
        const branchesResp = await axios.get(
          `${TOTVS_BASE_URL}/person/v2/branchesList?BranchCodePool=1&Page=1&PageSize=1000`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: 'application/json',
            },
            httpsAgent: totvsHttpsAgent,
            timeout: 15000,
          },
        );
        codes = (branchesResp.data?.items || [])
          .map((b) => parseInt(b.code))
          .filter((c) => !isNaN(c) && c > 0);
        console.log(`🏢 [erp-bg] ${codes.length} filiais carregadas (pool 1)`);
      } catch (err) {
        console.warn(
          `⚠️ [erp-bg] Falha ao buscar branches (usando fallback): ${err.message}`,
        );
        codes = [
          1, 2, 5, 6, 11, 55, 65, 75, 85, 87, 88, 89, 90, 91, 92, 93, 94, 95,
          96, 97, 98, 99, 100, 101,
        ];
      }

      // Suplemento: branches 1-5999 que tiveram operação de revenda no Supabase
      // (cobre filiais fora do pool 1 com vendas B2B/atacado)
      try {
        const REVENDA_OPS_FOR_BRANCH = [
          7236, 9122, 5102, 7242, 9061, 9001, 9121,
        ];
        const extraBranches = new Set();
        let off = 0;
        while (true) {
          const { data, error } = await supabaseFiscal
            .from('notas_fiscais')
            .select('branch_code')
            .eq('operation_type', 'Output')
            .in('operation_code', REVENDA_OPS_FOR_BRANCH)
            .gt('branch_code', 0)
            .lt('branch_code', 6000)
            .lt('person_code', 100000000)
            .range(off, off + 999);
          if (error || !data || data.length === 0) break;
          for (const r of data) extraBranches.add(parseInt(r.branch_code));
          if (data.length < 1000) break;
          off += 1000;
        }
        const codeSet = new Set(codes);
        const novos = [...extraBranches].filter((b) => !codeSet.has(b));
        if (novos.length > 0) {
          console.log(
            `🏢 [erp-bg] +${novos.length} filiais com revenda fora do pool 1: ${novos.join(',')}`,
          );
          codes = [...codes, ...novos];
        }
      } catch (e) {
        console.warn(
          `⚠️ [erp-bg] Falha ao expandir branches revenda: ${e.message}`,
        );
      }

      return codes;
    })();

    // Aguarda clientes e branches em paralelo
    const [clientesRaw, fmBranchCodes] = await Promise.all([
      clientesPromise,
      branchesPromise,
    ]);

    // Agora busca vendedores usando TODAS as filiais (fmBranchCodes)
    const sellersMap = {};
    try {
      const sellersResp = await axios.post(
        `${TOTVS_BASE_URL}/sale-panel/v2/sellers-list/search`,
        { branchs: fmBranchCodes, datemin: startMov, datemax: endMov },
        {
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Bearer ${token}`,
          },
          httpsAgent: totvsHttpsAgent,
          timeout: 30000,
        },
      );
      const sellersData =
        sellersResp.data?.dataRow || sellersResp.data?.items || [];
      for (const s of sellersData) {
        const code = s.seller_code || s.sellerCode || s.code;
        const name =
          s.seller_name || s.sellerName || s.name || `Vendedor ${code}`;
        if (code) sellersMap[code] = { code, name, branchCode: s.branch_code };
      }
      console.log(
        `✅ [erp-data] ${Object.keys(sellersMap).length} vendedores mapeados (${fmBranchCodes.length} filiais)`,
      );
    } catch (err) {
      console.warn(`⚠️ [erp-data] Falha ao buscar vendedores: ${err.message}`);
    }

    // ─── 3) Transações fiscais ─────────────────────────────────────────────
    console.log(
      `📊 [erp-data] Buscando movimento fiscal ${startMov} → ${endMov} (${fmBranchCodes.length} filiais)...`,
    );
    const fmEndpoint = `${TOTVS_BASE_URL}/analytics/v2/fiscal-movement/search`;
    const invoicesEndpoint = `${TOTVS_BASE_URL}/fiscal/v2/invoices/search`;

    // Operações de devolução/credev consideradas para LÍQUIDO (mesma lógica da Analytics)
    // CFOPs canônicos + ops TOTVS internas + ops de devolução de revenda confirmadas
    const DEVOL_OPS_LIQUIDO_ERP = new Set([
      1202,
      1204,
      1411,
      1410,
      2202,
      2411, // CFOPs canônicos
      1950,
      21, // TOTVS interno + credev item-level
      7245,
      7244,
      7240,
      7790,
      1214,
      20, // ops TOTVS revenda devolução
    ]);

    // Calcular períodos mensais — parse como hora local para evitar bug de timezone UTC
    const periodos = [];
    const [yI, mI, dI] = startMov.split('-').map(Number);
    const [yF, mF, dF] = endMov.split('-').map(Number);
    const dtIni = new Date(yI, mI - 1, dI);
    const dtFim = new Date(yF, mF - 1, dF);
    const fmtDate = (d) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    let cursor = new Date(dtIni);
    while (cursor <= dtFim) {
      const ini = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
      const fim = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
      if (fim > dtFim) fim.setTime(dtFim.getTime());
      if (ini < dtIni) ini.setTime(dtIni.getTime());
      periodos.push({ start: fmtDate(ini), end: fmtDate(fim) });
      cursor.setMonth(cursor.getMonth() + 1);
    }

    async function fetchPeriodo({ start, end }) {
      const transacoes = [];
      let page = 1;
      const pageSize = 1000;
      while (page <= 30) {
        let resp;
        try {
          resp = await axios.post(
            fmEndpoint,
            {
              filter: {
                branchCodeList: fmBranchCodes,
                startMovementDate: `${start}T00:00:00`,
                endMovementDate: `${end}T23:59:59`,
              },
              page,
              pageSize,
            },
            {
              headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                Authorization: `Bearer ${token}`,
              },
              httpsAgent: totvsHttpsAgent,
              timeout: 120000,
            },
          );
        } catch (err) {
          console.warn(
            `⚠️ [erp-bg] ${start}~${end} pág ${page}: ${err.message}`,
          );
          break;
        }
        const items = resp.data?.items || [];
        for (const it of items) {
          if (!it.personCode) continue;
          const opCode = parseInt(it.operationCode);
          // Sales válidas → transação positiva
          if (it.operationModel === 'Sales' && OPERACOES_VALIDAS.has(opCode)) {
            const valor = it.netValue || it.grossValue || 0;
            if (valor <= 0) continue;
            const canal =
              OPERACOES_VAREJO.includes(opCode) && it.branchCode !== 2
                ? 'varejo'
                : 'revenda';
            transacoes.push({
              personCode: it.personCode,
              dt: it.movementDate,
              vlFat: valor,
              total: valor,
              credev: 0,
              quantity: it.quantity || 1,
              sellerCode: it.sellerCode,
              branchCode: it.branchCode,
              operationCode: opCode,
              canal,
              kind: 'sale',
            });
            continue;
          }
          // SaleReturns / devoluções → transação NEGATIVA (alinha com Analytics líquido)
          if (
            it.operationModel === 'SaleReturns' &&
            DEVOL_OPS_LIQUIDO_ERP.has(opCode)
          ) {
            const valor = it.netValue || it.grossValue || 0;
            if (valor <= 0) continue;
            // Canal heurístico: mesmo critério de Sales, default revenda
            const canal =
              OPERACOES_VAREJO.includes(opCode) && it.branchCode !== 2
                ? 'varejo'
                : 'revenda';
            transacoes.push({
              personCode: it.personCode,
              dt: it.movementDate,
              vlFat: -valor,
              total: -valor,
              credev: 0,
              quantity: 0,
              sellerCode: it.sellerCode,
              branchCode: it.branchCode,
              operationCode: opCode,
              canal,
              kind: 'return',
            });
          }
        }
        if (items.length < pageSize) break;
        page++;
      }
      return transacoes;
    }

    // Busca credev (vale-troca) usado em pagamento via fiscal/v2/invoices
    // Emite UMA transação negativa por NF que tenha credev > 0,
    // atribuída ao dealerCode (vendedor real) extraído de items[].products[].
    async function fetchPeriodoCredev({ start, end }) {
      const transacoes = [];
      // Busca tanto Output (saídas) — credev aparece em payments dessas NFs
      let page = 1;
      const pageSize = 100; // invoices/search é mais pesado
      while (page <= 50) {
        let resp;
        try {
          resp = await axios.post(
            invoicesEndpoint,
            {
              filter: {
                branchCodeList: fmBranchCodes,
                operationCodeList: [...OPERACOES_VALIDAS],
                operationType: 'Output',
                startIssueDate: `${start}T00:00:00`,
                endIssueDate: `${end}T23:59:59`,
              },
              expand: 'payments,items',
              page,
              pageSize,
            },
            {
              headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                Authorization: `Bearer ${token}`,
              },
              httpsAgent: totvsHttpsAgent,
              timeout: 120000,
            },
          );
        } catch (err) {
          console.warn(
            `⚠️ [erp-bg credev] ${start}~${end} pág ${page}: ${err.message}`,
          );
          break;
        }
        const items = resp.data?.items || [];
        for (const nf of items) {
          if (nf.invoiceStatus === 'Canceled' || nf.invoiceStatus === 'Deleted')
            continue;
          if (!nf.personCode) continue;
          let credev = 0;
          for (const p of nf.payments || []) {
            if (p.documentType === 'Credev') {
              credev += parseFloat(p.paymentValue) || 0;
            }
          }
          if (credev <= 0) continue;
          // Vendedor: dealerCode em items[].products[] (mesma lógica Analytics)
          let dc = null;
          for (const item of nf.items || []) {
            for (const p of item.products || []) {
              if (p.dealerCode) {
                dc = parseInt(p.dealerCode);
                break;
              }
            }
            if (dc) break;
          }
          const opCode = parseInt(nf.operationCode);
          const canal =
            OPERACOES_VAREJO.includes(opCode) && nf.branchCode !== 2
              ? 'varejo'
              : 'revenda';
          transacoes.push({
            personCode: nf.personCode,
            dt: nf.issueDate,
            vlFat: -credev,
            total: -credev,
            credev,
            quantity: 0,
            sellerCode: dc,
            branchCode: nf.branchCode,
            operationCode: opCode,
            canal,
            kind: 'credev',
          });
        }
        const totalPages =
          resp.data?.totalPages ||
          (resp.data?.totalItems
            ? Math.ceil(resp.data.totalItems / pageSize)
            : page);
        if (page >= totalPages || items.length < pageSize) break;
        page++;
      }
      return transacoes;
    }

    const allTransacoes = [];
    ERP_LOADING_PROGRESS = {
      step: 'transacoes',
      page: 0,
      total: periodos.length,
    };
    for (let i = 0; i < periodos.length; i += 4) {
      const batch = periodos.slice(i, i + 4);
      const results = await Promise.all(batch.map(fetchPeriodo));
      for (const arr of results) allTransacoes.push(...arr);
      ERP_LOADING_PROGRESS = {
        step: 'transacoes',
        page: i + batch.length,
        total: periodos.length,
      };
    }
    const nSales = allTransacoes.filter((t) => t.kind === 'sale').length;
    const nReturns = allTransacoes.filter((t) => t.kind === 'return').length;
    console.log(
      `✅ [erp-data] ${allTransacoes.length} transações carregadas (${nSales} Sales, ${nReturns} Returns)`,
    );

    // ─── 3.1) Credev (vale-troca) via fiscal/v2/invoices ───────────────────
    // Para alinhar com a Analytics: subtrai credev usado em pagamento de cada NF
    ERP_LOADING_PROGRESS = {
      step: 'credev',
      page: 0,
      total: periodos.length,
    };
    console.log(
      `🧾 [erp-data] Buscando credev (vale-troca) via fiscal/v2/invoices...`,
    );
    let totalCredevTx = 0;
    for (let i = 0; i < periodos.length; i += 2) {
      const batch = periodos.slice(i, i + 2);
      const results = await Promise.all(
        batch.map((p) => fetchPeriodoCredev(p).catch(() => [])),
      );
      for (const arr of results) {
        allTransacoes.push(...arr);
        totalCredevTx += arr.length;
      }
      ERP_LOADING_PROGRESS = {
        step: 'credev',
        page: i + batch.length,
        total: periodos.length,
      };
    }
    console.log(
      `✅ [erp-data] ${totalCredevTx} transações de credev (subtraídas do faturamento)`,
    );

    // ─── 3.5) Enriquecer sellerCode com dealerCode das notas_fiscais ──────
    // O fiscal-movement retorna sellerCode da filial (genérico), mas o vendedor
    // real está no dealerCode dos items/products da NF. Buscamos isso aqui.
    ERP_LOADING_PROGRESS = { step: 'dealer-codes', page: 0, total: 0 };
    console.log(
      `🔍 [erp-data] Buscando dealerCodes de notas_fiscais para corrigir vendedores...`,
    );
    const dealerMap = new Map(); // "personCode::issueDate" → dealerCode
    const DEALER_PAGE = 1000;
    let dealerOff = 0;
    let dealerMore = true;
    while (dealerMore) {
      const { data: nfRows, error: nfErr } = await supabaseFiscal
        .from('notas_fiscais')
        .select('person_code, issue_date, items')
        .eq('operation_type', 'Output')
        .not('invoice_status', 'eq', 'Canceled')
        .not('invoice_status', 'eq', 'Deleted')
        .gte('issue_date', startMov)
        .lte('issue_date', endMov)
        .range(dealerOff, dealerOff + DEALER_PAGE - 1);
      if (nfErr || !nfRows || nfRows.length === 0) break;
      for (const nf of nfRows) {
        const key = `${nf.person_code}::${nf.issue_date}`;
        if (dealerMap.has(key)) continue;
        for (const item of nf.items || []) {
          const prods = item.products?.length > 0 ? item.products : [item];
          for (const p of prods) {
            const dc = parseInt(p.dealerCode);
            if (dc && !isNaN(dc)) {
              dealerMap.set(key, dc);
              break;
            }
          }
          if (dealerMap.has(key)) break;
        }
      }
      dealerMore = nfRows.length === DEALER_PAGE;
      dealerOff += DEALER_PAGE;
      ERP_LOADING_PROGRESS.page = dealerOff;
    }
    console.log(
      `✅ [erp-data] ${dealerMap.size} dealerCodes encontrados em notas_fiscais`,
    );
    // DEBUG: amostrar chaves do dealerMap e transações para diagnóstico
    const dmKeys = Array.from(dealerMap.keys()).slice(0, 5);
    console.log(
      `🔍 [dealer-debug] Amostra dealerMap keys: ${JSON.stringify(dmKeys)}`,
    );
    const txSample = allTransacoes
      .slice(0, 5)
      .map((t) => `${t.personCode}::${t.dt?.slice(0, 10)}`);
    console.log(
      `🔍 [dealer-debug] Amostra tx keys: ${JSON.stringify(txSample)}`,
    );
    // Contar quantos personCodes das tx existem no dealerMap (por personCode apenas)
    const dmPersons = new Set();
    for (const k of dealerMap.keys()) dmPersons.add(k.split('::')[0]);
    const txPersonMatch = new Set();
    for (const tx of allTransacoes) {
      if (dmPersons.has(String(tx.personCode)))
        txPersonMatch.add(tx.personCode);
    }
    console.log(
      `🔍 [dealer-debug] PersonCodes em dealerMap: ${dmPersons.size}, match com txs: ${txPersonMatch.size}`,
    );

    // Override sellerCode nas transações com o dealerCode real
    let dealerOverrides = 0;
    for (const tx of allTransacoes) {
      const txDate = tx.dt ? tx.dt.slice(0, 10) : '';
      const key = `${tx.personCode}::${txDate}`;
      const dc = dealerMap.get(key);
      if (dc) {
        tx.sellerCode = dc;
        dealerOverrides++;
      }
    }
    console.log(
      `✅ [erp-data] ${dealerOverrides}/${allTransacoes.length} transações atualizadas com dealerCode`,
    );

    // ─── 4) Montar clientes com status ────────────────────────────────────
    const txByPerson = {};
    // lastSellerByPerson: vendedor da última transação (pelo dtStr mais recente)
    const lastSellerByPerson = {};
    for (const tx of allTransacoes) {
      if (!txByPerson[tx.personCode]) txByPerson[tx.personCode] = [];
      const dt = new Date(tx.dt);
      const mes = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
      txByPerson[tx.personCode].push({
        mes,
        dtStr: tx.dt,
        total: tx.total,
        vlFat: tx.vlFat,
        credev: tx.credev,
        quantity: tx.quantity,
        sellerCode: tx.sellerCode,
        branchCode: tx.branchCode,
        canal: tx.canal,
      });
      // Atualizar último vendedor se esta tx for mais recente
      if (tx.sellerCode) {
        const prev = lastSellerByPerson[tx.personCode];
        if (!prev || tx.dt > prev.dt) {
          lastSellerByPerson[tx.personCode] = {
            dt: tx.dt,
            sellerCode: tx.sellerCode,
          };
        }
      }
    }

    // ─── 4.5) Preencher vendedor histórico via notas_fiscais para clientes sem vendedor ──
    const clientesSemVendedor = clientesRaw.filter(
      (c) => !lastSellerByPerson[c.code],
    );
    if (clientesSemVendedor.length > 0) {
      console.log(
        `📋 [erp-data] ${clientesSemVendedor.length} clientes sem vendedor no período. Buscando histórico em notas_fiscais...`,
      );
      const pendentes = new Set(clientesSemVendedor.map((c) => c.code));
      const NF_PAGE = 1000;
      let nfOffset = 0;
      let nfHasMore = true;
      while (nfHasMore && pendentes.size > 0) {
        const { data: nfRows, error: nfErr } = await supabaseFiscal
          .from('notas_fiscais')
          .select(
            'person_code, items, issue_date, total_value, operation_code, branch_code',
          )
          .eq('operation_type', 'Output')
          .not('invoice_status', 'eq', 'Canceled')
          .not('invoice_status', 'eq', 'Deleted')
          .order('issue_date', { ascending: false })
          .range(nfOffset, nfOffset + NF_PAGE - 1);
        if (nfErr || !nfRows || nfRows.length === 0) break;
        for (const nf of nfRows) {
          if (!pendentes.has(nf.person_code)) continue;
          if (lastSellerByPerson[nf.person_code]) {
            pendentes.delete(nf.person_code);
            continue;
          }
          const items = nf.items || [];
          let dealerCode = null;
          for (const item of items) {
            const prods = item.products?.length > 0 ? item.products : [item];
            for (const p of prods) {
              const dc = parseInt(p.dealerCode);
              if (dc && !isNaN(dc)) {
                dealerCode = dc;
                break;
              }
            }
            if (dealerCode) break;
          }
          if (dealerCode) {
            lastSellerByPerson[nf.person_code] = {
              dt: nf.issue_date,
              sellerCode: dealerCode,
            };
            // Adiciona uma transação histórica mínima para que o cliente tenha dados
            const opCode = nf.operation_code || 0;
            const canal =
              OPERACOES_VAREJO.includes(opCode) && nf.branch_code !== 2
                ? 'varejo'
                : 'revenda';
            if (!txByPerson[nf.person_code]) txByPerson[nf.person_code] = [];
            txByPerson[nf.person_code].push({
              mes: nf.issue_date ? nf.issue_date.slice(0, 7) : '',
              dtStr: nf.issue_date,
              total: nf.total_value || 0,
              vlFat: nf.total_value || 0,
              credev: 0,
              quantity: 1,
              sellerCode: dealerCode,
              branchCode: nf.branch_code || 0,
              canal,
            });
            pendentes.delete(nf.person_code);
          }
        }
        nfHasMore = nfRows.length === NF_PAGE;
        nfOffset += NF_PAGE;
      }
      console.log(
        `✅ [erp-data] ${clientesSemVendedor.length - pendentes.size} clientes obtiveram vendedor histórico de notas_fiscais`,
      );
    }

    function pickMainSeller(personCode) {
      const last = lastSellerByPerson[personCode];
      if (!last) return { code: null, name: '' };
      const code = last.sellerCode;
      const seller = sellersMap[code];
      return {
        code: parseInt(code),
        name: seller?.name || `Vendedor ${code}`,
      };
    }

    const DIAS_ALERTA = 60,
      DIAS_INATIVO = 90,
      hojeMs = Date.now();
    const clientes = [];
    const vendedoresSet = new Map();

    // Helper: extrai telefone primário (com DDD) do array phones do TOTVS
    const _pickPrimaryPhone = (phones) => {
      if (!Array.isArray(phones) || phones.length === 0) return '';
      const p = phones.find((x) => x.isDefault) || phones[0];
      const ddd = p.ddd ? `${p.ddd}` : '';
      const num = p.number || p.phoneNumber || '';
      return `${ddd}${num}`.replace(/\D/g, '');
    };
    const _pickAddrInfo = (addresses) => {
      if (!Array.isArray(addresses) || addresses.length === 0)
        return { cidade: '', uf: '' };
      const com = addresses.find((x) => x.addressType === 'Commercial');
      const def = addresses.find((x) => x.isDefault);
      const a =
        com ||
        def ||
        addresses.find((x) => x.cityName || x.city) ||
        addresses[0];
      return {
        cidade: a?.cityName || a?.city || '',
        uf: a?.stateAbbreviation || a?.state || a?.uf || '',
      };
    };

    // Resolver clientes do pes_pessoa que estão sem nome OU sem telefone/cidade
    // (incluímos os que têm nome mas faltam contato/endereço, p/ exibir na carteira)
    // Restringe a clientes que tiveram transação no período (têm presença na carteira),
    // p/ evitar enriquecer dezenas de milhares de cadastros sem movimentação.
    const clientesSemNome = clientesRaw.filter((c) => {
      const temTx = !!txByPerson[c.code]?.length;
      if (!temTx) return false;
      const semNome = !c.nm_pessoa && !c.fantasy_name;
      const semFone = !c.telefone;
      const addrs = Array.isArray(c.addresses) ? c.addresses : [];
      const semCidade = !addrs.some((a) => a && (a.cityName || a.city));
      return semNome || semFone || semCidade;
    });
    const supNamesMap = {}; // code → { name, fantasyName, telefone, cpf, uf, cidade, tipoPessoa, insertDate }
    if (clientesSemNome.length > 0) {
      console.log(
        `🔍 [erp-data] ${clientesSemNome.length} clientes em pes_pessoa sem nome. Buscando na API TOTVS...`,
      );
      ERP_LOADING_PROGRESS = {
        step: 'nomes-pes_pessoa',
        page: 0,
        total: clientesSemNome.length,
      };
      const BATCH_SIZE = 200;
      const semNomeCodes = clientesSemNome.map((c) => c.code);
      for (let i = 0; i < semNomeCodes.length; i += BATCH_SIZE) {
        const batch = semNomeCodes.slice(i, i + BATCH_SIZE);
        ERP_LOADING_PROGRESS = {
          step: 'nomes-pes_pessoa',
          page: i + batch.length,
          total: semNomeCodes.length,
        };
        try {
          const [pjResp, pfResp] = await Promise.all([
            axios
              .post(
                `${TOTVS_BASE_URL}/person/v2/legal-entities/search`,
                {
                  filter: { personCodeList: batch },
                  expand: 'phones,addresses',
                  page: 1,
                  pageSize: batch.length,
                },
                {
                  headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                    Authorization: `Bearer ${token}`,
                  },
                  httpsAgent: totvsHttpsAgent,
                  timeout: 15000,
                },
              )
              .catch(() => ({ data: { items: [] } })),
            axios
              .post(
                `${TOTVS_BASE_URL}/person/v2/individuals/search`,
                {
                  filter: { personCodeList: batch },
                  expand: 'phones,addresses',
                  page: 1,
                  pageSize: batch.length,
                },
                {
                  headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                    Authorization: `Bearer ${token}`,
                  },
                  httpsAgent: totvsHttpsAgent,
                  timeout: 15000,
                },
              )
              .catch(() => ({ data: { items: [] } })),
          ]);
          for (const item of [
            ...(pjResp.data?.items || []),
            ...(pfResp.data?.items || []),
          ]) {
            if (!item.code) continue;
            const addr = _pickAddrInfo(item.addresses);
            supNamesMap[item.code] = {
              name: item.name || '',
              fantasyName: item.fantasyName || '',
              telefone: _pickPrimaryPhone(item.phones),
              cidade: addr.cidade,
              uf: addr.uf || item.uf || '',
              insertDate: item.insertDate || '',
            };
          }
        } catch (err) {
          console.warn(
            `⚠️ [erp-data] Falha ao buscar nomes pes_pessoa batch ${i}: ${err.message}`,
          );
        }
      }
      console.log(
        `✅ [erp-data] ${Object.keys(supNamesMap).length}/${clientesSemNome.length} nomes resolvidos para clientes pes_pessoa`,
      );
    }

    for (const c of clientesRaw) {
      const transacoes = txByPerson[c.code] || [];
      const mainSeller = pickMainSeller(c.code);
      const vendedor = mainSeller.name || c.vendedor || c.sellerName || '';
      const vendedorCode = mainSeller.code;
      if (vendedor && vendedorCode) vendedoresSet.set(vendedor, vendedorCode);
      const tipo = c.tipo_pessoa === 'PJ' ? 'PJ' : 'PF';
      let ultimaCompra = null,
        diasSemComprar = null,
        statusCarteira = 'sem_compra';
      if (transacoes.length > 0) {
        ultimaCompra = transacoes.reduce(
          (max, t) => (t.dtStr > max ? t.dtStr : max),
          '',
        );
        if (ultimaCompra) {
          const ultMs = new Date(ultimaCompra).getTime();
          diasSemComprar = Math.floor((hojeMs - ultMs) / 86400000);
          statusCarteira =
            diasSemComprar < DIAS_ALERTA
              ? 'ativo'
              : diasSemComprar <= DIAS_INATIVO
                ? 'a_inativar'
                : 'inativo';
        }
      }
      let canalPredominante = '';
      if (transacoes.length > 0) {
        const canaisCount = {};
        for (const t of transacoes) {
          const c2 = t.canal || 'outro';
          canaisCount[c2] = (canaisCount[c2] || 0) + 1;
        }
        canalPredominante = Object.entries(canaisCount).sort(
          (a, b) => b[1] - a[1],
        )[0][0];
      }
      const resolvedSup = supNamesMap[c.code];
      const supAddr = _pickAddrInfo(c.addresses);
      const supCidade = supAddr.cidade;
      const supUf = c.uf || supAddr.uf;
      clientes.push({
        cod: String(c.code),
        nome:
          c.nm_pessoa ||
          c.fantasy_name ||
          resolvedSup?.name ||
          resolvedSup?.fantasyName ||
          `Cliente ${c.code}`,
        vendedor,
        vendedorCode,
        tipo,
        tipoPessoa: c.tipo_pessoa,
        canal: canalPredominante,
        statusCarteira,
        dtCadastroStr: c.insert_date || resolvedSup?.insertDate || '',
        cidade: supCidade || resolvedSup?.cidade || '',
        uf: supUf || resolvedSup?.uf || '',
        fone: c.telefone || resolvedSup?.telefone || '',
        cnpjCpf: c.cpf || '',
        transacoes,
        ltv: transacoes.reduce((s, t) => s + (t.total || 0), 0),
        ultimaCompra,
        diasSemComprar,
        // true se o cliente foi cadastrado no TOTVS dentro do período carregado → proxy de "primeira compra"
        primeiraCompra: !!(c.insert_date && new Date(c.insert_date) >= dataIni),
      });
    }

    // ─── 5.5) Incluir clientes de txByPerson que não estão no pes_pessoa ──
    const clientesRawCodes = new Set(clientesRaw.map((c) => c.code));
    const missingCodes = [];
    for (const personCode of Object.keys(txByPerson)) {
      const pc = parseInt(personCode);
      if (!clientesRawCodes.has(pc) && txByPerson[personCode]?.length > 0) {
        missingCodes.push(pc);
      }
    }

    // Buscar nomes dos clientes faltantes na API TOTVS (PF + PJ)
    const missingNamesMap = {}; // code → { name, fantasyName, tipoPessoa }
    if (missingCodes.length > 0) {
      console.log(
        `🔍 [erp-data] Buscando nomes de ${missingCodes.length} clientes sem cadastro em pes_pessoa...`,
      );
      ERP_LOADING_PROGRESS = {
        step: 'nomes-extras',
        page: 0,
        total: missingCodes.length,
      };
      const BATCH_SIZE = 200;
      for (let i = 0; i < missingCodes.length; i += BATCH_SIZE) {
        const batch = missingCodes.slice(i, i + BATCH_SIZE);
        ERP_LOADING_PROGRESS = {
          step: 'nomes-extras',
          page: i + batch.length,
          total: missingCodes.length,
        };
        try {
          // Busca PJ e PF em paralelo para cada batch
          const [pjResp, pfResp] = await Promise.all([
            axios
              .post(
                `${TOTVS_BASE_URL}/person/v2/legal-entities/search`,
                {
                  filter: { personCodeList: batch },
                  expand: 'phones,addresses',
                  page: 1,
                  pageSize: batch.length,
                },
                {
                  headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                    Authorization: `Bearer ${token}`,
                  },
                  httpsAgent: totvsHttpsAgent,
                  timeout: 15000,
                },
              )
              .catch(() => ({ data: { items: [] } })),
            axios
              .post(
                `${TOTVS_BASE_URL}/person/v2/individuals/search`,
                {
                  filter: { personCodeList: batch },
                  expand: 'phones,addresses',
                  page: 1,
                  pageSize: batch.length,
                },
                {
                  headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                    Authorization: `Bearer ${token}`,
                  },
                  httpsAgent: totvsHttpsAgent,
                  timeout: 15000,
                },
              )
              .catch(() => ({ data: { items: [] } })),
          ]);
          for (const item of [
            ...(pjResp.data?.items || []),
            ...(pfResp.data?.items || []),
          ]) {
            if (!item.code) continue;
            const addr = _pickAddrInfo(item.addresses);
            missingNamesMap[item.code] = {
              name: item.name || item.fantasyName || '',
              fantasyName: item.fantasyName || '',
              tipoPessoa: item.cnpj ? 'PJ' : 'PF',
              telefone: _pickPrimaryPhone(item.phones),
              cidade: addr.cidade,
              uf: addr.uf || item.uf || '',
              cpf: item.cnpj || item.cpf || '',
              insertDate: item.insertDate || '',
            };
          }
        } catch (err) {
          console.warn(
            `⚠️ [erp-data] Falha ao buscar nomes batch ${i}: ${err.message}`,
          );
        }
      }
      console.log(
        `✅ [erp-data] ${Object.keys(missingNamesMap).length}/${missingCodes.length} nomes resolvidos via API TOTVS`,
      );
    }

    let clientesSoTx = 0;
    for (const [personCode, transacoes] of Object.entries(txByPerson)) {
      const pc = parseInt(personCode);
      if (clientesRawCodes.has(pc)) continue;
      if (!transacoes || transacoes.length === 0) continue;
      const mainSeller = pickMainSeller(pc);
      const vendedor = mainSeller.name || '';
      const vendedorCode = mainSeller.code;
      if (vendedor && vendedorCode) vendedoresSet.set(vendedor, vendedorCode);
      let ultimaCompra = null,
        diasSemComprar = null,
        statusCarteira = 'sem_compra';
      if (transacoes.length > 0) {
        ultimaCompra = transacoes.reduce(
          (max, t) => (t.dtStr > max ? t.dtStr : max),
          '',
        );
        if (ultimaCompra) {
          const ultMs = new Date(ultimaCompra).getTime();
          diasSemComprar = Math.floor((hojeMs - ultMs) / 86400000);
          statusCarteira =
            diasSemComprar < DIAS_ALERTA
              ? 'ativo'
              : diasSemComprar <= DIAS_INATIVO
                ? 'a_inativar'
                : 'inativo';
        }
      }
      let canalPredominante = '';
      if (transacoes.length > 0) {
        const canaisCount = {};
        for (const t of transacoes) {
          canaisCount[t.canal || 'outro'] =
            (canaisCount[t.canal || 'outro'] || 0) + 1;
        }
        canalPredominante = Object.entries(canaisCount).sort(
          (a, b) => b[1] - a[1],
        )[0][0];
      }
      const resolved = missingNamesMap[pc];
      clientes.push({
        cod: String(pc),
        nome: resolved?.name || resolved?.fantasyName || `Cliente ${pc}`,
        vendedor,
        vendedorCode,
        tipo: resolved?.tipoPessoa || 'PF',
        tipoPessoa: resolved?.tipoPessoa || '',
        canal: canalPredominante,
        statusCarteira,
        dtCadastroStr: resolved?.insertDate || '',
        cidade: resolved?.cidade || '',
        uf: resolved?.uf || '',
        fone: resolved?.telefone || '',
        cnpjCpf: resolved?.cpf || '',
        transacoes,
        ltv: transacoes.reduce((s, t) => s + (t.total || 0), 0),
        ultimaCompra,
        diasSemComprar,
        primeiraCompra: !!(
          resolved?.insertDate && new Date(resolved.insertDate) >= dataIni
        ),
      });
      clientesSoTx++;
    }
    if (clientesSoTx > 0) {
      console.log(
        `✅ [erp-data] ${clientesSoTx} clientes extras criados a partir de transações TOTVS (${Object.keys(missingNamesMap).length} com nome resolvido)`,
      );
    }

    // ─── 6) Classifica clientType: abertura / reativação / recorrente ────
    // abertura  → cliente NUNCA comprou antes de dataIni
    // reativacao → cliente comprou antes mas com gap ≥ 60 dias
    // recorrente → comprou nos últimos 60 dias antes de dataIni
    try {
      ERP_LOADING_PROGRESS = {
        step: 'client-type',
        page: 0,
        total: clientes.length,
      };
      const REATIVACAO_DAYS = 60;
      const lastPurchaseBefore = new Map(); // pc → issue_date
      const datemin = startMov; // dataIni
      const personCodesAll = clientes
        .map((c) => parseInt(c.cod))
        .filter(Boolean);
      const CHUNK_R = 500;
      const PG = 1000;
      for (let i = 0; i < personCodesAll.length; i += CHUNK_R) {
        const chunk = personCodesAll.slice(i, i + CHUNK_R);
        ERP_LOADING_PROGRESS = {
          step: 'client-type',
          page: i + chunk.length,
          total: personCodesAll.length,
        };
        let off = 0;
        while (true) {
          const { data, error } = await supabaseFiscal
            .from('notas_fiscais')
            .select('person_code, issue_date')
            .eq('operation_type', 'Output')
            .not('invoice_status', 'eq', 'Canceled')
            .not('invoice_status', 'eq', 'Deleted')
            .lt('issue_date', datemin)
            .in('person_code', chunk)
            .lt('person_code', 100000000)
            .order('issue_date', { ascending: false })
            .range(off, off + PG - 1);
          if (error || !data || data.length === 0) break;
          for (const r of data) {
            const pc = r.person_code;
            if (!lastPurchaseBefore.has(pc)) {
              lastPurchaseBefore.set(pc, r.issue_date);
            }
          }
          if (data.length < PG) break;
          off += PG;
        }
      }
      let nAbert = 0,
        nReat = 0,
        nRec = 0;
      for (const c of clientes) {
        const pc = parseInt(c.cod);
        const prev = lastPurchaseBefore.get(pc);
        // Primeira data de transação no período loadado
        let firstP = null;
        for (const t of c.transacoes || []) {
          const d = t.dtStr;
          if (d && (!firstP || d < firstP)) firstP = d;
        }
        if (!firstP) {
          c.clientType = null; // sem compra no período
          continue;
        }
        if (!prev) {
          c.clientType = 'abertura';
          nAbert++;
        } else {
          const gap = (new Date(firstP) - new Date(prev)) / 86400000;
          if (gap >= REATIVACAO_DAYS) {
            c.clientType = 'reativacao';
            nReat++;
          } else {
            c.clientType = 'recorrente';
            nRec++;
          }
        }
      }
      console.log(
        `✅ [erp-data] clientType: ${nAbert} aberturas, ${nReat} reativações, ${nRec} recorrentes`,
      );
    } catch (err) {
      console.warn(`⚠️ [erp-data] clientType falhou: ${err.message}`);
    }

    const stats = {
      ativos: clientes.filter((c) => c.statusCarteira === 'ativo').length,
      a_inativar: clientes.filter((c) => c.statusCarteira === 'a_inativar')
        .length,
      inativos: clientes.filter((c) => c.statusCarteira === 'inativo').length,
      sem_compra: clientes.filter((c) => c.statusCarteira === 'sem_compra')
        .length,
      canalVarejo: clientes.filter((c) => c.canal === 'varejo').length,
      canalRevenda: clientes.filter((c) => c.canal === 'revenda').length,
      ltvTotal: clientes.reduce((s, c) => s + (c.ltv || 0), 0),
    };

    ERP_CACHE = {
      data: {
        clientes,
        totalClientes: clientes.length,
        totalTransacoes: allTransacoes.length,
        vendedores: [...vendedoresSet.entries()]
          .map(([name, code]) => ({ name, code }))
          .sort((a, b) => a.name.localeCompare(b.name)),
        sellersMap,
        stats,
        regras: {
          diasAlerta: DIAS_ALERTA,
          diasInativo: DIAS_INATIVO,
          operacoesVarejo: OPERACOES_VAREJO,
          operacoesRevenda: OPERACOES_REVENDA,
        },
        periodo: { de: startMov, ate: endMov, meses },
        loadedAt: new Date().toISOString(),
        duration: ((Date.now() - startTime) / 1000).toFixed(1) + 's',
      },
      timestamp: Date.now(),
      key: cacheKey,
    };

    saveErpCacheToDisk();
    console.log(
      `✅ [erp-bg] Concluído: ${clientes.length} clientes, ${allTransacoes.length} transações (${((Date.now() - startTime) / 1000).toFixed(0)}s)`,
    );
  } catch (err) {
    console.error('❌ [erp-bg] Erro:', err.message);
  } finally {
    ERP_LOADING = false;
    ERP_LOADING_PROGRESS = { step: '', page: 0, total: 0 };
  }
}

// ---------------------------------------------------------------------------
// 8. GET /api/crm/erp-status
//    Retorna status do cache do ERP (loading, loaded, progresso)
// ---------------------------------------------------------------------------
router.get(
  '/erp-status',
  asyncHandler(async (req, res) => {
    if (ERP_LOADING) {
      return successResponse(res, {
        loaded: false,
        loading: true,
        progress: ERP_LOADING_PROGRESS,
        message: `ERP carregando... (etapa: ${ERP_LOADING_PROGRESS.step})`,
      });
    }
    if (!ERP_CACHE.data) {
      return successResponse(res, {
        loaded: false,
        loading: false,
        message: 'ERP ainda não foi carregado',
      });
    }
    return successResponse(res, {
      loaded: true,
      loading: false,
      timestamp: ERP_CACHE.timestamp,
      ageSeconds: Math.floor((Date.now() - ERP_CACHE.timestamp) / 1000),
      key: ERP_CACHE.key,
      totalClientes: ERP_CACHE.data.totalClientes,
      totalTransacoes: ERP_CACHE.data.totalTransacoes,
      periodo: ERP_CACHE.data.periodo,
    });
  }),
);

// ---------------------------------------------------------------------------
// 9. GET /api/crm/oportunidades-por-inst
//    Conta contatos únicos por instância Evolution que enviaram mensagem
//    ao vendedor mas NÃO estão cadastrados no TOTVS (telefone não encontrado
//    na tabela pes_pessoa do Supabase). Resultado: { instancia: count }
// ---------------------------------------------------------------------------
let OPORT_CACHE = { data: null, timestamp: 0 };
const OPORT_CACHE_TTL = 5 * 60 * 1000; // 5 min

router.get(
  '/oportunidades-por-inst',
  asyncHandler(async (req, res) => {
    // Cache check
    if (
      OPORT_CACHE.data &&
      Date.now() - OPORT_CACHE.timestamp < OPORT_CACHE_TTL
    ) {
      return successResponse(res, OPORT_CACHE.data);
    }

    // 1) Busca todos os telefones cadastrados no TOTVS (via Supabase) — pageSize 10000
    const totvsPhones = new Set();
    try {
      let page = 0;
      const PAGE = 10000;
      while (true) {
        const { data: rows, error } = await supabase
          .from('pes_pessoa')
          .select('telefone')
          .not('telefone', 'is', null)
          .range(page * PAGE, (page + 1) * PAGE - 1);
        if (error || !rows || rows.length === 0) break;
        for (const r of rows) {
          const p = String(r.telefone || '').replace(/\D/g, '');
          if (p) {
            totvsPhones.add(p.startsWith('55') ? p : '55' + p);
            // também adiciona versão sem 55 e versão com/sem 9° dígito
            const s = p.startsWith('55') ? p.slice(2) : p;
            totvsPhones.add(s);
            if (s.length === 11) totvsPhones.add(s.slice(0, 2) + s.slice(3)); // sem 9
            if (s.length === 10)
              totvsPhones.add(s.slice(0, 2) + '9' + s.slice(2)); // com 9
          }
        }
        if (rows.length < PAGE) break;
        page++;
      }
    } catch (err) {
      console.warn('[oportunidades-por-inst] Supabase erro:', err.message);
    }

    // 2) Busca contatos únicos por instância Evolution (apenas mensagens recebidas, últimos 90 dias)
    let rows = [];
    try {
      const noventa = new Date(Date.now() - 90 * 86400000).toISOString();
      const result = await evolutionPool.query(
        `SELECT
           i.name AS instance_name,
           m."key"->>'remoteJid' AS jid
         FROM "Message" m
         JOIN "Instance" i ON i.id = m."instanceId"
         WHERE (m."key"->>'fromMe')::boolean = false
           AND m."key"->>'remoteJid' LIKE '%@s.whatsapp.net'
           AND m."messageTimestamp" > extract(epoch from $1::timestamptz)::bigint
         GROUP BY i.name, m."key"->>'remoteJid'`,
        [noventa],
      );
      rows = result.rows;
    } catch (err) {
      console.warn('[oportunidades-por-inst] Evolution erro:', err.message);
      return successResponse(res, {});
    }

    // 3) Conta por instância apenas os contatos não cadastrados no TOTVS
    const instMap = {};
    for (const row of rows) {
      const raw = (row.jid || '').replace('@s.whatsapp.net', '');
      if (!raw || raw.includes('-')) continue; // pula grupos
      const phone = raw.startsWith('55') ? raw : '55' + raw;
      const short = phone.slice(2);
      // verifica nas variações de formato
      const emTotvs =
        totvsPhones.has(phone) ||
        totvsPhones.has(short) ||
        (short.length === 11 &&
          totvsPhones.has(short.slice(0, 2) + short.slice(3))) ||
        (short.length === 10 &&
          totvsPhones.has(short.slice(0, 2) + '9' + short.slice(2)));
      if (!emTotvs) {
        const inst = row.instance_name;
        instMap[inst] = (instMap[inst] || 0) + 1;
      }
    }

    OPORT_CACHE = { data: instMap, timestamp: Date.now() };
    return successResponse(res, instMap);
  }),
);

// ---------------------------------------------------------------------------
// 10. GET /api/crm/vendedores
//     Retorna mapeamento dinâmico de vendedores (Supabase + Evolution)
//     para uso no frontend em vez de constantes hardcoded
// ---------------------------------------------------------------------------
router.get(
  '/vendedores',
  asyncHandler(async (req, res) => {
    const map = await loadVendedoresMap();
    return successResponse(res, {
      byClickupId: map.byClickupId,
      byTotvsId: map.byTotvsId,
    });
  }),
);

// ---------------------------------------------------------------------------
// 11. POST /api/crm/seller-customers
//     Retorna clientes que compraram de um vendedor num período
//     Busca em notas_fiscais (Supabase Fiscal) usando items->dealerCode
// ---------------------------------------------------------------------------
router.post(
  '/seller-customers',
  asyncHandler(async (req, res) => {
    const { sellerCode, datemin, datemax } = req.body;
    if (!sellerCode || !datemin || !datemax) {
      return errorResponse(
        res,
        'sellerCode, datemin e datemax obrigatórios',
        400,
        'MISSING_PARAMS',
      );
    }

    const code = parseInt(sellerCode);
    if (isNaN(code)) {
      return errorResponse(res, 'sellerCode inválido', 400, 'INVALID_SELLER');
    }

    // Query: busca NFs de saída (vendas) no período, filtra por dealerCode nos items
    const { data: nfs, error } = await supabaseFiscal
      .from('notas_fiscais')
      .select(
        'person_code, person_name, person_cpf_cnpj, total_value, quantity, issue_date, invoice_code, operation_name, items',
      )
      .eq('operation_type', 'Output')
      .gte('issue_date', datemin)
      .lte('issue_date', datemax)
      .not('invoice_status', 'eq', 'Canceled')
      .not('invoice_status', 'eq', 'Deleted')
      .lt('person_code', 100000000)
      .order('issue_date', { ascending: false })
      .limit(5000);

    if (error) {
      console.error('[seller-customers] Supabase error:', error.message);
      return errorResponse(
        res,
        'Erro ao buscar notas fiscais',
        500,
        'DB_ERROR',
      );
    }

    // Filtra NFs que tenham o dealerCode do vendedor nos items
    const nfsDoVendedor = (nfs || []).filter((nf) => {
      if (!nf.items || !Array.isArray(nf.items)) return false;
      return nf.items.some((item) => {
        if (item.products && Array.isArray(item.products)) {
          return item.products.some((p) => parseInt(p.dealerCode) === code);
        }
        return parseInt(item.dealerCode) === code;
      });
    });

    // Agrupa por cliente (Output - vendas brutas)
    const clientesMap = new Map();
    for (const nf of nfsDoVendedor) {
      const key = nf.person_code || nf.person_name;
      if (!key) continue;
      const existing = clientesMap.get(key) || {
        person_code: nf.person_code,
        person_name: nf.person_name || 'Sem nome',
        person_cpf_cnpj: nf.person_cpf_cnpj,
        total_value: 0,
        total_qty: 0,
        total_items: 0,
        invoices: [],
      };
      existing.total_value += parseFloat(nf.total_value) || 0;
      existing.total_qty += 1;
      existing.total_items += parseInt(nf.quantity) || 0;

      // Extrai produtos do vendedor desta NF
      const produtos = [];
      if (nf.items && Array.isArray(nf.items)) {
        for (const item of nf.items) {
          const prods =
            item.products &&
            Array.isArray(item.products) &&
            item.products.length > 0
              ? item.products
              : null;
          if (prods) {
            for (const p of prods) {
              if (parseInt(p.dealerCode) === code) {
                produtos.push({
                  code: p.productCode || p.code || '',
                  name: p.productName || p.name || '',
                  qty: parseFloat(p.quantity) || 0,
                  unit_value:
                    parseFloat(p.unitNetValue) ||
                    parseFloat(p.unitGrossValue) ||
                    0,
                  total_value:
                    parseFloat(p.netValue) || parseFloat(p.grossValue) || 0,
                });
              }
            }
          } else if (parseInt(item.dealerCode) === code) {
            produtos.push({
              code: item.code || '',
              name: item.name || '',
              qty: parseFloat(item.quantity) || 0,
              unit_value:
                parseFloat(item.unitNetValue) ||
                parseFloat(item.unitGrossValue) ||
                0,
              total_value:
                parseFloat(item.netValue) || parseFloat(item.grossValue) || 0,
            });
          }
        }
      }

      existing.invoices.push({
        invoice_code: nf.invoice_code,
        issue_date: nf.issue_date,
        total_value: parseFloat(nf.total_value) || 0,
        operation_name: nf.operation_name,
        produtos,
      });
      clientesMap.set(key, existing);
    }

    // ── Subtrai CREDEV (Input + CREDEV_OP_CODES) atribuído a este vendedor ──
    const CREDEV_OP_CODES = [
      1, 2, 555, 9073, 9402, 9065, 9403, 9062, 9005, 7790, 7245, 20, 1214, 7244,
    ];
    const personCodes = Array.from(clientesMap.values())
      .map((c) => c.person_code)
      .filter((pc) => pc != null && Number.isFinite(Number(pc)));
    let credevCountTotal = 0;
    if (personCodes.length > 0) {
      const { data: credevs } = await supabaseFiscal
        .from('notas_fiscais')
        .select('person_code, total_value, items, issue_date')
        .eq('operation_type', 'Input')
        .not('invoice_status', 'eq', 'Canceled')
        .not('invoice_status', 'eq', 'Deleted')
        .gte('issue_date', datemin)
        .lte('issue_date', datemax)
        .in('person_code', personCodes)
        .in('operation_code', CREDEV_OP_CODES)
        .lt('person_code', 100000000);

      for (const cnf of credevs || []) {
        const cliente = clientesMap.get(cnf.person_code);
        if (!cliente) continue;

        // Parcela do vendedor nesta CREDEV (proporcional ao netValue dos items dele)
        let nfNetTotal = 0;
        let sellerNet = 0;
        let sellerQty = 0;
        if (Array.isArray(cnf.items)) {
          for (const item of cnf.items) {
            const prods = Array.isArray(item.products) ? item.products : [];
            for (const p of prods) {
              const nv = parseFloat(p.netValue) || 0;
              nfNetTotal += nv;
              if (parseInt(p.dealerCode) === code) {
                sellerNet += nv;
                sellerQty += parseFloat(p.quantity) || 0;
              }
            }
          }
        }
        if (sellerNet <= 0) continue;

        const share = nfNetTotal > 0 ? sellerNet / nfNetTotal : 1;
        const credevValue = (parseFloat(cnf.total_value) || 0) * share;

        cliente.total_value -= credevValue;
        cliente.total_qty = Math.max(0, cliente.total_qty - 1);
        cliente.total_items = Math.max(0, cliente.total_items - sellerQty);
        cliente.credev_value = (cliente.credev_value || 0) + credevValue;
        cliente.credev_qty = (cliente.credev_qty || 0) + 1;
        credevCountTotal += 1;
      }
    }

    const clientes = Array.from(clientesMap.values())
      .sort((a, b) => b.total_value - a.total_value)
      .map((c) => ({
        ...c,
        total_value: Math.round(c.total_value * 100) / 100,
        credev_value: Math.round((c.credev_value || 0) * 100) / 100,
        last_purchase:
          c.invoices.length > 0
            ? c.invoices.reduce(
                (latest, inv) =>
                  new Date(inv.issue_date) > new Date(latest)
                    ? inv.issue_date
                    : latest,
                c.invoices[0].issue_date,
              )
            : null,
        invoices: c.invoices
          .sort((a, b) => new Date(b.issue_date) - new Date(a.issue_date))
          .slice(0, 20),
      }));

    return successResponse(
      res,
      {
        clientes,
        totalClientes: clientes.length,
        totalNFs: Math.max(0, nfsDoVendedor.length - credevCountTotal),
        totalNFsGross: nfsDoVendedor.length,
        totalCredev: credevCountTotal,
      },
      `${clientes.length} clientes encontrados`,
    );
  }),
);

// ---------------------------------------------------------------------------
// 12. POST /api/crm/seller-openings
//     Retorna aberturas de cadastro por vendedor (primeira compra NA VIDA na Crosby)
//     Estratégia: TOTVS person-statistics → firstPurchaseDate para cada cliente
// ---------------------------------------------------------------------------
router.post(
  '/seller-openings',
  asyncHandler(async (req, res) => {
    const { sellerCodes, datemin, datemax } = req.body;
    if (!sellerCodes || !Array.isArray(sellerCodes) || !datemin || !datemax) {
      return errorResponse(
        res,
        'sellerCodes (array), datemin e datemax obrigatórios',
        400,
        'MISSING_PARAMS',
      );
    }

    const codes = sellerCodes.map(Number).filter((n) => !isNaN(n));
    if (codes.length === 0) {
      return errorResponse(res, 'sellerCodes inválido', 400, 'INVALID_SELLERS');
    }

    console.log(
      `[seller-openings] Buscando aberturas para ${codes.length} vendedores (${datemin} → ${datemax})`,
    );

    // 1) Buscar NFs de saída no período (Supabase) — STREAMING: processa cada página
    //    inline pra não acumular `nfsPeriodo[]` em memória (OOM com período longo).
    //    O personNFsMap é construído direto na pagination loop.
    const NF_PAGE = 1000;
    let nfOffset = 0;
    let totalNFsProcessed = 0;

    // ── Carregar person_codes franquia (para regra do Jucelino na segmentação) ──
    const [franqOpF1, franqOpF2] = await Promise.all([
      supabase
        .from('pes_pessoa')
        .select('code')
        .filter('classifications', 'cs', '[{"type":2}]'),
      supabase
        .from('pes_pessoa')
        .select('code')
        .filter('classifications', 'cs', '[{"type":20}]'),
    ]);
    const franqPersonCodesOp = new Set(
      [...(franqOpF1.data || []), ...(franqOpF2.data || [])].map((r) =>
        Number(r.code),
      ),
    );

    // ── Helper: canal da NF (mesma lógica do faturamento-por-segmento, restrita aos canais) ──
    const ALLOWED_OPENING_SEGS = new Set([
      'varejo',
      'revenda',
      'multimarcas',
      'inbound',
      'inbound_david',
      'inbound_rafael',
    ]);
    const INBOUND_DAVID_SET = new Set([26, 69]);
    const INBOUND_RAFAEL_CODE = 21;
    const VAREJO_BRANCHES_OP = new Set([
      2, 5, 55, 65, 87, 88, 90, 93, 94, 95, 97,
    ]);
    const REVENDA_BRANCHES_OP = new Set([99]);
    const B2R_DEALERS_EMP2_OP = new Set([288, 251, 131]);
    const B2R_DEALERS_EMP99_OP = new Set([25, 15, 161, 165, 241, 779]);

    function classifyNfCanal(nf, dominantDealer) {
      if (dominantDealer === 40) return null; // dealer franquia → fora dos canais
      let seg;
      if (dominantDealer === 288 && franqPersonCodesOp.has(nf.person_code)) {
        seg = 'franquia';
      } else if (INBOUND_DAVID_SET.has(dominantDealer)) {
        seg = 'inbound_david';
      } else if (dominantDealer === INBOUND_RAFAEL_CODE) {
        seg = 'inbound_rafael';
      } else {
        seg = OP_SEGMENTO_MAP[nf.operation_code];
      }
      if (!seg || seg === 'franquia') return null;
      if (seg === 'varejo' && !VAREJO_BRANCHES_OP.has(nf.branch_code))
        return null;
      if (seg === 'business' && dominantDealer !== 20) seg = 'revenda';
      if (seg === 'revenda') {
        if (Number(nf.branch_code) === 99) {
          if (!B2R_DEALERS_EMP99_OP.has(dominantDealer)) return null;
        } else if (
          nf.branch_code === 2 &&
          B2R_DEALERS_EMP2_OP.has(dominantDealer)
        ) {
          // mantém revenda
        } else if (nf.branch_code === 2) {
          seg = 'varejo';
        } else if (!REVENDA_BRANCHES_OP.has(nf.branch_code)) {
          return null;
        }
      }
      return ALLOWED_OPENING_SEGS.has(seg) ? seg : null;
    }

    // Mapeia clientes por vendedor — STREAMING via paginação Supabase
    const personNFsMap = new Map(); // personCode -> [{date, dealerCodes, person_name, value, canal}]

    while (true) {
      const { data: nfBatch, error: errPeriodo } = await supabaseFiscal
        .from('notas_fiscais')
        .select(
          'person_code, person_name, items, issue_date, total_value, operation_code, branch_code, dealer_code',
        )
        .eq('operation_type', 'Output')
        .gte('issue_date', datemin)
        .lte('issue_date', datemax)
        .not('invoice_status', 'eq', 'Canceled')
        .not('invoice_status', 'eq', 'Deleted')
        .lt('person_code', 100000000)
        .range(nfOffset, nfOffset + NF_PAGE - 1);
      if (errPeriodo) {
        console.error('[seller-openings] Erro período:', errPeriodo.message);
        return errorResponse(
          res,
          'Erro ao buscar NFs do período',
          500,
          'DB_ERROR',
        );
      }
      if (!nfBatch || nfBatch.length === 0) break;

      // Processa NFs da página inline e libera o batch ao final
      for (const nf of nfBatch) {
        if (!nf.items || !Array.isArray(nf.items) || !nf.person_code) continue;
        const nfDealerCodes = new Set();
        const netByDealer = {};
        for (const item of nf.items) {
          const prods =
            item.products &&
            Array.isArray(item.products) &&
            item.products.length > 0
              ? item.products
              : [item];
          for (const p of prods) {
            const dc = parseInt(p.dealerCode);
            if (!isNaN(dc)) {
              nfDealerCodes.add(dc);
              const nv = parseFloat(p.netValue) || 0;
              netByDealer[dc] = (netByDealer[dc] || 0) + nv;
            }
          }
        }
        if (nfDealerCodes.size === 0) continue;

        const netEntries = Object.entries(netByDealer);
        const dominantDealer = netEntries.length
          ? Number(netEntries.sort((a, b) => b[1] - a[1])[0][0])
          : (nf.dealer_code ?? null);
        const canal = classifyNfCanal(nf, dominantDealer);

        if (!personNFsMap.has(nf.person_code))
          personNFsMap.set(nf.person_code, []);
        personNFsMap.get(nf.person_code).push({
          date: nf.issue_date,
          dealerCodes: nfDealerCodes,
          person_name: nf.person_name || 'Sem nome',
          value: parseFloat(nf.total_value) || 0,
          canal,
        });
      }
      totalNFsProcessed += nfBatch.length;
      if (nfBatch.length < NF_PAGE) break;
      nfOffset += NF_PAGE;
    }
    console.log(
      `[seller-openings] ${totalNFsProcessed} NFs processadas (streaming), ${personNFsMap.size} clientes únicos`,
    );

    // Para cada cliente: mapear vendedores ativos e dados da primeira NF no período
    const clientSellerMap = new Map(); // personCode -> Set de seller codes ATIVOS
    const clientNames = new Map();
    const clientPeriodData = new Map(); // personCode -> {date, value, openerCodes}
    const clickupLeadAttribution = new Map(); // personCode -> { seller_code, phone, lead_name, lead_date }

    for (const [personCode, nfs] of personNFsMap.entries()) {
      const allSellerCodes = new Set();
      for (const nf of nfs) {
        for (const dc of nf.dealerCodes) allSellerCodes.add(dc);
      }
      const activeSellers = [...allSellerCodes].filter((dc) =>
        codes.includes(dc),
      );
      if (activeSellers.length === 0) continue;

      const earliestDate = nfs.reduce(
        (min, nf) => (nf.date < min ? nf.date : min),
        nfs[0].date,
      );
      const openerCodes = new Set();
      let personName = 'Sem nome';
      let firstDayValue = 0;
      const firstDayCanalAcc = {}; // canal -> soma de value
      for (const nf of nfs) {
        if (nf.date === earliestDate) {
          for (const dc of nf.dealerCodes) openerCodes.add(dc);
          personName = nf.person_name;
          firstDayValue += nf.value;
          if (nf.canal) {
            firstDayCanalAcc[nf.canal] =
              (firstDayCanalAcc[nf.canal] || 0) + nf.value;
          }
        }
      }
      const canalEntries = Object.entries(firstDayCanalAcc);
      const firstSaleCanal = canalEntries.length
        ? canalEntries.sort((a, b) => b[1] - a[1])[0][0]
        : null;

      clientSellerMap.set(personCode, new Set(activeSellers));
      clientNames.set(personCode, personName);
      clientPeriodData.set(personCode, {
        date: earliestDate,
        value: firstDayValue,
        openerCodes,
        canal: firstSaleCanal,
      });
    }

    let clickupMatchedUnique = 0;
    let clickupAmbiguousPhones = 0;
    try {
      const clickupData = await loadClickupLeads({ allHistory: true });
      const clickupLeads = (clickupData?.canais || []).flatMap(
        (canal) => canal?.tarefas || [],
      );
      if (clickupLeads.length > 0) {
        const phoneLookupCache = new Map();
        for (const lead of clickupLeads) {
          if (!isClosedClickupStatus(lead.status)) continue;
          // Jason é uma categoria (cliente que passou pelo CRM), não um vendedor TOTVS.
          // Não filtra por vendedor do ClickUp — o crédito vai para o vendedor do TOTVS.
          if (!lead.telefone) continue;

          const matchedPeople = new Map(
            (await findTotvsPeopleByPhone(lead.telefone, phoneLookupCache)).map(
              (person) => [person.code, person],
            ),
          );

          if (matchedPeople.size !== 1) {
            if (matchedPeople.size > 1) clickupAmbiguousPhones += 1;
            continue;
          }

          const [matchedPerson] = matchedPeople.values();
          const existing = clickupLeadAttribution.get(matchedPerson.code);
          const leadDate = lead.dataCriacao
            ? lead.dataCriacao.slice(0, 10)
            : datemin;
          if (!existing || leadDate < existing.lead_date) {
            clickupLeadAttribution.set(matchedPerson.code, {
              // seller_code não armazenado: Jason não sobrescreve o vendedor do TOTVS
              phone: lead.telefone,
              lead_name: lead.nome || '',
              lead_date: leadDate,
            });
          }
          if (!clientNames.has(matchedPerson.code)) {
            clientNames.set(
              matchedPerson.code,
              matchedPerson.name || lead.nome || 'Sem nome',
            );
          }
        }
      }
      clickupMatchedUnique = clickupLeadAttribution.size;
    } catch (err) {
      console.warn(
        '[seller-openings] Merge ClickUp por telefone falhou:',
        err.message,
      );
    }

    const allPersonCodes = [
      ...new Set([...clientSellerMap.keys(), ...clickupLeadAttribution.keys()]),
    ];
    if (allPersonCodes.length === 0) {
      const result = codes.map((c) => ({
        seller_code: c,
        openings: 0,
        clients: [],
      }));
      return successResponse(
        res,
        {
          sellers: result,
          total: 0,
          meta: {
            clickup_phone_matches: clickupMatchedUnique,
            clickup_ambiguous_phones: clickupAmbiguousPhones,
            clickup_openings: 0,
          },
        },
        '0 aberturas',
      );
    }

    console.log(
      `[seller-openings] ${allPersonCodes.length} clientes no período. Verificando aberturas via insertDate + histórico...`,
    );

    // 2) Abertura = cliente cujo insertDate (data de cadastro no TOTVS) está dentro
    //    do período E não tem NF no canal nos 12 meses anteriores (mesmo critério de
    //    analytics-por-estado).

    // PRÉ-FILTRO Supabase: clientes que já têm NF Output ANTES do período
    const customersWithPriorNF = new Set();
    if (allPersonCodes.length > 0) {
      const PREFILTER_CHUNK = 500;
      for (let i = 0; i < allPersonCodes.length; i += PREFILTER_CHUNK) {
        const chunk = allPersonCodes.slice(i, i + PREFILTER_CHUNK);
        let off = 0;
        const PG = 1000;
        while (true) {
          const { data, error } = await supabaseFiscal
            .from('notas_fiscais')
            .select('person_code')
            .eq('operation_type', 'Output')
            .not('invoice_status', 'eq', 'Canceled')
            .not('invoice_status', 'eq', 'Deleted')
            .lt('issue_date', datemin)
            .in('person_code', chunk)
            .lt('person_code', 100000000)
            .range(off, off + PG - 1);
          if (error || !data || data.length === 0) break;
          for (const r of data) customersWithPriorNF.add(r.person_code);
          if (data.length < PG) break;
          if (customersWithPriorNF.size >= chunk.length) break;
          off += PG;
        }
      }
    }
    const personCodesPotenciais = allPersonCodes.filter(
      (pc) => !customersWithPriorNF.has(pc),
    );
    console.log(
      `[seller-openings] Pré-filtro Supabase: ${customersWithPriorNF.size} com NF anterior; ${personCodesPotenciais.length} potenciais → buscar insertDate`,
    );

    // Busca insertDate via TOTVS persons API (bulk, igual a analytics-por-estado)
    const personInsertDate = new Map(); // personCode -> insertDate string | null
    if (personCodesPotenciais.length > 0) {
      const TOTVS_CHUNK = 100;
      const CHUNK_CONCURRENCY = 4;
      const chunks = [];
      for (let i = 0; i < personCodesPotenciais.length; i += TOTVS_CHUNK) {
        chunks.push(personCodesPotenciais.slice(i, i + TOTVS_CHUNK));
      }
      for (let i = 0; i < chunks.length; i += CHUNK_CONCURRENCY) {
        const batch = chunks.slice(i, i + CHUNK_CONCURRENCY);
        await Promise.all(
          batch.map(async (chunk) => {
            try {
              const { allRows } = await fetchAndMapPersons(
                { personCodeList: chunk },
                'seller-openings',
              );
              for (const row of allRows || []) {
                const iDate = row.insert_date || row.insertDate || null;
                personInsertDate.set(Number(row.code), iDate);
              }
            } catch (err) {
              console.warn(
                `[seller-openings] chunk persons falhou: ${err.message}`,
              );
            }
          }),
        );
      }
    }

    // Clientes abertura: insertDate no período OU (sem insertDate E sem compra anterior)
    const openingClients = new Set();
    const clientFirstPurchase = new Map(); // personCode -> {date, value}
    const dminTs = new Date(datemin).getTime();
    const dmaxTs = new Date(datemax + 'T23:59:59').getTime();

    for (const pc of personCodesPotenciais) {
      const iDate = personInsertDate.get(pc);
      const pd = clientPeriodData.get(pc);
      if (iDate) {
        const its = new Date(iDate).getTime();
        if (its >= dminTs && its <= dmaxTs) {
          openingClients.add(pc);
          clientFirstPurchase.set(pc, {
            date: pd?.date || datemin,
            value: pd?.value || 0,
          });
        }
      }
      // Sem insertDate disponível → não conta como abertura (evita falsos positivos com clientes antigos)
    }

    console.log(
      `[seller-openings] ${openingClients.size} aberturas (insertDate em período) de ${allPersonCodes.length} candidatos.`,
    );

    // 3) Montar resultado: aberturas por vendedor
    const sellerOpenings = new Map();
    const pushSellerOpening = (sellerCode, clientData) => {
      if (!sellerOpenings.has(sellerCode))
        sellerOpenings.set(sellerCode, new Map());
      sellerOpenings.get(sellerCode).set(clientData.person_code, clientData);
    };
    let clickupOpenings = 0;

    for (const personCode of allPersonCodes) {
      if (!openingClients.has(personCode)) continue;
      const fp =
        clientFirstPurchase.get(personCode) || clientPeriodData.get(personCode);
      const periodData = clientPeriodData.get(personCode);
      const openerCodes = periodData?.openerCodes
        ? [...periodData.openerCodes]
        : [];

      // Atribui APENAS aos vendedores que ABRIRAM o cliente (vendas na primeira data
      // do período) E estão na lista de vendedores ativos da requisição (módulo).
      // Sem fallback: se o opener não é do módulo solicitado, a abertura não é creditada.
      const sellerSet = clientSellerMap.get(personCode);
      const codesSet = new Set(codes);
      const attributionSet = openerCodes.filter((dc) => codesSet.has(dc));

      const periodCanal = periodData?.canal || null;
      const clickupMatch = clickupLeadAttribution.get(personCode);
      if (clickupMatch) {
        // Atribui ao vendedor TOTVS que abriu o cliente (não ao vendedor do ClickUp)
        // Só conta como jason opening se for atribuído a pelo menos um vendedor
        // do módulo (pra alinhar com o que aparece no modal).
        if (attributionSet.length > 0) {
          clickupOpenings += 1;
          for (const sellerCode of attributionSet) {
            pushSellerOpening(sellerCode, {
              person_code: personCode,
              person_name:
                clientNames.get(personCode) ||
                clickupMatch.lead_name ||
                'Sem nome',
              first_purchase_date: fp?.date || null,
              first_purchase_value: fp?.value || 0,
              opener_codes: openerCodes,
              match_source: 'clickup_phone',
              matched_phone: clickupMatch.phone,
              clickup_lead_date: clickupMatch.lead_date,
              canal: periodCanal,
            });
          }
        }
        continue;
      }

      if (attributionSet.length === 0) continue;
      for (const sellerCode of attributionSet) {
        pushSellerOpening(sellerCode, {
          person_code: personCode,
          person_name: clientNames.get(personCode) || 'Sem nome',
          first_purchase_date: fp?.date || null,
          first_purchase_value: fp?.value || 0,
          opener_codes: openerCodes,
          match_source: 'fiscal_first_purchase',
          canal: periodCanal,
        });
      }
    }

    const ALLOWED_CANAIS = ['varejo', 'revenda', 'multimarcas', 'inbound'];
    const emptyByCanal = () =>
      ALLOWED_CANAIS.reduce((acc, c) => ({ ...acc, [c]: 0 }), {});

    const sellers = codes
      .map((c) => {
        const clients = Array.from(
          (sellerOpenings.get(c) || new Map()).values(),
        ).sort((a, b) =>
          String(b.first_purchase_date || '').localeCompare(
            String(a.first_purchase_date || ''),
          ),
        );
        const openings_by_canal = emptyByCanal();
        for (const cli of clients) {
          if (cli.canal && openings_by_canal[cli.canal] !== undefined) {
            openings_by_canal[cli.canal] += 1;
          }
        }
        const openings_in_canal = ALLOWED_CANAIS.reduce(
          (s, c) => s + openings_by_canal[c],
          0,
        );
        return {
          seller_code: c,
          openings: clients.length,
          openings_in_canal,
          openings_by_canal,
          clients,
        };
      })
      .sort((a, b) => b.openings - a.openings);

    const total = sellers.reduce((s, r) => s + r.openings, 0);
    const total_by_canal = emptyByCanal();
    for (const s of sellers) {
      for (const c of ALLOWED_CANAIS)
        total_by_canal[c] += s.openings_by_canal[c];
    }
    const total_in_canal = ALLOWED_CANAIS.reduce(
      (s, c) => s + total_by_canal[c],
      0,
    );

    return successResponse(
      res,
      {
        sellers,
        total,
        total_in_canal,
        total_by_canal,
        meta: {
          clickup_phone_matches: clickupMatchedUnique,
          clickup_ambiguous_phones: clickupAmbiguousPhones,
          clickup_openings: clickupOpenings,
          jason_openings: clickupOpenings,
          clickup_scope: 'all_history',
        },
      },
      `${total} aberturas de cadastro`,
    );
  }),
);

// ---------------------------------------------------------------------------
// 13b. POST /api/crm/branches-totals
//     Faturamento por LOJA (varejo). Filiais e op codes em config/varejoMetas.js.
//     Retorna { dataRow: [...], metas: {...} } (metas baseadas no metaType e datas).
//     Body: { datemin, datemax, metaType?: 'mensal' | 'semanal' | 'periodo' }
// ---------------------------------------------------------------------------
router.post(
  '/branches-totals',
  asyncHandler(async (req, res) => {
    const { datemin, datemax, metaType } = req.body;
    if (!datemin || !datemax) {
      return errorResponse(
        res,
        'datemin e datemax obrigatórios',
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

    const totvsData = await fetchBranchTotalsFromTotvs({
      initialToken: tokenData.access_token,
      branchs: VAREJO_BRANCH_CODES,
      datemin,
      datemax,
      refreshToken: async () => {
        const data = await getToken(true);
        return data.access_token;
      },
      logTag: 'CRM/BranchesTotals',
    });

    // Resolve metas pelo metaType + datas
    let metasMap = null;
    let metaInfo = null;
    if (metaType === 'mensal') {
      const yyyymm = datemin.slice(0, 7);
      metasMap = getMetaMensal(yyyymm);
      metaInfo = { type: 'mensal', label: yyyymm };
    } else if (metaType === 'semanal') {
      const sem = getMetaSemanal(datemin, datemax);
      if (sem) {
        metasMap = sem.metas;
        metaInfo = {
          type: 'semanal',
          label: sem.label,
          inicio: sem.inicio,
          fim: sem.fim,
        };
      }
    } else if (metaType === 'periodo') {
      metasMap = getMetaPeriodo(datemin, datemax);
      metaInfo = { type: 'periodo', label: `${datemin} → ${datemax}` };
    }

    const allowed = new Set(VAREJO_BRANCH_CODES);
    const dataRow = (totvsData.dataRow || [])
      .map((row) => {
        const code = Number(
          row.branch_code ?? row.branch ?? row.branchCode ?? 0,
        );
        if (!allowed.has(code)) return null;
        const info = VAREJO_BRANCHES[code] || {};
        const invoiceValue = Number(row.invoice_value ?? row.netValue ?? 0);
        const invoiceQty = Number(row.invoice_qty ?? row.quantity ?? 0);
        const itensQty = Number(row.itens_qty ?? row.quantityPiece ?? 0);
        const tm = invoiceQty > 0 ? invoiceValue / invoiceQty : 0;
        const pa = invoiceQty > 0 ? itensQty / invoiceQty : 0;
        const pmpv = itensQty > 0 ? invoiceValue / itensQty : 0;
        return {
          seller_code: code,
          seller_name:
            info.name || row.branch_name || row.branchName || `Filial ${code}`,
          short_name: info.short || '',
          invoice_qty: invoiceQty,
          invoice_value: Math.round(invoiceValue * 100) / 100,
          itens_qty: itensQty,
          tm: Math.round(tm * 100) / 100,
          pa: Math.round(pa * 1000) / 1000,
          pmpv: Math.round(pmpv * 100) / 100,
          canal: 'varejo',
          is_branch: true,
          meta: metasMap?.[code] || null,
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.invoice_value - a.invoice_value);

    return successResponse(
      res,
      { dataRow, meta: metaInfo },
      `Faturamento de ${dataRow.length} filiais varejo`,
    );
  }),
);

// ---------------------------------------------------------------------------
// 13c. POST /api/crm/canal-totals
//      Totais por canal — varejo via TOTVS direto, revenda/multimarcas via
//      Supabase com filtros de categoria de cliente e CREDEV subtraído.
//      Body: { datemin, datemax, modulo: 'varejo' | 'revenda' | 'multimarcas' }
//      Retorna: { invoice_value, invoice_qty, itens_qty, tm, pa, pmpv }
// ---------------------------------------------------------------------------
const CANAL_CONFIG = {
  varejo: {
    source: 'totvs-totals-branch',
    branchs: [2, 5, 55, 65, 87, 88, 90, 93, 94, 95, 97],
    operations: null,
  },
  revenda: {
    source: 'totvs-totals',
    // Filiais REVENDEDOR conforme classificação interna (BLUE HOUSE 75 e variantes,
    // JPA 2/200 e variantes, etc.). Lista mantida em sincronia com sistema externo.
    // Canal revenda — filiais conforme relatório oficial do cliente:
    // - 2 + 200 (combinadas como "PB-Outlet" — sem duplicidade entre elas)
    // - 75 (Lagoa Center, ativo até 2025) + 99 (BLUE HOUSE atual desde 2025-2026)
    // - 5 (Nova Cruz - RN, esporádico)
    // Excluídas: 750 e 850 (filiais teste, não aparecem no painel oficial).
    branchs: [2, 5, 75, 99, 200],
    operations: [7236, 9122, 5102, 7242, 9061, 9001, 9121, 512],
    // dealers B2R (revenda) — inclui ex-vendedores e dealers multi-canal
    // (revenda + multi/varejo) para captar devoluções de NFs revenda mesmo
    // que feitas por vendedor que saiu ou atende múltiplos canais.
    // 25=Anderson, 15=Heyridan, 161=Cleiton, 165=Michel, 241=Yago, 779=Aldo,
    // 288=Jucelino, 251=Felipe PB, 131=?, 94=Enri PB, 65=Renato (rev+multi),
    // 1924=Matheus Closer, 7044=Luiz (rev+varejo)
    sellers: [25, 15, 161, 165, 241, 779, 288, 251, 131, 94, 65, 1924, 7044],
    // Devoluções de venda (não inclui vale-troca/CREDEV varejo): subtrai do bruto
    devolucaoOps: [7245, 20, 1214, 7790],
    devolucaoBranchs: [2, 5, 75, 99, 200],
  },
  multimarcas: {
    source: 'totvs-totals',
    branchs: [99, 2, 95, 87, 88, 90, 94, 97],
    operations: [7235, 7241, 9127], // 9127 = SME PROMO SALES MULTIMARCAS FISCAL
    sellers: [26, 69], // INBOUND_DEALER_SET (usado para devoluções)
    excludeSellers: [26, 69, 21], // David, Rafael e Thalis têm módulos separados — não contam no total MTM
    devolucaoOps: [7244, 7245, 1214],
    devolucaoBranchs: [99, 2, 95, 87, 88, 90, 94, 97],
  },
  inbound_david: {
    source: 'totvs-totals',
    branchs: [99, 2, 95, 87, 88, 90, 94, 97],
    operations: [7235, 7241, 9127],
    sellers: [26, 69], // David (26) + Thalis (69)
    allowedSellers: [26, 69], // só conta NFs desses dealers
    devolucaoOps: [7244, 7245, 1214],
    devolucaoBranchs: [99, 2, 95, 87, 88, 90, 94, 97],
  },
  inbound_rafael: {
    source: 'totvs-totals',
    branchs: [99],
    operations: [7235, 7241, 9127],
    sellers: [21],
    allowedSellers: [21],
    devolucaoOps: [7244, 7245, 1214],
    devolucaoBranchs: [99, 2, 95, 87, 88, 90, 94, 97],
    // ─── Whitelist manual de transações ─────────────────────────────────
    // NFs cujo "Comprador/Vend" no TRAFLO16 é Rafael (21) mas que a API
    // REST expõe dealerCode=50 (GERAL) nos items. Para corrigir
    // permanentemente, atualize o cadastro dos items no TOTVS.
    manualTransactions: [
      // { branch, transactionCode, motivo? }
      { branch: 99, transactionCode: 827993 }, // GEORGE 18/04/2026 R$ 7.901
    ],
  },
};

async function callTotvsTotalsSearch({
  branchs,
  operations,
  sellers,
  datemin,
  datemax,
}) {
  const tokenData = await getToken();
  if (!tokenData?.access_token) throw new Error('Token TOTVS indisponível');
  let token = tokenData.access_token;
  const endpoint = `${TOTVS_BASE_URL}/sale-panel/v2/totals/search`;
  const payload = {
    branchs,
    datemin,
    datemax,
    ...(Array.isArray(operations) && operations.length > 0 && { operations }),
    ...(Array.isArray(sellers) && sellers.length > 0 && { sellers }),
  };
  const doRequest = (accessToken) =>
    axios.post(endpoint, payload, {
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      httpsAgent: totvsHttpsAgent,
      timeout: 60000,
    });
  let resp;
  try {
    resp = await doRequest(token);
  } catch (err) {
    if (err.response?.status === 401) {
      const newTk = await getToken(true);
      token = newTk.access_token;
      resp = await doRequest(token);
    } else throw err;
  }
  return resp.data;
}

// Chama TOTVS /sale-panel/v2/sellers/search para 1 branch (retorna per-seller)
async function callTotvsSellersSearch({
  branchs,
  operations,
  datemin,
  datemax,
}) {
  const tokenData = await getToken();
  if (!tokenData?.access_token) throw new Error('Token TOTVS indisponível');
  let token = tokenData.access_token;
  const endpoint = `${TOTVS_BASE_URL}/sale-panel/v2/sellers/search`;
  const payload = {
    branchs,
    datemin,
    datemax,
    ...(Array.isArray(operations) && operations.length > 0 && { operations }),
  };
  const doRequest = (accessToken) =>
    axios.post(endpoint, payload, {
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      httpsAgent: totvsHttpsAgent,
      timeout: 60000,
    });
  let resp;
  try {
    resp = await doRequest(token);
  } catch (err) {
    if (err.response?.status === 401) {
      const newTk = await getToken(true);
      token = newTk.access_token;
      resp = await doRequest(token);
    } else throw err;
  }
  return resp.data;
}

// Mapeamento de nomes de loja (override/extensão do VAREJO_BRANCHES)
const NON_VAREJO_BRANCH_INFO = {
  99: { name: 'BLUE HOUSE', short: 'BLU' },
  2: { name: 'JOÃO PESSOA', short: 'JPA' },
};

// Fetcha per-seller via TOTVS por canal (branchs + sellers do CANAL_CONFIG)
// Retorna array de { seller_code, seller_name, invoice_qty, invoice_value, itens_qty, tm, pa, pmpv, branch_code, branch_name, branch_short, canal }
async function fetchCanalPerSellerLive({ datemin, datemax, modulo, cfg }) {
  const sellersAllowed = new Set((cfg.sellers || []).map(Number));
  // Per-branch: chama sellers/search uma vez por branch (TOTVS exige 1 branch por call)
  const perBranchResults = await Promise.all(
    cfg.branchs.map(async (branchCode) => {
      try {
        const data = await callTotvsSellersSearch({
          branchs: [branchCode],
          operations: cfg.operations,
          datemin,
          datemax,
        });
        return { branchCode, data };
      } catch (err) {
        console.warn(
          `[canal-sellers ${modulo}] erro branch ${branchCode}: ${err.message}`,
        );
        return { branchCode, data: null };
      }
    }),
  );
  const result = [];
  for (const { branchCode, data } of perBranchResults) {
    if (!data) continue;
    const rows = data.dataRow || [];
    const info = NON_VAREJO_BRANCH_INFO[branchCode] || null;
    for (const r of rows) {
      const sc = Number(r.seller_code);
      if (sellersAllowed.size > 0 && !sellersAllowed.has(sc)) continue;
      const value = Number(r.seller_sale_value || r.invoice_value || 0);
      const qty = Number(r.seller_sale_qty || r.invoice_qty || 0);
      const items = Number(r.itens_qty || r.seller_sale_pieces || 0);
      const tm = qty > 0 ? value / qty : 0;
      const pa = qty > 0 && items > 0 ? items / qty : 0;
      const pmpv = items > 0 ? value / items : 0;
      result.push({
        seller_code: String(sc),
        seller_name: r.seller_name || `Vend. ${sc}`,
        invoice_qty: qty,
        invoice_qty_gross: qty,
        credev_qty: 0,
        invoice_value: Math.round(value * 100) / 100,
        credev_value: 0,
        itens_qty: items,
        itens_qty_gross: items,
        credev_itens_qty: 0,
        tm: Math.round(tm * 100) / 100,
        pa: Math.round(pa * 1000) / 1000,
        pmpv: Math.round(pmpv * 100) / 100,
        canal: modulo,
        branch_code: branchCode,
        branch_name: info?.name || `Filial ${branchCode}`,
        branch_short: info?.short || null,
      });
    }
  }
  // Agregar duplicados (mesmo seller_code em múltiplas branches — pega a maior)
  // Para canal Revenda: cada dealer aparece só na branch principal, mas seguro agregar.
  const merged = {};
  for (const r of result) {
    const k = r.seller_code;
    if (!merged[k]) {
      merged[k] = { ...r };
    } else {
      // Soma valores e refaz métricas
      merged[k].invoice_value += r.invoice_value;
      merged[k].invoice_qty += r.invoice_qty;
      merged[k].itens_qty += r.itens_qty;
      // Mantém branch onde mais vendeu como primária
      if (r.invoice_value > merged[k].invoice_value / 2) {
        merged[k].branch_code = r.branch_code;
        merged[k].branch_name = r.branch_name;
        merged[k].branch_short = r.branch_short;
      }
    }
  }

  // ─── Subtração de credev + SaleReturns por vendedor (alinha com Analytics) ───
  // Busca fiscal/v2/invoices Output (com payments+items) → atribui credev por dealerCode
  // Busca fiscal-movement → SaleReturns para clientes não em invoices, atribui ao sellerCode
  try {
    const tokenData = await getToken();
    const accessToken = tokenData?.access_token;
    if (accessToken) {
      const DEVOL_OPS_LIQUIDO_TOTVS = new Set([
        1202, 1204, 1411, 1410, 2202, 2411, 1950, 21, 7245, 7244, 7240, 7790,
        1214, 20,
      ]);

      // Fetch invoices p/ credev por vendedor (dealerCode em items[].products[])
      const invoicesEndpoint = `${TOTVS_BASE_URL}/fiscal/v2/invoices/search`;
      const fetchInvPage = async (page) =>
        axios
          .post(
            invoicesEndpoint,
            {
              filter: {
                branchCodeList: cfg.branchs,
                operationCodeList: cfg.operations,
                operationType: 'Output',
                startIssueDate: `${datemin}T00:00:00`,
                endIssueDate: `${datemax}T23:59:59`,
              },
              expand: 'payments,items',
              page,
              pageSize: 100,
            },
            {
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${accessToken}`,
              },
              httpsAgent: totvsHttpsAgent,
              timeout: 120000,
            },
          )
          .then((r) => r.data)
          .catch(() => ({ items: [] }));
      const firstInv = await fetchInvPage(1);
      const invItems = [...(firstInv?.items || [])];
      const invTotalPages =
        firstInv?.totalPages ||
        (firstInv?.totalItems ? Math.ceil(firstInv.totalItems / 100) : 1);
      if (invTotalPages > 1) {
        const rem = Array.from({ length: invTotalPages - 1 }, (_, i) => i + 2);
        for (let i = 0; i < rem.length; i += 3) {
          const batch = rem.slice(i, i + 3);
          const results = await Promise.all(batch.map(fetchInvPage));
          for (const pd of results) invItems.push(...(pd?.items || []));
        }
      }

      const personsInInvoices = new Set();
      // Acumuladores por vendedor: peças por dealerCode (extraídas de items[].products[])
      const itensQtyByDealer = {}; // dealerCode (string) → soma de quantity
      for (const nf of invItems) {
        if (nf.invoiceStatus === 'Canceled' || nf.invoiceStatus === 'Deleted')
          continue;
        const pc = parseInt(nf.personCode);
        if (pc) personsInInvoices.add(pc);

        // Soma peças por dealerCode (todos os produtos dessa NF)
        for (const item of nf.items || []) {
          for (const p of item.products || []) {
            const dc = p.dealerCode ? String(p.dealerCode) : null;
            if (!dc) continue;
            const q = parseFloat(p.quantity) || 0;
            if (q <= 0) continue;
            itensQtyByDealer[dc] = (itensQtyByDealer[dc] || 0) + q;
          }
        }

        let credev = 0;
        for (const p of nf.payments || []) {
          if (p.documentType === 'Credev') {
            credev += parseFloat(p.paymentValue) || 0;
          }
        }
        if (credev <= 0) continue;
        // Vendedor real: dealerCode em items[].products[]
        let dc = null;
        for (const item of nf.items || []) {
          for (const p of item.products || []) {
            if (p.dealerCode) {
              dc = String(p.dealerCode);
              break;
            }
          }
          if (dc) break;
        }
        if (dc && merged[dc]) {
          merged[dc].invoice_value -= credev;
          merged[dc].credev_value = (merged[dc].credev_value || 0) + credev;
        }
      }

      // Aplica peças computadas por vendedor (sobrescreve quando temos dado de invoices)
      for (const [dc, qty] of Object.entries(itensQtyByDealer)) {
        if (merged[dc]) {
          // Sobrescreve itens_qty quando invoices retornam dados
          // (TOTVS sellers/search retorna 0 para revenda)
          merged[dc].itens_qty = qty;
          merged[dc].itens_qty_gross = qty;
        }
      }

      // Fetch fiscal-movement p/ SaleReturns dos clientes não em invoices
      const fmEndpoint = `${TOTVS_BASE_URL}/analytics/v2/fiscal-movement/search`;
      const fetchFmPage = async (page) =>
        axios
          .post(
            fmEndpoint,
            {
              filter: {
                branchCodeList: cfg.branchs,
                startMovementDate: `${datemin}T00:00:00`,
                endMovementDate: `${datemax}T23:59:59`,
              },
              page,
              pageSize: 1000,
            },
            {
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${accessToken}`,
              },
              httpsAgent: totvsHttpsAgent,
              timeout: 120000,
            },
          )
          .then((r) => r.data)
          .catch(() => ({ items: [] }));
      const firstFm = await fetchFmPage(1);
      const fmItems = [...(firstFm?.items || [])];
      const fmTotalPages =
        firstFm?.totalPages ||
        (firstFm?.totalItems ? Math.ceil(firstFm.totalItems / 1000) : 1);
      if (fmTotalPages > 1) {
        const rem = Array.from({ length: fmTotalPages - 1 }, (_, i) => i + 2);
        for (let i = 0; i < rem.length; i += 3) {
          const batch = rem.slice(i, i + 3);
          const results = await Promise.all(batch.map(fetchFmPage));
          for (const pd of results) fmItems.push(...(pd?.items || []));
        }
      }

      for (const it of fmItems) {
        if (it.operationModel !== 'SaleReturns') continue;
        const op = parseInt(it.operationCode);
        if (!DEVOL_OPS_LIQUIDO_TOTVS.has(op)) continue;
        const pc = parseInt(it.personCode);
        if (!pc || personsInInvoices.has(pc)) continue;
        const v = parseFloat(it.netValue || it.grossValue || 0);
        if (v <= 0) continue;
        const sc = String(it.sellerCode || '');
        if (sc && merged[sc]) {
          merged[sc].invoice_value -= v;
          merged[sc].credev_value = (merged[sc].credev_value || 0) + v;
        }
      }
    }
  } catch (err) {
    console.warn(
      `[canal-sellers ${modulo}] credev/returns erro: ${err.message}`,
    );
  }

  for (const v of Object.values(merged)) {
    // Garante que invoice_value não fique negativo (após subtração de credev)
    if (v.invoice_value < 0) v.invoice_value = 0;
    v.invoice_value = Math.round(v.invoice_value * 100) / 100;
    v.credev_value = Math.round((v.credev_value || 0) * 100) / 100;
    v.tm =
      v.invoice_qty > 0
        ? Math.round((v.invoice_value / v.invoice_qty) * 100) / 100
        : 0;
    v.pa =
      v.invoice_qty > 0 && v.itens_qty > 0
        ? Math.round((v.itens_qty / v.invoice_qty) * 1000) / 1000
        : 0;
    v.pmpv =
      v.itens_qty > 0
        ? Math.round((v.invoice_value / v.itens_qty) * 100) / 100
        : 0;
  }
  return Object.values(merged).sort(
    (a, b) => b.invoice_value - a.invoice_value,
  );
}

// Analytics: faturamento de um canal agregado por UF do cliente.
// Body: { datemin, datemax, modulo: 'varejo' | 'revenda' | 'multimarcas' }
// Retorna: { rows: [{ uf, invoice_value, invoice_value_ly, growth_pct, customers, top_clients }] }
// Cache em memória de personInfo (UF/cidade/nome) — TTL 30 min
// Reduz chamadas TOTVS para mesmos clientes em requests subsequentes.
const PERSON_INFO_CACHE = new Map(); // pc → { info, ts }
const PERSON_CACHE_TTL = 30 * 60 * 1000;

// Cache em memória do resultado completo do analytics — TTL 5 min
// Versão incrementa quando lógica de classificação muda → invalida cache.
const ANALYTICS_CACHE_VERSION = 'v29-inbound-rafael-branch99';
const ANALYTICS_CACHE = new Map(); // key → { data, ts, ver }
const ANALYTICS_CACHE_TTL = 5 * 60 * 1000;

// Cache separado para o histórico de 12 meses (lastPurchaseItems)
// TTL maior (30 min) pois dados históricos raramente mudam
const HISTORY_CACHE = new Map(); // key → { items, ts }
const HISTORY_CACHE_TTL = 30 * 60 * 1000;

const ANALYTICS_OPS_BY_MODULO = {
  revenda: [7236, 9122, 5102, 7242, 9061, 9001, 9121, 512],
  multimarcas: [7235, 7241],
  inbound_david: [7235, 7241],
  inbound_rafael: [7235, 7241],
  varejo: [545, 546, 548, 9033, 9001, 9009, 510, 521, 511, 522, 9017, 9027],
};

const analyticsHandler = asyncHandler(async (req, res) => {
  const { datemin, datemax } = req.body;
  const modulo = (req.body.modulo || 'revenda').toLowerCase();
  if (!datemin || !datemax) {
    return errorResponse(
      res,
      'datemin e datemax obrigatórios',
      400,
      'MISSING_DATES',
    );
  }
  // Cache hit (5 min TTL) — invalida quando versão da lógica muda
  const cacheKey = `${datemin}|${datemax}|${modulo}|${req.body.withReactivation === true ? '1' : '0'}`;
  const cached = ANALYTICS_CACHE.get(cacheKey);
  if (
    cached &&
    cached.ver === ANALYTICS_CACHE_VERSION &&
    Date.now() - cached.ts < ANALYTICS_CACHE_TTL
  ) {
    return successResponse(
      res,
      {
        ...cached.data,
        cached: true,
        cacheAge: Math.floor((Date.now() - cached.ts) / 1000),
      },
      `Analytics ${modulo} (cache)`,
    );
  }
  const CANAL_OPS = ANALYTICS_OPS_BY_MODULO[modulo];
  if (!CANAL_OPS) {
    return errorResponse(
      res,
      `Módulo "${modulo}" não suportado`,
      400,
      'INVALID_MODULO',
    );
  }
  // Mantém o nome interno mas semantizando como "ops do canal"
  const REVENDA_OP_CODES = CANAL_OPS;

  // Para alinhar com o sistema externo (que separa REVENDEDOR de FRANQUIA/MTM):
  // - revenda: exclui franquia (F-prefix CROSBY) + MTM + Crosby internos/legados
  // - multimarcas: exclui só franquia (mantém MTM já que SÃO multimarca)
  // E filtra pelas filiais classificadas no canal.
  const canalCfg = CANAL_CONFIG[modulo];
  const branchFilter =
    Array.isArray(canalCfg?.branchs) && canalCfg.branchs.length > 0
      ? canalCfg.branchs
      : null;
  let franquiaPCs;
  if (modulo === 'revenda') {
    franquiaPCs = await getNonRevendaPersonCodes();
  } else if (modulo === 'multimarcas' || modulo === 'inbound_david' || modulo === 'inbound_rafael') {
    franquiaPCs = await getFranquiaPersonCodes();
  } else {
    franquiaPCs = new Set();
  }

  // Helper: subtrai 1 ano (mesma data do ano anterior)
  const minusYear = (d) => {
    const [y, m, dd] = d.split('-').map(Number);
    return `${y - 1}-${String(m).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  };
  const datemin_ly = minusYear(datemin);
  const datemax_ly = minusYear(datemax);

  // Devolução/CREDEV: subtrai do bruto p/ retornar valor LÍQUIDO sempre
  // CFOPs canônicos de devolução de venda + ops específicas do canal (canalCfg.devolucaoOps)
  const DEFAULT_DEVOLUCAO_OPS = [1202, 1411, 1410, 2202, 2411];
  const devolucaoOps = Array.from(
    new Set([
      ...DEFAULT_DEVOLUCAO_OPS,
      ...(canalCfg?.devolucaoOps || []).map(Number),
    ]),
  );

  // Helper TOTVS direct — usa fiscal-movement (real-time, sem sync gap).
  // Mesma lógica de filtro do total: bruto - devolução por personCode,
  // só conta SaleReturns se dealer ∈ canal (evita pegar devolução de outros canais).
  // Inclui CFOPs canônicos + ops TOTVS internas (7245 devol revenda confirmada
  // em GISELLY 7581 30/04/2026 — R$ 5.251,32 que não estávamos subtraindo).
  const DEVOL_OPS_LIQUIDO_TOTVS = new Set([
    1202,
    1204,
    1411,
    1410,
    2202,
    2411, // CFOPs canônicos
    1950,
    21, // TOTVS interno + credev item-level
    7245,
    7244,
    7240,
    7790,
    1214,
    20, // ops TOTVS revenda devolução
  ]);
  const allowedDealersDevol =
    Array.isArray(canalCfg?.sellers) && canalCfg.sellers.length > 0
      ? new Set(canalCfg.sellers.map(Number))
      : null;
  const excludedSellersSet =
    Array.isArray(canalCfg?.excludeSellers) && canalCfg.excludeSellers.length > 0
      ? new Set(canalCfg.excludeSellers.map(Number))
      : null;
  // allowedSellers: se definido, só conta NFs atribuídas a esses dealers (inbound_david/rafael)
  const allowedSellersSet =
    Array.isArray(canalCfg?.allowedSellers) && canalCfg.allowedSellers.length > 0
      ? new Set(canalCfg.allowedSellers.map(Number))
      : null;
  // Helper paginação concorrente — busca todas páginas em paralelo após
  // a 1ª descobrir o total
  const fetchMovementPagesParallel = async (di, df, accessToken) => {
    const fetchPage = async (page) => {
      const r = await axios.post(
        `${TOTVS_BASE_URL}/analytics/v2/fiscal-movement/search`,
        {
          filter: {
            branchCodeList: branchFilter,
            startMovementDate: `${di}T00:00:00`,
            endMovementDate: `${df}T23:59:59`,
          },
          page,
          pageSize: 1000,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          httpsAgent: totvsHttpsAgent,
          timeout: 120000,
        },
      );
      return r.data;
    };
    const first = await fetchPage(1);
    const items = [...(first?.items || [])];
    const totalPages =
      first?.totalPages ||
      (first?.totalItems ? Math.ceil(first.totalItems / 1000) : 1);
    if (totalPages > 1) {
      // Busca páginas restantes em paralelo, em batches de 3
      const remaining = Array.from({ length: totalPages - 1 }, (_, i) => i + 2);
      const CONCURRENCY = 3;
      for (let i = 0; i < remaining.length; i += CONCURRENCY) {
        const batch = remaining.slice(i, i + CONCURRENCY);
        const results = await Promise.all(
          batch.map((p) => fetchPage(p).catch(() => ({ items: [] }))),
        );
        for (const pd of results) items.push(...(pd?.items || []));
      }
    }
    return items;
  };

  // ─── Helper paginação invoices com expand=payments ─────────────────────
  const fetchInvoicesPagesParallel = async (
    operationType,
    operationCodes,
    di,
    df,
    accessToken,
    expand = 'payments',
  ) => {
    const fetchPage = async (page) => {
      const r = await axios.post(
        `${TOTVS_BASE_URL}/fiscal/v2/invoices/search`,
        {
          filter: {
            branchCodeList: branchFilter,
            operationCodeList: operationCodes,
            operationType,
            startIssueDate: `${di}T00:00:00`,
            endIssueDate: `${df}T23:59:59`,
          },
          expand,
          page,
          pageSize: 100,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          httpsAgent: totvsHttpsAgent,
          timeout: 120000,
        },
      );
      return r.data;
    };
    const first = await fetchPage(1);
    const items = [...(first?.items || [])];
    const totalPages =
      first?.totalPages ||
      (first?.totalItems ? Math.ceil(first.totalItems / 100) : 1);
    if (totalPages > 1) {
      const remaining = Array.from({ length: totalPages - 1 }, (_, i) => i + 2);
      const CONC = 3;
      for (let i = 0; i < remaining.length; i += CONC) {
        const batch = remaining.slice(i, i + CONC);
        const results = await Promise.all(
          batch.map((p) => fetchPage(p).catch(() => ({ items: [] }))),
        );
        for (const pd of results) items.push(...(pd?.items || []));
      }
    }
    return items;
  };

  // ─── Função HÍBRIDA com PRIORIDADE para fiscal/v2/invoices (NF total)
  // Fluxo:
  //   1. fiscal/v2/invoices: NF total + credev (precisão para branches com NF)
  //   2. fiscal-movement: Sales para personCodes que NÃO estão em invoices
  //      (cobre branches 200/etc. sem emissão de NF)
  //   3. Subtrai op 21 SaleReturns para clientes sem NF
  const fetchPeriodAggInvoices = async (di, df, accessToken) => {
    const byPerson = new Map();
    let totalBruto = 0;
    let totalCredev = 0;
    const nfsBrutoSet = new Set();
    const personsInInvoices = new Set();

    // PASS 0: fiscal/v2/invoices (fonte primária — NF total + credev em payments)
    try {
      const outputItems = await fetchInvoicesPagesParallel(
        'Output',
        canalCfg.operations,
        di,
        df,
        accessToken,
        'payments,items',
      );
      for (const nf of outputItems) {
        if (nf.invoiceStatus === 'Canceled' || nf.invoiceStatus === 'Deleted')
          continue;
        const pc = parseInt(nf.personCode);
        if (!pc || franquiaPCs.has(pc)) continue;
        const total = parseFloat(nf.totalValue) || 0;
        if (total <= 0) continue;
        // Extract dealerCode from items[].products[]
        let dc = null;
        for (const item of nf.items || []) {
          for (const p of item.products || []) {
            if (p.dealerCode) {
              dc = parseInt(p.dealerCode);
              break;
            }
          }
          if (dc) break;
        }
        if (excludedSellersSet && dc && excludedSellersSet.has(dc)) continue;
        if (allowedSellersSet && (!dc || !allowedSellersSet.has(dc))) continue;
        let credev = 0;
        for (const p of nf.payments || []) {
          if (p.documentType === 'Credev')
            credev += parseFloat(p.paymentValue) || 0;
        }
        const netValue = total - credev;
        const ex = byPerson.get(pc) || {
          value: 0,
          qty: 0,
          sellerValues: new Map(),
          firstDate: null,
        };
        ex.value += netValue;
        ex.qty += 1;
        if (dc)
          ex.sellerValues.set(dc, (ex.sellerValues.get(dc) || 0) + netValue);
        const md = nf.issueDate;
        if (md && (!ex.firstDate || md < ex.firstDate)) ex.firstDate = md;
        byPerson.set(pc, ex);
        personsInInvoices.add(pc);
        totalBruto += total;
        totalCredev += credev;
        nfsBrutoSet.add(`${nf.branchCode}|${nf.invoiceCode}|${nf.issueDate}`);
      }
    } catch (err) {
      console.warn(`[analytics] invoices fetch falhou: ${err.message}`);
    }

    // ── Fonte 2: fiscal-movement — captura clientes que NÃO estão em invoices
    const movementItems = await fetchMovementPagesParallel(di, df, accessToken);

    // PASS 1: Sales (apenas para clientes não cobertos por invoices)
    for (const it of movementItems) {
      if (personsInInvoices.has(parseInt(it.personCode))) continue;
      if (it.operationModel !== 'Sales') continue;
      const op = parseInt(it.operationCode);
      if (!REVENDA_OP_CODES.includes(op)) continue;
      const pc = parseInt(it.personCode);
      if (!pc || franquiaPCs.has(pc)) continue;
      const v = parseFloat(it.netValue || it.grossValue || 0);
      if (v <= 0) continue;
      const dc = parseInt(it.sellerCode) || null;
      if (excludedSellersSet && dc && excludedSellersSet.has(dc)) continue;
      if (allowedSellersSet && (!dc || !allowedSellersSet.has(dc))) continue;
      const ex = byPerson.get(pc) || {
        value: 0,
        qty: 0,
        sellerValues: new Map(),
        firstDate: null,
      };
      ex.value += v;
      if (!ex.qty) ex.qty = 1;
      if (dc) ex.sellerValues.set(dc, (ex.sellerValues.get(dc) || 0) + v);
      const md = it.movementDate;
      if (md && (!ex.firstDate || md < ex.firstDate)) ex.firstDate = md;
      byPerson.set(pc, ex);
      totalBruto += v;
      nfsBrutoSet.add(`${it.branchCode}|${it.personCode}|${it.movementDate}`);
    }

    // PASS 2: SaleReturns op 21 (apenas clientes não em invoices)
    for (const it of movementItems) {
      if (personsInInvoices.has(parseInt(it.personCode))) continue;
      if (it.operationModel !== 'SaleReturns') continue;
      if (parseInt(it.operationCode) !== 21) continue;
      const pc = parseInt(it.personCode);
      if (!pc || franquiaPCs.has(pc)) continue;
      const v = parseFloat(it.netValue || it.grossValue || 0);
      if (v <= 0) continue;
      const ex = byPerson.get(pc);
      if (!ex) continue;
      ex.value -= v;
      totalCredev += v;
    }

    // Bloco antigo (mantido para fallback caso algo dê errado)
    const _legacyDeadCode = false;
    if (_legacyDeadCode) {
      for (const it of movementItems) {
        if (it.operationModel !== 'Sales') continue;
        const op = parseInt(it.operationCode);
        if (!REVENDA_OP_CODES.includes(op)) continue;
        const pc = parseInt(it.personCode);
        if (!pc || franquiaPCs.has(pc)) continue;
        const v = parseFloat(it.netValue || it.grossValue || 0);
        if (v <= 0) continue;
        const dc = parseInt(it.sellerCode) || null;
        const ex = byPerson.get(pc) || {
          value: 0,
          qty: 0,
          sellerValues: new Map(),
          firstDate: null,
        };
        ex.value += v;
        if (dc) ex.sellerValues.set(dc, (ex.sellerValues.get(dc) || 0) + v);
        const md = it.movementDate;
        if (md && (!ex.firstDate || md < ex.firstDate)) ex.firstDate = md;
        byPerson.set(pc, ex);
        totalBruto += v;
        nfsBrutoSet.add(`${it.branchCode}|${it.personCode}|${it.movementDate}`);
      }

      // PASS 2: SaleReturns op 21 (credev gerado via devolução, item-level)
      // Caso LEILIANA branch 200: sem NF em fiscal/v2/invoices, mas há op 21
      for (const it of movementItems) {
        if (it.operationModel !== 'SaleReturns') continue;
        if (parseInt(it.operationCode) !== 21) continue;
        const pc = parseInt(it.personCode);
        if (!pc || franquiaPCs.has(pc)) continue;
        const v = parseFloat(it.netValue || it.grossValue || 0);
        if (v <= 0) continue;
        const ex = byPerson.get(pc);
        if (!ex) continue;
        ex.value -= v;
        totalCredev += v;
      }
      // Conta NFs únicas por personCode (aproximação)
      for (const ex of byPerson.values()) {
        ex.qty = 1; // Estima 1 NF por cliente; ajustar depois com invoices
      }

      // ── Fonte 2: fiscal/v2/invoices/search — credev USADO em pagamento (NF nivel)
      // Caso KATIANA branch 2: NF total - credev pago = liquido
      try {
        const outputItems = await fetchInvoicesPagesParallel(
          'Output',
          canalCfg.operations,
          di,
          df,
          accessToken,
          'payments',
        );
        const qtyByPerson = new Map();
        for (const nf of outputItems) {
          if (nf.invoiceStatus === 'Canceled' || nf.invoiceStatus === 'Deleted')
            continue;
          const pc = parseInt(nf.personCode);
          if (!pc || franquiaPCs.has(pc)) continue;
          let credev = 0;
          for (const p of nf.payments || []) {
            if (p.documentType === 'Credev')
              credev += parseFloat(p.paymentValue) || 0;
          }
          if (credev > 0) {
            const ex = byPerson.get(pc);
            if (ex) {
              ex.value -= credev;
              totalCredev += credev;
            }
          }
          qtyByPerson.set(pc, (qtyByPerson.get(pc) || 0) + 1);
        }
        for (const [pc, qty] of qtyByPerson.entries()) {
          const ex = byPerson.get(pc);
          if (ex) ex.qty = qty;
        }
      } catch (err) {
        console.warn(`[analytics] credev lookup falhou: ${err.message}`);
      }
    } // fim _legacyDeadCode

    // Remove person_codes com saldo ≤ 0 após credev
    for (const [pc, ex] of byPerson.entries()) {
      if (ex.value <= 0) byPerson.delete(pc);
    }

    byPerson.__bruto = totalBruto;
    byPerson.__devol = totalCredev;
    byPerson.__credev = totalCredev;
    byPerson.__qty = nfsBrutoSet.size;
    return byPerson;
  };

  const fetchPeriodAggTotvs = async (di, df, accessToken) => {
    const items = await fetchMovementPagesParallel(di, df, accessToken);
    const byPerson = new Map();
    let totalBruto = 0;
    let totalDevol = 0;
    const nfsBrutoSet = new Set();
    // PASS 1: Sales — constrói byPerson
    for (const it of items) {
      if (it.operationModel !== 'Sales') continue;
      const pc = parseInt(it.personCode);
      if (franquiaPCs.has(pc)) continue;
      const op = parseInt(it.operationCode);
      if (!REVENDA_OP_CODES.includes(op)) continue;
      const v = parseFloat(it.netValue || it.grossValue || 0);
      if (v <= 0) continue;
      const dc = parseInt(it.sellerCode) || null;
      if (excludedSellersSet && dc && excludedSellersSet.has(dc)) continue;
      if (allowedSellersSet && (!dc || !allowedSellersSet.has(dc))) continue;
      const ex = byPerson.get(pc) || {
        value: 0,
        qty: 0,
        sellerValues: new Map(),
        firstDate: null,
      };
      ex.value += v;
      ex.qty += 1;
      if (dc) {
        ex.sellerValues.set(dc, (ex.sellerValues.get(dc) || 0) + v);
      }
      const md = it.movementDate;
      if (md && (!ex.firstDate || md < ex.firstDate)) ex.firstDate = md;
      byPerson.set(pc, ex);
      totalBruto += v;
      nfsBrutoSet.add(`${it.branchCode}|${it.personCode}|${it.movementDate}`);
    }
    // PASS 2: SaleReturns — subtrai por personCode (já em byPerson) ou dealer revenda
    for (const it of items) {
      if (it.operationModel !== 'SaleReturns') continue;
      const pc = parseInt(it.personCode);
      if (franquiaPCs.has(pc)) continue;
      const op = parseInt(it.operationCode);
      if (!DEVOL_OPS_LIQUIDO_TOTVS.has(op)) continue;
      const v = parseFloat(it.netValue || it.grossValue || 0);
      if (v <= 0) continue;
      const dc = parseInt(it.sellerCode) || null;
      // Subtrai SE: dealer é revenda OU cliente já é revenda (em byPerson)
      const dealerIsRevenda =
        allowedDealersDevol && dc && allowedDealersDevol.has(dc);
      const customerIsRevenda = byPerson.has(pc);
      if (!dealerIsRevenda && !customerIsRevenda) continue;
      totalDevol += v;
      const ex = byPerson.get(pc);
      if (!ex) continue;
      ex.value -= v;
      if (dc && ex.sellerValues.has(dc)) {
        ex.sellerValues.set(dc, ex.sellerValues.get(dc) - v);
      }
    }
    // Remove person_codes com saldo ≤ 0
    for (const [pc, ex] of byPerson.entries()) {
      if (ex.value <= 0) byPerson.delete(pc);
    }
    // Anexa totals como propriedades extras do Map (não-padrão mas funciona)
    byPerson.__bruto = totalBruto;
    byPerson.__devol = totalDevol;
    byPerson.__qty = nfsBrutoSet.size;
    return byPerson;
  };

  // Helper Supabase fallback — usado quando canal não tem branchFilter
  // (ex: módulos não configurados).
  const fetchPeriodAgg = async (di, df) => {
    const PAGE = 1000;
    const byPerson = new Map();
    let offset = 0;
    while (true) {
      let q = supabaseFiscal
        .from('notas_fiscais')
        .select('person_code, total_value, branch_code, dealer_code')
        .eq('operation_type', 'Output')
        .not('invoice_status', 'eq', 'Canceled')
        .not('invoice_status', 'eq', 'Deleted')
        .gte('issue_date', di)
        .lte('issue_date', df)
        .in('operation_code', REVENDA_OP_CODES)
        .lt('person_code', 100000000);
      if (branchFilter) {
        q = q.in('branch_code', branchFilter);
      } else {
        q = q.gt('branch_code', 0).lt('branch_code', 991);
      }
      const { data, error } = await q.range(offset, offset + PAGE - 1);
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) break;
      for (const nf of data) {
        const pc = nf.person_code;
        if (franquiaPCs.has(pc)) continue;
        const dc = parseInt(nf.dealer_code) || null;
        if (excludedSellersSet && dc && excludedSellersSet.has(dc)) continue;
        if (allowedSellersSet && (!dc || !allowedSellersSet.has(dc))) continue;
        const val = parseFloat(nf.total_value) || 0;
        const ex = byPerson.get(pc) || {
          value: 0,
          qty: 0,
          sellerValues: new Map(),
        };
        ex.value += val;
        ex.qty += 1;
        if (dc) {
          ex.sellerValues.set(dc, (ex.sellerValues.get(dc) || 0) + val);
        }
        byPerson.set(pc, ex);
      }
      if (data.length < PAGE) break;
      offset += PAGE;
    }
    if (devolucaoOps.length > 0) {
      offset = 0;
      while (true) {
        let q = supabaseFiscal
          .from('notas_fiscais')
          .select('person_code, total_value, branch_code, dealer_code')
          .eq('operation_type', 'Input')
          .not('invoice_status', 'eq', 'Canceled')
          .not('invoice_status', 'eq', 'Deleted')
          .gte('issue_date', di)
          .lte('issue_date', df)
          .in('operation_code', devolucaoOps)
          .lt('person_code', 100000000);
        if (branchFilter) {
          q = q.in('branch_code', branchFilter);
        } else {
          q = q.gt('branch_code', 0).lt('branch_code', 991);
        }
        const { data, error } = await q.range(offset, offset + PAGE - 1);
        if (error) break;
        if (!data || data.length === 0) break;
        for (const nf of data) {
          const pc = nf.person_code;
          if (franquiaPCs.has(pc)) continue;
          const dc = parseInt(nf.dealer_code) || null;
          const val = parseFloat(nf.total_value) || 0;
          const ex = byPerson.get(pc);
          if (!ex) continue;
          ex.value -= val;
          if (dc && ex.sellerValues.has(dc)) {
            ex.sellerValues.set(dc, ex.sellerValues.get(dc) - val);
          }
        }
        if (data.length < PAGE) break;
        offset += PAGE;
      }
    }
    for (const [pc, ex] of byPerson.entries()) {
      if (ex.value <= 0) byPerson.delete(pc);
    }
    return byPerson;
  };

  let byPerson,
    byPersonLY,
    lastPurchaseItems = [];
  try {
    // Quando o canal tem branchFilter configurado, usa TOTVS direct
    // (fiscal-movement) — bypass sync gap do Supabase, valores precisos.
    if (branchFilter) {
      const tokenData = await getToken();
      const accessToken = tokenData?.access_token;
      if (accessToken) {
        // Paraleliza as 2 chamadas principais (atual + LY)
        // Usa fiscal/v2/invoices/search (NF total + payments) — mais alinhado
        // com painel TOTVS que mostra NF total - credev como receita real.
        [byPerson, byPersonLY] = await Promise.all([
          fetchPeriodAggInvoices(datemin, datemax, accessToken),
          fetchPeriodAggInvoices(datemin_ly, datemax_ly, accessToken),
        ]);
        // ── Credev já é tratado dentro de fetchPeriodAggInvoices ────────
        // (NF.totalValue - sum(payments where documentType='Credev'))
        // Variável mantida para retrocompatibilidade.
        const fetchCredevByPerson_DEPRECATED = async (dmin, dmax) => {
          const credevByPerson = new Map();
          const fetchPage = async (page) => {
            const r = await axios.post(
              `${TOTVS_BASE_URL}/fiscal/v2/invoices/search`,
              {
                filter: {
                  branchCodeList: branchFilter,
                  operationCodeList: canalCfg.operations,
                  operationType: 'Output',
                  startIssueDate: `${dmin}T00:00:00`,
                  endIssueDate: `${dmax}T23:59:59`,
                },
                expand: 'payments',
                page,
                pageSize: 100,
              },
              {
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${accessToken}`,
                },
                httpsAgent: totvsHttpsAgent,
                timeout: 120000,
              },
            );
            return r.data;
          };
          try {
            const first = await fetchPage(1);
            const items = [...(first?.items || [])];
            const totalPages =
              first?.totalPages ||
              (first?.totalItems ? Math.ceil(first.totalItems / 100) : 1);
            if (totalPages > 1) {
              const remaining = Array.from(
                { length: totalPages - 1 },
                (_, i) => i + 2,
              );
              const CONC = 3;
              for (let i = 0; i < remaining.length; i += CONC) {
                const batch = remaining.slice(i, i + CONC);
                const results = await Promise.all(
                  batch.map((p) => fetchPage(p).catch(() => ({ items: [] }))),
                );
                for (const pd of results) items.push(...(pd?.items || []));
              }
            }
            for (const nf of items) {
              if (
                nf.invoiceStatus === 'Canceled' ||
                nf.invoiceStatus === 'Deleted'
              )
                continue;
              const pc = parseInt(nf.personCode);
              if (!pc || franquiaPCs.has(pc)) continue;
              let credev = 0;
              for (const p of nf.payments || []) {
                if (p.documentType === 'Credev') {
                  credev += parseFloat(p.paymentValue) || 0;
                }
              }
              if (credev > 0) {
                credevByPerson.set(pc, (credevByPerson.get(pc) || 0) + credev);
              }
            }
          } catch (err) {
            console.warn(`[analytics] credev fetch falhou: ${err.message}`);
          }
          return credevByPerson;
        };

        // Credev já tratado dentro de fetchPeriodAggInvoices (byPerson.__credev)

        // 3ª chamada: histórico ANTES de datemin — sempre executado para detectar
        // aberturas sem depender do Supabase (que pode estar desatualizado).
        // Janela: 12 meses antes do início do período.
        if (byPerson.size > 0) {
          try {
            const dminDate = new Date(datemin);
            const dprevStart = new Date(dminDate);
            dprevStart.setFullYear(dprevStart.getFullYear() - 1);
            const dprevEnd = new Date(dminDate);
            dprevEnd.setDate(dprevEnd.getDate() - 1);
            const fmtDate = (d) =>
              `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            const dminPrev = fmtDate(dprevStart);
            const dmaxPrev = fmtDate(dprevEnd);
            const historyCacheKey = `${dminPrev}|${dmaxPrev}`;
            const cachedHistory = HISTORY_CACHE.get(historyCacheKey);
            if (
              cachedHistory &&
              Date.now() - cachedHistory.ts < HISTORY_CACHE_TTL
            ) {
              lastPurchaseItems = cachedHistory.items;
              console.log(
                `💾 [analytics] lastPurchase do cache (${lastPurchaseItems.length} itens)`,
              );
            } else {
              lastPurchaseItems = await fetchMovementPagesParallel(
                dminPrev,
                dmaxPrev,
                accessToken,
              );
              HISTORY_CACHE.set(historyCacheKey, {
                items: lastPurchaseItems,
                ts: Date.now(),
              });
              console.log(
                `✅ [analytics] lastPurchase buscado e cacheado (${lastPurchaseItems.length} itens)`,
              );
            }
          } catch (err) {
            console.warn(`[analytics] lastPurchaseBefore: ${err.message}`);
            lastPurchaseItems = [];
          }
        }
      } else {
        [byPerson, byPersonLY] = await Promise.all([
          fetchPeriodAgg(datemin, datemax),
          fetchPeriodAgg(datemin_ly, datemax_ly),
        ]);
      }
    } else {
      [byPerson, byPersonLY] = await Promise.all([
        fetchPeriodAgg(datemin, datemax),
        fetchPeriodAgg(datemin_ly, datemax_ly),
      ]);
    }
  } catch (err) {
    return errorResponse(res, err.message, 500, 'DB_ERROR');
  }

  if (byPerson.size === 0 && byPersonLY.size === 0) {
    return successResponse(
      res,
      { rows: [], total: 0, total_clients: 0, total_value: 0 },
      '0 NFs revenda no período',
    );
  }

  // 2) Lookup UF + cidade + nome de cada person_code DIRETO no TOTVS
  // Não usa mais Supabase pes_pessoa (que pode estar desatualizado).
  const personCodes = [...new Set([...byPerson.keys(), ...byPersonLY.keys()])];
  const personInfo = new Map();
  // Helper: extrai UF + cidade de uma row (mapeada via fetchAndMapPersons)
  const pickAddress = (row) => {
    let uf = row.uf || null;
    let cidade = null;
    if (Array.isArray(row.addresses) && row.addresses.length > 0) {
      const com = row.addresses.find((a) => a.addressType === 'Commercial');
      const def = row.addresses.find((a) => a.isDefault);
      const pick = com || def || row.addresses[0];
      if (pick) {
        if (!uf) uf = pick.stateAbbreviation || pick.uf || null;
        cidade = pick.cityName || null;
      }
    }
    return { uf, cidade };
  };

  // 1) Primeiro tenta o cache (TTL 30min) para evitar chamadas TOTVS repetidas
  const now = Date.now();
  const codesToFetch = [];
  for (const pc of personCodes) {
    const cached = PERSON_INFO_CACHE.get(pc);
    if (cached && now - cached.ts < PERSON_CACHE_TTL) {
      personInfo.set(pc, cached.info);
    } else {
      codesToFetch.push(pc);
    }
  }
  // 2) Busca apenas os que não estão em cache, em paralelo (chunks de 100)
  if (codesToFetch.length > 0) {
    console.log(
      `[analytics] ${personCodes.length - codesToFetch.length} cache hit, buscando ${codesToFetch.length} clientes no TOTVS...`,
    );
    const TOTVS_CHUNK = 100;
    const chunks = [];
    for (let i = 0; i < codesToFetch.length; i += TOTVS_CHUNK) {
      chunks.push(codesToFetch.slice(i, i + TOTVS_CHUNK));
    }
    // Paraleliza chunks (até 4 simultâneos pra não estourar TOTVS)
    const CHUNK_CONCURRENCY = 4;
    for (let i = 0; i < chunks.length; i += CHUNK_CONCURRENCY) {
      const batch = chunks.slice(i, i + CHUNK_CONCURRENCY);
      await Promise.all(
        batch.map(async (chunk) => {
          try {
            const { allRows } = await fetchAndMapPersons(
              { personCodeList: chunk },
              'analytics-totvs',
            );
            for (const row of allRows || []) {
              const { uf, cidade } = pickAddress(row);
              const info = {
                name:
                  row.fantasy_name || row.nm_pessoa || `Cliente ${row.code}`,
                uf: (uf || 'N/D').toUpperCase(),
                cidade,
                insertDate: row.insert_date || row.insertDate || null,
                phones: extractAllPhonesFromPessoa(row),
              };
              personInfo.set(Number(row.code), info);
              PERSON_INFO_CACHE.set(Number(row.code), { info, ts: now });
            }
          } catch (err) {
            console.warn(`[analytics-totvs] chunk falhou: ${err.message}`);
          }
        }),
      );
    }
  }

  // 3) Agrega por UF (atual) — também acumula valores por vendedor por UF
  const byUF = new Map(); // uf → { value, qty, customers: Map<pc,...>, sellerValues: Map<dc,value> }
  for (const [pc, info] of byPerson.entries()) {
    const pinfo = personInfo.get(pc) || { name: `Cliente ${pc}`, uf: 'N/D' };
    const uf = pinfo.uf || 'N/D';
    const ex = byUF.get(uf) || {
      value: 0,
      qty: 0,
      customers: new Map(),
      sellerValues: new Map(),
    };
    ex.value += info.value;
    ex.qty += info.qty;
    // Vendedor dominante deste cliente
    let topSeller = null;
    let topSellerVal = 0;
    for (const [dc, v] of info.sellerValues.entries()) {
      ex.sellerValues.set(dc, (ex.sellerValues.get(dc) || 0) + v);
      if (v > topSellerVal) {
        topSellerVal = v;
        topSeller = dc;
      }
    }
    ex.customers.set(pc, {
      person_code: pc,
      person_name: pinfo.name,
      cidade: pinfo.cidade,
      value: info.value,
      qty: info.qty,
      seller_code: topSeller,
    });
    byUF.set(uf, ex);
  }

  // Ano passado (LY) — agrega por UF + lista de clientes (igual byUF)
  const byUF_LY = new Map();
  for (const [pc, info] of byPersonLY.entries()) {
    const pinfo = personInfo.get(pc) || { name: `Cliente ${pc}`, uf: 'N/D' };
    const uf = pinfo.uf || 'N/D';
    const ex = byUF_LY.get(uf) || {
      value: 0,
      qty: 0,
      customers: new Map(),
    };
    ex.value += info.value;
    ex.qty += info.qty;
    let topSeller = null;
    let topSellerVal = 0;
    for (const [dc, v] of info.sellerValues.entries()) {
      if (v > topSellerVal) {
        topSellerVal = v;
        topSeller = dc;
      }
    }
    ex.customers.set(pc, {
      person_code: pc,
      person_name: pinfo.name,
      cidade: pinfo.cidade,
      value: info.value,
      qty: info.qty,
      seller_code: topSeller,
    });
    byUF_LY.set(uf, ex);
  }

  // Lookup nomes dos vendedores B2R via Supabase v_vendedores_integracao
  let vendMap = {};
  try {
    const m = await loadVendedoresMap();
    vendMap = m?.byTotvsId || {};
  } catch (e) {
    console.warn('[analytics-revenda] sellerName lookup falhou:', e.message);
  }
  const sellerName = (dc) =>
    vendMap[dc]?.nome || vendMap[String(dc)]?.nome || `Vend. ${dc}`;

  // 4) Tags de abertura/reativação — histórico anterior via TOTVS direct
  // Estes itens já foram pré-buscados em paralelo (lastPurchaseItems).
  // firstPurchaseInPeriod já vem em byPerson.firstDate (extraído de items).
  const lastPurchaseBefore = new Map();
  if (byPerson.size > 0 && lastPurchaseItems && lastPurchaseItems.length > 0) {
    const pcsSet = new Set([...byPerson.keys()]);
    for (const it of lastPurchaseItems) {
      const pc = parseInt(it.personCode);
      if (!pcsSet.has(pc)) continue;
      if (it.operationModel !== 'Sales') continue;
      // Filtra apenas operações do mesmo canal (ex: revenda) para não
      // considerar compras de outros canais como "histórico de abertura"
      const op = parseInt(it.operationCode);
      if (!REVENDA_OP_CODES.includes(op)) continue;
      const md = it.movementDate;
      if (!md) continue;
      const cur = lastPurchaseBefore.get(pc);
      if (!cur || md > cur) lastPurchaseBefore.set(pc, md);
    }
  }
  // Helper: classifica cliente em abertura/reativação/recorrente
  // 'abertura' = sem compra no TOTVS nos 12 meses anteriores ao período
  // 'reativacao' = histórico anterior com gap >= 60 dias
  // 'recorrente' = comprou nos últimos 60 dias antes do período
  const REATIVACAO_DAYS = 60;
  // lastPurchaseItems é sempre buscado (12 meses) — não depende de flag
  const reactivationDataAvailable = lastPurchaseItems.length >= 0;
  const classifyClient = (pc, firstPeriodDate, aberturasSet) => {
    // Abertura: está no set calculado com insertDate + sem compra anterior
    if (aberturasSet.has(pc)) return 'abertura';
    // Reativação: tem compra anterior mas gap >= REATIVACAO_DAYS
    if (reactivationDataAvailable) {
      const prev = lastPurchaseBefore.get(pc);
      if (prev && firstPeriodDate) {
        const gap = (new Date(firstPeriodDate) - new Date(prev)) / 86400000;
        if (gap >= REATIVACAO_DAYS) return 'reativacao';
      }
      return 'recorrente';
    }
    return 'recorrente';
  };

  // firstPurchaseInPeriod agora vem direto de byPerson (capturado em fetchPeriodAggTotvs)
  const firstPurchaseInPeriod = new Map();
  for (const [pc, info] of byPerson.entries()) {
    if (info.firstDate) firstPurchaseInPeriod.set(pc, info.firstDate);
  }

  // Aberturas de cadastro do canal (calculado ANTES do rows.map p/ uso no classifyClient):
  //   1) cliente cadastrado dentro do período (pes_pessoa.insert_date)
  //   2) que tem COMPRA do canal no mesmo período (em byPerson)
  // Aberturas = cliente que:
  //   1) teve o cadastro criado no TOTVS dentro do período (insertDate)
  //   2) fez compra no canal no período (está em byPerson)
  //   3) não tem compra no canal nos 12 meses anteriores (primeira compra)
  let aberturasAtual = 0;
  let aberturasAtualPCs = new Set();
  let aberturasLY = 0;
  let aberturasLYPCs = new Set();
  const dminTs = new Date(datemin).getTime();
  const dmaxTs = new Date(datemax + 'T23:59:59').getTime();
  for (const pc of byPerson.keys()) {
    const pinfo = personInfo.get(pc);
    const iDate = pinfo?.insertDate;
    const hasNoPriorPurchase = !lastPurchaseBefore.has(pc);
    if (iDate) {
      // Usa insertDate do TOTVS como critério principal
      const its = new Date(iDate).getTime();
      const registeredInPeriod = its >= dminTs && its <= dmaxTs;
      if (registeredInPeriod && hasNoPriorPurchase) aberturasAtualPCs.add(pc);
    }
    // Sem insertDate disponível → não conta como abertura (evita falsos positivos com clientes antigos)
  }
  aberturasAtual = aberturasAtualPCs.size;
  aberturasLY = 0;

  // Match aberturas com leads ClickUp (tráfego pago / CRM)
  const aberturasClickupMatch = new Map(); // personCode → { lead_name, status, url, origem, lead_date }
  if (CLICKUP_API_KEY && aberturasAtualPCs.size > 0) {
    try {
      // Índice reverso telefone → personCode somente para as aberturas
      const phoneToPC = new Map();
      for (const pc of aberturasAtualPCs) {
        const pinfo = personInfo.get(pc);
        for (const rawPhone of pinfo?.phones || []) {
          for (const v of buildPhoneVariants(rawPhone)) {
            if (v && !phoneToPC.has(v)) phoneToPC.set(v, pc);
          }
        }
      }
      if (phoneToPC.size > 0) {
        const clickupData = await loadClickupLeads({ allHistory: true });
        const allLeads = (clickupData?.canais || []).flatMap(
          (c) => c?.tarefas || [],
        );
        for (const lead of allLeads) {
          if (!lead.telefone) continue;
          let matchedPC = null;
          for (const v of buildPhoneVariants(lead.telefone)) {
            if (phoneToPC.has(v)) {
              matchedPC = phoneToPC.get(v);
              break;
            }
          }
          if (!matchedPC) continue;
          const existing = aberturasClickupMatch.get(matchedPC);
          const leadDate = lead.dataCriacao
            ? lead.dataCriacao.slice(0, 10)
            : '';
          if (!existing || leadDate < existing.lead_date) {
            aberturasClickupMatch.set(matchedPC, {
              lead_name: lead.nome || '',
              status: lead.status || '',
              url: lead.clickupUrl || `https://app.clickup.com/t/${lead.id}`,
              origem: lead.origem || '',
              lead_date: leadDate,
            });
          }
        }
      }
      console.log(
        `[analytics] ClickUp: ${aberturasClickupMatch.size} aberturas com lead no CRM`,
      );
    } catch (err) {
      console.warn('[analytics] ClickUp match falhou:', err.message);
    }
  }

  // Ticket médio das aberturas
  var ticketMedioAbertura = null;
  var totalFatAbertura = null;
  if (aberturasAtualPCs.size > 0) {
    let somaAbert = 0;
    for (const pc of aberturasAtualPCs) {
      const info = byPerson.get(pc);
      if (info) somaAbert += info.value || 0;
    }
    ticketMedioAbertura =
      Math.round((somaAbert / aberturasAtualPCs.size) * 100) / 100;
    totalFatAbertura = Math.round(somaAbert * 100) / 100;
  }

  const totalValueSupa = [...byUF.values()].reduce((s, v) => s + v.value, 0);
  const totalValueLYSupa = [...byUF_LY.values()].reduce(
    (s, v) => s + v.value,
    0,
  );

  // ─── Total LÍQUIDO via TOTVS Sale Panel (fonte oficial — TOTVS faz a
  // compensação automática quando passamos venda + devolução juntas).
  let totalValue = totalValueSupa;
  let totalValueLY = totalValueLYSupa;
  let totalQtyTotvs = byPerson.__qty || null;
  let totalQtyLYTotvs = byPersonLY.__qty || null;
  let totalValueGrossTotvs =
    byPerson.__bruto != null ? Math.round(byPerson.__bruto * 100) / 100 : null;
  let totalDevolTotvs =
    byPerson.__devol != null ? Math.round(byPerson.__devol * 100) / 100 : null;
  if (
    branchFilter &&
    Array.isArray(canalCfg?.operations) &&
    canalCfg.operations.length > 0
  ) {
    try {
      const tokenData = await getToken();
      const accessToken = tokenData?.access_token;
      if (accessToken) {
        // Combina ops de venda + devolução numa única chamada → líquido oficial
        const DEVOL_TOTVS_OPS = [
          7245,
          7244,
          7240,
          7790,
          1214,
          20, // ops TOTVS internas
          1202,
          1204,
          1411,
          1410,
          2202,
          2411,
          1950,
          21, // CFOPs
        ];
        const opsCombined = Array.from(
          new Set([...canalCfg.operations, ...DEVOL_TOTVS_OPS]),
        );
        const callTotalsLiquid = async (dmin, dmax) => {
          const r = await callTotvsTotalsSearch({
            branchs: branchFilter,
            operations: opsCombined,
            datemin: dmin,
            datemax: dmax,
          });
          const row = r?.dataRow?.[0] || {};
          return {
            liquid: parseFloat(row.invoice_value) || 0,
            qty: parseInt(row.invoice_qty) || 0,
          };
        };
        // Não chama Sale Panel — usamos byPerson direto (já é Liquido = Bruto - Credev)
        totalValue = [...byPerson.values()].reduce((s, v) => s + v.value, 0);
        totalValueLY = [...byPersonLY.values()].reduce(
          (s, v) => s + v.value,
          0,
        );
      }
    } catch (err) {
      console.warn(`[analytics] Sale Panel total falhou: ${err.message}`);
    }
  }
  if (
    false && // ←  desabilitado: byPerson já tem dados TOTVS
    branchFilter &&
    Array.isArray(canalCfg?.operations) &&
    canalCfg.operations.length > 0
  ) {
    try {
      const tokenData = await getToken();
      const accessToken = tokenData?.access_token;
      if (!accessToken) throw new Error('Sem token TOTVS');

      const fetchAllItemsMovement = async (branches, dmin, dmax) => {
        const items = [];
        let page = 1;
        while (page <= 100) {
          const r = await axios.post(
            `${TOTVS_BASE_URL}/analytics/v2/fiscal-movement/search`,
            {
              filter: {
                branchCodeList: branches,
                startMovementDate: `${dmin}T00:00:00`,
                endMovementDate: `${dmax}T23:59:59`,
              },
              page,
              pageSize: 1000,
            },
            {
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${accessToken}`,
              },
              httpsAgent: totvsHttpsAgent,
              timeout: 120000,
            },
          );
          const arr = r.data?.items || [];
          if (arr.length === 0) break;
          items.push(...arr);
          if (arr.length < 1000) break;
          page++;
        }
        return items;
      };

      // Lista de devolução: CFOPs canônicos + ops TOTVS internas (1950, 21).
      // - 1950: confirmada via fiscal/v2/invoices/search (devolução c/ NF)
      // - 21: credev item-level / devolução parcial (sem NF emitida).
      //   Confirmado: ITALO JORGE (pc=44524) tem 2× op 21 (R$ 53,40+R$ 53,40
      //   = R$ 106,80) que bate EXATAMENTE com o credev mostrado no painel
      //   externo (R$ 106,81). Validado por comparação NF-a-NF em 01/04/2025.
      const DEVOL_OPS_LIQUIDO = new Set([
        1202,
        1204,
        1411,
        1410,
        2202,
        2411, // CFOPs canônicos
        1950, // Devolução TOTVS com NF
        21, // Credev item-level / devolução parcial
      ]);
      // Dealers do canal — usado para filtrar devoluções (só subtrai de
      // dealers do canal, não captura devoluções de varejo/franquia/etc.)
      const allowedDealersDevol =
        Array.isArray(canalCfg?.sellers) && canalCfg.sellers.length > 0
          ? new Set(canalCfg.sellers.map(Number))
          : null;
      const aggregate = async (dmin, dmax) => {
        const items = await fetchAllItemsMovement(branchFilter, dmin, dmax);
        let bruto = 0;
        let devol = 0;
        let nfsBrutoSet = new Set();
        for (const it of items) {
          const pc = parseInt(it.personCode);
          if (franquiaPCs.has(pc)) continue;
          const op = parseInt(it.operationCode);
          const v = parseFloat(it.netValue || it.grossValue || 0);
          if (v <= 0) continue;
          if (it.operationModel === 'Sales' && REVENDA_OP_CODES.includes(op)) {
            bruto += v;
            const nfKey = `${it.branchCode}|${it.personCode}|${it.movementDate}`;
            nfsBrutoSet.add(nfKey);
          } else if (
            it.operationModel === 'SaleReturns' &&
            DEVOL_OPS_LIQUIDO.has(op)
          ) {
            // Filtra devoluções por dealer do canal — evita subtrair
            // devoluções de outros canais (varejo/multimarca/etc.)
            const dc = parseInt(it.sellerCode) || null;
            if (allowedDealersDevol && (!dc || !allowedDealersDevol.has(dc))) {
              continue;
            }
            devol += v;
          }
        }
        return {
          bruto,
          devol,
          liquido: bruto - devol,
          qty: nfsBrutoSet.size,
        };
      };

      const [cur, prev] = await Promise.all([
        aggregate(datemin, datemax),
        aggregate(datemin_ly, datemax_ly),
      ]);
      totalValue = cur.liquido;
      totalValueLY = prev.liquido;
      totalQtyTotvs = cur.qty;
      totalQtyLYTotvs = prev.qty;
      totalValueGrossTotvs = cur.bruto;
      totalDevolTotvs = cur.devol;
    } catch (err) {
      console.warn(
        `[analytics] TOTVS fiscal-movement falhou (usando fallback Supabase): ${err.message}`,
      );
    }
  }

  const allUFs = new Set([...byUF.keys(), ...byUF_LY.keys()]);
  const rows = [...allUFs]
    .map((uf) => {
      const cur = byUF.get(uf);
      const ly = byUF_LY.get(uf);
      const value = cur?.value || 0;
      const valueLY = ly?.value || 0;
      let growthPct = null;
      if (valueLY > 0) {
        growthPct = ((value - valueLY) / valueLY) * 100;
      } else if (value > 0) {
        growthPct = null; // sem base anterior — exibido como "novo"
      }
      const customers = cur
        ? [...cur.customers.values()].sort((a, b) => b.value - a.value)
        : [];
      // Vendedores agregados desta UF
      const by_seller = cur
        ? [...cur.sellerValues.entries()]
            .map(([dc, v]) => ({
              seller_code: dc,
              seller_name: sellerName(dc),
              invoice_value: Math.round(v * 100) / 100,
            }))
            .sort((a, b) => b.invoice_value - a.invoice_value)
        : [];
      // Enriquece clientes com seller_name + tipo (abertura/reativacao/recorrente)
      let aberturas = 0;
      let reativacoes = 0;
      const customersFmt = customers.map((c) => {
        const firstP = firstPurchaseInPeriod.get(c.person_code);
        const clientType = classifyClient(
          c.person_code,
          firstP,
          aberturasAtualPCs,
        );
        if (clientType === 'abertura') aberturas++;
        else if (clientType === 'reativacao') reativacoes++;
        return {
          ...c,
          value: Math.round(c.value * 100) / 100,
          seller_name: c.seller_code ? sellerName(c.seller_code) : null,
          client_type: clientType,
          first_purchase_in_period: firstP || null,
          last_purchase_before: lastPurchaseBefore.get(c.person_code) || null,
          clickup_lead: aberturasClickupMatch.get(c.person_code) || null,
        };
      });
      // Clientes ano passado (LY) na mesma UF — útil pra ver "perda"
      const customersLY = ly
        ? [...ly.customers.values()]
            .sort((a, b) => b.value - a.value)
            .map((c) => ({
              ...c,
              value: Math.round(c.value * 100) / 100,
              seller_name: c.seller_code ? sellerName(c.seller_code) : null,
            }))
        : [];
      return {
        uf,
        invoice_value: Math.round(value * 100) / 100,
        invoice_qty: cur?.qty || 0,
        customers_count: customers.length,
        // Comparativo ano passado
        invoice_value_ly: Math.round(valueLY * 100) / 100,
        invoice_qty_ly: ly?.qty || 0,
        customers_count_ly: customersLY.length,
        growth_pct: growthPct == null ? null : Math.round(growthPct * 10) / 10,
        delta_value: Math.round((value - valueLY) * 100) / 100,
        pct: totalValue > 0 ? (value / totalValue) * 100 : 0,
        // Contadores de tipos de cliente no período
        aberturas,
        reativacoes,
        recorrentes: customersFmt.length - aberturas - reativacoes,
        top_clients: customersFmt.slice(0, 10),
        all_customers: customersFmt,
        all_customers_ly: customersLY,
        by_seller,
      };
    })
    .sort((a, b) => b.invoice_value - a.invoice_value);

  const totalGrowth =
    totalValueLY > 0
      ? Math.round(((totalValue - totalValueLY) / totalValueLY) * 1000) / 10
      : null;

  const responsePayload = {
    rows,
    total_value: Math.round(totalValue * 100) / 100,
    total_value_ly: Math.round(totalValueLY * 100) / 100,
    total_growth_pct: totalGrowth,
    total_qty:
      totalQtyTotvs ?? [...byUF.values()].reduce((s, v) => s + v.qty, 0),
    total_qty_ly:
      totalQtyLYTotvs ?? [...byUF_LY.values()].reduce((s, v) => s + v.qty, 0),
    total_clients: byPerson.size,
    total_clients_ly: byPersonLY.size,
    // Aberturas de cadastro (clientes registrados no período)
    total_aberturas_cadastro: aberturasAtual,
    total_aberturas_cadastro_ly: aberturasLY,
    ticket_medio_abertura:
      typeof ticketMedioAbertura !== 'undefined' ? ticketMedioAbertura : null,
    total_fat_abertura:
      typeof totalFatAbertura !== 'undefined' ? totalFatAbertura : null,
    states_count: rows.length,
    period_ly: { datemin: datemin_ly, datemax: datemax_ly },
    modulo,
    total_value_gross:
      totalValueGrossTotvs != null
        ? Math.round(totalValueGrossTotvs * 100) / 100
        : null,
    total_devolucao:
      totalDevolTotvs != null ? Math.round(totalDevolTotvs * 100) / 100 : null,
    total_value_supabase: Math.round(totalValueSupa * 100) / 100,
    total_value_ly_supabase: Math.round(totalValueLYSupa * 100) / 100,
    source: totalValueGrossTotvs != null ? 'totvs+supabase' : 'supabase',
  };
  // Salva no cache (5 min TTL)
  ANALYTICS_CACHE.set(cacheKey, {
    data: responsePayload,
    ts: Date.now(),
    ver: ANALYTICS_CACHE_VERSION,
  });

  return successResponse(
    res,
    responsePayload,
    `Faturamento ${modulo} por estado: ${rows.length} UFs`,
  );
});

// Endpoint genérico (qualquer canal: varejo / revenda / multimarcas)
router.post('/analytics-por-estado', analyticsHandler);
// Alias backwards-compat (assume modulo=revenda quando não informado)
router.post('/analytics-revenda-por-estado', analyticsHandler);

// Reativação: cliente comprou no período E tinha 60+ dias sem comprar antes.
// Considera Output NFs em QUALQUER branch/op (visão holística do cliente).
router.post(
  '/canal-reactivations',
  asyncHandler(async (req, res) => {
    const { datemin, datemax, modulo, daysInactive = 60 } = req.body;
    if (!datemin || !datemax || !modulo) {
      return errorResponse(
        res,
        'datemin, datemax e modulo obrigatórios',
        400,
        'MISSING_PARAMS',
      );
    }
    const cfg = CANAL_CONFIG[modulo];
    if (!cfg) {
      return errorResponse(
        res,
        `Módulo "${modulo}" não suportado`,
        400,
        'INVALID_MODULO',
      );
    }

    // 1. Customers que compraram no período (no canal) — LEVE: sem items
    // Usa nf.dealer_code (NF-level) pra evitar carregar items.products[] do JSONB.
    const sellersAllowed = new Set((cfg.sellers || []).map(Number));
    const customersInPeriod = new Map(); // person_code -> { first_period_date, name, value, branch, seller_code }
    let offset = 0;
    const PAGE = 1000;
    while (true) {
      const { data, error } = await supabaseFiscal
        .from('notas_fiscais')
        .select(
          'person_code, person_name, issue_date, total_value, branch_code, dealer_code',
        )
        .eq('operation_type', 'Output')
        .not('invoice_status', 'eq', 'Canceled')
        .not('invoice_status', 'eq', 'Deleted')
        .gte('issue_date', datemin)
        .lte('issue_date', datemax)
        .in('branch_code', cfg.branchs)
        .in('operation_code', cfg.operations)
        .lt('person_code', 100000000)
        .range(offset, offset + PAGE - 1);
      if (error) {
        return errorResponse(
          res,
          `Erro Supabase: ${error.message}`,
          500,
          'DB_ERROR',
        );
      }
      if (!data || data.length === 0) break;
      for (const nf of data) {
        const pc = nf.person_code;
        const nfSellerCode = parseInt(nf.dealer_code) || null;
        // Filtra de saída: ignora NFs cujo seller não é B2R do canal
        if (
          sellersAllowed.size > 0 &&
          (nfSellerCode == null || !sellersAllowed.has(nfSellerCode))
        )
          continue;
        const existing = customersInPeriod.get(pc);
        if (!existing || nf.issue_date < existing.first_period_date) {
          customersInPeriod.set(pc, {
            first_period_date: nf.issue_date,
            person_name: nf.person_name || 'Sem nome',
            value: parseFloat(nf.total_value) || 0,
            branch_code: nf.branch_code,
            seller_code: nfSellerCode,
          });
        } else if (nf.issue_date === existing.first_period_date) {
          existing.value += parseFloat(nf.total_value) || 0;
        }
      }
      if (data.length < PAGE) break;
      offset += PAGE;
    }

    // 2. Para cada cliente, busca MAX(issue_date) antes do período (qualquer branch)
    const personCodes = [...customersInPeriod.keys()];
    if (personCodes.length === 0) {
      return successResponse(
        res,
        { count: 0, total_value: 0, customers: [], total_in_period: 0 },
        '0 reativações',
      );
    }
    const lastPurchaseBefore = new Map();
    const CHUNK = 200;
    for (let i = 0; i < personCodes.length; i += CHUNK) {
      const chunk = personCodes.slice(i, i + CHUNK);
      const { data, error } = await supabaseFiscal
        .from('notas_fiscais')
        .select('person_code, issue_date')
        .eq('operation_type', 'Output')
        .not('invoice_status', 'eq', 'Canceled')
        .not('invoice_status', 'eq', 'Deleted')
        .lt('issue_date', datemin)
        .in('person_code', chunk)
        .lt('person_code', 100000000)
        .order('issue_date', { ascending: false })
        .limit(chunk.length * 5);
      if (error) {
        console.warn(`[reactivations] erro chunk ${i}: ${error.message}`);
        continue;
      }
      for (const nf of data || []) {
        if (!lastPurchaseBefore.has(nf.person_code)) {
          lastPurchaseBefore.set(nf.person_code, nf.issue_date);
        }
      }
    }

    // 3. Filtra clientes com gap >= daysInactive (default 60)
    // E que foram atendidos por um dealer do canal (sellers do CANAL_CONFIG)
    const reactivations = [];
    for (const [pc, info] of customersInPeriod.entries()) {
      const prev = lastPurchaseBefore.get(pc);
      if (!prev) continue; // sem compra anterior → seria abertura
      const days =
        (new Date(info.first_period_date) - new Date(prev)) /
        (1000 * 60 * 60 * 24);
      if (days < daysInactive) continue;
      // Filtro: só conta como reativação do canal se vendedor é B2R
      if (
        sellersAllowed.size > 0 &&
        (info.seller_code == null || !sellersAllowed.has(info.seller_code))
      )
        continue;
      reactivations.push({
        person_code: pc,
        person_name: info.person_name,
        branch_code: info.branch_code,
        seller_code: info.seller_code,
        last_purchase_before: prev,
        first_purchase_in_period: info.first_period_date,
        days_inactive: Math.floor(days),
        value: Math.round(info.value * 100) / 100,
      });
    }

    // 4. Buscar nomes dos vendedores (TOTVS sellers/search) — uma vez por branch
    const sellerNameMap = {};
    if (reactivations.length > 0) {
      try {
        const branchSet = new Set(
          reactivations.map((r) => r.branch_code).filter(Boolean),
        );
        await Promise.all(
          [...branchSet].map(async (br) => {
            try {
              const data = await callTotvsSellersSearch({
                branchs: [br],
                operations: cfg.operations,
                datemin,
                datemax,
              });
              for (const r of data?.dataRow || []) {
                sellerNameMap[Number(r.seller_code)] =
                  r.seller_name || `Vend. ${r.seller_code}`;
              }
            } catch (e) {
              console.warn(`[reactivations] sellers branch ${br}:`, e.message);
            }
          }),
        );
      } catch (e) {
        console.warn('[reactivations] sellerName lookup falhou:', e.message);
      }
    }
    for (const r of reactivations) {
      r.seller_name =
        sellerNameMap[r.seller_code] ||
        (r.seller_code ? `Vend. ${r.seller_code}` : null);
    }

    reactivations.sort((a, b) => b.value - a.value);
    const totalValue = reactivations.reduce((s, r) => s + r.value, 0);
    return successResponse(
      res,
      {
        count: reactivations.length,
        total_value: Math.round(totalValue * 100) / 100,
        days_inactive_threshold: daysInactive,
        total_in_period: customersInPeriod.size,
        customers: reactivations,
      },
      `${reactivations.length} reativações (${daysInactive}+ dias)`,
    );
  }),
);

async function getFranquiaPersonCodes() {
  // Padrões observados pra clientes franqueados Crosby:
  // - fantasy_name começa com 'F\d+ - CROSBY' (ex: 'F031 - CROSBY ALAGOA GRANDE')
  // - email termina em '@franquiacrosby.com'
  // - classifications type=2 ou type=20 (legado)
  const PAGE = 1000;
  const codes = new Set();

  const fetchAllPages = async (queryFn) => {
    let offset = 0;
    while (true) {
      const { data, error } = await queryFn().range(offset, offset + PAGE - 1);
      if (error) {
        console.warn('[franquia] erro:', error.message);
        break;
      }
      if (!data || data.length === 0) break;
      for (const r of data) codes.add(Number(r.code));
      if (data.length < PAGE) break;
      offset += PAGE;
    }
  };

  await fetchAllPages(() =>
    supabase
      .from('pes_pessoa')
      .select('code')
      .like('fantasy_name', 'F%CROSBY%'),
  );
  await fetchAllPages(() =>
    supabase
      .from('pes_pessoa')
      .select('code')
      .like('email', '%@franquiacrosby.com'),
  );
  await fetchAllPages(() =>
    supabase
      .from('pes_pessoa')
      .select('code')
      .filter('classifications', 'cs', '[{"type":2}]'),
  );
  await fetchAllPages(() =>
    supabase
      .from('pes_pessoa')
      .select('code')
      .filter('classifications', 'cs', '[{"type":20}]'),
  );

  return codes;
}

// ─── Clientes que NÃO são REVENDEDOR puro ────────────────────────────────────
// Usado pra excluir do total de revenda no Analytics:
//   - Franquias (F-prefix CROSBY, @franquiacrosby.com, classifications 2/20)
//   - MULTIMARCAS (fantasy_name começa com 'MTM ')
//   - Crosby internos/legados (fantasy_name contém 'CROSBY' mas SEM prefixo F,
//     ex: "ANTIGO CNPJ DA CROSBY CEARA MIRIM", "CROSBY LOJA VIRTUAL")
async function getNonRevendaPersonCodes() {
  const codes = await getFranquiaPersonCodes();
  const PAGE = 1000;

  const addAll = async (queryFn) => {
    let offset = 0;
    while (true) {
      const { data, error } = await queryFn().range(offset, offset + PAGE - 1);
      if (error) {
        console.warn('[non-revenda] erro:', error.message);
        break;
      }
      if (!data || data.length === 0) break;
      for (const r of data) codes.add(Number(r.code));
      if (data.length < PAGE) break;
      offset += PAGE;
    }
  };

  // NOTA: MTM (Multimarca) NÃO é mais excluído — clientes com "MTM" no nome
  // (ex: "MTM RITA DE CASSIA LOPES DA CUNHA") aparecem como REVENDEDOR no
  // painel oficial. O prefixo "MTM" é apenas tag legada de cadastro, não
  // determina o canal real do cliente.

  // CROSBY interno/legado — contém 'CROSBY' mas NÃO começa com 'F\d - CROSBY'
  // Captura "ANTIGO CNPJ DA CROSBY", "CROSBY LOJA VIRTUAL", "CROSBY SHOPPING MIDWAY", etc.
  await addAll(() =>
    supabase
      .from('pes_pessoa')
      .select('code, fantasy_name')
      .like('fantasy_name', '%CROSBY%')
      .not('fantasy_name', 'like', 'F%CROSBY%'),
  );

  return codes;
}

async function computeCanalTotalsFromSupabase({ datemin, datemax, cfg }) {
  const franquiaPCs = cfg.excludeFranquia
    ? await getFranquiaPersonCodes()
    : new Set();

  // Helper: NF passa o filtro de dealer (se configurado)?
  // dealersByBranch={99:[25,15,...],2:[288,...]} — NF deve ter pelo menos 1 produto
  // de um dealer permitido pra branch da NF.
  const checkDealerFilter = (nf) => {
    if (!cfg.dealersByBranch) return true;
    const allowed = cfg.dealersByBranch[nf.branch_code];
    if (!allowed || allowed.length === 0) return false;
    const allowedSet = new Set(allowed.map(Number));
    if (Array.isArray(nf.items)) {
      for (const item of nf.items) {
        const prods = Array.isArray(item.products) ? item.products : [];
        for (const p of prods) {
          const dc = parseInt(p.dealerCode);
          if (allowedSet.has(dc)) return true;
        }
      }
    }
    // Fallback: dealer no nível de NF
    if (allowedSet.has(parseInt(nf.dealer_code))) return true;
    return false;
  };

  let invoice_value = 0;
  let itens_qty = 0;
  let credev_value = 0;
  let credev_qty = 0;
  let credev_itens_qty = 0;
  const nfKeys = new Set();
  const credevKeys = new Set();
  const PAGE = 1000;

  // Output (vendas)
  let offset = 0;
  while (true) {
    const { data, error } = await supabaseFiscal
      .from('notas_fiscais')
      .select(
        'person_code, total_value, items, branch_code, invoice_code, issue_date, dealer_code',
      )
      .eq('operation_type', 'Output')
      .not('invoice_status', 'eq', 'Canceled')
      .not('invoice_status', 'eq', 'Deleted')
      .gte('issue_date', datemin)
      .lte('issue_date', datemax)
      .in('branch_code', cfg.branchs)
      .in('operation_code', cfg.operations)
      .lt('person_code', 100000000)
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`Erro Supabase Output: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const nf of data) {
      if (franquiaPCs.has(nf.person_code)) continue;
      if (!checkDealerFilter(nf)) continue;
      invoice_value += parseFloat(nf.total_value) || 0;
      nfKeys.add(`${nf.branch_code}|${nf.invoice_code}|${nf.issue_date}`);
      for (const item of nf.items || []) {
        const prods = Array.isArray(item.products) ? item.products : [];
        for (const p of prods) {
          itens_qty += parseFloat(p.quantity) || 0;
        }
      }
    }
    if (data.length < PAGE) break;
    offset += PAGE;
  }

  // CREDEV (Input) — opcional, pula se credevOps vazio
  if (Array.isArray(cfg.credevOps) && cfg.credevOps.length > 0) {
    let credOffset = 0;
    while (true) {
      const { data, error } = await supabaseFiscal
        .from('notas_fiscais')
        .select(
          'person_code, total_value, items, branch_code, invoice_code, issue_date, dealer_code',
        )
        .eq('operation_type', 'Input')
        .not('invoice_status', 'eq', 'Canceled')
        .not('invoice_status', 'eq', 'Deleted')
        .gte('issue_date', datemin)
        .lte('issue_date', datemax)
        .in('branch_code', cfg.branchs)
        .in('operation_code', cfg.credevOps)
        .lt('person_code', 100000000)
        .range(credOffset, credOffset + PAGE - 1);
      if (error) throw new Error(`Erro Supabase CREDEV: ${error.message}`);
      if (!data || data.length === 0) break;
      for (const nf of data) {
        if (franquiaPCs.has(nf.person_code)) continue;
        if (!checkDealerFilter(nf)) continue;
        const val = parseFloat(nf.total_value) || 0;
        credev_value += val;
        credev_qty += 1;
        credevKeys.add(`${nf.branch_code}|${nf.invoice_code}|${nf.issue_date}`);
        for (const item of nf.items || []) {
          const prods = Array.isArray(item.products) ? item.products : [];
          for (const p of prods) {
            credev_itens_qty += parseFloat(p.quantity) || 0;
          }
        }
      }
      if (data.length < PAGE) break;
      credOffset += PAGE;
    }
  }

  // Líquido = Output - CREDEV
  const liquido_value = invoice_value - credev_value;
  const liquido_itens = Math.max(0, itens_qty - credev_itens_qty);
  const liquido_qty = Math.max(0, nfKeys.size - credev_qty);
  const tm = liquido_qty > 0 ? liquido_value / liquido_qty : 0;
  const pa = liquido_qty > 0 ? liquido_itens / liquido_qty : 0;
  const pmpv = liquido_itens > 0 ? liquido_value / liquido_itens : 0;

  return {
    invoice_value: Math.round(liquido_value * 100) / 100,
    invoice_qty: liquido_qty,
    itens_qty: liquido_itens,
    tm: Math.round(tm * 100) / 100,
    pa: Math.round(pa * 1000) / 1000,
    pmpv: Math.round(pmpv * 100) / 100,
    credev_value: Math.round(credev_value * 100) / 100,
    credev_qty,
    gross_invoice_value: Math.round(invoice_value * 100) / 100,
    gross_invoice_qty: nfKeys.size,
    franquia_excluded: cfg.excludeFranquia ? franquiaPCs.size : 0,
  };
}

router.post(
  '/canal-totals',
  asyncHandler(async (req, res) => {
    const { datemin, datemax, modulo } = req.body;
    if (!datemin || !datemax || !modulo) {
      return errorResponse(
        res,
        'datemin, datemax e modulo obrigatórios',
        400,
        'MISSING_PARAMS',
      );
    }
    const cfg = CANAL_CONFIG[modulo];
    if (!cfg) {
      return errorResponse(
        res,
        `Módulo "${modulo}" não suportado`,
        400,
        'INVALID_MODULO',
      );
    }

    if (cfg.source === 'totvs-totals') {
      // ─── Bruto via TOTVS direto (sale-panel/v2/totals/search) ───────────
      const data = await callTotvsTotalsSearch({
        branchs: cfg.branchs,
        operations: cfg.operations,
        sellers: cfg.sellers,
        datemin,
        datemax,
      });
      const t = (data.dataRow && data.dataRow[0]) || {
        invoice_value: 0,
        invoice_qty: 0,
        itens_qty: 0,
      };
      let grossValue = Number(t.invoice_value || 0);
      let grossQty = Number(t.invoice_qty || 0);
      let grossItens = Number(t.itens_qty || 0);

      // ─── Suplementação por whitelist de transações ──────────────────────
      // Busca NFs específicas (cfg.manualTransactions) via fiscal/v2/invoices.
      // ATENÇÃO: a API NÃO suporta `transactionCodeList` como filtro — então
      // buscamos pelo período do range e filtramos localmente. Como os
      // manualTx só são consultados quando estão dentro do range solicitado,
      // o custo é baixo (só páginas necessárias do dia da transação).
      const manualTxList = Array.isArray(cfg.manualTransactions)
        ? cfg.manualTransactions
        : [];
      // Filtra apenas as transações que CABEM no range (datemin..datemax)
      // — isso depende do issueDate da NF, que ainda não temos. Como
      // fallback, processamos todas e descartamos as que não estão no range
      // pelo issueDate retornado.
      let manualNfsAdded = 0;
      let manualValueAdded = 0;
      const manualTxSet = new Set();
      if (manualTxList.length > 0) {
        try {
          const tk = await getToken();
          const tkn = tk?.access_token;
          if (tkn) {
            // Agrupa por branch
            const byBranch = new Map();
            for (const m of manualTxList) {
              const b = Number(m.branch);
              const tx = Number(m.transactionCode);
              if (!b || !tx) continue;
              if (!byBranch.has(b)) byBranch.set(b, []);
              byBranch.get(b).push(tx);
            }
            // Para cada branch, busca NFs do range com PAGINAÇÃO PARALELA
            for (const [branch, txs] of byBranch.entries()) {
              const txSet = new Set(txs);
              try {
                const fetchPg = (pg) =>
                  axios
                    .post(
                      `${TOTVS_BASE_URL}/fiscal/v2/invoices/search`,
                      {
                        filter: {
                          branchCodeList: [branch],
                          operationType: 'Output',
                          startIssueDate: `${datemin}T00:00:00`,
                          endIssueDate: `${datemax}T23:59:59`,
                        },
                        expand: 'items',
                        page: pg,
                        pageSize: 100,
                      },
                      {
                        headers: {
                          'Content-Type': 'application/json',
                          Accept: 'application/json',
                          Authorization: `Bearer ${tkn}`,
                        },
                        httpsAgent: totvsHttpsAgent,
                        timeout: 60000,
                      },
                    )
                    .then((r) => r.data)
                    .catch((err) => {
                      console.warn(
                        `[manualTx pg ${pg}] ${err.message}`,
                      );
                      return { items: [] };
                    });

                // 1ª página pra descobrir totalPages
                const first = await fetchPg(1);
                const allInv = [...(first?.items || [])];
                const totalPages = Math.min(first?.totalPages || 1, 50);
                if (totalPages > 1) {
                  const rem = Array.from(
                    { length: totalPages - 1 },
                    (_, i) => i + 2,
                  );
                  const CONC = 5;
                  for (let i = 0; i < rem.length; i += CONC) {
                    const batch = rem.slice(i, i + CONC);
                    const results = await Promise.all(batch.map(fetchPg));
                    for (const pd of results)
                      allInv.push(...(pd?.items || []));
                  }
                }
                // Filtra localmente pelas transações da whitelist
                for (const nf of allInv) {
                  const txCode = Number(nf.transactionCode);
                  if (!txSet.has(txCode)) continue;
                  if (
                    nf.invoiceStatus === 'Canceled' ||
                    nf.invoiceStatus === 'Deleted'
                  )
                    continue;
                  const totalValue = parseFloat(nf.totalValue) || 0;
                  if (totalValue <= 0) continue;
                  const key = `${nf.branchCode}|${nf.transactionCode}`;
                  if (manualTxSet.has(key)) continue;
                  manualTxSet.add(key);
                  // Dealer dominante — pula se já contado pelo sale-panel
                  const netByDealer = {};
                  let qty = 0;
                  for (const it of nf.items || []) {
                    for (const p of it.products || []) {
                      const dc = p.dealerCode ? Number(p.dealerCode) : null;
                      if (dc) {
                        netByDealer[dc] = (netByDealer[dc] || 0) +
                          (parseFloat(p.netValue) || 0);
                      }
                      qty += parseFloat(p.quantity) || 0;
                    }
                  }
                  const entries = Object.entries(netByDealer);
                  let dominantDealer = null;
                  if (entries.length > 0) {
                    dominantDealer = Number(
                      entries.sort((a, b) => b[1] - a[1])[0][0],
                    );
                  }
                  const allowedSet = new Set(
                    (cfg.sellers || []).map(Number),
                  );
                  if (dominantDealer && allowedSet.has(dominantDealer))
                    continue;
                  grossValue += totalValue;
                  grossQty += 1;
                  grossItens += qty;
                  manualNfsAdded++;
                  manualValueAdded += totalValue;
                }
              } catch (err) {
                console.warn(
                  `[canal-totals ${modulo}] manualTx branch ${branch} falhou: ${err.message}`,
                );
              }
            }
            if (manualNfsAdded > 0) {
              console.log(
                `[canal-totals ${modulo}] +${manualNfsAdded} NFs por whitelist (R$ ${manualValueAdded.toFixed(2)})`,
              );
            }
          }
        } catch (err) {
          console.warn(
            `[canal-totals ${modulo}] manualTx falhou: ${err.message}`,
          );
        }
      }

      // ─── Suplementação por CPF do vendedor (header) ─────────────────────
      // Se cfg.sellerCpfList definida: busca NFs adicionais via fiscal/v2/
      // invoices/search filtrando pelo sellerCpf do header. Captura casos
      // onde o TRAFLO16 mostra "Comprador/Vend: X" mas a API REST expõe
      // dealerCode diferente nos products (ex: dealer 50 GERAL).
      // Adiciona ao grossValue/Qty/Itens só NFs que ainda NÃO foram contadas
      // pelo callTotvsTotalsSearch (i.e. dealerCode dos products NÃO está
      // em cfg.sellers).
      const sellerCpfSet =
        Array.isArray(cfg.sellerCpfList) && cfg.sellerCpfList.length > 0
          ? new Set(cfg.sellerCpfList.map(String))
          : null;
      let cpfNfsAdded = 0;
      let cpfValueAdded = 0;
      if (sellerCpfSet) {
        try {
          const tk = await getToken();
          const tkn = tk?.access_token;
          if (tkn) {
            const allowedSellersForCpf = new Set(
              (cfg.sellers || []).map(Number),
            );
            const fetchInvPage = async (page) =>
              axios
                .post(
                  `${TOTVS_BASE_URL}/fiscal/v2/invoices/search`,
                  {
                    filter: {
                      branchCodeList: cfg.branchs,
                      operationCodeList: cfg.operations,
                      operationType: 'Output',
                      startIssueDate: `${datemin}T00:00:00`,
                      endIssueDate: `${datemax}T23:59:59`,
                    },
                    expand: 'items',
                    page,
                    pageSize: 100,
                  },
                  {
                    headers: {
                      'Content-Type': 'application/json',
                      Accept: 'application/json',
                      Authorization: `Bearer ${tkn}`,
                    },
                    httpsAgent: totvsHttpsAgent,
                    timeout: 60000,
                  },
                )
                .then((r) => r.data)
                .catch(() => ({ items: [] }));
            const first = await fetchInvPage(1);
            const allInv = [...(first?.items || [])];
            const totalPages =
              first?.totalPages ||
              (first?.totalItems
                ? Math.ceil(first.totalItems / 100)
                : 1);
            if (totalPages > 1) {
              const rem = Array.from(
                { length: totalPages - 1 },
                (_, i) => i + 2,
              );
              const CONC = 5;
              for (let i = 0; i < rem.length; i += CONC) {
                const batch = rem.slice(i, i + CONC);
                const results = await Promise.all(batch.map(fetchInvPage));
                for (const pd of results)
                  allInv.push(...(pd?.items || []));
              }
            }
            // Itera invoices: se sellerCpf bate E dealerCode dos products
            // NÃO está em cfg.sellers (já contado), adiciona ao bruto
            for (const nf of allInv) {
              if (
                nf.invoiceStatus === 'Canceled' ||
                nf.invoiceStatus === 'Deleted'
              )
                continue;
              const cpf = String(nf.sellerCpf || '').replace(/\D/g, '');
              if (!cpf || !sellerCpfSet.has(cpf)) continue;
              // Calcula dealer dominante dos products
              let dominantDealer = null;
              const netByDealer = {};
              let qtyTotal = 0;
              for (const it of nf.items || []) {
                const products = Array.isArray(it.products) ? it.products : [];
                for (const p of products) {
                  const dc = p.dealerCode ? Number(p.dealerCode) : null;
                  if (!dc) continue;
                  netByDealer[dc] = (netByDealer[dc] || 0) +
                    (parseFloat(p.netValue) || 0);
                  qtyTotal += parseFloat(p.quantity) || 0;
                }
              }
              const entries = Object.entries(netByDealer);
              if (entries.length > 0) {
                dominantDealer = Number(
                  entries.sort((a, b) => b[1] - a[1])[0][0],
                );
              }
              // Se dealer dominante já está em cfg.sellers, NF já foi contada
              // pelo sale-panel — não duplica
              if (dominantDealer && allowedSellersForCpf.has(dominantDealer))
                continue;
              const totalValue = parseFloat(nf.totalValue) || 0;
              if (totalValue <= 0) continue;
              grossValue += totalValue;
              grossQty += 1;
              grossItens += qtyTotal;
              cpfNfsAdded++;
              cpfValueAdded += totalValue;
            }
            if (cpfNfsAdded > 0) {
              console.log(
                `[canal-totals ${modulo}] +${cpfNfsAdded} NFs por sellerCpf (R$ ${cpfValueAdded.toFixed(2)})`,
              );
            }
          }
        } catch (err) {
          console.warn(
            `[canal-totals ${modulo}] sellerCpf supplement falhou: ${err.message}`,
          );
        }
      }

      // ─── Devolução: ALINHADA com Analytics (líquido = bruto - credev - SaleReturns) ───
      // Credev: documentType==='Credev' em payments de fiscal/v2/invoices Output
      // SaleReturns op 21: fiscal-movement (apenas para clientes sem NF em invoices)
      // CFOPs canônicos / ops TOTVS internas de devolução também são consideradas
      const tokenData = await getToken();
      const accessToken = tokenData?.access_token;

      let devolucao_credev = 0; // credev em payments (USO)
      let devolucao_returns = 0; // SaleReturns op 21 + ops devol TOTVS (geração não usada)
      const personsInInvoices = new Set();

      const DEVOL_OPS_LIQUIDO_TOTVS = new Set([
        1202,
        1204,
        1411,
        1410,
        2202,
        2411, // CFOPs canônicos
        1950,
        21, // TOTVS interno + credev item-level
        7245,
        7244,
        7240,
        7790,
        1214,
        20, // ops TOTVS revenda devolução
      ]);

      // ── Helper: paginação invoices com expand=payments,items ──
      const fetchInvoicesPages = async () => {
        const endpoint = `${TOTVS_BASE_URL}/fiscal/v2/invoices/search`;
        const pageSize = 100;
        const fetchPage = async (page) =>
          axios
            .post(
              endpoint,
              {
                filter: {
                  branchCodeList: cfg.branchs,
                  operationCodeList: cfg.operations,
                  operationType: 'Output',
                  startIssueDate: `${datemin}T00:00:00`,
                  endIssueDate: `${datemax}T23:59:59`,
                },
                expand: 'payments,items',
                page,
                pageSize,
              },
              {
                headers: {
                  'Content-Type': 'application/json',
                  Accept: 'application/json',
                  Authorization: `Bearer ${accessToken}`,
                },
                httpsAgent: totvsHttpsAgent,
                timeout: 120000,
              },
            )
            .then((r) => r.data)
            .catch((err) => {
              console.warn(
                `[canal-totals invoices] pág ${page}: ${err.message}`,
              );
              return { items: [] };
            });
        const first = await fetchPage(1);
        const all = [...(first?.items || [])];
        const totalPages =
          first?.totalPages ||
          (first?.totalItems ? Math.ceil(first.totalItems / pageSize) : 1);
        if (totalPages > 1) {
          const rem = Array.from({ length: totalPages - 1 }, (_, i) => i + 2);
          const CONC = 3;
          for (let i = 0; i < rem.length; i += CONC) {
            const batch = rem.slice(i, i + CONC);
            const results = await Promise.all(batch.map(fetchPage));
            for (const pd of results) all.push(...(pd?.items || []));
          }
        }
        return all;
      };

      // ── Helper: paginação fiscal-movement ──
      const fetchMovementPages = async () => {
        const endpoint = `${TOTVS_BASE_URL}/analytics/v2/fiscal-movement/search`;
        const pageSize = 1000;
        const fetchPage = async (page) =>
          axios
            .post(
              endpoint,
              {
                filter: {
                  branchCodeList: cfg.branchs,
                  startMovementDate: `${datemin}T00:00:00`,
                  endMovementDate: `${datemax}T23:59:59`,
                },
                page,
                pageSize,
              },
              {
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${accessToken}`,
                },
                httpsAgent: totvsHttpsAgent,
                timeout: 120000,
              },
            )
            .then((r) => r.data)
            .catch((err) => {
              console.warn(
                `[canal-totals movement] pág ${page}: ${err.message}`,
              );
              return { items: [] };
            });
        const first = await fetchPage(1);
        const all = [...(first?.items || [])];
        const totalPages =
          first?.totalPages ||
          (first?.totalItems ? Math.ceil(first.totalItems / pageSize) : 1);
        if (totalPages > 1) {
          const rem = Array.from({ length: totalPages - 1 }, (_, i) => i + 2);
          const CONC = 3;
          for (let i = 0; i < rem.length; i += CONC) {
            const batch = rem.slice(i, i + CONC);
            const results = await Promise.all(batch.map(fetchPage));
            for (const pd of results) all.push(...(pd?.items || []));
          }
        }
        return all;
      };

      // Filtro de dealer permitido (canal restrito a vendedores específicos
      // como inbound_david/inbound_rafael/revenda) — credev e returns só
      // contam se o vendedor for um dos permitidos.
      // Prioriza `allowedSellersDevol` se definido (lista mais restrita
      // para evitar pegar devoluções de dealers genéricos como 50/GERAL)
      const allowedSellersSet =
        Array.isArray(
          cfg.allowedSellersDevol || cfg.allowedSellers || cfg.sellers,
        ) &&
        (cfg.allowedSellersDevol || cfg.allowedSellers || cfg.sellers)
          .length > 0
          ? new Set(
              (
                cfg.allowedSellersDevol || cfg.allowedSellers || cfg.sellers
              ).map(Number),
            )
          : null;

      // Helper: extrai dealer dominante de items[].products[]
      const dealerFromInvoice = (nf) => {
        if (!Array.isArray(nf.items) || nf.items.length === 0) return null;
        const netByDealer = {};
        for (const item of nf.items) {
          const products = Array.isArray(item.products) ? item.products : [];
          for (const p of products) {
            const dc = p.dealerCode ? Number(p.dealerCode) : null;
            if (!dc) continue;
            netByDealer[dc] = (netByDealer[dc] || 0) + (parseFloat(p.netValue) || 0);
          }
        }
        const entries = Object.entries(netByDealer);
        if (entries.length === 0) return null;
        return Number(entries.sort((a, b) => b[1] - a[1])[0][0]);
      };

      try {
        if (accessToken) {
          // PASS 0: invoices — credev em payments (filtrado por dealer permitido)
          const invoiceItems = await fetchInvoicesPages();
          for (const nf of invoiceItems) {
            if (
              nf.invoiceStatus === 'Canceled' ||
              nf.invoiceStatus === 'Deleted'
            )
              continue;
            const pc = parseInt(nf.personCode);
            if (!pc) continue;
            // Filtro: NF deve ser de um dealer permitido (se canal restrito)
            if (allowedSellersSet) {
              const dealer = dealerFromInvoice(nf);
              if (!dealer || !allowedSellersSet.has(dealer)) continue;
            }
            personsInInvoices.add(pc);
            for (const p of nf.payments || []) {
              if (p.documentType === 'Credev') {
                devolucao_credev += parseFloat(p.paymentValue) || 0;
              }
            }
          }

          // PASS 2: fiscal-movement SaleReturns para clientes NÃO em invoices
          // (filtrado por dealer permitido também — evita pegar devoluções
          // de outros vendedores na mesma branch)
          const movItems = await fetchMovementPages();
          for (const it of movItems) {
            if (it.operationModel !== 'SaleReturns') continue;
            const op = parseInt(it.operationCode);
            if (!DEVOL_OPS_LIQUIDO_TOTVS.has(op)) continue;
            const pc = parseInt(it.personCode);
            if (!pc) continue;
            if (personsInInvoices.has(pc)) continue;
            // Filtro: SaleReturn deve ser de um dealer permitido
            if (allowedSellersSet) {
              const sc = parseInt(it.sellerCode);
              if (!sc || !allowedSellersSet.has(sc)) continue;
            }
            const v = parseFloat(it.netValue || it.grossValue || 0);
            if (v <= 0) continue;
            devolucao_returns += v;
          }
        }
      } catch (err) {
        console.warn(
          `[canal-totals ${modulo}] devolução analytics-style erro: ${err.message}`,
        );
      }

      const devolucao_value = devolucao_credev + devolucao_returns;
      const devolucao_qty = 0; // qtd não computada nesse modo (usa contagem da gross)
      const devolucao_itens = 0;

      const liq_value = grossValue - devolucao_value;
      const liq_qty = Math.max(0, grossQty - devolucao_qty);
      const liq_itens = Math.max(0, grossItens - devolucao_itens);
      const tm = liq_qty > 0 ? liq_value / liq_qty : 0;
      const pa = liq_qty > 0 ? liq_itens / liq_qty : 0;
      const pmpv = liq_itens > 0 ? liq_value / liq_itens : 0;

      // Per-seller via TOTVS sellers/search (live, sem sync delay)
      let per_seller = [];
      try {
        per_seller = await fetchCanalPerSellerLive({
          datemin,
          datemax,
          modulo,
          cfg,
        });
      } catch (err) {
        console.warn(
          `[canal-totals ${modulo}] per_seller erro: ${err.message}`,
        );
      }

      return successResponse(
        res,
        {
          modulo,
          invoice_value: Math.round(liq_value * 100) / 100,
          invoice_qty: liq_qty,
          itens_qty: liq_itens,
          tm: Math.round(tm * 100) / 100,
          pa: Math.round(pa * 1000) / 1000,
          pmpv: Math.round(pmpv * 100) / 100,
          gross_invoice_value: Math.round(grossValue * 100) / 100,
          gross_invoice_qty: grossQty,
          devolucao_value: Math.round(devolucao_value * 100) / 100,
          devolucao_qty,
          devolucao_credev: Math.round(devolucao_credev * 100) / 100,
          devolucao_returns: Math.round(devolucao_returns * 100) / 100,
          per_seller,
          source:
            'totvs_gross + invoices_credev + movement_returns (analytics-aligned)',
          branchs_used: cfg.branchs,
          ops_used: cfg.operations,
          sellers_used: cfg.sellers,
          devolucao_ops_used: [...DEVOL_OPS_LIQUIDO_TOTVS],
        },
        `Totais ${modulo} (líquido = TOTVS bruto - credev - SaleReturns)`,
      );
    }

    // source = 'totvs-totals-branch' (varejo) — per-branch breakdown
    const tokenData = await getToken();
    if (!tokenData?.access_token) {
      return errorResponse(
        res,
        'Não foi possível obter token TOTVS',
        503,
        'TOKEN_UNAVAILABLE',
      );
    }
    const totvsData = await fetchBranchTotalsFromTotvs({
      initialToken: tokenData.access_token,
      branchs: cfg.branchs,
      datemin,
      datemax,
      refreshToken: async () => {
        const data = await getToken(true);
        return data.access_token;
      },
      logTag: `CRM/CanalTotals[${modulo}]`,
      operations: cfg.operations,
    });
    const total = totvsData.total || {
      invoice_value: 0,
      invoice_qty: 0,
      itens_qty: 0,
      tm: 0,
      pa: 0,
      pmpv: 0,
    };
    return successResponse(
      res,
      {
        modulo,
        ...total,
        source: 'totvs',
        branchs_used: cfg.branchs,
        ops_used: cfg.operations,
        per_branch: totvsData.dataRow,
      },
      `Totais ${modulo} (TOTVS /totals-branch)`,
    );
  }),
);

// ---------------------------------------------------------------------------
// 13. POST /api/crm/sellers-totals
//     Faturamento por vendedor — espelha a segmentação de
//     /api/crm/faturamento-por-segmento (mesma fonte do Forecast),
//     restrito aos canais varejo, revenda, multimarcas e inbound.
//     Quando `modulo` é enviado, filtra ao canal correspondente
//     (multimarcas inclui inbound).
// ---------------------------------------------------------------------------
router.post(
  '/sellers-totals',
  asyncHandler(async (req, res) => {
    const { datemin, datemax, modulo } = req.body;
    if (!datemin || !datemax) {
      return errorResponse(
        res,
        'datemin e datemax obrigatórios',
        400,
        'MISSING_DATES',
      );
    }

    // ── Constantes de segmentação (mesma lógica de /faturamento-por-segmento) ──
    const ALLOWED_SEGS = new Set([
      'varejo',
      'revenda',
      'multimarcas',
      'inbound',
      'inbound_david',
      'inbound_rafael',
    ]);
    const allOpCodes = Object.keys(OP_SEGMENTO_MAP).map(Number);
    const INBOUND_DAVID_DEALERS = new Set([26, 69]);
    const INBOUND_RAFAEL_DEALER = 21;
    const FRANQUIA_DEALER = 40;
    const JUCELINO_DEALER = 288;
    const VAREJO_BRANCH_CODES = new Set([
      2, 5, 55, 65, 87, 88, 90, 93, 94, 95, 97,
    ]);
    const REVENDA_BRANCH_CODES = new Set([99]);
    const B2R_REVENDA_DEALERS_EMP2 = new Set([288, 251, 131]);
    const B2R_REVENDA_DEALERS_EMP99 = new Set([25, 15, 161, 165, 241, 779]);

    // Clientes classificados como franquia (regra do Jucelino → canal franquia)
    const [franqF1, franqF2] = await Promise.all([
      supabase
        .from('pes_pessoa')
        .select('code')
        .filter('classifications', 'cs', '[{"type":2}]'),
      supabase
        .from('pes_pessoa')
        .select('code')
        .filter('classifications', 'cs', '[{"type":20}]'),
    ]);
    if (franqF1.error)
      return errorResponse(res, franqF1.error.message, 500, 'SUPABASE_ERROR');
    if (franqF2.error)
      return errorResponse(res, franqF2.error.message, 500, 'SUPABASE_ERROR');
    const franqPersonCodes = new Set(
      [...(franqF1.data || []), ...(franqF2.data || [])].map((r) =>
        Number(r.code),
      ),
    );

    // ── Buscar todas as NFs Output mapeadas (dealer 40 excluído: dealer 40 é só franquia) ──
    const PAGE = 1000;
    let allNFs = [];
    let offset = 0;
    while (true) {
      const { data, error } = await supabaseFiscal
        .from('notas_fiscais')
        .select(
          'items, total_value, operation_code, dealer_code, branch_code, person_code, invoice_code, issue_date',
        )
        .eq('operation_type', 'Output')
        .not('invoice_status', 'eq', 'Canceled')
        .not('invoice_status', 'eq', 'Deleted')
        .gte('issue_date', datemin)
        .lte('issue_date', datemax)
        .in('operation_code', allOpCodes)
        .neq('dealer_code', FRANQUIA_DEALER)
        .lt('person_code', 100000000)
        .range(offset, offset + PAGE - 1);
      if (error) {
        return errorResponse(
          res,
          `Erro ao buscar NFs: ${error.message}`,
          500,
          'SUPABASE_ERROR',
        );
      }
      allNFs = allNFs.concat(data);
      if (data.length < PAGE) break;
      offset += PAGE;
    }

    // Helper: dealer_code dominante da NF (pelo netValue dos items)
    function getDealerCodeSeg(nf) {
      if (!Array.isArray(nf.items) || nf.items.length === 0)
        return nf.dealer_code ?? null;
      const netByDealer = {};
      for (const item of nf.items) {
        for (const p of item.products || []) {
          const dc = p.dealerCode;
          if (!dc) continue;
          const nv = parseFloat(p.netValue) || 0;
          netByDealer[dc] = (netByDealer[dc] || 0) + nv;
        }
      }
      const entries = Object.entries(netByDealer);
      if (entries.length === 0) return nf.dealer_code ?? null;
      return Number(entries.sort((a, b) => b[1] - a[1])[0][0]);
    }

    // sellerMap: dealerCode → totais agregados
    // personToSeller: personCode → { dealerCode: totalNetValue } — usado p/ Credev
    const sellerMap = {};
    const personToSeller = {};

    for (const nf of allNFs) {
      const dealerReal = getDealerCodeSeg(nf);
      let seg;
      if (
        dealerReal === JUCELINO_DEALER &&
        franqPersonCodes.has(nf.person_code)
      ) {
        seg = 'franquia';
      } else if (INBOUND_DAVID_DEALERS.has(dealerReal)) {
        seg = 'inbound_david';
      } else if (INBOUND_RAFAEL_DEALERS.has(dealerReal)) {
        seg = 'inbound_rafael';
      } else {
        seg = OP_SEGMENTO_MAP[nf.operation_code];
      }
      if (!seg) continue;
      if (seg === 'franquia') continue;
      if (seg === 'varejo' && !VAREJO_BRANCH_CODES.has(nf.branch_code))
        continue;
      if (seg === 'business' && dealerReal !== 20) seg = 'revenda';
      if (seg === 'revenda') {
        if (Number(nf.branch_code) === 99) {
          if (!B2R_REVENDA_DEALERS_EMP99.has(dealerReal)) continue;
        } else if (
          nf.branch_code === 2 &&
          B2R_REVENDA_DEALERS_EMP2.has(dealerReal)
        ) {
          // mantém revenda
        } else if (nf.branch_code === 2) {
          seg = 'varejo';
        } else if (!REVENDA_BRANCH_CODES.has(nf.branch_code)) {
          continue;
        }
      }

      // Restringe aos 4 canais que o CRM de Vendas exibe
      if (!ALLOWED_SEGS.has(seg)) continue;
      if (!Array.isArray(nf.items)) continue;

      const nfTotalValue = parseFloat(nf.total_value) || 0;
      const nfKey = `${nf.branch_code}|${nf.invoice_code}|${nf.issue_date}`;
      const sellerNetValues = {};
      let nfNetValueTotal = 0;

      for (const item of nf.items) {
        const prods = Array.isArray(item.products) ? item.products : [];
        for (const p of prods) {
          const dc = String(p.dealerCode);
          if (!dc || dc === 'undefined') continue;
          const nv = parseFloat(p.netValue) || 0;
          const qty = parseFloat(p.quantity) || 1;
          nfNetValueTotal += nv;
          if (!sellerNetValues[dc]) sellerNetValues[dc] = { net: 0, qty: 0 };
          sellerNetValues[dc].net += nv;
          sellerNetValues[dc].qty += qty;
          if (nf.person_code) {
            if (!personToSeller[nf.person_code])
              personToSeller[nf.person_code] = {};
            if (!personToSeller[nf.person_code][dc])
              personToSeller[nf.person_code][dc] = 0;
            personToSeller[nf.person_code][dc] += nv;
          }
        }
      }

      if (nfNetValueTotal <= 0) continue;

      for (const [dc, info] of Object.entries(sellerNetValues)) {
        if (!sellerMap[dc]) {
          sellerMap[dc] = {
            invoice_value: 0,
            itens_qty: 0,
            nfKeys: new Set(),
            credev_value: 0,
            canalAcc: {},
            branchAcc: {},
          };
        }
        const share = info.net / nfNetValueTotal;
        const valueShare = nfTotalValue * share;
        sellerMap[dc].invoice_value += valueShare;
        sellerMap[dc].itens_qty += info.qty;
        sellerMap[dc].nfKeys.add(nfKey);
        sellerMap[dc].canalAcc[seg] =
          (sellerMap[dc].canalAcc[seg] || 0) + valueShare;
        sellerMap[dc].branchAcc[nf.branch_code] =
          (sellerMap[dc].branchAcc[nf.branch_code] || 0) + valueShare;
      }
    }

    // ── Descontar Credevs (Input NFs) do vendedor principal de cada cliente ──
    // Mesma lista de op codes do faturamento-por-segmento.
    const CREDEV_OP_CODES = [
      1, 2, 555, 9073, 9402, 9065, 9403, 9062, 9005, 7790, 7245, 20, 1214, 7244,
    ];
    const personCodes = Object.keys(personToSeller);
    if (personCodes.length > 0) {
      const personMainSeller = {};
      for (const [pc, sellerNet] of Object.entries(personToSeller)) {
        const main = Object.entries(sellerNet).sort((a, b) => b[1] - a[1])[0];
        if (main) personMainSeller[pc] = main[0];
      }

      const CHUNK = 300;
      for (let i = 0; i < personCodes.length; i += CHUNK) {
        const chunk = personCodes.slice(i, i + CHUNK);
        let offsetIn = 0;
        while (true) {
          const { data: inputNFs, error: inputErr } = await supabaseFiscal
            .from('notas_fiscais')
            .select(
              'total_value, person_code, items, branch_code, invoice_code, issue_date',
            )
            .eq('operation_type', 'Input')
            .not('invoice_status', 'eq', 'Canceled')
            .not('invoice_status', 'eq', 'Deleted')
            .in('person_code', chunk)
            .in('operation_code', CREDEV_OP_CODES)
            .gte('issue_date', datemin)
            .lte('issue_date', datemax)
            .range(offsetIn, offsetIn + PAGE - 1);
          if (inputErr || !inputNFs || inputNFs.length === 0) break;
          for (const nf of inputNFs) {
            const sellerCode = personMainSeller[nf.person_code];
            if (!sellerCode || !sellerMap[sellerCode]) continue;
            const val = parseFloat(nf.total_value) || 0;
            const credevKey = `${nf.branch_code}|${nf.invoice_code}|${nf.issue_date}`;
            // Conta itens da credev
            let credevItens = 0;
            for (const item of nf.items || []) {
              const prods = Array.isArray(item.products) ? item.products : [];
              for (const p of prods) {
                credevItens += parseFloat(p.quantity) || 0;
              }
            }
            sellerMap[sellerCode].invoice_value -= val;
            sellerMap[sellerCode].credev_value =
              (sellerMap[sellerCode].credev_value || 0) + val;
            // Conta NFs de credev e itens devolvidos (descontados depois)
            sellerMap[sellerCode].credev_qty =
              (sellerMap[sellerCode].credev_qty || 0) + 1;
            sellerMap[sellerCode].credev_itens_qty =
              (sellerMap[sellerCode].credev_itens_qty || 0) + credevItens;
          }
          if (inputNFs.length < PAGE) break;
          offsetIn += PAGE;
        }
      }
    }

    // Mapa de nomes de vendedores
    const vendedoresMapData = await loadVendedoresMap();

    // Filtro por módulo — multimarcas: apenas Walter/Renato/Arthur (David/Thalis → inbound_david, Rafael → inbound_rafael)
    const moduloToSegs = {
      multimarcas: new Set(['multimarcas']),
      revenda: new Set(['revenda']),
      varejo: new Set(['varejo']),
      inbound: new Set(['inbound', 'inbound_david', 'inbound_rafael']),
      inbound_david: new Set(['inbound_david']),
      inbound_rafael: new Set(['inbound_rafael']),
    };

    const dataRow = Object.entries(sellerMap)
      .map(([code, info]) => {
        // Net = Output NFs - credev (devoluções)
        const grossQty = info.nfKeys.size;
        const credevQty = info.credev_qty || 0;
        const invoiceQty = Math.max(0, grossQty - credevQty);
        const grossItens = info.itens_qty || 0;
        const credevItens = info.credev_itens_qty || 0;
        const itensNet = Math.max(0, grossItens - credevItens);
        const tm = invoiceQty > 0 ? info.invoice_value / invoiceQty : 0;
        const pa = invoiceQty > 0 ? itensNet / invoiceQty : 0;
        const pmpv = itensNet > 0 ? info.invoice_value / itensNet : 0;
        const vInfo = vendedoresMapData.byTotvsId?.[code];
        const erpSeller = ERP_CACHE.data?.sellersMap?.[code];
        const canalEntries = Object.entries(info.canalAcc);
        const canal = canalEntries.length
          ? canalEntries.sort((a, b) => b[1] - a[1])[0][0]
          : null;
        // Loja dominante (branch com mais valor faturado)
        const branchEntries = Object.entries(info.branchAcc || {});
        const primaryBranchCode = branchEntries.length
          ? Number(branchEntries.sort((a, b) => b[1] - a[1])[0][0])
          : null;
        const NON_VAREJO_BRANCHES = {
          99: { name: 'BLUE HOUSE', short: 'BLU' },
        };
        const branchInfo =
          primaryBranchCode &&
          (VAREJO_BRANCHES[primaryBranchCode] ||
            NON_VAREJO_BRANCHES[primaryBranchCode]);
        return {
          seller_code: code,
          seller_name: vInfo?.nome || erpSeller?.name || `Vendedor ${code}`,
          invoice_qty: invoiceQty, // líquido (descontado credev)
          invoice_qty_gross: grossQty,
          credev_qty: credevQty,
          invoice_value: Math.round(info.invoice_value * 100) / 100,
          credev_value: Math.round((info.credev_value || 0) * 100) / 100,
          itens_qty: itensNet, // líquido (descontado credev)
          itens_qty_gross: grossItens,
          credev_itens_qty: credevItens,
          tm: Math.round(tm * 100) / 100,
          pa: Math.round(pa * 1000) / 1000,
          pmpv: Math.round(pmpv * 100) / 100,
          canal,
          branch_code: primaryBranchCode,
          branch_name:
            branchInfo?.name ||
            (primaryBranchCode ? `Filial ${primaryBranchCode}` : null),
          branch_short: branchInfo?.short || null,
        };
      })
      .filter((row) => {
        if (!ALLOWED_SEGS.has(row.canal)) return false;
        if (modulo && moduloToSegs[modulo]) {
          return moduloToSegs[modulo].has(row.canal);
        }
        return true;
      })
      .sort((a, b) => b.invoice_value - a.invoice_value);

    return successResponse(
      res,
      { dataRow },
      `Faturamento de ${dataRow.length} vendedores`,
    );
  }),
);

// ---------------------------------------------------------------------------
// 14. POST /api/crm/faturamento-por-segmento
//     Retorna faturamento agrupado por segmento (varejo/revenda/franquia/
//     multimarcas/bazar) baseado no operation_code das notas_fiscais.
// ---------------------------------------------------------------------------

// Cache em memória para classificações de franquia (TTL: 10 minutos)
let _franqCache = null;
let _franqCacheAt = 0;
const FRANQ_CACHE_TTL = 10 * 60 * 1000;

async function getFranqPersonCodes() {
  const now = Date.now();
  if (_franqCache && now - _franqCacheAt < FRANQ_CACHE_TTL) return _franqCache;
  const [f1, f2] = await Promise.all([
    supabase
      .from('pes_pessoa')
      .select('code')
      .filter('classifications', 'cs', '[{"type":2}]'),
    supabase
      .from('pes_pessoa')
      .select('code')
      .filter('classifications', 'cs', '[{"type":20}]'),
  ]);
  if (f1.error) throw new Error(f1.error.message);
  if (f2.error) throw new Error(f2.error.message);
  _franqCache = new Set(
    [...(f1.data || []), ...(f2.data || [])].map((r) => Number(r.code)),
  );
  _franqCacheAt = now;
  return _franqCache;
}

// Helper: busca todas as páginas de uma query Supabase (PAGE=1000)
async function fetchAllPages(buildQuery) {
  const PAGE = 1000;
  let all = [];
  let offset = 0;
  while (true) {
    const { data, error } = await buildQuery(offset, offset + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    all = all.concat(data);
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

const OP_SEGMENTO_MAP = {
  // Varejo (B2C)
  510: 'varejo',
  511: 'varejo',
  521: 'varejo',
  522: 'varejo',
  545: 'varejo',
  546: 'varejo',
  548: 'varejo',
  9009: 'varejo', // F-VENDA DE MERCADORIA PARA DENTRO DO ESTADO
  9017: 'varejo',
  9027: 'varejo',
  9033: 'varejo',
  // Revendedor
  7236: 'revenda',
  9122: 'revenda',
  5102: 'revenda',
  7242: 'revenda',
  9061: 'revenda', // 5102F VENDAS PARA DENTRO DO RN
  9001: 'revenda', // 5102F - VENDAS PARA DENTRO DO ESTADO
  9121: 'revenda', // SME PROMO SALES REVENDA - FISCAL
  // Franquia
  7234: 'franquia',
  7240: 'franquia',
  7802: 'franquia',
  9124: 'franquia', // SME PROMO SALES FRANQUIA - FISCAL
  7259: 'franquia', // SUFRAMA DE VENDA DE MERC PARA TERCEIROS
  // Multimarcas
  7235: 'multimarcas',
  7241: 'multimarcas',
  // Bazar
  887: 'bazar',
  // Varejo Shopping (lojas em shopping mall — tabela shopping)
  9400: 'varejo', // 5102F - VENDAS PARA DENTRO DO ESTADO (TABELA SHOPPING)
  9401: 'varejo', // 5102SNF - VENDA DE MERCADORIA (TABELA SHOPPING)
  9420: 'varejo', // 5102F - VENDAS PARA DENTRO DO ESTADO (TABELA SHOPPING) RN
  9067: 'varejo', // 5102F VENDAS PARA DENTRO DA PB VAREJO SHOPPING
  9404: 'varejo', // 5102F NF-E - VENDAS PARA DENTRO DO ESTADO (TABELA SHOPPING)
  // Showroom
  7254: 'showroom',
  7007: 'showroom',
  // Novidades Franquia
  7255: 'novidadesfranquia',
  // Business
  7237: 'business',
  7269: 'business',
  7279: 'business',
  7277: 'business',
};

// Cache em memória do faturamento por segmento (TOTVS)
// Datas passadas: TTL 30min | data atual: TTL 3min
const FATSEG_CACHE = new Map();
const FATSEG_CACHE_TTL = 3 * 60 * 1000;
const FATSEG_CACHE_TTL_PAST = 30 * 60 * 1000;

router.post(
  '/faturamento-por-segmento',
  asyncHandler(async (req, res) => {
    const { datemin, datemax } = req.body;
    if (!datemin || !datemax) {
      return errorResponse(
        res,
        'datemin e datemax obrigatórios',
        400,
        'MISSING_DATES',
      );
    }

    // Cache por (datemin|datemax) — TTL maior para datas já fechadas
    const cacheKey = `${datemin}|${datemax}`;
    const today = new Date().toISOString().split('T')[0];
    const cacheTTL = datemax < today ? FATSEG_CACHE_TTL_PAST : FATSEG_CACHE_TTL;
    const cached = FATSEG_CACHE.get(cacheKey);
    if (cached && Date.now() - cached.ts < cacheTTL) {
      return successResponse(
        res,
        { ...cached.data, cached: true },
        'OK (cache)',
      );
    }

    const allOpCodes = Object.keys(OP_SEGMENTO_MAP).map(Number);

    // B2M INBOUND: dealer_code 26 (David) e 69 (Thalis) → inbound_david
    // dealer 21 (Rafael) → inbound_rafael (NÃO inclui 50 GERAL)
    const INBOUND_DAVID_DEALERS = new Set([26, 69]);
    const INBOUND_RAFAEL_DEALERS = new Set([21]);
    // Franquia: dealer 40 (sempre), ou dealer 288 (Jucelino) para clientes classificados como franquia
    const FRANQUIA_DEALER = 40;
    const JUCELINO_DEALER = 288;
    // Varejo: apenas lojas próprias (exclui franquias e outros canais)
    const VAREJO_BRANCH_CODES = new Set([
      2, 5, 55, 65, 87, 88, 90, 93, 94, 95, 97,
    ]);
    // Revenda: apenas filial 99
    const REVENDA_BRANCH_CODES = new Set([99]);
    // Vendedores B2R da empresa 2 — NFs deles ficam em revenda, não varejo
    const B2R_REVENDA_DEALERS_EMP2 = new Set([288, 251, 131]); // Jucelino, Felipe, Agenor
    // Vendedores de revenda da empresa 99
    const B2R_REVENDA_DEALERS_EMP99 = new Set([25, 15, 161, 165, 241, 779]); // Anderson, Heyridan, Cleiton, Michel, Yago, Aldo

    // Branches Ricardo Eletro (segmento separado)
    const RE_BRANCH_CODES = new Set([11, 111]);
    const RE_EXCL_OPS = new Set([5153, 5152, 5909, 5910, 5912, 6914, 7273]);

    // ─── TOTVS-only path: fiscal/v2/invoices/search (total + payments + items) ─
    // Substitui o fetch via Supabase notas_fiscais por chamada live ao TOTVS.
    // Subtrai credev em payments por segmento (alinha com CRM Analytics).
    const tokenData = await getToken();
    if (!tokenData?.access_token) {
      return errorResponse(res, 'Token TOTVS indisponível', 503, 'TOKEN_OFF');
    }
    const accessToken = tokenData.access_token;

    // Carrega lista de branches (todas — pool 1)
    let branchCodeList;
    try {
      branchCodeList = await getBranchCodes(accessToken);
    } catch (err) {
      console.warn('[fat-seg] getBranchCodes falhou, usando fallback amplo');
      branchCodeList = [
        1, 2, 5, 6, 11, 50, 55, 65, 75, 85, 87, 88, 89, 90, 91, 92, 93, 94, 95,
        96, 97, 98, 99, 100, 101, 111, 200, 600, 950, 960, 750, 850,
      ];
    }

    // Helper: fetch all pages com concorrência
    const fetchInvoicesPagesParallel = async (
      branches,
      operationCodes,
      expand = 'payments,items',
    ) => {
      const endpoint = `${TOTVS_BASE_URL}/fiscal/v2/invoices/search`;
      const pageSize = 100;
      const fetchPageWithRetry = async (page, retries = 3) => {
        for (let attempt = 1; attempt <= retries; attempt++) {
          try {
            const r = await axios.post(
              endpoint,
              {
                filter: {
                  branchCodeList: branches,
                  operationCodeList: operationCodes,
                  operationType: 'Output',
                  startIssueDate: `${datemin}T00:00:00`,
                  endIssueDate: `${datemax}T23:59:59`,
                },
                expand,
                page,
                pageSize,
              },
              {
                headers: {
                  'Content-Type': 'application/json',
                  Accept: 'application/json',
                  Authorization: `Bearer ${accessToken}`,
                },
                httpsAgent: totvsHttpsAgent,
                timeout: 120000,
              },
            );
            return r.data;
          } catch (err) {
            const retryable = err.message?.includes('stream has been aborted') ||
              err.message?.includes('socket hang up') ||
              err.message?.includes('ECONNRESET') ||
              err.response?.status === 429;
            if (retryable && attempt < retries) {
              const delay = attempt * 1500;
              console.warn(`[fat-seg invoices] pág ${page} tentativa ${attempt} falhou (${err.message}), retry em ${delay}ms`);
              await new Promise((r) => setTimeout(r, delay));
              continue;
            }
            console.warn(`[fat-seg invoices] pág ${page}: ${err.message}`);
            return { items: [] };
          }
        }
        return { items: [] };
      };
      const first = await fetchPageWithRetry(1);
      const all = [...(first?.items || [])];
      const totalPages =
        first?.totalPages ||
        (first?.totalItems ? Math.ceil(first.totalItems / pageSize) : 1);
      console.log(
        `[fat-seg] ${first?.totalItems ?? '?'} NFs em ${totalPages} páginas`,
      );
      if (totalPages > 1) {
        const rem = Array.from({ length: totalPages - 1 }, (_, i) => i + 2);
        const CONC = 5; // items-only → respostas menores → TOTVS aguenta mais concorrência
        for (let i = 0; i < rem.length; i += CONC) {
          const batch = rem.slice(i, i + CONC);
          const results = await Promise.all(batch.map((p) => fetchPageWithRetry(p)));
          for (const pd of results) all.push(...(pd?.items || []));
        }
      }
      return all;
    };

    // 1+2+3) Fetches sequenciais (TOTVS: max 3 simultâneos) — franquia (Supabase) em paralelo
    let invoicesMain, invoicesRE, franqPersonCodes;
    try {
      // franqPersonCodes (Supabase) + invoicesMain (TOTVS) em paralelo
      [franqPersonCodes, invoicesMain] = await Promise.all([
        // Classificação franquia (cache 10min) — Supabase, não sobrecarrega TOTVS
        getFranqPersonCodes(),
        // NFs principais — todas as ops do OP_SEGMENTO_MAP (só items, sem payments)
        fetchInvoicesPagesParallel(
          branchCodeList,
          allOpCodes,
          'items',
        ),
      ]);
      // Ricardo Eletro sequencial (após invoicesMain) — evita 6 requests TOTVS simultâneos
      invoicesRE = await fetchInvoicesPagesParallel([11, 111], [], 'items').catch((err) => {
        console.warn('[fat-seg] Ricardo Eletro fetch falhou:', err.message);
        return [];
      });
    } catch (err) {
      return errorResponse(
        res,
        `Erro ao buscar invoices TOTVS: ${err.message}`,
        500,
        'TOTVS_ERROR',
      );
    }

    // ─── Helper: dealer dominante via items[].products[] (TOTVS API) ─────
    function getDealerCodeFromInvoice(nf) {
      if (!Array.isArray(nf.items) || nf.items.length === 0) return null;
      const netByDealer = {};
      for (const item of nf.items) {
        const products = Array.isArray(item.products) ? item.products : [];
        for (const p of products) {
          const dc = p.dealerCode ? Number(p.dealerCode) : null;
          if (!dc) continue;
          const nv = parseFloat(p.netValue) || 0;
          netByDealer[dc] = (netByDealer[dc] || 0) + nv;
        }
      }
      const entries = Object.entries(netByDealer);
      if (entries.length === 0) return null;
      return Number(entries.sort((a, b) => b[1] - a[1])[0][0]);
    }

    // ─── Processa invoices principais ──
    const segMap = {};
    // personSegmentValue: personCode → { [segment]: totalAcumulado }
    const personSegmentValue = new Map();
    let totalNFsProcessadas = 0;

    for (const nf of invoicesMain) {
      if (nf.invoiceStatus === 'Canceled' || nf.invoiceStatus === 'Deleted')
        continue;
      const personCode = parseInt(nf.personCode);
      if (!personCode || personCode >= 100000000) continue;
      const branchCode = parseInt(nf.branchCode);
      const operationCode = parseInt(nf.operationCode);
      const totalValue = parseFloat(nf.totalValue) || 0;
      if (totalValue <= 0) continue;

      const dealerReal = getDealerCodeFromInvoice(nf);

      // Classificação de segmento (mesma lógica anterior, agora live)
      let seg;
      if (dealerReal === FRANQUIA_DEALER) {
        seg = 'franquia';
      } else if (
        dealerReal === JUCELINO_DEALER &&
        franqPersonCodes.has(personCode)
      ) {
        seg = 'franquia';
      } else if (INBOUND_DAVID_DEALERS.has(dealerReal)) {
        seg = 'inbound_david';
      } else if (INBOUND_RAFAEL_DEALERS.has(dealerReal)) {
        seg = 'inbound_rafael';
      } else {
        seg = OP_SEGMENTO_MAP[operationCode];
      }
      if (!seg) continue;

      // Filtros por segmento
      if (seg === 'varejo' && !VAREJO_BRANCH_CODES.has(branchCode)) continue;
      if (seg === 'business' && dealerReal !== 20) seg = 'revenda';
      if (seg === 'revenda') {
        if (branchCode === 99) {
          if (!B2R_REVENDA_DEALERS_EMP99.has(dealerReal)) continue;
        } else if (
          branchCode === 2 &&
          B2R_REVENDA_DEALERS_EMP2.has(dealerReal)
        ) {
          // mantém revenda
        } else if (branchCode === 2) {
          seg = 'varejo';
        } else if (!REVENDA_BRANCH_CODES.has(branchCode)) {
          continue;
        }
      }

      // Soma por segmento (valor bruto — sem credev de payments)
      segMap[seg] = (segMap[seg] || 0) + totalValue;

      // Acumula segmento dominante por pessoa (pra debug/atribuição)
      if (personCode) {
        let pSegMap = personSegmentValue.get(personCode);
        if (!pSegMap) {
          pSegMap = {};
          personSegmentValue.set(personCode, pSegMap);
        }
        pSegMap[seg] = (pSegMap[seg] || 0) + totalValue;
      }

      totalNFsProcessadas++;
    }

    // ─── Ricardo Eletro (branches 11/111, exceto ops de transferência) ──
    if (invoicesRE.length > 0) {
      let reTotal = 0;
      for (const nf of invoicesRE) {
        if (nf.invoiceStatus === 'Canceled' || nf.invoiceStatus === 'Deleted')
          continue;
        const opCode = parseInt(nf.operationCode);
        if (RE_EXCL_OPS.has(opCode)) continue;
        const personCode = parseInt(nf.personCode);
        if (!personCode || personCode >= 100000000) continue;
        const totalValue = parseFloat(nf.totalValue) || 0;
        if (totalValue <= 0) continue;
        reTotal += totalValue;
      }
      if (reTotal > 0) {
        segMap.ricardoeletro = Math.round(reTotal * 100) / 100;
      }
    }

    // Arredondamentos finais
    for (const k of Object.keys(segMap)) {
      segMap[k] = Math.round(segMap[k] * 100) / 100;
    }

    const total = Object.values(segMap).reduce((s, v) => s + v, 0);

    const responseData = {
      // segmentos = bruto (sem deducao de credev de payments — troca de velocidade)
      segmentos: segMap,
      segmentos_bruto: segMap,
      credev_por_segmento: {},
      total: Math.round(total * 100) / 100,
      total_bruto: Math.round(total * 100) / 100,
      credev_total: 0,
      total_liquido: Math.round(total * 100) / 100,
      // Metadata
      source: 'totvs_live',
      nfs_processadas: totalNFsProcessadas,
      branches_used: branchCodeList.length,
    };

    FATSEG_CACHE.set(cacheKey, { data: responseData, ts: Date.now() });
    if (FATSEG_CACHE.size > 10) {
      const oldest = [...FATSEG_CACHE.entries()].sort(
        (a, b) => a[1].ts - b[1].ts,
      )[0];
      FATSEG_CACHE.delete(oldest[0]);
    }

    return successResponse(res, responseData, 'OK (TOTVS live)');
  }),
);

// ---------------------------------------------------------------------------
// POST /api/crm/transacoes-canal
//      Lista NFs individuais de um canal no período, para exibir no popup
// ---------------------------------------------------------------------------
const OP_CANAL_MAP_INV = {
  510: 'varejo',
  511: 'varejo',
  521: 'varejo',
  522: 'varejo',
  545: 'varejo',
  546: 'varejo',
  548: 'varejo',
  9009: 'varejo',
  9017: 'varejo',
  9027: 'varejo',
  9033: 'varejo',
  9400: 'varejo',
  9401: 'varejo',
  9420: 'varejo',
  9067: 'varejo',
  9404: 'varejo',
  7236: 'revenda',
  9122: 'revenda',
  5102: 'revenda',
  7242: 'revenda',
  9061: 'revenda',
  9001: 'revenda',
  9121: 'revenda',
  7234: 'franquia',
  7240: 'franquia',
  7802: 'franquia',
  9124: 'franquia',
  7259: 'franquia',
  7235: 'multimarcas',
  7241: 'multimarcas',
  887: 'bazar',
  7254: 'showroom',
  7007: 'showroom',
  7255: 'novidadesfranquia',
  7237: 'business',
  7269: 'business',
  7279: 'business',
  7277: 'business',
};

router.post(
  '/transacoes-canal',
  asyncHandler(async (req, res) => {
    const { datemin, datemax, canal } = req.body;
    if (!datemin || !datemax || !canal)
      return errorResponse(
        res,
        'datemin, datemax e canal obrigatórios',
        400,
        'MISSING_PARAMS',
      );

    const VALID_CANAIS = new Set([
      'varejo',
      'revenda',
      'franquia',
      'multimarcas',
      'inbound',
      'inbound_david',
      'inbound_rafael',
      'bazar',
      'showroom',
      'novidadesfranquia',
      'business',
      'ricardoeletro',
    ]);
    if (!VALID_CANAIS.has(canal))
      return errorResponse(
        res,
        `Canal '${canal}' não reconhecido`,
        400,
        'INVALID_CANAL',
      );

    // ─── TOTVS live (mesma fonte do faturamento-por-segmento) ──────────────
    const tokenData = await getToken();
    if (!tokenData?.access_token)
      return errorResponse(res, 'Token TOTVS indisponível', 503, 'TOKEN_OFF');
    const accessToken = tokenData.access_token;

    const allOpCodesArr = Object.keys(OP_SEGMENTO_MAP).map(Number);
    const BUSINESS_OP_CODES_ARR = [7237, 7269, 7279, 7277];
    const REVENDA_OP_CODES_ARR = Object.entries(OP_SEGMENTO_MAP)
      .filter(([, v]) => v === 'revenda')
      .map(([k]) => Number(k));

    let branchCodeList;
    try {
      branchCodeList = await getBranchCodes(accessToken);
    } catch {
      branchCodeList = [
        1, 2, 5, 6, 11, 50, 55, 65, 75, 85, 87, 88, 89, 90, 91, 92, 93, 94, 95,
        96, 97, 98, 99, 100, 101, 111,
      ];
    }

    // Determina branches e op codes para query TOTVS
    let queryBranches, queryOpCodes;
    const RE_EXCL_OPS_SET = new Set([5153, 5152, 5909, 5910, 5912, 6914, 7273]);

    if (canal === 'ricardoeletro') {
      queryBranches = [11, 111];
      queryOpCodes = null; // sem filtro de op — busca tudo e exclui depois
    } else if (canal === 'varejo') {
      queryBranches = [2, 5, 55, 65, 87, 88, 90, 93, 94, 95, 97];
      queryOpCodes = [...allOpCodesArr, ...BUSINESS_OP_CODES_ARR];
    } else if (canal === 'revenda') {
      queryBranches = [2, 99];
      queryOpCodes = [...REVENDA_OP_CODES_ARR, ...BUSINESS_OP_CODES_ARR];
    } else if (canal === 'multimarcas') {
      queryBranches = branchCodeList;
      queryOpCodes = [7235, 7241];
    } else if (canal === 'inbound_david' || canal === 'inbound_rafael') {
      queryBranches = branchCodeList;
      queryOpCodes = allOpCodesArr;
    } else if (canal === 'bazar') {
      queryBranches = branchCodeList;
      queryOpCodes = [887];
    } else if (canal === 'showroom') {
      queryBranches = branchCodeList;
      queryOpCodes = [7254, 7007];
    } else if (canal === 'novidadesfranquia') {
      queryBranches = branchCodeList;
      queryOpCodes = [7255];
    } else if (canal === 'business') {
      queryBranches = branchCodeList;
      queryOpCodes = BUSINESS_OP_CODES_ARR;
    } else {
      // franquia, inbound — dealer-based, need all op codes
      queryBranches = branchCodeList;
      queryOpCodes = allOpCodesArr;
    }

    // Helper: fetch all pages from TOTVS invoices/search
    const fetchPages = async (branches, opCodes) => {
      const endpoint = `${TOTVS_BASE_URL}/fiscal/v2/invoices/search`;
      const pageSize = 100;
      const filter = {
        branchCodeList: branches,
        ...(opCodes && opCodes.length > 0
          ? { operationCodeList: opCodes }
          : {}),
        operationType: 'Output',
        startIssueDate: `${datemin}T00:00:00`,
        endIssueDate: `${datemax}T23:59:59`,
      };
      const fetchPage = (page) =>
        axios
          .post(
            endpoint,
            { filter, expand: 'items,payments', page, pageSize },
            {
              headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                Authorization: `Bearer ${accessToken}`,
              },
              httpsAgent: totvsHttpsAgent,
              timeout: 120000,
            },
          )
          .then((r) => r.data)
          .catch((err) => {
            console.warn(`[tx-canal] pág ${page}: ${err.message}`);
            return { items: [] };
          });

      const first = await fetchPage(1);
      const all = [...(first?.items || [])];
      const totalPages =
        first?.totalPages ||
        (first?.totalItems ? Math.ceil(first.totalItems / pageSize) : 1);
      console.log(
        `[tx-canal] ${first?.totalItems ?? '?'} NFs para canal=${canal}`,
      );
      if (totalPages > 1) {
        const rem = Array.from({ length: totalPages - 1 }, (_, i) => i + 2);
        const CONC = 8;
        for (let i = 0; i < rem.length; i += CONC) {
          const batch = rem.slice(i, i + CONC);
          const results = await Promise.all(batch.map(fetchPage));
          for (const pd of results) all.push(...(pd?.items || []));
        }
      }
      return all;
    };

    // Helper: dealer dominante via items[].products[].dealerCode (TOTVS API)
    function getDealerCodeTx(nf) {
      if (!Array.isArray(nf.items) || nf.items.length === 0) return null;
      const netByDealer = {};
      for (const item of nf.items) {
        const products = Array.isArray(item.products) ? item.products : [];
        for (const p of products) {
          const dc = p.dealerCode ? Number(p.dealerCode) : null;
          if (!dc) continue;
          const nv = parseFloat(p.netValue) || 0;
          netByDealer[dc] = (netByDealer[dc] || 0) + nv;
        }
      }
      const entries = Object.entries(netByDealer);
      if (entries.length === 0) return null;
      return Number(entries.sort((a, b) => b[1] - a[1])[0][0]);
    }

    // Constantes de classificação (idêntico ao faturamento-por-segmento)
    const FRANQUIA_DEALER_TX = 40;
    const JUCELINO_DEALER_TX = 288;
    const INBOUND_DAVID_DEALERS_TX = new Set([26, 69]);
    const INBOUND_RAFAEL_DEALER_TX = 21;
    const INBOUND_DEALER_CODES = new Set([26, 69, 21]); // todos inbound (para filtro franquia/varejo/revenda)
    const VAREJO_BRANCH_CODES_TX = new Set([
      2, 5, 55, 65, 87, 88, 90, 93, 94, 95, 97,
    ]);
    const REVENDA_BRANCH_CODES_TX = new Set([99]);
    const B2R_REVENDA_DEALERS_EMP2 = new Set([288, 251, 131]);
    const B2R_REVENDA_DEALERS_EMP99 = new Set([25, 15, 161, 165, 241, 779]);
    const BUSINESS_OP_CODES_SET = new Set(BUSINESS_OP_CODES_ARR);

    // Carrega franquia person codes se necessário
    const franqPersonCodes =
      canal === 'franquia' ||
      canal === 'inbound' ||
      canal === 'inbound_david' ||
      canal === 'inbound_rafael' ||
      canal === 'varejo' ||
      canal === 'revenda'
        ? await getFranqPersonCodes()
        : new Set();

    let opCodes;
    void opCodes; // mantido para evitar hoisting issues

    // ─── Busca TOTVS ────────────────────────────────────────────────────────
    let rawInvoices;
    try {
      rawInvoices = await fetchPages(queryBranches, queryOpCodes);
    } catch (err) {
      return errorResponse(
        res,
        `Erro TOTVS: ${err.message}`,
        500,
        'TOTVS_ERROR',
      );
    }

    // ─── Classificação (idêntica ao faturamento-por-segmento) ───────────────
    const CREDEV_OP_CODES_TX = new Set([
      1, 2, 555, 9073, 9402, 9065, 9403, 9062, 9005, 7790, 7245, 20, 1214, 7244,
    ]);
    const CREDEV_NAME_RE = /credev|devolu/i;

    const allNFs = [];
    for (const nf of rawInvoices) {
      if (nf.invoiceStatus === 'Canceled' || nf.invoiceStatus === 'Deleted')
        continue;
      const personCode = parseInt(nf.personCode);
      if (!personCode || personCode >= 100000000) continue;
      const totalValue = parseFloat(nf.totalValue) || 0;
      if (totalValue <= 0) continue;
      const branchCode = parseInt(nf.branchCode);
      const operationCode = parseInt(nf.operationCode);

      // Excluir credevs
      if (CREDEV_OP_CODES_TX.has(operationCode)) continue;
      if (CREDEV_NAME_RE.test(nf.operationName || '')) continue;

      const dealerReal = getDealerCodeTx(nf);

      if (canal === 'ricardoeletro') {
        if (RE_EXCL_OPS_SET.has(operationCode)) continue;
        allNFs.push(nf);
        continue;
      }

      // Determina segmento (mesma lógica do faturamento-por-segmento)
      let seg;
      if (dealerReal === FRANQUIA_DEALER_TX) {
        seg = 'franquia';
      } else if (
        dealerReal === JUCELINO_DEALER_TX &&
        franqPersonCodes.has(personCode)
      ) {
        seg = 'franquia';
      } else if (INBOUND_DAVID_DEALERS_TX.has(dealerReal)) {
        seg = 'inbound_david';
      } else if (dealerReal === INBOUND_RAFAEL_DEALER_TX) {
        seg = 'inbound_rafael';
      } else {
        seg = OP_SEGMENTO_MAP[operationCode];
      }
      if (!seg) continue;

      // Filtros por segmento (mesma lógica do faturamento-por-segmento)
      if (seg === 'varejo' && !VAREJO_BRANCH_CODES_TX.has(branchCode)) continue;
      if (seg === 'business' && dealerReal !== 20) seg = 'revenda';
      if (seg === 'revenda') {
        if (branchCode === 99) {
          if (!B2R_REVENDA_DEALERS_EMP99.has(dealerReal)) continue;
        } else if (
          branchCode === 2 &&
          B2R_REVENDA_DEALERS_EMP2.has(dealerReal)
        ) {
          // mantém revenda
        } else if (branchCode === 2) {
          seg = 'varejo';
        } else if (!REVENDA_BRANCH_CODES_TX.has(branchCode)) {
          continue;
        }
      }

      if (seg !== canal) continue;
      allNFs.push(nf);
    }

    // ─── Enriquecer com vendedor + bearer map ────────────────────────────────
    const allBranches = [
      ...new Set(allNFs.map((n) => parseInt(n.branchCode)).filter(Boolean)),
    ];
    const cacheKey = `${[...allBranches].sort().join(',')}|${datemin}|${datemax}`;
    const hasCachedBearer =
      AR_BEARER_CACHE.has(cacheKey) &&
      Date.now() - AR_BEARER_CACHE.get(cacheKey).ts < AR_BEARER_CACHE_TTL;

    const bearerMapPromise = hasCachedBearer
      ? Promise.resolve(AR_BEARER_CACHE.get(cacheKey).map)
      : fetchARBearerMap(allBranches, datemin, datemax);

    const [vendMap, bearerMap] = await Promise.all([
      loadVendedoresMap(),
      hasCachedBearer
        ? bearerMapPromise
        : Promise.race([
            bearerMapPromise,
            new Promise((r) => setTimeout(() => r(new Map()), 3000)),
          ]),
    ]);

    // Calcula credev de uma NF via payments.documentType === 'Credev'
    const calcCredevTx = (nf) => {
      if (!Array.isArray(nf.payments)) return 0;
      return nf.payments.reduce(
        (s, p) =>
          s +
          (p.documentType === 'Credev' ? parseFloat(p.paymentValue) || 0 : 0),
        0,
      );
    };

    let totalBruto = 0;
    let totalCredev = 0;
    const transacoes = allNFs.map((n) => {
      const dealerCode = getDealerCodeTx(n);
      const vInfo = dealerCode ? vendMap.byTotvsId?.[dealerCode] : null;
      const vendedor_nome = vInfo?.nome || null;
      const vendedor_ativo = vInfo ? vInfo.ativo !== false : null;
      const invoiceSeq = n.invoiceSequence;
      const grossValue = parseFloat(n.totalValue) || 0;
      const credevAmount = calcCredevTx(n);
      totalBruto += grossValue;
      totalCredev += credevAmount;
      return {
        branch_code: parseInt(n.branchCode),
        transaction_code: n.transactionCode,
        invoice_code: n.invoiceCode,
        serial_code: n.serialCode,
        issue_date: n.issueDate ? n.issueDate.split('T')[0] : null,
        person_code: parseInt(n.personCode),
        person_name: n.personName,
        operation_code: parseInt(n.operationCode),
        operation_name: n.operationName,
        document_type_code: n.documentTypeCode || null,
        is_credev: credevAmount > 0,
        total_value: Math.max(
          0,
          Math.round((grossValue - credevAmount) * 100) / 100,
        ),
        total_bruto: Math.round(grossValue * 100) / 100,
        credev_amount: Math.round(credevAmount * 100) / 100,
        payment_condition: n.paymentConditionName || null,
        payment_method: bearerMap.get(invoiceSeq) || null,
        dealer_code: dealerCode,
        vendedor_nome,
        vendedor_ativo,
      };
    });

    const total_liquido = Math.round((totalBruto - totalCredev) * 100) / 100;

    return successResponse(
      res,
      {
        canal,
        datemin,
        datemax,
        total: Math.round(totalBruto * 100) / 100,
        total_liquido,
        credev_total: Math.round(totalCredev * 100) / 100,
        count: allNFs.length,
        transacoes,
      },
      'OK',
    );
  }),
);

// ---------------------------------------------------------------------------
// POST /api/crm/debug-operation-codes
//      Lista operation_codes com totais para um período (diagnóstico de canais)
// ---------------------------------------------------------------------------
router.post(
  '/debug-operation-codes',
  asyncHandler(async (req, res) => {
    const { datemin, datemax } = req.body;
    if (!datemin || !datemax)
      return errorResponse(
        res,
        'datemin e datemax obrigatórios',
        400,
        'MISSING_DATES',
      );

    let allNFs = [];
    let offset = 0;
    const PAGE = 1000;
    while (true) {
      const { data, error } = await supabaseFiscal
        .from('notas_fiscais')
        .select('operation_code, operation_name, total_value')
        .eq('operation_type', 'Output')
        .not('invoice_status', 'eq', 'Canceled')
        .not('invoice_status', 'eq', 'Deleted')
        .gte('issue_date', datemin)
        .lte('issue_date', datemax)
        .lt('person_code', 100000000)
        .range(offset, offset + PAGE - 1);
      if (error)
        return errorResponse(res, error.message, 500, 'SUPABASE_ERROR');
      allNFs = allNFs.concat(data);
      if (data.length < PAGE) break;
      offset += PAGE;
    }

    const OP_MAP = OP_SEGMENTO_MAP;

    const byOp = {};
    for (const nf of allNFs) {
      const op = nf.operation_code;
      if (!byOp[op])
        byOp[op] = {
          operation_code: op,
          operation_name: nf.operation_name,
          canal: OP_MAP[op] || null,
          count: 0,
          total: 0,
        };
      byOp[op].count++;
      byOp[op].total += parseFloat(nf.total_value) || 0;
    }

    const rows = Object.values(byOp)
      .map((r) => ({ ...r, total: Math.round(r.total * 100) / 100 }))
      .sort((a, b) => b.total - a.total);

    const totalSemCanal = rows
      .filter((r) => !r.canal)
      .reduce((s, r) => s + r.total, 0);
    const totalComCanal = rows
      .filter((r) => r.canal)
      .reduce((s, r) => s + r.total, 0);

    return successResponse(
      res,
      {
        rows,
        totalSemCanal: Math.round(totalSemCanal * 100) / 100,
        totalComCanal: Math.round(totalComCanal * 100) / 100,
        totalGeral: Math.round((totalSemCanal + totalComCanal) * 100) / 100,
      },
      `${rows.length} operation codes`,
    );
  }),
);

// ---------------------------------------------------------------------------
// POST /api/crm/faturamento-por-pagamento
//      Agrupa faturamento do período por forma de pagamento
//      Combina: catálogo oficial TOTVS (payment-fiscal-movement) + valores Supabase
// ---------------------------------------------------------------------------
router.post(
  '/faturamento-por-pagamento',
  asyncHandler(async (req, res) => {
    const { datemin, datemax } = req.body;
    if (!datemin || !datemax)
      return errorResponse(
        res,
        'datemin e datemax obrigatórios',
        400,
        'MISSING_DATES',
      );

    // Busca catálogo TOTVS + valores Supabase em paralelo
    const [totvsResult, supabaseResult] = await Promise.allSettled([
      // 1. Catálogo de condições de pagamento (TOTVS)
      (async () => {
        const tokenData = await getToken();
        const token = tokenData.access_token;
        const branchCodes = await getBranchCodes(token);
        const endpoint = `${TOTVS_BASE_URL}/analytics/v2/payment-fiscal-movement/search`;
        const response = await axios.post(
          endpoint,
          {
            filter: {
              branchCodeList: branchCodes,
              startMovementDate: `${datemin}T00:00:00`,
              endMovementDate: `${datemax}T23:59:59`,
            },
            page: 1,
            pageSize: 1000,
          },
          {
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            timeout: 30000,
            httpsAgent: totvsHttpsAgent,
          },
        );
        return response.data?.items || response.data?.data || [];
      })(),

      // 2. Valores reais por condição de pagamento (Supabase)
      (async () => {
        let allNFs = [];
        let offset = 0;
        const PAGE = 1000;
        while (true) {
          const { data, error } = await supabaseFiscal
            .from('notas_fiscais')
            .select(
              'total_value, payment_condition_code, payment_condition_name',
            )
            .eq('operation_type', 'Output')
            .not('invoice_status', 'eq', 'Canceled')
            .not('invoice_status', 'eq', 'Deleted')
            .gte('issue_date', datemin)
            .lte('issue_date', datemax)
            .lt('person_code', 100000000)
            .range(offset, offset + PAGE - 1);
          if (error) throw error;
          allNFs = allNFs.concat(data);
          if (data.length < PAGE) break;
          offset += PAGE;
        }
        return allNFs;
      })(),
    ]);

    if (supabaseResult.status === 'rejected') {
      return errorResponse(
        res,
        supabaseResult.reason?.message || 'Erro Supabase',
        500,
        'SUPABASE_ERROR',
      );
    }

    // Monta mapa code -> nome oficial do TOTVS
    const totvsCatalog = {};
    if (totvsResult.status === 'fulfilled') {
      for (const item of totvsResult.value) {
        if (item.code != null) totvsCatalog[item.code] = item.name;
      }
    }

    // Agrega valores por condição de pagamento
    const byPag = {};
    for (const nf of supabaseResult.value) {
      const code = nf.payment_condition_code ?? 0;
      const nameBase = nf.payment_condition_name || 'Não informado';
      // Usa nome do TOTVS quando disponível (fonte oficial)
      const name = totvsCatalog[code] || nameBase;
      const key = `${code}`;
      if (!byPag[key]) {
        byPag[key] = {
          paymentCode: code,
          paymentDescription: name,
          invoiceQty: 0,
          totalValue: 0,
        };
      }
      byPag[key].invoiceQty++;
      byPag[key].totalValue += parseFloat(nf.total_value) || 0;
    }

    // Inclui condições do catálogo TOTVS sem NFs no período (totalValue = 0)
    for (const [code, name] of Object.entries(totvsCatalog)) {
      const key = `${code}`;
      if (!byPag[key]) {
        byPag[key] = {
          paymentCode: Number(code),
          paymentDescription: name,
          invoiceQty: 0,
          totalValue: 0,
        };
      }
    }

    const items = Object.values(byPag)
      .map((r) => ({ ...r, totalValue: Math.round(r.totalValue * 100) / 100 }))
      .sort((a, b) => b.totalValue - a.totalValue);

    const total = items.reduce((s, i) => s + i.totalValue, 0);

    return successResponse(
      res,
      { items, total: Math.round(total * 100) / 100 },
      `${items.length} formas de pagamento`,
    );
  }),
);

// ─── Cron: sync diário de leads → compras (igual ao n8n: 09:24 BRT) ──────────
export function iniciarCronSyncLeadsCompras() {
  if (!CLICKUP_API_KEY || !CLICKUP_LIST_ID) {
    console.log(
      '⏭️  [sync-leads-compras] cron NÃO agendado (ClickUp não configurado)',
    );
    return null;
  }
  const task = cron.schedule(
    '24 9 * * *',
    async () => {
      console.log('⏰ [sync-leads-compras] Disparado pelo cron (09:24 BRT)');
      try {
        const result = await executarSyncLeadsCompras({
          dryRun: false,
          source: 'cron',
        });
        console.log(
          `✅ [sync-leads-compras][cron] ${result.leads_atualizados} atualizados em ${result.duration_human}`,
        );
      } catch (err) {
        console.error('❌ [sync-leads-compras][cron] erro:', err.message);
      }
    },
    { timezone: 'America/Sao_Paulo' },
  );
  console.log(
    '⏰ [sync-leads-compras] Cron agendado: todo dia às 09:24 (America/Sao_Paulo)',
  );
  return task;
}

// ---------------------------------------------------------------------------
// POST /api/crm/varejo-totvs
//     Retorna o faturamento varejo agregado diretamente do TOTVS,
//     usando o mesmo critério do Ranking de Faturamento (filtro "Filial"):
//     branches com nome contendo "CROSBY", excluindo "FRANQUIA" e codes 98/980.
// ---------------------------------------------------------------------------
router.post(
  '/varejo-totvs',
  asyncHandler(async (req, res) => {
    const { datemin, datemax } = req.body;
    if (!datemin || !datemax) {
      return errorResponse(
        res,
        'datemin e datemax obrigatórios',
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
    const token = tokenData.access_token;
    const branchs = await getBranchCodes(token);

    const totvsData = await fetchBranchTotalsFromTotvs({
      initialToken: token,
      branchs,
      datemin,
      datemax,
      refreshToken: async () => {
        const d = await getToken(true);
        return d.access_token;
      },
      logTag: 'VarejoTotvs',
    });

    // Mesmo critério do Ranking de Faturamento — filterType === 'filial'
    const EXCLUIR = new Set([98, 980]);
    const rows = (totvsData.dataRow || []).filter((b) => {
      const bc = Number(b.branch_code ?? 0);
      if (EXCLUIR.has(bc)) return false;
      const name = (b.branch_name || '').toUpperCase();
      return name.includes('CROSBY') && !name.includes('FRANQUIA');
    });

    const agg = rows.reduce(
      (acc, b) => ({
        invoice_value: acc.invoice_value + Number(b.invoice_value ?? 0),
        invoice_qty: acc.invoice_qty + Number(b.invoice_qty ?? 0),
        itens_qty: acc.itens_qty + Number(b.itens_qty ?? 0),
      }),
      { invoice_value: 0, invoice_qty: 0, itens_qty: 0 },
    );

    agg.tm = agg.invoice_qty > 0 ? agg.invoice_value / agg.invoice_qty : 0;
    agg.pa =
      agg.invoice_qty > 0 && agg.itens_qty > 0
        ? agg.itens_qty / agg.invoice_qty
        : 0;
    agg.pmpv = agg.itens_qty > 0 ? agg.invoice_value / agg.itens_qty : 0;

    console.log(
      `✅ [VarejoTotvs] ${rows.length} filiais | R$ ${agg.invoice_value.toFixed(2)}`,
    );

    return successResponse(
      res,
      { ...agg, branches: rows },
      'Varejo TOTVS obtido com sucesso',
    );
  }),
);

export default router;
