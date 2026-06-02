// ============================================================
// FORECAST — Promessa Semanal / Mensal (Métricas Diárias)
// Lê metas da tabela forecast_canal_metas (mesma alimentada na aba
// "Métricas por Canal" → Faturamento × Meta).
// Faturamento real vem de /api/crm/faturamento-por-segmento.
// ============================================================
import express from 'express';
import axios from 'axios';
import supabase from '../config/supabase.js';
import {
  asyncHandler,
  successResponse,
  errorResponse,
} from '../utils/errorHandler.js';
import { getPool } from '../services/uazapiSync.js';

const router = express.Router();

// ──────────────────────────────────────────────────────────────
// Envio de mensagem via instância "crosbybot" (UAzapi)
// ──────────────────────────────────────────────────────────────
const UAZ_BASE = process.env.UAZAPI_BASE_URL || '';
const CROSBYBOT_NAME = process.env.UAZAPI_ALERT_INSTANCE || 'crosbybot';

function normalizeBrPhone(s) {
  const d = String(s || '').replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('55')) return d;
  if (d.length === 10 || d.length === 11) return `55${d}`;
  return d;
}

async function getCrosbybotToken() {
  const pool = getPool();
  let r = await pool.query(
    `SELECT id, name, token, status FROM instances
      WHERE LOWER(name) = LOWER($1)
      ORDER BY (status = 'connected') DESC
      LIMIT 1`,
    [CROSBYBOT_NAME],
  );
  if (r.rows[0]?.token) return r.rows[0];
  r = await pool.query(
    `SELECT id, name, token, status FROM instances
      WHERE LOWER(name) LIKE '%' || LOWER($1) || '%'
      ORDER BY (status = 'connected') DESC
      LIMIT 1`,
    [CROSBYBOT_NAME],
  );
  return r.rows[0] || null;
}

async function sendCrosbybotMessage(phone, text) {
  if (!UAZ_BASE) throw new Error('UAZAPI_BASE_URL não configurado');
  const number = normalizeBrPhone(phone);
  if (!number) throw new Error('Telefone inválido');
  const sender = await getCrosbybotToken();
  if (!sender?.token) {
    throw new Error(
      `Instância "${CROSBYBOT_NAME}" não encontrada no banco. Rode sync.`,
    );
  }
  try {
    await axios.post(
      `${UAZ_BASE}/send/text`,
      { number, text },
      {
        headers: { token: sender.token, 'Content-Type': 'application/json' },
        timeout: 30_000,
      },
    );
  } catch (err) {
    if (err.response?.status === 404) {
      await axios.post(
        `${UAZ_BASE}/sendText`,
        { number, text },
        {
          headers: { token: sender.token, 'Content-Type': 'application/json' },
          timeout: 30_000,
        },
      );
    } else {
      throw err;
    }
  }
  return { sender: sender.name, recipient: number, status: sender.status };
}

// Envia uma imagem (base64) via UAzapi. `imageBase64` pode vir com prefixo data:image/png;base64,
async function sendCrosbybotImage(phone, imageBase64, caption = '') {
  if (!UAZ_BASE) throw new Error('UAZAPI_BASE_URL não configurado');
  const number = normalizeBrPhone(phone);
  if (!number) throw new Error('Telefone inválido');
  const sender = await getCrosbybotToken();
  if (!sender?.token) {
    throw new Error(
      `Instância "${CROSBYBOT_NAME}" não encontrada no banco. Rode sync.`,
    );
  }
  // Aceita imagem com ou sem prefixo data:URI
  const cleanB64 = String(imageBase64 || '').replace(
    /^data:image\/\w+;base64,/,
    '',
  );
  if (!cleanB64) throw new Error('Imagem vazia');

  // UAzapi /send/media — tenta dois formatos comuns por compatibilidade
  const tries = [
    {
      url: `${UAZ_BASE}/send/media`,
      body: { number, type: 'image', file: cleanB64, text: caption },
    },
    {
      url: `${UAZ_BASE}/send/media`,
      body: {
        number,
        mediatype: 'image',
        file: `data:image/png;base64,${cleanB64}`,
        text: caption,
      },
    },
    {
      url: `${UAZ_BASE}/sendImage`,
      body: { number, image: cleanB64, caption },
    },
  ];
  let lastErr;
  for (const t of tries) {
    try {
      await axios.post(t.url, t.body, {
        headers: { token: sender.token, 'Content-Type': 'application/json' },
        timeout: 60_000,
        maxBodyLength: 50 * 1024 * 1024,
        maxContentLength: 50 * 1024 * 1024,
      });
      return {
        sender: sender.name,
        recipient: number,
        endpoint: t.url,
        status: sender.status,
      };
    } catch (err) {
      lastErr = err;
      // Se for 4xx (not found), tenta o próximo formato
      if (err.response?.status === 404 || err.response?.status === 400)
        continue;
      throw err;
    }
  }
  throw (
    lastErr || new Error('Nenhum endpoint UAzapi aceitou o envio de imagem')
  );
}

const INTERNAL_API_BASE =
  process.env.INTERNAL_API_BASE_URL ||
  `http://localhost:${process.env.PORT || 4100}`;

// ──────────────────────────────────────────────────────────────
// EXCLUSÕES FORECAST — clientes que devem ser EXCLUÍDOS do
// faturamento real do Forecast (mantendo no faturamento geral do CRM).
//
// Uso típico: cliente "franquia" virou loja própria → faturamento ainda
// existe e é contabilizado no CRM, mas no Forecast Franquia já não deve
// contar porque não estava previsto na meta.
//
// Cada exclusão tem:
//   personCode: cliente (number)
//   canal:      canal do segMap a abater (string — ex: 'franquia')
//   dateFrom:   data ISO de início (YYYY-MM-DD). Aplica de dateFrom em diante.
//   description: comentário (não usado em runtime)
//
// Cálculo: busca via fiscal/v2/invoices NFs com personCode + ops do canal +
// issueDate >= dateFrom, soma totalValue, e subtrai do segMap[canal].
// ──────────────────────────────────────────────────────────────
const FORECAST_EXCLUSOES = [
  {
    personCode: 29541,
    canal: 'franquia',
    dateFrom: '2026-05-21',
    description:
      'CROSBY RECIFE MALL LTDA — virou loja própria em 21/05/2026. Faturamento dela continua no CRM mas não deve entrar no Forecast Franquia.',
  },
];

// Cache pra evitar re-calcular exclusão a cada Forecast request
const EXCLUSOES_CACHE = new Map();
const EXCLUSOES_CACHE_TTL_REALTIME = 60 * 60 * 1000; // 1h
const EXCLUSOES_CACHE_TTL_PAST = 24 * 60 * 60 * 1000; // 24h pra meses passados

// Ops por canal (espelha CANAL_CONFIG do crm.routes.js)
const CANAL_OPS = {
  franquia: [7234, 7240, 7802, 9124, 7259],
  multimarcas: [7235, 7241, 9127, 200],
  business: [7237, 7269, 7279, 7277],
};

async function calcularExclusaoNF({ personCode, ops, datemin, datemax }) {
  const { getToken } = await import('../utils/totvsTokenManager.js');
  const { TOTVS_BASE_URL, httpsAgent, getBranchCodes } =
    await import('../totvsrouter/totvsHelper.js');
  const tk = await getToken();
  if (!tk?.access_token) return 0;
  // fiscal/v2/invoices exige branchCodeList. Pega todas as branches.
  let branchCodeList;
  try {
    branchCodeList = await getBranchCodes(tk.access_token);
  } catch (err) {
    // Fallback hardcoded — pode omitir branches novas adicionadas ao TOTVS
    // após o lançamento. Se Recife Mall ou outro cliente excluido faturar
    // em branch fora dessa lista, a exclusão silenciosamente perde a NF.
    console.warn(
      `[forecast/exclusoes] getBranchCodes falhou (${err.message}) — usando fallback hardcoded. Algumas NFs podem não ser excluídas se estiverem em branches novas.`,
    );
    branchCodeList = [
      1, 2, 5, 6, 11, 50, 55, 65, 75, 85, 87, 88, 89, 90, 91, 92, 93, 94, 95,
      96, 97, 98, 99, 100, 101, 111, 200,
    ];
  }
  let total = 0;
  // fiscal/v2/invoices não aceita filter por personCode → busca por ops e
  // filtra localmente. Paginação pequena: NFs com ops franquia são poucas.
  for (let page = 1; page <= 20; page++) {
    let resp;
    try {
      resp = await axios.post(
        `${TOTVS_BASE_URL}/fiscal/v2/invoices/search`,
        {
          filter: {
            branchCodeList,
            operationCodeList: ops,
            operationType: 'Output',
            startIssueDate: `${datemin}T00:00:00`,
            endIssueDate: `${datemax}T23:59:59`,
          },
          expand: '',
          page,
          pageSize: 100,
        },
        {
          headers: { Authorization: `Bearer ${tk.access_token}` },
          httpsAgent,
          timeout: 60000,
        },
      );
    } catch (err) {
      console.warn(`[forecast/exclusoes] pág ${page} falhou: ${err.message}`);
      break;
    }
    const items = resp.data?.items || [];
    if (items.length === 0) break;
    for (const nf of items) {
      if (nf.invoiceStatus === 'Canceled' || nf.invoiceStatus === 'Deleted')
        continue;
      if (parseInt(nf.personCode) !== personCode) continue;
      total += parseFloat(nf.totalValue || 0);
    }
    if (items.length < 100) break;
  }
  return total;
}

// Calcula o total a EXCLUIR por canal para o período (datemin..datemax).
// Retorna Map<canal, valorExcluir>.
async function getExclusoesPorCanal(datemin, datemax) {
  if (!datemin || !datemax) return new Map();
  const datemin_ymd = toYmd(datemin);
  const datemax_ymd = toYmd(datemax);
  const result = new Map();
  // Hoje pra decidir TTL
  const hojeYmd = toYmd(new Date());
  const isPast = datemax_ymd < hojeYmd;
  const ttl = isPast ? EXCLUSOES_CACHE_TTL_PAST : EXCLUSOES_CACHE_TTL_REALTIME;

  for (const ex of FORECAST_EXCLUSOES) {
    // dateFrom é a data quando a regra começa a valer. Recorta o período
    // pra começar em max(dateFrom, datemin_ymd). Se o recorte for vazio,
    // não aplica (exclusão não cobre esse período).
    const dfrom = ex.dateFrom > datemin_ymd ? ex.dateFrom : datemin_ymd;
    if (dfrom > datemax_ymd) continue;

    const ops = CANAL_OPS[ex.canal];
    if (!Array.isArray(ops) || ops.length === 0) continue;

    const cacheKey = `${ex.personCode}|${ex.canal}|${dfrom}|${datemax_ymd}`;
    const cached = EXCLUSOES_CACHE.get(cacheKey);
    let valor;
    if (cached && Date.now() - cached.ts < ttl) {
      valor = cached.valor;
    } else {
      valor = await calcularExclusaoNF({
        personCode: ex.personCode,
        ops,
        datemin: dfrom,
        datemax: datemax_ymd,
      });
      EXCLUSOES_CACHE.set(cacheKey, { valor, ts: Date.now() });
      if (EXCLUSOES_CACHE.size > 50) {
        const oldest = [...EXCLUSOES_CACHE.entries()].sort(
          (a, b) => a[1].ts - b[1].ts,
        )[0];
        EXCLUSOES_CACHE.delete(oldest[0]);
      }
      if (valor > 0) {
        console.log(
          `[forecast/exclusoes] ${ex.canal} − R$${valor.toFixed(2)} (personCode=${ex.personCode}, ${dfrom}..${datemax_ymd}) — ${ex.description?.slice(0, 50)}`,
        );
      }
    }
    result.set(ex.canal, (result.get(ex.canal) || 0) + valor);
  }
  return result;
}

// Aplica exclusões no segMap. Modifica IN-PLACE.
async function aplicarExclusoesForecast(segMap, datemin, datemax) {
  if (!segMap) return segMap;
  const exclusoes = await getExclusoesPorCanal(datemin, datemax);
  for (const [canal, valor] of exclusoes.entries()) {
    if (valor > 0 && segMap[canal] != null) {
      const before = Number(segMap[canal] || 0);
      segMap[canal] = Math.max(0, before - valor);
      console.log(
        `[forecast/exclusoes] ${canal}: R$${before.toFixed(2)} → R$${segMap[canal].toFixed(2)} (−R$${valor.toFixed(2)} excluído)`,
      );
    }
  }
  return segMap;
}

// ──────────────────────────────────────────────────────────────
// Configuração dos canais (igual ao Forecast "Por Canal")
// ──────────────────────────────────────────────────────────────
// Canal "fabrica" é virtual: soma showroom + novidadesfranquia.
// As metas usam canal='fabrica' na forecast_canal_metas.
const FABRICA_SOURCES = ['showroom', 'novidadesfranquia'];

const CANAIS = [
  { key: 'varejo', label: 'Varejo' },
  { key: 'revenda', label: 'Revenda' },
  { key: 'multimarcas', label: 'Multimarcas' },
  { key: 'inbound_david', label: 'MTM Inbound David' },
  { key: 'inbound_rafael', label: 'MTM Inbound Rafael' },
  { key: 'franquia', label: 'Franquia' },
  { key: 'bazar', label: 'Bazar' },
  { key: 'fabrica', label: 'Fábrica (Kleiton)' }, // showroom + novidadesfranquia
  { key: 'business', label: 'Business' },
  { key: 'ricardoeletro', label: 'Ricardo Eletro' },
];

// ──────────────────────────────────────────────────────────────
// BlueCard — canal QUANTITATIVO (n.º de cartões enviados)
// ──────────────────────────────────────────────────────────────
// Lista ClickUp "Gestão Cartões" — filtro por status="enviado" e
// custom field "Envio do Cartão" (date) dentro do período.
// IMPORTANTE: BlueCard usa unidade "cartões" (não R$). Não entra no
// total monetário dos endpoints — é exibido em linha separada com
// flag `is_quantity: true`.
const BLUECARD_LIST_ID = process.env.BLUECARD_LIST_ID || '901109156287';
const BLUECARD_ENVIO_FIELD_ID = 'bccdf561-eb70-4b9c-aa1d-7298b6e892e1';
const BLUECARD_STATUS = 'enviado';

// Cache: chave "datemin|datemax" → { count, ts }
const BLUECARD_CACHE = new Map();
const BLUECARD_TTL_MS = 5 * 60 * 1000; // 5 min
let _bluecardNoKeyWarned = false;

async function fetchBlueCardSentCount(datemin, datemax) {
  if (!datemin || !datemax) return 0;
  const cacheKey = `${datemin}|${datemax}`;
  const cached = BLUECARD_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.ts < BLUECARD_TTL_MS) return cached.count;

  const apiKey = process.env.CLICKUP_API_KEY || '';
  if (!apiKey) {
    if (!_bluecardNoKeyWarned) {
      console.warn('[bluecard] CLICKUP_API_KEY ausente — retornando 0');
      _bluecardNoKeyWarned = true;
    }
    // cacheia por TTL para evitar checagem constante
    BLUECARD_CACHE.set(cacheKey, { count: 0, ts: Date.now() });
    return 0;
  }

  // janela inclusiva em UTC
  const dMs = new Date(`${datemin}T00:00:00Z`).getTime();
  const aMs = new Date(`${datemax}T23:59:59Z`).getTime();

  let count = 0;
  let page = 0;
  const MAX_PAGES = 100; // 100 × 100 = 10k cartões enviados (caso extremo)
  while (page < MAX_PAGES) {
    let tasks;
    try {
      const r = await axios.get(
        `https://api.clickup.com/api/v2/list/${BLUECARD_LIST_ID}/task`,
        {
          params: {
            subtasks: true,
            include_closed: true,
            page,
            'statuses[]': BLUECARD_STATUS,
          },
          headers: { Authorization: apiKey },
          timeout: 60000,
        },
      );
      tasks = r.data?.tasks || [];
    } catch (e) {
      console.warn(`[bluecard] fetch página ${page} falhou: ${e.message}`);
      break;
    }
    if (tasks.length === 0) break;
    for (const t of tasks) {
      const cf = (t.custom_fields || []).find(
        (f) => f.id === BLUECARD_ENVIO_FIELD_ID,
      );
      const raw = cf?.value;
      if (!raw) continue;
      const ms = Number(raw);
      if (!Number.isFinite(ms)) continue;
      if (ms >= dMs && ms <= aMs) count += 1;
    }
    if (tasks.length < 100) break;
    page += 1;
  }

  BLUECARD_CACHE.set(cacheKey, { count, ts: Date.now() });
  return count;
}

// ──────────────────────────────────────────────────────────────
// Helpers de período
// ──────────────────────────────────────────────────────────────

function getIsoWeek(date) {
  const d = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()),
  );
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return { ano: d.getUTCFullYear(), semana: weekNo };
}

// Última semana COMPLETA — mesma definição usada em "Métricas por Canal"
// (segunda passada → domingo passado). É a semana onde os metas costumam estar cadastrados.
function getLastCompletedIsoWeek() {
  const today = new Date();
  const dow = today.getUTCDay();
  const daysSinceLastSunday = dow === 0 ? 7 : dow;
  const sun = new Date(today);
  sun.setUTCDate(today.getUTCDate() - daysSinceLastSunday);
  return getIsoWeek(sun);
}

function isoWeekStart(ano, semana) {
  const jan4 = new Date(Date.UTC(ano, 0, 4));
  const dayOfWeek = jan4.getUTCDay() || 7;
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - (dayOfWeek - 1));
  const result = new Date(week1Monday);
  result.setUTCDate(week1Monday.getUTCDate() + (semana - 1) * 7);
  return result;
}

function isoWeekRange(ano, semana) {
  const start = isoWeekStart(ano, semana);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  const fmt = (d) => d.toISOString().slice(0, 10);
  return { data_inicio: fmt(start), data_fim: fmt(end) };
}

function weekKey(ano, semana) {
  return `${ano}-W${String(semana).padStart(2, '0')}`;
}
function monthKey(ano, mes) {
  return `${ano}-${String(mes).padStart(2, '0')}`;
}

// Dias úteis (segunda a sábado)
function diasUteisRangeMonSat(from, to) {
  let n = 0;
  const cur = new Date(from);
  cur.setUTCHours(12, 0, 0, 0);
  const end = new Date(to);
  end.setUTCHours(12, 0, 0, 0);
  while (cur <= end) {
    if (cur.getUTCDay() !== 0) n += 1; // 0 = domingo
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return n;
}

function diasUteisDoMes(ano, mes) {
  const start = new Date(Date.UTC(ano, mes - 1, 1));
  const last = new Date(Date.UTC(ano, mes, 0));
  return diasUteisRangeMonSat(start, last);
}

function diasUteisDecorridosNoMes(ano, mes, hoje) {
  const start = new Date(Date.UTC(ano, mes - 1, 1));
  const last = new Date(Date.UTC(ano, mes, 0));
  let ref = last;
  if (hoje.getUTCFullYear() === ano && hoje.getUTCMonth() + 1 === mes)
    ref = hoje;
  else if (hoje < start) return 0;
  return diasUteisRangeMonSat(start, ref);
}

// ──────────────────────────────────────────────────────────────
// Helper: faturamento por segmento via API existente
// O endpoint /faturamento-por-segmento espera datemin/datemax como YYYY-MM-DD
// (ele mesmo concatena T00:00:00 / T23:59:59 internamente)
// Retorna { varejo: X, revenda: Y, ..., fabrica: showroom+novidadesfranquia }
// ──────────────────────────────────────────────────────────────
function toYmd(v) {
  if (!v) return v;
  // Aceita "YYYY-MM-DD" ou "YYYY-MM-DDTHH:MM:SS"; devolve só YYYY-MM-DD
  return String(v).slice(0, 10);
}

async function getFaturamentoPorSegmento(datemin, datemax) {
  try {
    // lite=true → pula PASS 0 (credev em payments, FIS_NFITEMPROD scan) no
    // fat-seg. Líquido fica levemente inflado mas o card carrega em segundos
    // e o TOTVS não bloqueia o usuário. Pra ver o líquido oficial completo,
    // o cron noturno pode rodar full mode separado.
    // Quando consulta é de 1 dia "recente" (≤ 3 dias atrás), força fresh —
    // o cache de 24h pode estar com dados parciais do TOTVS sync que rodou
    // de manhã. Isso afeta o card "Faturamento de Ontem por Canal".
    const di = toYmd(datemin);
    const df = toYmd(datemax);
    const hojeIso = new Date().toISOString().slice(0, 10);
    const eumDiaSo = di === df;
    const diasAtras = Math.round(
      (new Date(hojeIso) - new Date(df)) / (1000 * 60 * 60 * 24),
    );
    const forcarFresh = eumDiaSo && diasAtras >= 0 && diasAtras <= 3;
    const url = forcarFresh
      ? `${INTERNAL_API_BASE}/api/crm/faturamento-por-segmento?lite=true&nocache=true`
      : `${INTERNAL_API_BASE}/api/crm/faturamento-por-segmento?lite=true`;
    const r = await axios.post(
      url,
      { datemin: di, datemax: df, lite: true, nocache: forcarFresh || undefined },
      // Timeout reduzido pra 60s — em lite mode não precisa varrer items.
      { timeout: 60000 },
    );
    const seg = r.data?.data?.segmentos || r.data?.segmentos || {};
    const out = { ...seg };
    // Canal virtual "fabrica" = showroom + novidadesfranquia
    out.fabrica = FABRICA_SOURCES.reduce((s, k) => s + Number(seg[k] || 0), 0);
    return out;
  } catch (e) {
    console.warn(
      `[forecast/promessa] getFaturamentoPorSegmento falhou (${toYmd(datemin)}~${toYmd(datemax)}): ${e?.message} — tentando fallback via canal-totals`,
    );
    // ─── FALLBACK: chama /canal-totals individualmente por canal e monta segMap.
    // É mais leve que o fat-seg (sem iteração per-NF) e mais resiliente.
    return getFaturamentoPorSegmentoViaCanalTotals(datemin, datemax);
  }
}

// Lista de canais usados no forecast/comparativo. Devem ser canais que
// /canal-totals suporta (CANAL_CONFIG no crm.routes.js).
// `useGross: true` → usa gross_invoice_value (sem subtrair devolução).
// Motivo: esses canais NÃO têm allowedSellers, então PASS 2 (SaleReturns)
// pega devolução de toda a empresa → over-subtraction → negativo/subestimado.
// fat-seg per-NF para esses retorna BRUTO; o fallback deve fazer o mesmo.
const FAT_SEG_CANAIS = [
  { mod: 'varejo', useGross: false },
  { mod: 'revenda', useGross: false },
  { mod: 'multimarcas', useGross: false },
  { mod: 'inbound_david', useGross: false },
  { mod: 'inbound_rafael', useGross: false },
  { mod: 'franquia', useGross: false }, // sempre full mode, líquido = bruto − credev − Recife Mall
  { mod: 'business', useGross: true }, // sem allowedSellers
  { mod: 'bazar', useGross: true }, // skipDevolucao já protege, mas keep gross pra consistência
  { mod: 'showroom', useGross: true }, // sem allowedSellers
  { mod: 'novidadesfranquia', useGross: true }, // sem allowedSellers
  { mod: 'ricardoeletro', useGross: true }, // skipDevolPass2 protege, gross é consistente
];

async function getFaturamentoPorSegmentoViaCanalTotals(datemin, datemax) {
  const di = toYmd(datemin);
  const df = toYmd(datemax);
  try {
    const calls = await Promise.all(
      FAT_SEG_CANAIS.map(async ({ mod, useGross }) => {
        try {
          // lite=true → pula PASS 0 (credev em payments, full FIS_NFITEMPROD
          // scan). Mantém bruto + returns + exclusão Recife Mall. Líquido fica
          // levemente inflado (sem subtrair credev em payments, ~1-3% pra
          // varejo/revenda/multimarcas), mas o ganho de performance evita
          // bloqueio TOTVS e timeouts no /promessa-semanal|mensal e comparativo.
          const r = await axios.post(
            `${INTERNAL_API_BASE}/api/crm/canal-totals?lite=true`,
            { datemin: di, datemax: df, modulo: mod, lite: true },
            { timeout: 120000 },
          );
          const d = r.data?.data || r.data;
          // Usa gross pra canais sem allowedSellers (evita devol over-subtraction).
          // Para canais com allowedSellers, o líquido é confiável.
          const liquido = Number(d?.invoice_value ?? 0);
          const bruto = Number(d?.gross_invoice_value ?? 0);
          // Estratégia:
          //   - useGross=true → sempre bruto (clamp 0)
          //   - useGross=false → líquido se > 0; se <= 0 (devol > venda no período,
          //     comum em inbound_david/inbound_rafael), usa bruto como floor
          //     pra não zerar o canal (evita "Valores zerados" na Promessa Semanal)
          let valor;
          if (useGross) {
            valor = Math.max(0, bruto || liquido);
          } else if (liquido > 0) {
            valor = liquido;
          } else if (bruto > 0) {
            console.warn(
              `[fat-seg fallback ${mod}] líquido=R$${liquido.toFixed(2)} ≤ 0 → usa bruto R$${bruto.toFixed(2)}`,
            );
            valor = bruto;
          } else {
            valor = 0;
          }
          return [mod, valor];
        } catch (err) {
          console.warn(
            `[fat-seg fallback] canal ${mod} falhou: ${err.message}`,
          );
          return [mod, 0];
        }
      }),
    );
    const seg = Object.fromEntries(calls);
    // Canal virtual "fabrica" = showroom + novidadesfranquia
    seg.fabrica = FABRICA_SOURCES.reduce((s, k) => s + Number(seg[k] || 0), 0);
    const total = Object.values(seg).reduce((s, v) => s + Number(v || 0), 0);
    if (total === 0) {
      console.warn(
        `[fat-seg fallback] todos os canais retornaram 0 — pode ser TOTVS indisponível`,
      );
      return null; // indica falha total
    }
    console.log(
      `[fat-seg fallback] ${di}~${df}: monteg segMap via canal-totals (total=R$${total.toFixed(2)})`,
    );
    return seg;
  } catch (err) {
    console.warn(`[fat-seg fallback] erro fatal: ${err.message}`);
    return null;
  }
}

// Carrega metas de forecast_canal_metas
// Retorna mapa { canal_key: valor_meta }
async function getMetasPorCanal(period_type, period_key) {
  const { data, error } = await supabase
    .from('forecast_canal_metas')
    .select('canal, valor_meta')
    .eq('period_type', period_type)
    .eq('period_key', period_key);
  if (error) return new Map();
  return new Map(
    (data || []).map((m) => [
      String(m.canal).toLowerCase(),
      Number(m.valor_meta || 0),
    ]),
  );
}

// ═══════════════════════════════════════════════════════════════
// ROTA: Semana atual (helper para o front)
// ═══════════════════════════════════════════════════════════════
router.get(
  '/promessa-semanal/semana-atual',
  asyncHandler(async (req, res) => {
    // Semana ISO em curso (segunda → domingo correntes)
    const { ano, semana } = getIsoWeek(new Date());
    const range = isoWeekRange(ano, semana);
    return successResponse(res, { ano, semana, ...range });
  }),
);

// ═══════════════════════════════════════════════════════════════
// GET /forecast/ontem-canal
// Faturamento de ONTEM por canal — direto do TOTVS (sale-panel via
// canais-totals-all em modo lite). NÃO usa Supabase notas_fiscais.
// Cache TTL 5min — força fresh em consultas recentes.
// ═══════════════════════════════════════════════════════════════
router.get(
  '/ontem-canal',
  asyncHandler(async (req, res) => {
    const hoje = new Date();
    // Ontem útil: D-1, pulando domingo (vira sábado)
    const ontem = new Date(hoje);
    ontem.setUTCDate(ontem.getUTCDate() - 1);
    while (ontem.getUTCDay() === 0) {
      ontem.setUTCDate(ontem.getUTCDate() - 1);
    }
    const diaIso = ontem.toISOString().slice(0, 10);

    let segs = {};
    try {
      const r = await axios.post(
        `${INTERNAL_API_BASE}/api/crm/canais-totals-all?lite=true&nocache=true`,
        { datemin: diaIso, datemax: diaIso, lite: true },
        { timeout: 180000 },
      );
      const d = r.data?.data || r.data || {};
      segs = d.segmentos || {};
    } catch (e) {
      console.warn(`[forecast/ontem-canal] TOTVS falhou: ${e.message}`);
      return errorResponse(
        res,
        `TOTVS indisponível: ${e.message}`,
        503,
        'TOTVS_UNAVAILABLE',
      );
    }

    // Canal virtual "fabrica" = showroom + novidadesfranquia
    const fabrica = FABRICA_SOURCES.reduce(
      (s, k) => s + Number(segs[k] || 0),
      0,
    );

    // Lista de canais ordenada — usa o mesmo CANAIS do /promessa-semanal
    // pra UI ficar consistente. Mapeia fat_dia_anterior por canal_key.
    const CANAIS_OUT = [
      { key: 'varejo',         label: 'Varejo' },
      { key: 'revenda',        label: 'Revenda' },
      { key: 'multimarcas',    label: 'Multimarcas' },
      { key: 'inbound_david',  label: 'MTM Inbound David' },
      { key: 'inbound_rafael', label: 'MTM Inbound Rafael' },
      { key: 'franquia',       label: 'Franquia' },
      { key: 'business',       label: 'Business' },
      { key: 'bazar',          label: 'Bazar' },
      { key: 'fabrica',        label: 'Fábrica (Kleiton)' },
      { key: 'ricardoeletro',  label: 'Ricardo Eletro' },
    ];
    const canais = CANAIS_OUT.map((c) => {
      const valor = c.key === 'fabrica' ? fabrica : Number(segs[c.key] || 0);
      return {
        canal_key: c.key,
        nome: c.label,
        fat_dia_anterior: Math.round(valor * 100) / 100,
        is_quantity: false,
      };
    });

    const total = canais.reduce((a, c) => a + c.fat_dia_anterior, 0);
    return successResponse(res, {
      dia_anterior: diaIso,
      canais,
      total: { fat_dia_anterior: Math.round(total * 100) / 100 },
      source: 'totvs-sale-panel-direct',
    });
  }),
);

// ═══════════════════════════════════════════════════════════════
// GET /forecast/promessa-semanal?ano=&semana=
// Lê metas da forecast_canal_metas (period_type='semanal', period_key='YYYY-Www')
// ═══════════════════════════════════════════════════════════════
router.get(
  '/promessa-semanal',
  asyncHandler(async (req, res) => {
    const hoje = new Date();
    // Default: semana corrente (ISO em curso) — visão operacional do dia a dia
    const cur = getIsoWeek(hoje);
    const ano = parseInt(req.query.ano, 10) || cur.ano;
    const semana = parseInt(req.query.semana, 10) || cur.semana;
    // until_today=true → REAL acumulado vai até HOJE (visão "ao vivo");
    //                    se omitido/false → até ONTEM (D-1, default).
    const untilToday =
      req.query.until_today === 'true' || req.query.until_today === '1';

    const { data_inicio, data_fim } = isoWeekRange(ano, semana);
    const wKey = weekKey(ano, semana);

    // Dias úteis (seg-sáb) da semana (uso geral)
    const startDate = new Date(`${data_inicio}T12:00:00Z`);
    const endDate = new Date(`${data_fim}T12:00:00Z`);
    const diasUteisTotal = diasUteisRangeMonSat(startDate, endDate);
    const refDecorr = hoje < endDate ? hoje : endDate;
    const diasUteisDecorridos =
      refDecorr < startDate ? 0 : diasUteisRangeMonSat(startDate, refDecorr);

    // Dias decorridos POR CANAL para Qnt Deveria
    //   - Varejo: conta do domingo anterior à segunda da ISO até ontem (Sun-Sat)
    //   - Demais: conta da segunda da ISO até ontem (Mon-Sat)
    //   - Cap em 6 (para semana já encerrada o Qnt Deveria = meta)
    //   - Ontem = hoje - 1 (independe da semana exibida)
    const ontem = new Date(hoje);
    ontem.setUTCDate(ontem.getUTCDate() - 1);
    ontem.setUTCHours(12, 0, 0, 0);
    const opEndSat = new Date(endDate);
    opEndSat.setUTCDate(opEndSat.getUTCDate() - 1); // Sábado da ISO week
    function diasDecorridosCanal(canalKey) {
      const start = new Date(startDate);
      if (canalKey === 'varejo') start.setUTCDate(start.getUTCDate() - 1); // Domingo prev
      if (ontem < start) return 0;
      const end = ontem > opEndSat ? opEndSat : ontem;
      let n = 0;
      const cur = new Date(start);
      while (cur <= end) {
        const dow = cur.getUTCDay();
        // Varejo conta todos os dias; demais pulam domingo
        if (canalKey === 'varejo' || dow !== 0) n += 1;
        cur.setUTCDate(cur.getUTCDate() + 1);
      }
      return Math.min(n, 6);
    }

    // "Dia anterior" = ontem em relação a HOJE (sempre).
    // Independe da semana exibida — representa "o que fechou ontem" para o
    // operador. Pula domingos para usar o último dia útil (seg-sáb).
    // Reaproveita `ontem` já declarado acima (linha ~306), mas faz cópia com
    // rollback de domingo (sem mutar a original usada por diasDecorridosCanal).
    const ontemDiaAnterior = new Date(ontem);
    while (ontemDiaAnterior.getUTCDay() === 0) {
      ontemDiaAnterior.setUTCDate(ontemDiaAnterior.getUTCDate() - 1);
    }
    const diaAnteriorIso = ontemDiaAnterior.toISOString().slice(0, 10);

    // Para o REAL acumulado:
    //  - default (untilToday=false): até ONTEM (D-1) — dados fechados
    //  - untilToday=true: até HOJE — visão ao vivo (TOTVS)
    const hojeIso = hoje.toISOString().slice(0, 10);
    const refDate = untilToday ? hoje : ontemDiaAnterior;
    const refIso = untilToday ? hojeIso : diaAnteriorIso;
    const realDateMax = refDate < endDate ? refIso : data_fim;
    const datemin = data_inicio;
    const datemax = realDateMax;

    // Buscar tudo em paralelo
    const refMesAno = endDate.getUTCFullYear();
    const refMesNum = endDate.getUTCMonth() + 1;
    const mKey = monthKey(refMesAno, refMesNum);

    const [metasSemana, metasMes, fatSemana, fatDiaAnt, bcSemana, bcDiaAnt] =
      await Promise.all([
        getMetasPorCanal('semanal', wKey),
        getMetasPorCanal('mensal', mKey),
        getFaturamentoPorSegmento(datemin, datemax),
        diaAnteriorIso
          ? getFaturamentoPorSegmento(diaAnteriorIso, diaAnteriorIso)
          : Promise.resolve(null),
        // BlueCard — quantitativo
        fetchBlueCardSentCount(datemin, datemax),
        diaAnteriorIso
          ? fetchBlueCardSentCount(diaAnteriorIso, diaAnteriorIso)
          : Promise.resolve(0),
      ]);

    // Aplica exclusões (ex: Recife Mall fora de Franquia a partir de 21/05)
    await aplicarExclusoesForecast(fatSemana, datemin, datemax);
    if (fatDiaAnt && diaAnteriorIso) {
      await aplicarExclusoesForecast(fatDiaAnt, diaAnteriorIso, diaAnteriorIso);
    }

    const diasUteisMes = diasUteisDoMes(refMesAno, refMesNum);

    const canaisOut = CANAIS.map((c) => {
      const meta = metasSemana.get(c.key) || 0;
      const real = Number((fatSemana || {})[c.key] || 0);
      const fatAnt = Number((fatDiaAnt || {})[c.key] || 0);
      const pct = meta > 0 ? (real / meta) * 100 : 0;

      // Qnt Deveria = meta × min(dias_decorridos, 6) / 6
      // Varejo: dom-sáb / Demais: seg-sáb
      const diasCanal = diasDecorridosCanal(c.key);
      const qntDeveria = (meta * diasCanal) / 6;

      const forecastMensal = metasMes.get(c.key) || 0;
      const metaDoDia =
        forecastMensal > 0 && diasUteisMes > 0
          ? forecastMensal / diasUteisMes
          : diasUteisTotal > 0
            ? meta / diasUteisTotal
            : 0;

      return {
        canal_key: c.key,
        nome: c.label,
        meta_realista: meta,
        faturamento_real: real,
        qnt_deveria: Number(qntDeveria.toFixed(2)),
        meta_do_dia: Number(metaDoDia.toFixed(2)),
        fat_dia_anterior: Number(fatAnt.toFixed(2)),
        percentual: Number(pct.toFixed(2)),
        dias_decorridos_canal: diasCanal,
      };
    });

    const total = canaisOut.reduce(
      (acc, r) => {
        acc.meta_realista += r.meta_realista;
        acc.faturamento_real += r.faturamento_real;
        acc.qnt_deveria += r.qnt_deveria;
        acc.meta_do_dia += r.meta_do_dia;
        acc.fat_dia_anterior += r.fat_dia_anterior;
        return acc;
      },
      {
        meta_realista: 0,
        faturamento_real: 0,
        qnt_deveria: 0,
        meta_do_dia: 0,
        fat_dia_anterior: 0,
      },
    );
    total.percentual =
      total.meta_realista > 0
        ? Number(
            ((total.faturamento_real / total.meta_realista) * 100).toFixed(2),
          )
        : 0;

    // ─── BlueCard — quantidade de cartões (unidade: "cartões", NÃO R$) ─────
    // Vai DEPOIS do total porque não soma no total monetário.
    // Mantém mesmas chaves dos demais canais para compatibilidade visual.
    const bluecardMetaSem = metasSemana.get('bluecard') || 0;
    const bluecardMetaMes = metasMes.get('bluecard') || 0;
    const bluecardDiasCanal = Math.min(diasUteisDecorridos, 6); // segue regra "demais"
    const bluecardQntDeveria = (bluecardMetaSem * bluecardDiasCanal) / 6;
    const bluecardMetaDia =
      bluecardMetaMes > 0 && diasUteisMes > 0
        ? bluecardMetaMes / diasUteisMes
        : diasUteisTotal > 0
          ? bluecardMetaSem / diasUteisTotal
          : 0;
    const bluecardPct =
      bluecardMetaSem > 0 ? (bcSemana / bluecardMetaSem) * 100 : 0;
    canaisOut.push({
      canal_key: 'bluecard',
      nome: 'BlueCard',
      is_quantity: true,
      unit: 'cartões',
      meta_realista: bluecardMetaSem,
      faturamento_real: bcSemana,
      qnt_deveria: Number(bluecardQntDeveria.toFixed(2)),
      meta_do_dia: Number(bluecardMetaDia.toFixed(2)),
      fat_dia_anterior: bcDiaAnt,
      percentual: Number(bluecardPct.toFixed(2)),
      dias_decorridos_canal: bluecardDiasCanal,
    });

    return successResponse(res, {
      ano,
      semana_iso: semana,
      data_inicio,
      data_fim,
      dia_anterior: diaAnteriorIso,
      dias_uteis_total: diasUteisTotal,
      dias_uteis_decorridos: diasUteisDecorridos,
      period_key: wKey,
      mes_referencia: {
        ano: refMesAno,
        mes: refMesNum,
        period_key: mKey,
        dias_uteis: diasUteisMes,
      },
      canais: canaisOut,
      total,
    });
  }),
);

// ═══════════════════════════════════════════════════════════════
// GET /forecast/promessa-vendedores?ano=&semana=
// Retorna detalhamento por vendedor (B2R e B2M), com:
//   - meta_por_vendedor = meta_canal_semana / N vendedores listados
//   - real_por_vendedor = faturamento per_seller do canal
//   - "extras" = vendedores com realizado mas sem meta cadastrada (ex: Jucelino)
//   - David: rebatido no card B2M com sua meta própria (inbound_david)
// ═══════════════════════════════════════════════════════════════
// Configuração dos cards por vendedor.
//   nome = "match" usado pra encontrar no per_seller do TOTVS (substring case-insensitive)
//   nomeExibicao = como aparece na UI (default = nome)
//   Use o NOME REAL como está no TOTVS (ex: CLEYTON, não CLEITON).
const VENDEDORES_CARDS = [
  {
    code: 'B2R',
    label: 'B2R',
    canal: 'revenda',
    titulares: [
      { nome: 'CLEYTON', label: 'Cleiton' },
      { nome: 'MICHEL', label: 'Michel' },
      { nome: 'YAGO', label: 'Yago' },
    ],
  },
  {
    code: 'B2M',
    label: 'B2M',
    canal: 'multimarcas',
    titulares: [
      { nome: 'RENATO', label: 'Renato' },
      { nome: 'WALTER', label: 'Walter' },
      { nome: 'ARTHUR', label: 'Arthur' },
    ],
    // Vendedores "convidados": cada um puxa meta + faturamento de OUTRO canal
    convidados: [
      {
        nome: 'RAFAEL',
        label: 'Rafael',
        canalMeta: 'inbound_rafael',
        canalFat: 'inbound_rafael',
      },
      {
        nome: 'DAVID',
        label: 'David',
        canalMeta: 'inbound_david',
        canalFat: 'inbound_david',
      },
    ],
  },
];

async function getPerSeller(modulo, datemin, datemax) {
  try {
    // Usa /canal-totals (TOTVS Analytics live) — MESMA fonte do CRM → Performance
    // para multimarcas/revenda/inbound_david/inbound_rafael (CRMVendas.jsx linha 378).
    // - per_seller: vendedor por NF (dealer principal), sem rateio por item.
    // - Reflete o painel oficial do TOTVS.
    const r = await axios.post(
      `${INTERNAL_API_BASE}/api/crm/canal-totals`,
      { datemin: toYmd(datemin), datemax: toYmd(datemax), modulo },
      { timeout: 180000 },
    );
    const d = r.data?.data || r.data;
    return d?.per_seller || d?.totals?.per_seller || [];
  } catch (e) {
    console.warn(
      `[forecast/vendedores] per_seller(${modulo}) falhou:`,
      e?.message,
    );
    return [];
  }
}

function findSellerFat(perSeller, nome) {
  const target = String(nome).toUpperCase().trim();
  for (const s of perSeller || []) {
    const sname = String(s.seller_name || s.name || '').toUpperCase();
    if (sname.includes(target)) {
      // Realizado por vendedor = LÍQUIDO (bruto − credev).
      const bruto =
        Number(
          s.invoice_value ??
            s.faturamento_liquido ??
            s.liquido ??
            s.total_liquido ??
            s.total ??
            0,
        ) || 0;
      const credev = Number(s.credev_value || 0);
      return Math.max(0, bruto - credev);
    }
  }
  return 0;
}

router.get(
  '/promessa-vendedores',
  asyncHandler(async (req, res) => {
    const hoje = new Date();
    const cur = getIsoWeek(hoje);
    const ano = parseInt(req.query.ano, 10) || cur.ano;
    const semana = parseInt(req.query.semana, 10) || cur.semana;
    // until_today=true → REAL vai até HOJE; senão até ONTEM (D-1, default)
    const untilToday =
      req.query.until_today === 'true' || req.query.until_today === '1';

    const { data_inicio, data_fim } = isoWeekRange(ano, semana);
    const wKey = weekKey(ano, semana);

    // Para o REAL: cap em (hoje|ontem) se semana corrente/futura
    const endDate = new Date(`${data_fim}T12:00:00Z`);
    const ontem = new Date(hoje);
    ontem.setUTCDate(ontem.getUTCDate() - 1);
    while (ontem.getUTCDay() === 0) ontem.setUTCDate(ontem.getUTCDate() - 1);
    const refDate = untilToday ? hoje : ontem;
    const realDateMax =
      refDate < endDate ? refDate.toISOString().slice(0, 10) : data_fim;
    const datemin = data_inicio;
    const datemax = realDateMax;

    const metasSemana = await getMetasPorCanal('semanal', wKey);

    // Fonte OFICIAL: painel de vendedores do TOTVS (mesma do relatório). Todos os
    // vendedores do canal, todas as filiais do canal, só ops do canal. Sem cálculo
    // próprio de credev — o seller_sale_value já é o Vl. Faturado.
    const cards = await Promise.all(
      VEND_MENSAL_GROUPS.map(async (g) => {
        const liquidos = await buildVendedoresLiquido(g, datemin, datemax);
        const meta = g.metaCanais.reduce(
          (a, k) => a + (metasSemana.get(k) || 0),
          0,
        );
        // Promessa por vendedor = meta_canal / N (rateio igual entre os titulares).
        // Mantém a soma das promessas igual à meta do canal (sem arredondamento
        // perdendo centavos no total).
        const N = Math.max(1, liquidos.length);
        const metaPorVend = meta / N;
        const vendedores = liquidos.map((v) => {
          const metaV = Math.round(metaPorVend * 100) / 100;
          return {
            seller_code: v.seller_code,
            nome: v.nome,
            meta: metaV,
            bruto: v.bruto,
            credev: v.credev,
            real: v.real,
            percentual:
              metaV > 0 ? Number(((v.real / metaV) * 100).toFixed(2)) : 0,
          };
        });
        const totalReal = vendedores.reduce((a, v) => a + v.real, 0);
        return {
          code: g.code,
          label: `Prometido ${g.code} - Semana ${semana}`,
          canal: g.code,
          meta_canal: Math.round(meta * 100) / 100,
          vendedores,
          extras: [],
          total: {
            meta: Math.round(meta * 100) / 100,
            real: Math.round(totalReal * 100) / 100,
            percentual:
              meta > 0 ? Number(((totalReal / meta) * 100).toFixed(2)) : 0,
          },
        };
      }),
    );

    return successResponse(res, {
      ano,
      semana_iso: semana,
      data_inicio,
      data_fim,
      period_key: wKey,
      fonte: 'painel-oficial-totvs',
      cards,
    });
  }),
);

// ═══════════════════════════════════════════════════════════════
// GET /forecast/vendedores-mensal?ano=&mes=&until_today=
// Faturamento por vendedor MENSAL — TODOS os vendedores de revenda/multimarcas.
// Estratégia "soma das semanas": fatia o mês em pedaços alinhados à semana
// (recortados ao mês), puxa per_seller LEVE de cada pedaço e soma por vendedor.
// Evita a varredura única do mês (pesada e instável). Cada pedaço é cacheado.
// ═══════════════════════════════════════════════════════════════
const VEND_MENSAL_CACHE = new Map();
const VEND_MENSAL_INFLIGHT = new Map();
const VEND_MENSAL_TTL_REALTIME = 60 * 60 * 1000; // 1h
const VEND_MENSAL_TTL_PAST = 24 * 60 * 60 * 1000; // 24h

// Concorrência limitada (não sobrecarrega o TOTVS): processa N tarefas por vez.
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let idx = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (idx < items.length) {
        const i = idx++;
        results[i] = await fn(items[i], i);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

// Operações de VENDA usadas pelo painel oficial do TOTVS (sale-panel/sellers)
// para as filiais "especiais" (inclui a 99). Mesma lista do painelVendas.js —
// é a base do relatório oficial "Faturamento por Vendedor".
const SPECIAL_OPERATIONS_99 = [
  1, 2, 55, 510, 511, 1511, 521, 1521, 522, 960, 9001, 9009, 9027, 9017,
  9400, 9401, 9402, 9403, 9404, 9005, 545, 546, 555, 548, 1210, 9405, 1205,
  1101, 9065, 9064, 9063, 9062, 9061, 9420, 9026, 9067, 7234, 7236, 7240,
  7241, 7242, 7235, 7237, 7254, 7259, 7255, 7243, 7245, 7244,
  5919, // adicionada em 2026-06 — entra no Forecast (Métricas Diárias) por vendedor
];

// Grupos de canais da tabela mensal (todos os vendedores de cada grupo)
const VEND_MENSAL_GROUPS = [
  {
    code: 'B2R',
    label: 'B2R (Revenda)',
    metaCanais: ['revenda'],
    // ESCOPO = todas as filiais REVENDA (mesma base do canal-totals revenda).
    // Antes era só [99]; agora inclui 2/200 (JPA/PB), 5 (Nova Cruz), 75 (Lagoa
    // Center) — onde Felipe (251), Enri (94), Heyridan (15) etc também vendem.
    // Operations do canal revenda (não SPECIAL_OPS_99 que é amplo demais).
    branchs: [2, 5, 75, 99, 200],
    operations: [7236, 9122, 5102, 7242, 9061, 9001, 9121, 512],
    // Time B2R — exclui vendedores que não são do canal (Geral, Khristianna, etc.)
    sellers: [25, 15, 161, 165, 241, 779, 288, 251, 131, 94, 1924, 7044],
    // Revenda (varejo): credev = vale-troca usado em pagamento.
    credevTipo: 'payments',
  },
  {
    code: 'B2M',
    label: 'B2M (Multimarcas)',
    metaCanais: ['multimarcas', 'inbound_david', 'inbound_rafael'],
    branchs: [99],
    operations: SPECIAL_OPERATIONS_99,
    // Multimarcas (atacado): credev = DEVOLUÇÃO real (SaleReturns), não vale-troca.
    credevTipo: 'returns',
    // Time B2M — Renato, Walter, Arthur, David, Rafael, Thalis(inativo)
    sellers: [65, 177, 259, 26, 21, 69],
  },
];

// Busca faturamento BRUTO por vendedor no painel OFICIAL do TOTVS
// (sale-panel/sellers — campo seller_sale_value). Consulta leve.
async function getSellersOficial(branchs, operations, datemin, datemax) {
  try {
    const r = await axios.post(
      `${INTERNAL_API_BASE}/api/totvs/sale-panel/sellers-canal`,
      { branchs, operations, datemin: toYmd(datemin), datemax: toYmd(datemax) },
      { timeout: 180000 },
    );
    const d = r.data?.data || r.data;
    return Array.isArray(d?.sellers) ? d.sellers : [];
  } catch (e) {
    console.warn(`[getSellersOficial] falhou: ${e?.message}`);
    return [];
  }
}

// Credev (vale-troca em pagamento) por vendedor. O payments NÃO está no Supabase,
// então a única fonte é o canal-totals (per_seller.credev_value), que lê a API
// fiscal do TOTVS. Soma o credev_value por seller_code somando os canais do grupo.
// Retorna mapa { seller_code(string): valor }.
// Fatia [datemin,datemax] em pedaços alinhados à semana (terminam no domingo),
// pra cada canal-totals ser LEVE (varredura de ≤7 dias) e cacheável. Range curto
// (≤8 dias) vira 1 pedaço só.
function chunkPorSemana(datemin, datemax) {
  const start = new Date(`${toYmd(datemin)}T12:00:00Z`);
  const end = new Date(`${toYmd(datemax)}T12:00:00Z`);
  const chunks = [];
  let cur = new Date(start);
  while (cur <= end) {
    const dow = cur.getUTCDay() || 7; // 1=seg..7=dom
    const sunday = new Date(cur);
    sunday.setUTCDate(cur.getUTCDate() + (7 - dow));
    const chunkEnd = sunday < end ? sunday : end;
    chunks.push({ start: cur.toISOString().slice(0, 10), end: chunkEnd.toISOString().slice(0, 10) });
    cur = new Date(chunkEnd);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return chunks;
}

async function getCredevVendedor(branchs, operations, datemin, datemax, tipo = 'payments') {
  // Credev por vendedor via endpoint dedicado /credev-por-vendedor.
  // tipo='payments' (vale-troca, B2R) | 'returns' (devolução real, B2M).
  // UMA chamada por semana pra o escopo inteiro. Soma por seller_code.
  const out = {};
  const chunks = chunkPorSemana(datemin, datemax);
  for (const ch of chunks) {
    try {
      const r = await axios.post(
        `${INTERNAL_API_BASE}/api/crm/credev-por-vendedor`,
        { branchs, operations, datemin: ch.start, datemax: ch.end, tipo },
        { timeout: 200000 },
      );
      const d = r.data?.data || r.data;
      for (const [code, val] of Object.entries(d?.credev || {})) {
        out[String(code)] = (out[String(code)] || 0) + (Number(val) || 0);
      }
    } catch (e) {
      console.warn(`[getCredevVendedor ${ch.start}~${ch.end}] falhou: ${e?.message}`);
    }
  }
  return out;
}

// Monta a lista de vendedores LÍQUIDA de um grupo: bruto (painel oficial) −
// credev (canal-totals per_seller), filtrando só os vendedores do time (g.sellers).
async function buildVendedoresLiquido(g, datemin, datemax) {
  // LÍQUIDO por vendedor = faturamento BRUTO (painel oficial, seller_sale_value)
  // − credev (vale-troca, do canal-totals per_seller.credev_value).
  const [sellers, credevMap] = await Promise.all([
    getSellersOficial(g.branchs, g.operations, datemin, datemax),
    getCredevVendedor(g.branchs, g.operations, datemin, datemax, g.credevTipo),
  ]);
  const allow = new Set((g.sellers || []).map(Number));
  return sellers
    .filter((s) => allow.size === 0 || allow.has(Number(s.seller_code)))
    .map((s) => {
      const bruto = Number(s.value || 0);
      const credev = Number(credevMap[String(s.seller_code)] || 0);
      return {
        seller_code: String(s.seller_code),
        nome: s.seller_name || `Vend. ${s.seller_code}`,
        bruto: Math.round(bruto * 100) / 100,
        credev: Math.round(credev * 100) / 100,
        real: Math.max(0, Math.round((bruto - credev) * 100) / 100),
      };
    })
    .filter((v) => v.real > 0 || v.bruto > 0)
    .sort((a, b) => b.real - a.real);
}

router.get(
  '/vendedores-mensal',
  asyncHandler(async (req, res) => {
    const hoje = new Date();
    const ano = parseInt(req.query.ano, 10) || hoje.getUTCFullYear();
    const mes = parseInt(req.query.mes, 10) || hoje.getUTCMonth() + 1;
    const untilToday =
      req.query.until_today === 'true' || req.query.until_today === '1';

    const mKey = monthKey(ano, mes);
    const cacheKey = `${mKey}|${untilToday}`;
    const todayIso = hoje.toISOString().slice(0, 10);

    // Range efetivo do mês [01, min(fim do mês, ontem|hoje)]
    const monthStart = new Date(Date.UTC(ano, mes - 1, 1));
    const monthEnd = new Date(Date.UTC(ano, mes, 0));
    const ontem = new Date(hoje);
    ontem.setUTCDate(ontem.getUTCDate() - 1);
    while (ontem.getUTCDay() === 0) ontem.setUTCDate(ontem.getUTCDate() - 1);
    const refDate = untilToday ? hoje : ontem;
    let effEnd = monthEnd;
    if (refDate < monthEnd) effEnd = refDate; // mês corrente → parcial
    const ymd = (d) => d.toISOString().slice(0, 10);

    // Mês futuro / antes do início → vazio
    if (effEnd < monthStart) {
      return successResponse(res, {
        ano,
        mes,
        period_key: mKey,
        chunks: [],
        cards: VEND_MENSAL_GROUPS.map((g) => ({
          code: g.code,
          label: g.label,
          meta: 0,
          total: 0,
          percentual: 0,
          vendedores: [],
        })),
      });
    }

    const isPast = ymd(effEnd) < todayIso;
    const ttl = isPast ? VEND_MENSAL_TTL_PAST : VEND_MENSAL_TTL_REALTIME;
    const cached = VEND_MENSAL_CACHE.get(cacheKey);
    if (cached && Date.now() - cached.ts < ttl) {
      return successResponse(res, { ...cached.data, cached: true });
    }
    if (VEND_MENSAL_INFLIGHT.has(cacheKey)) {
      const data = await VEND_MENSAL_INFLIGHT.get(cacheKey);
      return successResponse(res, { ...data, coalesced: true });
    }

    const _run = (async () => {
      const metasMes = await getMetasPorCanal('mensal', mKey);
      const di = ymd(monthStart);
      const df = ymd(effEnd);

      // Uma chamada ao painel OFICIAL (bruto) + credev (Supabase) por grupo.
      // Líquido = bruto − credev. Leve e estável — sem fatiar em semanas.
      const cards = await Promise.all(
        VEND_MENSAL_GROUPS.map(async (g) => {
          const vendedores = await buildVendedoresLiquido(g, di, df);
          const total = vendedores.reduce((a, v) => a + v.real, 0);
          const meta = g.metaCanais.reduce((a, k) => a + (metasMes.get(k) || 0), 0);
          return {
            code: g.code,
            label: g.label,
            meta: Math.round(meta * 100) / 100,
            total: Math.round(total * 100) / 100,
            percentual: meta > 0 ? Number(((total / meta) * 100).toFixed(2)) : 0,
            vendedores,
          };
        }),
      );

      return {
        ano,
        mes,
        period_key: mKey,
        data_inicio: di,
        data_fim: df,
        fonte: 'painel-oficial-totvs',
        cards,
      };
    })();

    VEND_MENSAL_INFLIGHT.set(cacheKey, _run);
    try {
      const data = await _run;
      VEND_MENSAL_CACHE.set(cacheKey, { data, ts: Date.now() });
      if (VEND_MENSAL_CACHE.size > 30) {
        const oldest = [...VEND_MENSAL_CACHE.entries()].sort(
          (a, b) => a[1].ts - b[1].ts,
        )[0];
        VEND_MENSAL_CACHE.delete(oldest[0]);
      }
      return successResponse(res, data);
    } finally {
      VEND_MENSAL_INFLIGHT.delete(cacheKey);
    }
  }),
);

// ═══════════════════════════════════════════════════════════════
// GET /forecast/vendedores-db?periodo_tipo=mensal&periodo_key=2026-05
// Lê o faturamento por vendedor do SUPABASE (forecast_faturamento_vendedor) —
// instantâneo, SEM tocar no TOTVS. Fonte abastecida pelo sync/import.
// ═══════════════════════════════════════════════════════════════
router.get(
  '/vendedores-db',
  asyncHandler(async (req, res) => {
    const hoje = new Date();
    const periodo_tipo = req.query.periodo_tipo === 'semanal' ? 'semanal' : 'mensal';
    let periodo_key = req.query.periodo_key;
    if (!periodo_key) {
      if (periodo_tipo === 'mensal') {
        periodo_key = monthKey(hoje.getUTCFullYear(), hoje.getUTCMonth() + 1);
      } else {
        const cur = getIsoWeek(hoje);
        periodo_key = weekKey(cur.ano, cur.semana);
      }
    }
    let { data: rows, error } = await supabase
      .from('forecast_faturamento_vendedor')
      .select('grupo, seller_code, seller_name, bruto, credev, liquido, atualizado_em')
      .eq('periodo_tipo', periodo_tipo)
      .eq('periodo_key', periodo_key);
    if (error) return errorResponse(res, error.message, 500, 'DB_ERROR');

    // Fallback inteligente: se período pedido não tem dados (ex: início do
    // mês quando ainda não importou), retorna o ÚLTIMO período disponível.
    let periodo_key_real = periodo_key;
    let fallback_aplicado = false;
    if (!rows || rows.length === 0) {
      const { data: ultimo } = await supabase
        .from('forecast_faturamento_vendedor')
        .select('periodo_key')
        .eq('periodo_tipo', periodo_tipo)
        .order('periodo_key', { ascending: false })
        .limit(1);
      if (ultimo && ultimo[0]?.periodo_key) {
        periodo_key_real = ultimo[0].periodo_key;
        fallback_aplicado = true;
        const fb = await supabase
          .from('forecast_faturamento_vendedor')
          .select('grupo, seller_code, seller_name, bruto, credev, liquido, atualizado_em')
          .eq('periodo_tipo', periodo_tipo)
          .eq('periodo_key', periodo_key_real);
        rows = fb.data || [];
      }
    }

    const metas = await getMetasPorCanal(periodo_tipo, periodo_key_real);
    const cards = VEND_MENSAL_GROUPS.map((g) => {
      const grp = (rows || []).filter((r) => r.grupo === g.code);
      const vendedores = grp
        .map((r) => ({
          seller_code: r.seller_code,
          nome: r.seller_name || `Vend. ${r.seller_code}`,
          bruto: Number(r.bruto || 0),
          credev: Number(r.credev || 0),
          real: Number(r.liquido || 0),
        }))
        .filter((v) => v.real > 0 || v.bruto > 0)
        .sort((a, b) => b.real - a.real);
      const total = vendedores.reduce((a, v) => a + v.real, 0);
      const meta = g.metaCanais.reduce((a, k) => a + (metas.get(k) || 0), 0);
      const atualizado_em = grp
        .map((r) => r.atualizado_em)
        .sort()
        .pop() || null;
      return {
        code: g.code,
        label: g.label,
        meta: Math.round(meta * 100) / 100,
        total: Math.round(total * 100) / 100,
        percentual: meta > 0 ? Number(((total / meta) * 100).toFixed(2)) : 0,
        atualizado_em,
        vendedores,
      };
    });
    return successResponse(res, {
      periodo_tipo,
      periodo_key: periodo_key_real,
      periodo_key_solicitado: periodo_key,
      fallback_aplicado,
      fonte: 'supabase',
      cards,
    });
  }),
);

// ═══════════════════════════════════════════════════════════════
// GET /forecast/comparativo-anual?ano=&mes=
// Compara faturamento por canal entre mesmo mês de 2 anos consecutivos
// Canais alinhados com a planilha do gerente (B2M, B2R, B2C, RE, Showroom, Bazar)
// ═══════════════════════════════════════════════════════════════
// Canais do Comparativo. Campo opcional `sources` lista os canais do segMap
// que devem ser somados para formar o valor exibido (canal virtual).
// Se ausente, usa `key` direto.
const COMPARATIVO_CANAIS = [
  {
    key: 'b2m_total',
    label: 'B2M',
    sources: ['multimarcas', 'inbound_rafael', 'inbound_david'],
  }, // B2M = Multimarcas + Inbound David + Inbound Rafael
  { key: 'revenda', label: 'B2R' },
  { key: 'varejo', label: 'B2C' },
  { key: 'ricardoeletro', label: 'Ricardo Eletro' },
  {
    key: 'fabrica',
    label: 'Fábrica (Kleiton)',
    sources: ['showroom', 'novidadesfranquia'],
  }, // ops 7254, 7007, 7255
  { key: 'franquia', label: 'Franquia' }, // Antes "B2L" — renomeado pra ficar consistente com Promessa Mensal/Semanal
  { key: 'business', label: 'Business' }, // Ops 7237, 7269, 7279, 7277 — venda corporativa
  { key: 'bazar', label: 'Bazar' },
];

// Helper: lê valores de referência fixos para um ano/mês.
// Canal virtual "fabrica" = showroom + novidadesfranquia (mesma agregação do
// /faturamento-por-segmento). Ambos componentes precisam estar na tabela ref
// (ou ao menos um deles); o que faltar é tratado como 0.
async function getRefValues(ano, mes) {
  const { data, error } = await supabase
    .from('forecast_comparativo_ref')
    .select('canal, valor_full, valor_acumulado, dia_acumulado')
    .eq('ano', ano)
    .eq('mes', mes);
  if (error) return new Map();
  const m = new Map();
  for (const r of data || []) {
    m.set(String(r.canal).toLowerCase(), {
      full: Number(r.valor_full || 0),
      acumulado: Number(r.valor_acumulado || 0),
      dia: r.dia_acumulado,
    });
  }
  // Canal virtual "fabrica" = showroom + novidadesfranquia
  if (!m.has('fabrica')) {
    const sr = m.get('showroom') || { full: 0, acumulado: 0, dia: null };
    const nv = m.get('novidadesfranquia') || {
      full: 0,
      acumulado: 0,
      dia: null,
    };
    m.set('fabrica', {
      full: Number((sr.full + nv.full).toFixed(2)),
      acumulado: Number((sr.acumulado + nv.acumulado).toFixed(2)),
      dia: sr.dia || nv.dia,
    });
  }
  // Canal virtual "b2m_total" = multimarcas + inbound_rafael + inbound_david
  if (!m.has('b2m_total')) {
    const mm = m.get('multimarcas') || { full: 0, acumulado: 0, dia: null };
    const ir = m.get('inbound_rafael') || { full: 0, acumulado: 0, dia: null };
    const id = m.get('inbound_david') || { full: 0, acumulado: 0, dia: null };
    m.set('b2m_total', {
      full: Number((mm.full + ir.full + id.full).toFixed(2)),
      acumulado: Number(
        (mm.acumulado + ir.acumulado + id.acumulado).toFixed(2),
      ),
      dia: mm.dia || ir.dia || id.dia,
    });
  }
  return m;
}

router.get(
  '/comparativo-anual',
  asyncHandler(async (req, res) => {
    const hoje = new Date();
    const anoAtual = parseInt(req.query.ano, 10) || hoje.getUTCFullYear();
    const mes = parseInt(req.query.mes, 10) || hoje.getUTCMonth() + 1;
    const anoAnt = anoAtual - 1;
    // until_today=true → REAL 2026 vai até HOJE; senão até ONTEM (D-1, default)
    const untilToday =
      req.query.until_today === 'true' || req.query.until_today === '1';

    const fmt = (y, m, d) =>
      `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const lastDayAnt = new Date(Date.UTC(anoAnt, mes, 0)).getUTCDate();
    const lastDayAtual = new Date(Date.UTC(anoAtual, mes, 0)).getUTCDate();

    // Período cheio do ano anterior
    const periodAntFull = {
      datemin: fmt(anoAnt, mes, 1),
      datemax: fmt(anoAnt, mes, lastDayAnt),
    };

    // Período acumulado: 1º → (hoje | ontem) cap em mês corrente
    let diaAcum;
    if (hoje.getUTCFullYear() === anoAtual && hoje.getUTCMonth() + 1 === mes) {
      // Mês corrente: até hoje (untilToday) ou ontem (D-1)
      diaAcum = untilToday
        ? hoje.getUTCDate()
        : Math.max(0, hoje.getUTCDate() - 1);
    } else if (
      hoje.getUTCFullYear() < anoAtual ||
      (hoje.getUTCFullYear() === anoAtual && hoje.getUTCMonth() + 1 < mes)
    ) {
      diaAcum = 0; // mês futuro — sem real
    } else {
      diaAcum = lastDayAtual; // mês passado
    }

    const periodAntAcum =
      diaAcum > 0
        ? {
            datemin: fmt(anoAnt, mes, 1),
            datemax: fmt(anoAnt, mes, Math.min(diaAcum, lastDayAnt)),
          }
        : null;
    const periodAtualReal =
      diaAcum > 0
        ? {
            datemin: fmt(anoAtual, mes, 1),
            datemax: fmt(anoAtual, mes, diaAcum),
          }
        : null;

    // Ano anterior vem da tabela de REFERÊNCIA (valores fixos cadastrados).
    // Ano atual vem do TOTVS (real do mês corrente).
    // BlueCard: ano anterior e atual vêm direto do ClickUp (dado histórico
    // presente lá; se a lista ainda não existia no período, retorna 0).
    const [refAnt, segAtualReal, bcAtual, bcAnt] = await Promise.all([
      getRefValues(anoAnt, mes),
      periodAtualReal
        ? getFaturamentoPorSegmento(
            periodAtualReal.datemin,
            periodAtualReal.datemax,
          )
        : Promise.resolve(null),
      periodAtualReal
        ? fetchBlueCardSentCount(
            periodAtualReal.datemin,
            periodAtualReal.datemax,
          )
        : Promise.resolve(0),
      periodAntAcum
        ? fetchBlueCardSentCount(periodAntAcum.datemin, periodAntAcum.datemax)
        : Promise.resolve(0),
    ]);

    // Aplica exclusões (ex: Recife Mall fora de Franquia a partir de 21/05)
    if (segAtualReal && periodAtualReal) {
      await aplicarExclusoesForecast(
        segAtualReal,
        periodAtualReal.datemin,
        periodAtualReal.datemax,
      );
    }

    // FRANQUIA: subtração de credev agora é feita dentro do /fat-seg, não duplica aqui.

    const canaisOut = COMPARATIVO_CANAIS.map((c) => {
      const ref = refAnt.get(c.key) || { full: 0, acumulado: 0, dia: null };
      const fat2024 = ref.full;
      const fat2024Acum = ref.acumulado;
      // Para canais virtuais (com `sources`), soma os canais da lista; senão usa key direta
      let fat2025Real;
      if (Array.isArray(c.sources) && c.sources.length > 0) {
        fat2025Real = c.sources.reduce(
          (s, src) => s + Number((segAtualReal || {})[src] || 0),
          0,
        );
      } else {
        fat2025Real = Number((segAtualReal || {})[c.key] || 0);
      }
      const diferenca = fat2024Acum - fat2025Real;
      const comparativo =
        fat2024Acum > 0
          ? (fat2025Real / fat2024Acum - 1) * 100
          : fat2025Real > 0
            ? 100
            : 0; // 100% se ano passado era 0 e este ano > 0
      return {
        canal_key: c.key,
        nome: c.label,
        fat_ano_anterior_full: Number(fat2024.toFixed(2)),
        fat_ano_anterior_acumulado: Number(fat2024Acum.toFixed(2)),
        fat_ano_atual_real: Number(fat2025Real.toFixed(2)),
        diferenca: Number(diferenca.toFixed(2)),
        comparativo_pct: Number(comparativo.toFixed(2)),
        dia_acumulado_ref: ref.dia,
      };
    });

    const total = canaisOut.reduce(
      (acc, r) => {
        acc.fat_ano_anterior_full += r.fat_ano_anterior_full;
        acc.fat_ano_anterior_acumulado += r.fat_ano_anterior_acumulado;
        acc.fat_ano_atual_real += r.fat_ano_atual_real;
        return acc;
      },
      {
        fat_ano_anterior_full: 0,
        fat_ano_anterior_acumulado: 0,
        fat_ano_atual_real: 0,
      },
    );
    total.diferenca = Number(
      (total.fat_ano_anterior_acumulado - total.fat_ano_atual_real).toFixed(2),
    );
    total.comparativo_pct =
      total.fat_ano_anterior_acumulado > 0
        ? Number(
            (
              (total.fat_ano_atual_real / total.fat_ano_anterior_acumulado -
                1) *
              100
            ).toFixed(2),
          )
        : 0;

    // ─── BlueCard — quantidade de cartões enviados (ano vs ano) ────────────
    // Para o "full" do ano anterior, usamos o mês inteiro do ano passado.
    const bcAntFull = await fetchBlueCardSentCount(
      periodAntFull.datemin,
      periodAntFull.datemax,
    );
    const bcDiferenca = bcAnt - bcAtual;
    const bcComparativoPct =
      bcAnt > 0 ? (bcAtual / bcAnt - 1) * 100 : bcAtual > 0 ? 100 : 0;
    canaisOut.push({
      canal_key: 'bluecard',
      nome: 'BlueCard',
      is_quantity: true,
      unit: 'cartões',
      fat_ano_anterior_full: bcAntFull,
      fat_ano_anterior_acumulado: bcAnt,
      fat_ano_atual_real: bcAtual,
      diferenca: bcDiferenca,
      comparativo_pct: Number(bcComparativoPct.toFixed(2)),
      dia_acumulado_ref: diaAcum,
    });

    return successResponse(res, {
      ano_atual: anoAtual,
      ano_anterior: anoAnt,
      mes,
      dia_referencia: diaAcum,
      periodo_anterior_full: periodAntFull,
      periodo_anterior_acumulado: periodAntAcum,
      periodo_atual_real: periodAtualReal,
      canais: canaisOut,
      total,
    });
  }),
);

// ═══════════════════════════════════════════════════════════════
// GET /forecast/promessa-mensal?ano=&mes=
// Lê metas da forecast_canal_metas (period_type='mensal', period_key='YYYY-MM')
// ═══════════════════════════════════════════════════════════════
router.get(
  '/promessa-mensal',
  asyncHandler(async (req, res) => {
    const hoje = new Date();
    const ano = parseInt(req.query.ano, 10) || hoje.getUTCFullYear();
    const mes = parseInt(req.query.mes, 10) || hoje.getUTCMonth() + 1;
    // until_today=true → REAL acumulado vai até HOJE; senão até ONTEM (D-1, default)
    const untilToday =
      req.query.until_today === 'true' || req.query.until_today === '1';

    const lastDay = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
    const data_inicio = `${ano}-${String(mes).padStart(2, '0')}-01`;
    const data_fim = `${ano}-${String(mes).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    const mKey = monthKey(ano, mes);

    // "Ontem" (D-1) — sempre, pula domingo
    const ontem = new Date(hoje);
    ontem.setUTCDate(ontem.getUTCDate() - 1);
    while (ontem.getUTCDay() === 0) {
      ontem.setUTCDate(ontem.getUTCDate() - 1);
    }
    const ontemIso = ontem.toISOString().slice(0, 10);
    const hojeIso = hoje.toISOString().slice(0, 10);
    // Data de referência: ontem (default) ou hoje (untilToday)
    const refIso = untilToday ? hojeIso : ontemIso;

    // Dia "FATURADO DO DIA" segue a mesma referência (hoje ou ontem)
    let diaIso = null;
    if (hoje.getUTCFullYear() === ano && hoje.getUTCMonth() + 1 === mes) {
      diaIso = refIso;
    } else if (
      hoje.getUTCFullYear() < ano ||
      (hoje.getUTCFullYear() === ano && hoje.getUTCMonth() + 1 < mes)
    ) {
      diaIso = null;
    } else {
      diaIso = data_fim;
    }

    // Para o REAL acumulado: 01/MM → refIso (hoje ou ontem conforme toggle)
    const realDateMax =
      hoje.getUTCFullYear() === ano && hoje.getUTCMonth() + 1 === mes
        ? refIso
        : hoje.getUTCFullYear() < ano ||
            (hoje.getUTCFullYear() === ano && hoje.getUTCMonth() + 1 < mes)
          ? null // mês futuro — sem dados
          : data_fim; // mês passado — usa fim do mês

    const diasUteisTotal = diasUteisDoMes(ano, mes);
    // Dias úteis decorridos: até HOJE (untilToday) ou ONTEM (D-1, default)
    const diasUteisDecorridos = diasUteisDecorridosNoMes(
      ano,
      mes,
      untilToday ? hoje : ontem,
    );

    const [metas, fatMes, fatDia, bcMes, bcDia] = await Promise.all([
      getMetasPorCanal('mensal', mKey),
      realDateMax
        ? getFaturamentoPorSegmento(data_inicio, realDateMax)
        : Promise.resolve(null),
      diaIso
        ? getFaturamentoPorSegmento(diaIso, diaIso)
        : Promise.resolve(null),
      realDateMax
        ? fetchBlueCardSentCount(data_inicio, realDateMax)
        : Promise.resolve(0),
      diaIso ? fetchBlueCardSentCount(diaIso, diaIso) : Promise.resolve(0),
    ]);

    // Aplica exclusões (ex: Recife Mall fora de Franquia a partir de 21/05)
    if (fatMes && realDateMax) {
      await aplicarExclusoesForecast(fatMes, data_inicio, realDateMax);
    }
    if (fatDia && diaIso) {
      await aplicarExclusoesForecast(fatDia, diaIso, diaIso);
    }

    const canaisOut = CANAIS.map((c) => {
      const meta = metas.get(c.key) || 0;
      const real = Number((fatMes || {})[c.key] || 0);
      const realDia = Number((fatDia || {})[c.key] || 0);

      const metaDoDia = diasUteisTotal > 0 ? meta / diasUteisTotal : 0;
      const qntDeveria = metaDoDia * diasUteisDecorridos;
      // Mensal: % = REAL / QNT DEVERIA
      const pct = qntDeveria > 0 ? (real / qntDeveria) * 100 : 0;

      return {
        canal_key: c.key,
        nome: c.label,
        meta_mensal: meta,
        forecast_mensal: meta, // meta == forecast (unificado)
        qnt_deveria: Number(qntDeveria.toFixed(2)),
        real_acumulado: Number(real.toFixed(2)),
        meta_do_dia: Number(metaDoDia.toFixed(2)),
        faturado_do_dia: Number(realDia.toFixed(2)),
        percentual: Number(pct.toFixed(2)),
      };
    });

    const total = canaisOut.reduce(
      (acc, r) => {
        acc.meta_mensal += r.meta_mensal;
        acc.forecast_mensal += r.forecast_mensal;
        acc.qnt_deveria += r.qnt_deveria;
        acc.real_acumulado += r.real_acumulado;
        acc.meta_do_dia += r.meta_do_dia;
        acc.faturado_do_dia += r.faturado_do_dia;
        return acc;
      },
      {
        meta_mensal: 0,
        forecast_mensal: 0,
        qnt_deveria: 0,
        real_acumulado: 0,
        meta_do_dia: 0,
        faturado_do_dia: 0,
      },
    );
    total.percentual =
      total.qnt_deveria > 0
        ? Number(((total.real_acumulado / total.qnt_deveria) * 100).toFixed(2))
        : 0;

    // ─── BlueCard — quantidade de cartões enviados no mês ──────────────────
    const bluecardMetaM = metas.get('bluecard') || 0;
    const bluecardMetaDiaM =
      diasUteisTotal > 0 ? bluecardMetaM / diasUteisTotal : 0;
    const bluecardQntDeveriaM = bluecardMetaDiaM * diasUteisDecorridos;
    const bluecardPctM =
      bluecardQntDeveriaM > 0 ? (bcMes / bluecardQntDeveriaM) * 100 : 0;
    canaisOut.push({
      canal_key: 'bluecard',
      nome: 'BlueCard',
      is_quantity: true,
      unit: 'cartões',
      meta_mensal: bluecardMetaM,
      forecast_mensal: bluecardMetaM,
      qnt_deveria: Number(bluecardQntDeveriaM.toFixed(2)),
      real_acumulado: bcMes,
      meta_do_dia: Number(bluecardMetaDiaM.toFixed(2)),
      faturado_do_dia: bcDia,
      percentual: Number(bluecardPctM.toFixed(2)),
    });

    return successResponse(res, {
      ano,
      mes,
      data_inicio,
      data_fim,
      dia_referencia: diaIso,
      dias_uteis_total: diasUteisTotal,
      dias_uteis_decorridos: diasUteisDecorridos,
      period_key: mKey,
      canais: canaisOut,
      total,
    });
  }),
);

// ═══════════════════════════════════════════════════════════════
// POST /forecast/send-whatsapp
// Envia um relatório (mensal/semanal/vendedores/comparativo) pra um número
// via crosbybot. O servidor monta o texto formatado.
// Body: { tipo, phone, ano?, mes?, semana? }
// ═══════════════════════════════════════════════════════════════
const MESES_NOMES = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
];

const fmtBRL = (v) =>
  `R$ ${Number(v || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

// Formata valor de um canal: R$ para monetário, "N un" para quantitativo
const fmtCanalVal = (canal, v) => {
  if (canal?.is_quantity) {
    return `${Math.round(Number(v || 0))} ${canal.unit || 'un'}`;
  }
  return fmtBRL(v);
};

const fmtPct = (v) => `${Number(v || 0).toFixed(0)}%`;

const arrowEmoji = (pct) => {
  if (pct >= 100) return '🟢';
  if (pct >= 70) return '🟡';
  return '🔴';
};

const arrowComp = (pct) => (pct >= 0 ? '🟢⬆️' : '🔴⬇️');

async function fetchInternal(path) {
  const r = await axios.get(`${INTERNAL_API_BASE}/api/forecast${path}`, {
    timeout: 180000,
  });
  return r.data?.data || r.data;
}

function buildTextoMensal(d) {
  const mes = MESES_NOMES[d.mes - 1];
  const lines = [];
  lines.push(`📊 *Promessa Mensal — ${mes}/${d.ano}*`);
  lines.push(`Dias úteis: ${d.dias_uteis_decorridos}/${d.dias_uteis_total}`);
  lines.push('');
  for (const c of d.canais || []) {
    if (!c.forecast_mensal && !c.real_acumulado) continue;
    lines.push(`${arrowEmoji(c.percentual)} *${c.nome}*`);
    lines.push(`   Forecast: ${fmtCanalVal(c, c.forecast_mensal)}`);
    lines.push(`   Real:     ${fmtCanalVal(c, c.real_acumulado)}`);
    lines.push(
      `   Qnt Dev.: ${fmtCanalVal(c, c.qnt_deveria)}  |  ${fmtPct(c.percentual)}`,
    );
    lines.push('');
  }
  const t = d.total || {};
  lines.push('━━━━━━━━━━━━━━━');
  lines.push(`*TOTAL*  ${arrowEmoji(t.percentual)}`);
  lines.push(`Forecast: ${fmtBRL(t.forecast_mensal)}`);
  lines.push(
    `Real:     ${fmtBRL(t.real_acumulado)}  (${fmtPct(t.percentual)})`,
  );
  return lines.join('\n');
}

function buildTextoSemanal(d) {
  const lines = [];
  lines.push(`📅 *Promessa Semanal — ${d.period_key}*`);
  lines.push(`Período: ${d.data_inicio} → ${d.data_fim}`);
  lines.push(`Dias úteis: ${d.dias_uteis_decorridos}/${d.dias_uteis_total}`);
  lines.push('');
  for (const c of d.canais || []) {
    if (!c.meta_realista && !c.faturamento_real) continue;
    lines.push(`${arrowEmoji(c.percentual)} *${c.nome}*`);
    lines.push(`   Meta:     ${fmtCanalVal(c, c.meta_realista)}`);
    lines.push(
      `   Real:     ${fmtCanalVal(c, c.faturamento_real)}  (${fmtPct(c.percentual)})`,
    );
    lines.push(`   Fat ontem: ${fmtCanalVal(c, c.fat_dia_anterior)}`);
    lines.push('');
  }
  const t = d.total || {};
  lines.push('━━━━━━━━━━━━━━━');
  lines.push(`*TOTAL*  ${arrowEmoji(t.percentual)}`);
  lines.push(`Meta:     ${fmtBRL(t.meta_realista)}`);
  lines.push(
    `Real:     ${fmtBRL(t.faturamento_real)}  (${fmtPct(t.percentual)})`,
  );
  return lines.join('\n');
}

function buildTextoVendedores(d) {
  const lines = [];
  lines.push(`👥 *Detalhe por Vendedor — Semana ${d.semana_iso}*`);
  lines.push('');
  for (const card of d.cards || []) {
    lines.push(`*${card.label}*`);
    for (const v of card.vendedores || []) {
      // Realizado por vendedor (painel oficial). Meta é só no total do canal.
      lines.push(`• ${v.nome}: ${fmtBRL(v.real)}`);
    }
    for (const e of card.extras || []) {
      lines.push(`   ${e.nome}: ${fmtBRL(e.real)} (extra)`);
    }
    const t = card.total || {};
    lines.push(
      `*Total:* ${fmtBRL(t.real)} / ${fmtBRL(t.meta)}  (${fmtPct(t.percentual)})`,
    );
    lines.push('');
  }
  return lines.join('\n');
}

function buildTextoComparativo(d) {
  const lines = [];
  lines.push(`📈 *Comparativo ${d.ano_anterior} × ${d.ano_atual}*`);
  lines.push(
    `${MESES_NOMES[d.mes - 1]}/${d.ano_atual} (até dia ${d.dia_referencia})`,
  );
  lines.push('');
  for (const c of d.canais || []) {
    if (!c.fat_ano_anterior_full && !c.fat_ano_atual_real) continue;
    lines.push(
      `${arrowComp(c.comparativo_pct)} *${c.nome}* (${c.comparativo_pct >= 0 ? '+' : ''}${c.comparativo_pct.toFixed(0)}%)`,
    );
    lines.push(
      `   ${d.ano_anterior}:        ${fmtCanalVal(c, c.fat_ano_anterior_full)}`,
    );
    lines.push(
      `   ${d.ano_anterior} Acum.:  ${fmtCanalVal(c, c.fat_ano_anterior_acumulado)}`,
    );
    lines.push(
      `   ${d.ano_atual} Real:   ${fmtCanalVal(c, c.fat_ano_atual_real)}`,
    );
    lines.push('');
  }
  const t = d.total || {};
  lines.push('━━━━━━━━━━━━━━━');
  lines.push(`*TOTAL* ${arrowComp(t.comparativo_pct)}`);
  lines.push(
    `${d.ano_anterior} Acum.: ${fmtBRL(t.fat_ano_anterior_acumulado)}`,
  );
  lines.push(`${d.ano_atual} Real:  ${fmtBRL(t.fat_ano_atual_real)}`);
  lines.push(
    `Comparativo: ${t.comparativo_pct >= 0 ? '+' : ''}${Number(t.comparativo_pct || 0).toFixed(0)}%`,
  );
  return lines.join('\n');
}

// POST /forecast/cron-trigger-whatsapp — dispara manualmente o job de envio
// Body opcional: { phone: '84991234567', untilToday: false }
// (se não passar phone, usa FORECAST_WHATSAPP_PHONE do .env)
router.post(
  '/cron-trigger-whatsapp',
  asyncHandler(async (req, res) => {
    const { phone, untilToday } = req.body || {};
    // Import dinâmico pra evitar carregar Puppeteer no boot da rota
    const { executarForecastWhatsapp } =
      await import('../jobs/forecast-whatsapp.job.js');
    // Dispara em background — responde imediatamente
    executarForecastWhatsapp({ phone, untilToday: !!untilToday })
      .then((r) => {
        console.log(
          `[cron-trigger-whatsapp] resultado: ${r.indicadores?.filter((i) => i.ok).length}/${r.indicadores?.length} ok`,
        );
      })
      .catch((err) => {
        console.error(`[cron-trigger-whatsapp] erro: ${err.message}`);
      });
    return successResponse(
      res,
      { triggered: true, phone: phone || 'env', untilToday: !!untilToday },
      'Job disparado em background. Acompanhe pelos logs.',
    );
  }),
);

// POST /forecast/send-whatsapp-image — recebe { phone, image (base64), caption }
router.post(
  '/send-whatsapp-image',
  asyncHandler(async (req, res) => {
    const { phone, image, caption = '' } = req.body || {};
    if (!phone) return errorResponse(res, 'phone obrigatório', 400);
    if (!image) return errorResponse(res, 'image (base64) obrigatório', 400);
    const normalized = normalizeBrPhone(phone);
    if (!normalized || normalized.length < 12) {
      return errorResponse(res, 'Número de telefone inválido', 400);
    }
    try {
      const r = await sendCrosbybotImage(normalized, image, caption);
      return successResponse(res, { ok: true, ...r }, 'Imagem enviada');
    } catch (e) {
      const detail = e.response?.data || e.message;
      return errorResponse(
        res,
        `Falha no envio: ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 300)}`,
        502,
      );
    }
  }),
);

router.post(
  '/send-whatsapp',
  asyncHandler(async (req, res) => {
    const { tipo, phone, ano, mes, semana } = req.body || {};
    if (!tipo) return errorResponse(res, 'tipo obrigatório', 400);
    if (!phone) return errorResponse(res, 'phone obrigatório', 400);
    const normalized = normalizeBrPhone(phone);
    if (!normalized || normalized.length < 12) {
      return errorResponse(
        res,
        'Número de telefone inválido (formato esperado: DDD+número)',
        400,
      );
    }

    let text;
    try {
      switch (tipo) {
        case 'mensal': {
          const qs = new URLSearchParams();
          if (ano) qs.set('ano', ano);
          if (mes) qs.set('mes', mes);
          const d = await fetchInternal(`/promessa-mensal?${qs}`);
          text = buildTextoMensal(d);
          break;
        }
        case 'semanal': {
          const qs = new URLSearchParams();
          if (ano) qs.set('ano', ano);
          if (semana) qs.set('semana', semana);
          const d = await fetchInternal(`/promessa-semanal?${qs}`);
          text = buildTextoSemanal(d);
          break;
        }
        case 'vendedores': {
          const qs = new URLSearchParams();
          if (ano) qs.set('ano', ano);
          if (semana) qs.set('semana', semana);
          const d = await fetchInternal(`/promessa-vendedores?${qs}`);
          text = buildTextoVendedores(d);
          break;
        }
        case 'comparativo': {
          const qs = new URLSearchParams();
          if (ano) qs.set('ano', ano);
          if (mes) qs.set('mes', mes);
          const d = await fetchInternal(`/comparativo-anual?${qs}`);
          text = buildTextoComparativo(d);
          break;
        }
        default:
          return errorResponse(res, `tipo desconhecido: ${tipo}`, 400);
      }
    } catch (e) {
      return errorResponse(res, `Falha ao montar relatório: ${e.message}`, 500);
    }

    try {
      const r = await sendCrosbybotMessage(normalized, text);
      return successResponse(
        res,
        { ok: true, ...r, preview: text.slice(0, 200) },
        'Mensagem enviada',
      );
    } catch (e) {
      return errorResponse(res, `Falha no envio: ${e.message}`, 502);
    }
  }),
);

// POST /forecast/recalcular-ref-yoy
//   Dispara manualmente o recálculo do ano anterior (forecast_comparativo_ref).
//   Mesma lógica do cron diário das 02:00 BRT.
router.post(
  '/recalcular-ref-yoy',
  asyncHandler(async (req, res) => {
    const { recalcularForecastRef } =
      await import('../jobs/forecast-ref-yoy.job.js');
    await recalcularForecastRef();
    return successResponse(res, { ok: true }, 'Referência YoY recalculada');
  }),
);

// POST /forecast/limpar-cache
//   Invalida caches em memória dos endpoints de faturamento.
//   Útil quando o cache foi populado com dados parciais (ex: TOTVS retornou erro).
router.post(
  '/limpar-cache',
  asyncHandler(async (req, res) => {
    const r = await axios.post(
      `${INTERNAL_API_BASE}/api/crm/clear-fatseg-cache`,
      {},
    );
    return successResponse(res, r.data?.data || { ok: true }, 'Cache limpo');
  }),
);

// POST /forecast/reimportar-faturamento
//   Re-importa NFs do TOTVS para a tabela `notas_fiscais` (Supabase) num período.
//   Útil quando NFs foram emitidas retroativamente e o cron diário não pegou.
//   Body: { datemin: 'YYYY-MM-DD', datemax: 'YYYY-MM-DD' }
router.post(
  '/reimportar-faturamento',
  asyncHandler(async (req, res) => {
    const { datemin, datemax } = req.body || {};
    if (!datemin || !datemax) {
      return errorResponse(
        res,
        'datemin e datemax obrigatórios (YYYY-MM-DD)',
        400,
      );
    }
    const { executarFaturamentoDiario } =
      await import('../jobs/faturamento-diario.job.js');
    const result = await executarFaturamentoDiario({ datemin, datemax });
    if (!result.ok) {
      return errorResponse(res, 'Falha na re-importação (ver logs)', 500);
    }
    return successResponse(
      res,
      result,
      `Re-importação concluída: ${result.totalUpserted} NFs (${result.dateRange})`,
    );
  }),
);

// ════════════════════════════════════════════════════════════════════
// CREDEV OVERRIDES — admin pode desconsiderar credev de NFs específicas
// ════════════════════════════════════════════════════════════════════

// Helper: invalida cache do fat-seg via endpoint interno HTTP
async function invalidateFatSegCache() {
  try {
    const port = process.env.PORT || 4100;
    await axios.post(
      `http://localhost:${port}/api/crm/clear-fatseg-cache`,
      {},
      { timeout: 10000 },
    );
  } catch (e) {
    console.warn(
      '[credev-overrides] falha ao limpar fat-seg cache:',
      e?.message,
    );
  }
}

// GET /api/forecast/credev-overrides?canal=&ativos_only=true
//      Lista overrides (todos ou só ativos). Suporta filtro por canal.
router.get(
  '/credev-overrides',
  asyncHandler(async (req, res) => {
    const canal = req.query.canal;
    const ativosOnly = req.query.ativos_only !== 'false'; // default true
    let q = supabase
      .from('forecast_credev_overrides')
      .select('*')
      .order('created_at', { ascending: false });
    if (ativosOnly) q = q.eq('ativo', true);
    if (canal) q = q.eq('canal', String(canal).toLowerCase());
    const { data, error } = await q;
    if (error) return errorResponse(res, error.message, 500);
    return successResponse(res, {
      overrides: data || [],
      count: data?.length || 0,
    });
  }),
);

// POST /api/forecast/credev-overrides
//      Cria um novo override OU reativa um inativo existente.
//      Body: { branch_code, transaction_code, invoice_code, canal, credev_amount, motivo }
router.post(
  '/credev-overrides',
  asyncHandler(async (req, res) => {
    const {
      branch_code,
      transaction_code,
      invoice_code,
      issue_date,
      canal,
      credev_amount,
      motivo,
    } = req.body || {};
    if (!branch_code || !transaction_code || !canal || !motivo) {
      return errorResponse(
        res,
        'branch_code, transaction_code, canal e motivo são obrigatórios',
        400,
      );
    }
    if (String(motivo).trim().length < 3) {
      return errorResponse(res, 'Motivo deve ter pelo menos 3 caracteres', 400);
    }

    const userEmail =
      req.headers['x-user-email'] || req.user?.email || 'anonimo';
    const ipOrigem = req.ip || req.headers['x-forwarded-for'] || null;

    // Verifica se já existe override (ativo ou inativo) — para reativar em vez
    // de criar duplicado.
    const { data: existing } = await supabase
      .from('forecast_credev_overrides')
      .select('*')
      .eq('branch_code', branch_code)
      .eq('transaction_code', transaction_code)
      .eq('canal', String(canal).toLowerCase())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    let overrideRow;
    let acao;
    if (existing) {
      if (existing.ativo) {
        return errorResponse(
          res,
          'Já existe um override ATIVO para essa NF/canal',
          409,
        );
      }
      // Reativa o existente atualizando motivo
      const { data: updated, error } = await supabase
        .from('forecast_credev_overrides')
        .update({
          ativo: true,
          motivo: String(motivo).trim(),
          credev_amount: credev_amount ?? existing.credev_amount,
          issue_date: issue_date ?? existing.issue_date,
          created_by: userEmail,
          created_at: new Date().toISOString(),
          deactivated_by: null,
          deactivated_at: null,
        })
        .eq('id', existing.id)
        .select()
        .single();
      if (error) return errorResponse(res, error.message, 500);
      overrideRow = updated;
      acao = 'reactivate';
    } else {
      const { data: created, error } = await supabase
        .from('forecast_credev_overrides')
        .insert({
          branch_code,
          transaction_code,
          invoice_code: invoice_code || null,
          issue_date: issue_date || null,
          canal: String(canal).toLowerCase(),
          credev_amount: credev_amount || null,
          motivo: String(motivo).trim(),
          ativo: true,
          created_by: userEmail,
        })
        .select()
        .single();
      if (error) return errorResponse(res, error.message, 500);
      overrideRow = created;
      acao = 'create';
    }

    // Log
    await supabase.from('forecast_credev_overrides_log').insert({
      override_id: overrideRow.id,
      branch_code,
      transaction_code,
      invoice_code: invoice_code || null,
      issue_date: issue_date || null,
      canal: String(canal).toLowerCase(),
      acao,
      motivo: String(motivo).trim(),
      credev_amount: credev_amount || null,
      alterado_por: userEmail,
      ip_origem: ipOrigem,
    });

    // Invalida cache do fat-seg para que o próximo request use o override
    invalidateFatSegCache();

    return successResponse(
      res,
      { override: overrideRow, acao },
      acao === 'create' ? 'Override criado' : 'Override reativado',
    );
  }),
);

// DELETE /api/forecast/credev-overrides/:id  (soft delete = ativo=false)
router.delete(
  '/credev-overrides/:id',
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!id) return errorResponse(res, 'ID inválido', 400);

    const userEmail =
      req.headers['x-user-email'] || req.user?.email || 'anonimo';
    const ipOrigem = req.ip || req.headers['x-forwarded-for'] || null;

    const { data: existing, error: errSel } = await supabase
      .from('forecast_credev_overrides')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (errSel) return errorResponse(res, errSel.message, 500);
    if (!existing) return errorResponse(res, 'Override não encontrado', 404);
    if (!existing.ativo) {
      return errorResponse(res, 'Override já está inativo', 400);
    }

    const { data: updated, error } = await supabase
      .from('forecast_credev_overrides')
      .update({
        ativo: false,
        deactivated_by: userEmail,
        deactivated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();
    if (error) return errorResponse(res, error.message, 500);

    await supabase.from('forecast_credev_overrides_log').insert({
      override_id: id,
      branch_code: existing.branch_code,
      transaction_code: existing.transaction_code,
      invoice_code: existing.invoice_code,
      canal: existing.canal,
      acao: 'deactivate',
      motivo: existing.motivo,
      credev_amount: existing.credev_amount,
      alterado_por: userEmail,
      ip_origem: ipOrigem,
    });

    // Invalida cache do fat-seg para que o próximo request use a nova config
    invalidateFatSegCache();

    return successResponse(res, { override: updated }, 'Override desativado');
  }),
);

// GET /api/forecast/credev-overrides/log
//      Histórico completo de alterações
router.get(
  '/credev-overrides/log',
  asyncHandler(async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    const { data, error } = await supabase
      .from('forecast_credev_overrides_log')
      .select('*')
      .order('alterado_em', { ascending: false })
      .limit(limit);
    if (error) return errorResponse(res, error.message, 500);
    return successResponse(res, { log: data || [], count: data?.length || 0 });
  }),
);

export default router;
