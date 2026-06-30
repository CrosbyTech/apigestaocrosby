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
// ⚠️ Op 7279 é compartilhada (franquia/business/revenda). Aparece em FRANQUIA
// e BUSINESS — o canal real é resolvido por dealer no fat-seg (resolveCanal7279).
const CANAL_OPS = {
  franquia: [7234, 7240, 7802, 9124, 7259, 7279],
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

// Mapeia (ano ISO, semana ISO) → chave de meta semanal no formato
// 'YYYY-MM-Sn' usado pelo novo PlanejamentoMensalModal.
//
// Regra: pega a SEGUNDA-feira da semana ISO; o mês e o "número fixo de semana"
// dentro daquele mês determinam a chave:
//   dia 1-7  → S1
//   dia 8-14 → S2
//   dia 15-21→ S3
//   dia 22-28→ S4
//   dia 29+  → S5
//
// Ex: W22/2026 (start 25/05) → '2026-05-S4'
//     W23/2026 (start 01/06) → '2026-06-S1'
//     W27/2026 (start 29/06) → '2026-06-S5'
function isoWeekToMonthSemKey(ano, semana) {
  const { data_inicio } = isoWeekRange(ano, semana);
  // data_inicio já é a segunda
  const [y, m, d] = data_inicio.split('-').map(Number);
  let s;
  if (d <= 7) s = 1;
  else if (d <= 14) s = 2;
  else if (d <= 21) s = 3;
  else if (d <= 28) s = 4;
  else s = 5;
  return `${y}-${String(m).padStart(2, '0')}-S${s}`;
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
    // Força fresh quando:
    //   - é 1 dia recente (até 3 dias atrás) — caso "Faturamento de Ontem"
    //   - OU range termina HOJE/ONTEM (mês corrente) — caso Comparativo Anual.
    //     Cache de mês corrente costuma ter canais B2R/B2M/Franquia zerados
    //     intermitentemente até NF do dia ser sincronizada no TOTVS.
    const dfTerminaRecente = diasAtras >= 0 && diasAtras <= 1;
    const forcarFresh =
      (eumDiaSo && diasAtras >= 0 && diasAtras <= 3) || dfTerminaRecente;
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

// Helper: roda async iteratee em batches sequenciais (controla paralelismo)
async function mapBatched(items, batchSize, iteratee) {
  const out = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const r = await Promise.all(batch.map(iteratee));
    out.push(...r);
  }
  return out;
}

async function getFaturamentoPorSegmentoViaCanalTotals(datemin, datemax) {
  const di = toYmd(datemin);
  const df = toYmd(datemax);
  try {
    // Antes era Promise.all de 11 canais simultâneos → bloqueava TOTVS.
    // Agora 4 por vez: ~3x mais lento mas confiável (sem timeouts).
    const calls = await mapBatched(FAT_SEG_CANAIS, 4,
      async ({ mod, useGross }) => {
        try {
          const r = await axios.post(
            `${INTERNAL_API_BASE}/api/crm/canal-totals?lite=true`,
            { datemin: di, datemax: df, modulo: mod, lite: true },
            { timeout: 180000 },
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
      },
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
// Distribuição da meta MENSAL do Varejo por semana do mês.
// SEM 1 → 22.4% · SEM 2 → 32% · SEM 3 → 22.8% · SEM 4 → 22.8% · SEM 5 → 0%
// Aplica APENAS no canal varejo (outros canais ficam linear meta/dias).
// ═══════════════════════════════════════════════════════════════
const VAREJO_DIST_SEMANAL = { 1: 0.224, 2: 0.32, 3: 0.228, 4: 0.228, 5: 0 };
function getVarejoMetaSemanal(metasMes, periodKeySemanal) {
  // periodKeySemanal formato 'YYYY-MM-Sn' → extrai n
  const m = /-S(\d)$/.exec(periodKeySemanal || '');
  if (!m) return null;
  const semNum = Number(m[1]);
  const pct = VAREJO_DIST_SEMANAL[semNum];
  if (pct == null) return null;
  const metaMesVarejo = Number(metasMes?.get?.('varejo') || 0);
  if (metaMesVarejo <= 0) return null;
  return Math.round(metaMesVarejo * pct * 100) / 100;
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
// GET /forecast/ontem-vendedor-loja
// Faturamento de ONTEM por VENDEDOR (multimarcas) e por LOJA (varejo).
// Pra render gráficos rápidos na aba Métricas Diárias.
// Reusa canal-totals (per_seller) pra B2M e fetchBranchTotalsFromTotvs pra B2C.
// ═══════════════════════════════════════════════════════════════
const VAREJO_LOJAS = {
  2:  { name: 'João Pessoa',     uf: 'PB' },
  5:  { name: 'Nova Cruz',       uf: 'RN' },
  55: { name: 'Parnamirim',      uf: 'RN' },
  65: { name: 'Canguaretama',    uf: 'RN' },
  87: { name: 'Cidade Jardim',   uf: 'PE' },
  88: { name: 'Guararapes',      uf: 'PE' },
  90: { name: 'Ayrton Senna',    uf: 'RN' },
  93: { name: 'Imperatriz',      uf: 'MA' },
  94: { name: 'Patos',           uf: 'PB' },
  95: { name: 'Midway',          uf: 'RN' },
  97: { name: 'Teresina',        uf: 'PI' },
  98: { name: 'Shopping Recife', uf: 'PE' },
};

// ─── Helper: per_seller via NFs (transações reais) ───────────────────
// Usado pra range pequeno (1 dia) onde canal-totals do TOTVS retorna credev
// artificialmente inflado. Faz query NF-a-NF no Supabase Fiscal e classifica
// canal + dealer da mesma forma que transacao-historico-sync.
const OP_SEGMENTO_PARA_TRANSACAO = {
  // Varejo
  510:'varejo', 511:'varejo', 521:'varejo', 522:'varejo', 545:'varejo',
  546:'varejo', 548:'varejo', 9009:'varejo', 9017:'varejo', 9027:'varejo',
  9033:'varejo', 9400:'varejo', 9401:'varejo', 9420:'varejo', 9067:'varejo',
  9404:'varejo', 5919:'varejo',
  // Revenda
  7236:'revenda', 9122:'revenda', 5102:'revenda', 5202:'revenda', 7242:'revenda',
  9061:'revenda', 9001:'revenda', 9121:'revenda', 1407:'revenda', 7806:'revenda',
  7809:'revenda', 512:'revenda',
  // Franquia
  7234:'franquia', 7240:'franquia', 7802:'franquia', 9124:'franquia', 7259:'franquia',
  // Multimarcas
  7235:'multimarcas', 7241:'multimarcas', 9127:'multimarcas',
  // Bazar
  887:'bazar',
  // Business
  7237:'business', 7269:'business', 7279:'business', 7277:'business',
  // Showroom
  7254:'showroom', 7007:'showroom',
  // Novidades Franquia
  7255:'novidadesfranquia',
};
const RE_BRANCH = new Set([11, 111]);
const RE_OPS = new Set([512,5102,7236,200,510,521,545,548,7237,7269,7277,7279]);
const INBOUND_DAVID = new Set([26, 69]);
const INBOUND_RAFAEL = 21;
const OP_7279_DEALER = new Map([
  [40,'franquia'], [20,'business'], [161,'revenda'], [241,'revenda'], [165,'revenda'],
]);
// Filtros de Revenda (B2R) — mesma lógica do fat-seg em crm.routes.js
const VAREJO_BRANCH_CODES_TR = new Set([2, 5, 55, 65, 87, 88, 90, 93, 94, 95, 97]);
const REVENDA_BRANCH_CODES_TR = new Set([99]);
const B2R_REVENDA_DEALERS_EMP2 = new Set([288, 251, 131]); // Jucelino, Felipe, Agenor
const B2R_REVENDA_DEALERS_EMP99 = new Set([25, 15, 161, 165, 241, 779]); // Anderson, Heyridan, Cleiton, Michel, Yago, Aldo
const FRANQUIA_DEALER = 40;
const JUCELINO_DEALER = 288;

// Titulares fixos por canal — sempre aparecem nos cards (zerados se não houver venda).
// Aceita variações ortográficas (CLEYTON/CLEITON) e sobrenomes do TOTVS.
const TITULARES_B2R = [
  { label: 'Cleiton', matches: ['CLEYTON', 'CLEITON'] },
  { label: 'Michel', matches: ['MICHEL'] },
  { label: 'Yago', matches: ['YAGO'] },
];
const TITULARES_B2M = [
  { label: 'Renato', matches: ['RENATO'] },
  { label: 'Walter', matches: ['WALTER'] },
  { label: 'Arthur', matches: ['ARTHUR'] },
];

// Garante que TODOS os titulares aparecem na lista (zerados se não vendeu).
// SOMA múltiplas entradas que casam com o mesmo titular (ex: CLEYTON F + CLEITON
// no per_seller → ambos vão pro "Cleiton"). Mantém vendedores não-titulares
// (ex.: Aldo, Anderson) abaixo dos titulares.
// Guard `usados` antes de somar evita double-count quando duas grafias do mesmo
// nome casam com mais de um titular (ex.: 'CLEYTON' no matches do A e 'CLEY'
// no matches do B → primeiro titular consome a entry, demais a ignoram).
function mergeTitulares(lista, titulares, _totalCanal) {
  const out = [];
  const usados = new Set();
  for (const t of titulares) {
    let soma = 0;
    let achou = false;
    for (const v of lista || []) {
      if (usados.has(v)) continue;
      const nm = String(v.nome || '').toUpperCase();
      if (t.matches.some((m) => nm.includes(m))) {
        soma += Number(v.valor || 0);
        usados.add(v);
        achou = true;
      }
    }
    out.push({ nome: t.label, valor: achou ? Math.round(soma * 100) / 100 : 0 });
  }
  // Outros vendedores que vieram na lista mas não são titulares principais
  for (const v of lista || []) {
    if (usados.has(v)) continue;
    out.push({ nome: v.nome, valor: Number(v.valor || 0) });
  }
  return out;
}

function getDominantDealerFromNf(nf) {
  const items = Array.isArray(nf?.items) ? nf.items : [];
  if (!items.length) return null;
  const cnt = new Map();
  for (const it of items) {
    const products = Array.isArray(it?.products) ? it.products : [];
    for (const p of products) {
      const dc = p?.dealerCode ?? p?.sellerCode;
      if (dc == null) continue;
      const n = Number(dc);
      if (!Number.isFinite(n)) continue;
      cnt.set(n, (cnt.get(n) || 0) + 1);
    }
  }
  if (cnt.size === 0) return null;
  let best = null, max = 0;
  for (const [k, v] of cnt.entries()) {
    if (v > max) { max = v; best = k; }
  }
  return best;
}

function classificarNfCanal(nf) {
  const op = Number(nf.operation_code);
  const bc = nf.branch_code != null ? Number(nf.branch_code) : null;
  const isDevol = String(nf.operation_type || '').toLowerCase() === 'input';

  // 1) Ricardo Eletro: filiais 11/111
  if (bc != null && RE_BRANCH.has(bc) && (RE_OPS.has(op) || isDevol)) {
    return { canal: 'ricardoeletro', dealer: getDominantDealerFromNf(nf) };
  }

  // 2) Op 7279: depende do dealer
  let canal = null;
  let dealer = getDominantDealerFromNf(nf);

  if (op === 7279) {
    canal = (dealer != null && OP_7279_DEALER.get(dealer)) || 'revenda';
  } else {
    // 3) Franquia/Inbound (override por dealer)
    if (dealer === FRANQUIA_DEALER) canal = 'franquia';
    else if (dealer === JUCELINO_DEALER) canal = 'franquia'; // sem checar personCanalMap
    else if (dealer != null && INBOUND_DAVID.has(dealer)) canal = 'inbound_david';
    else if (dealer === INBOUND_RAFAEL) canal = 'inbound_rafael';
    if (!canal) canal = OP_SEGMENTO_PARA_TRANSACAO[op] || null;
  }
  if (!canal) return { canal: null, dealer };

  // 4) Filtros específicos por canal (mesma lógica do fat-seg)
  if (canal === 'varejo' && (bc == null || !VAREJO_BRANCH_CODES_TR.has(bc))) {
    return { canal: null, dealer };
  }
  if (canal === 'revenda') {
    if (bc === 99) {
      if (!B2R_REVENDA_DEALERS_EMP99.has(dealer)) return { canal: null, dealer };
    } else if (bc === 2 && B2R_REVENDA_DEALERS_EMP2.has(dealer)) {
      // mantém revenda
    } else if (bc === 2) {
      canal = 'varejo';
      if (!VAREJO_BRANCH_CODES_TR.has(bc)) return { canal: null, dealer };
    } else if (!REVENDA_BRANCH_CODES_TR.has(bc)) {
      return { canal: null, dealer };
    }
  }
  return { canal, dealer };
}

// Per_seller via transações (NF a NF) — só Supabase Fiscal + mapping seller.
// Retorna [{ seller_name, bruto, credev, liquido }]
async function perSellerViaTransacoes(dmin, dmax, modulo) {
  const { createClient } = await import('@supabase/supabase-js');
  const supabaseFiscal = createClient(
    process.env.SUPABASE_FISCAL_URL,
    process.env.SUPABASE_FISCAL_KEY,
  );

  // 1) Lê NFs do range (output + input)
  const PAGE = 1000;
  const porDealer = new Map(); // dealer_code → { bruto, credev }
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseFiscal
      .from('notas_fiscais')
      .select('branch_code, operation_code, operation_type, invoice_status, total_value, items, person_code')
      .gte('issue_date', dmin)
      .lte('issue_date', dmax)
      .range(from, from + PAGE - 1);
    if (error) {
      console.warn(`[perSellerViaTransacoes] supabaseFiscal: ${error.message}`);
      break;
    }
    if (!data || data.length === 0) break;
    for (const nf of data) {
      const status = String(nf.invoice_status || '').toLowerCase();
      if (status === 'canceled' || status === 'deleted') continue;
      const { canal, dealer } = classificarNfCanal(nf);
      if (canal !== modulo || dealer == null) continue;
      const val = Number(nf.total_value || 0);
      if (val <= 0) continue;
      const isDevol = String(nf.operation_type || '').toLowerCase() === 'input';
      const cur = porDealer.get(dealer) || { bruto: 0, credev: 0 };
      if (isDevol) cur.credev += val;
      else cur.bruto += val;
      porDealer.set(dealer, cur);
    }
    if (data.length < PAGE) break;
  }

  // 2) Mapping dealer → seller_name (via Supabase main: v_vendedores_integracao)
  const dealerNames = new Map();
  try {
    const { data: vendedores } = await supabase
      .from('v_vendedores_integracao')
      .select('totvs_id, nome_vendedor');
    for (const v of vendedores || []) {
      if (v.totvs_id != null) dealerNames.set(Number(v.totvs_id), v.nome_vendedor);
    }
  } catch (e) {
    console.warn(`[perSellerViaTransacoes] vendedores map: ${e.message}`);
  }

  // 3) Monta lista [{seller_name, bruto, credev, liquido}]
  const result = [];
  for (const [dealer, v] of porDealer.entries()) {
    const seller_name = dealerNames.get(dealer) || `Vendedor ${dealer}`;
    const liquido = Math.max(0, v.bruto - v.credev);
    if (liquido <= 0 && v.bruto <= 0) continue;
    result.push({
      seller_name,
      invoice_value: v.bruto,
      credev_value: v.credev,
      liquido: Math.round(liquido * 100) / 100,
    });
  }
  return result.sort((a, b) => b.liquido - a.liquido);
}

// Total líquido por canal via transações NF (1 query, todos os canais).
// Usado pra single-sellers do card "Ontem".
async function totalsPorCanalViaTransacoes(dmin, dmax) {
  const { createClient } = await import('@supabase/supabase-js');
  const supabaseFiscal = createClient(
    process.env.SUPABASE_FISCAL_URL,
    process.env.SUPABASE_FISCAL_KEY,
  );
  const PAGE = 1000;
  const porCanal = {}; // canal → { bruto, credev }
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseFiscal
      .from('notas_fiscais')
      .select('branch_code, operation_code, operation_type, invoice_status, total_value, items, person_code')
      .gte('issue_date', dmin)
      .lte('issue_date', dmax)
      .range(from, from + PAGE - 1);
    if (error) {
      console.warn(`[totalsPorCanalViaTransacoes] erro: ${error.message}`);
      break;
    }
    if (!data || data.length === 0) break;
    for (const nf of data) {
      const status = String(nf.invoice_status || '').toLowerCase();
      if (status === 'canceled' || status === 'deleted') continue;
      const { canal } = classificarNfCanal(nf);
      if (!canal) continue;
      const val = Number(nf.total_value || 0);
      if (val <= 0) continue;
      const isDevol = String(nf.operation_type || '').toLowerCase() === 'input';
      if (!porCanal[canal]) porCanal[canal] = { bruto: 0, credev: 0 };
      if (isDevol) porCanal[canal].credev += val;
      else porCanal[canal].bruto += val;
    }
    if (data.length < PAGE) break;
  }
  // Saída: canal → líquido
  const out = {};
  for (const [c, v] of Object.entries(porCanal)) {
    out[c] = Math.max(0, v.bruto - v.credev);
  }
  return out;
}

// Mapa de `loja` (formato Supabase fat_transacao_historico) → {nome,uf}
const VAREJO_LOJA_SUPABASE = {
  'CROSBY JOAO PESSOA':            { name: 'João Pessoa',     uf: 'PB' },
  'CROSBY NOVA CRUZ':              { name: 'Nova Cruz',       uf: 'RN' },
  'CROSBY PARNAMIRIM':             { name: 'Parnamirim',      uf: 'RN' },
  'CROSBY CANGUARETAMA':           { name: 'Canguaretama',    uf: 'RN' },
  'CROSBY SHOPPING CIDADE JARDIM': { name: 'Cidade Jardim',   uf: 'PE' },
  'CROSBY SHOPPING GUARARAPES':    { name: 'Guararapes',      uf: 'PE' },
  'CROSBY AYRTON SENNA':           { name: 'Ayrton Senna',    uf: 'RN' },
  'CROSBY IMPERATRIZ':             { name: 'Imperatriz',      uf: 'MA' },
  'CROSBY SHOPPING PATOS':         { name: 'Patos',           uf: 'PB' },
  'CROSBY SHOPPING MIDWAY':        { name: 'Midway',          uf: 'RN' },
  'CROSBY SHOPPING TERESINA':      { name: 'Teresina',        uf: 'PI' },
  'CROSBY SHOPPING RECIFE':        { name: 'Shopping Recife', uf: 'PE' },
};

// Cache + inflight pra rota /ontem-vendedor-loja — evita refazer 6+ chamadas
// TOTVS quando os 3 cards (Mês/Semana/Dia) carregam simultaneamente ou o user
// navega entre abas. TTL 5min (dados intra-dia mudam pouco).
const OVL_CACHE = new Map(); // key: `${dmin}|${dmax}` → { ts, data }
const OVL_INFLIGHT = new Map();
const OVL_TTL_MS = 30 * 60 * 1000;
// Dedup global: dias com fallback TOTVS em andamento (evita duplicar requests
// quando vários cards do mesmo range chegam ao mesmo tempo).
const FALLBACK_DIAS_INFLIGHT = new Set();

// POST /api/forecast/per-seller-cache/refresh?dias=N
// Dispara backfill manual da tabela forecast_per_seller_cache. Por default 35 dias.
// IMPORTANTE: chamada longa — só usar quando TOTVS estiver descansado.
router.post(
  '/per-seller-cache/refresh',
  asyncHandler(async (req, res) => {
    const dias = parseInt(req.query.dias || req.body?.dias || '35', 10);
    const { executarSyncPerSellerCache } = await import(
      '../jobs/forecast-per-seller-cache.job.js'
    );
    // Roda em background — não bloqueia resposta
    executarSyncPerSellerCache({ dias })
      .then((r) => console.log('[psc-cron] backfill manual concluído:', r))
      .catch((e) => console.error('[psc-cron] backfill manual falhou:', e.message));
    return successResponse(res, {
      ok: true,
      message: `Backfill iniciado em background pra ${dias} dias. Acompanhe nos logs.`,
    });
  }),
);

router.get(
  '/ontem-vendedor-loja',
  asyncHandler(async (req, res) => {
    console.log('🆕 [ovl] NOVA VERSÃO COM PROMESSA-VENDEDORES iniciada');
    const hoje = new Date();
    // Datas: usa ?datemin/?datemax se vier (mês/semana), senão ontem (D-1 útil).
    let dmin, dmax, periodoLabel;
    if (req.query.datemin && req.query.datemax) {
      dmin = String(req.query.datemin);
      dmax = String(req.query.datemax);
      periodoLabel = req.query.periodo || 'custom';
    } else {
      // "Ontem" = 1 dia útil (D-1, pulando domingo)
      const ontem = new Date(hoje);
      ontem.setUTCDate(ontem.getUTCDate() - 1);
      while (ontem.getUTCDay() === 0) ontem.setUTCDate(ontem.getUTCDate() - 1);
      dmin = ontem.toISOString().slice(0, 10);
      dmax = dmin;
      periodoLabel = 'ontem';
    }
    // Alias antigo do código: diaIso. Mantém comportamento.
    const diaIso = dmax; // pra single-seller usa o dia final do range

    // Cache hit (TTL 30min). v11 = força refetch (per_seller veio vazio antes)
    const cacheKey = `v13|${dmin}|${dmax}`;
    const noCache = req.query.nocache === '1' || req.query.nocache === 'true';
    if (!noCache) {
      const cached = OVL_CACHE.get(cacheKey);
      if (cached && Date.now() - cached.ts < OVL_TTL_MS) {
        return successResponse(res, { ...cached.data, periodo: periodoLabel, cached: true });
      }
      // Inflight: se já tem fetch em andamento pra mesma key, aguarda ele
      if (OVL_INFLIGHT.has(cacheKey)) {
        try {
          const data = await OVL_INFLIGHT.get(cacheKey);
          return successResponse(res, { ...data, periodo: periodoLabel, coalesced: true });
        } catch {
          /* cai pro fetch normal abaixo */
        }
      }
    }

    // Registra promise pra outros callers aguardarem
    let _resolveInflight, _rejectInflight;
    const inflightPromise = new Promise((rr, rj) => {
      _resolveInflight = rr;
      _rejectInflight = rj;
    });
    if (!noCache) OVL_INFLIGHT.set(cacheKey, inflightPromise);
    res.on('finish', () => {
      if (OVL_INFLIGHT.get(cacheKey) === inflightPromise) {
        OVL_INFLIGHT.delete(cacheKey);
      }
    });

    // ─── CACHE-ONLY MODE: zero TOTVS, só Supabase ──────────────────────────
    // Usado por Métricas Diretoria pra evitar afogar o TOTVS. Lê direto da
    // tabela canal_totals_cache (populada pelo cron noturno via canal-totals
    // do TOTVS — valor líquido por canal já com credev subtraído). Match exato
    // OU fuzzy (datemax ≤ 2 dias de diferença).
    //
    // ⚠️ inbound_david e inbound_rafael são RECALCULADOS direto da tabela
    // notas_fiscais (Supabase fiscal) — o sale-panel do TOTVS tem latência e
    // perde NFs recentes, então o cache de canal_totals fica subestimado nesses
    // canais. notas_fiscais é a fonte autoritativa do TOTVS fiscal.
    //
    // Sem per-seller detalhe (1 linha agregada por canal). Resposta em ~1s.
    // Usuário pode forçar TOTVS via botão "Atualizar" (sem cacheOnly).
    const cacheOnly =
      req.query.cacheOnly === '1' || req.query.cacheOnly === 'true';
    if (cacheOnly) {
      try {
        const { default: supabase } = await import('../config/supabase.js');
        const { createClient } = await import('@supabase/supabase-js');
        const supabaseFiscal = createClient(
          process.env.SUPABASE_FISCAL_URL,
          process.env.SUPABASE_FISCAL_KEY,
        );

        // ── Fonte primária: canal_totals_cache (Supabase, rápido). Os overrides
        // abaixo (Jhemyson, David, Rafael, Multimarcas) recalculam do Supabase
        // notas_fiscais — autoritativo. Pular canais-totals-all com nocache=true
        // (TOTVS direto) que demorava 3+ minutos em ranges grandes.
        let seg = {};
        try {
          const { data: rows } = await supabase
            .from('canal_totals_cache')
            .select('canal, datemax, valor_liquido')
            .eq('datemin', dmin);
          const reqEnd = new Date(`${dmax}T00:00:00Z`).getTime();
          for (const r of rows || []) {
            const rowEnd = new Date(`${r.datemax}T00:00:00Z`).getTime();
            const diffDays = Math.abs(rowEnd - reqEnd) / (24 * 3600 * 1000);
            if (diffDays <= 2) seg[r.canal] = Number(r.valor_liquido || 0);
          }
          console.log(`[ovl cache-only] cache hit (${Object.keys(seg).length} canais) ${dmin}~${dmax}`);
        } catch (e) {
          console.warn(`[ovl cache-only] cache lookup falhou: ${e.message}`);
        }

        const round = (v) => Math.round(Number(v || 0) * 100) / 100;
        const mkSingle = (canal, nome) => {
          const v = round(seg[canal]);
          return { nome, canal, valor: v };
        };

        // ── Override Jhemyson: filtra só dealer=40 ──────────────────────
        // O canal franquia inclui Jhemyson (40) + Jucelino (288) + outras NFs.
        // Mas o usuário quer ver APENAS as vendas do Jhemyson (dealer 40).
        // 1ª tentativa: canal-totals?modulo=franquia per_seller dealer=40
        // 2ª (fallback): notas_fiscais dealer_code=40 ops franquia (Supabase fiscal)
        let jhemValor = null;
        try {
          const r = await axios.post(
            `${INTERNAL_API_BASE}/api/crm/canal-totals?lite=true`,
            { datemin: dmin, datemax: dmax, modulo: 'franquia', lite: true },
            { timeout: 30000 },
          );
          const d = r.data?.data || r.data || {};
          const jhem = (d.per_seller || []).find(
            (s) => Number(s.seller_code) === 40,
          );
          if (jhem) {
            const bruto = Number(jhem.invoice_value || 0);
            const credev = Number(jhem.credev_value || 0);
            jhemValor = Math.max(0, bruto - credev);
          }
        } catch (e) {
          console.warn(`[ovl cache-only] Jhemyson via canal-totals falhou: ${e.message}`);
        }
        // Fallback: notas_fiscais Supabase (rápido)
        if (jhemValor == null || jhemValor === 0) {
          try {
            const { data: nfs } = await supabaseFiscal
              .from('notas_fiscais')
              .select('total_value, invoice_status, operation_type')
              .gte('issue_date', dmin).lte('issue_date', dmax)
              .eq('dealer_code', 40)
              .in('operation_code', [7234, 7240, 7802, 9124, 7259]);
            const valid = (nfs || []).filter(
              (n) => n.invoice_status !== 'Canceled' && n.invoice_status !== 'Deleted',
            );
            const out = valid
              .filter((n) => n.operation_type === 'Output')
              .reduce((s, n) => s + Number(n.total_value || 0), 0);
            const inp = valid
              .filter((n) => n.operation_type === 'Input')
              .reduce((s, n) => s + Number(n.total_value || 0), 0);
            const liquidoNF = Math.max(0, out - inp);
            if (liquidoNF > 0) {
              jhemValor = liquidoNF;
              console.log(`[ovl cache-only] Jhemyson via notas_fiscais (fallback): R$${liquidoNF.toFixed(2)}`);
            }
          } catch (e) {
            console.warn(`[ovl cache-only] Jhemyson fallback notas_fiscais falhou: ${e.message}`);
          }
        }
        // Override Jhemyson DESATIVADO: ele inflava seg.franquia além do
        // canal_totals_cache.franquia oficial (R$ 128k vs R$ 83k). O cache
        // é a fonte de verdade — mantemos. jhemValor ainda é usado mais
        // adiante como valor exibido pro vendedor Jhemyson individualmente
        // (sem alterar o total do canal franquia).

        // ── Override Inbound David/Rafael: recalcula via Supabase fiscal ────
        // O canal_totals_cache vem do TOTVS sale-panel que tem latência e
        // perde NFs recentes. notas_fiscais é a fonte autoritativa.
        // Retorna { ok: true, valor } em sucesso (mesmo se 0) ou { ok: false }
        // em falha de query. Distinguir "0 legítimo" de "0 por erro" evita
        // manter cache_totals inflado quando a query Supabase quebra.
        const recalcInboundSupabase = async (label, sellerCodes) => {
          try {
            const { data: nfs, error } = await supabaseFiscal
              .from('notas_fiscais')
              .select('total_value, invoice_status, operation_type')
              .gte('issue_date', dmin).lte('issue_date', dmax)
              .in('dealer_code', sellerCodes)
              .in('operation_code', [7235, 7241, 9127])
              .in('branch_code', B2M_OVERRIDE_BRANCHES);
            if (error) {
              console.warn(`[ovl cache-only] ${label} recalc falhou (query error): ${error.message}`);
              return { ok: false };
            }
            const valid = (nfs || []).filter(
              (n) => n.invoice_status !== 'Canceled' && n.invoice_status !== 'Deleted',
            );
            const out = valid.filter((n) => n.operation_type === 'Output').reduce((s, n) => s + Number(n.total_value || 0), 0);
            const inp = valid.filter((n) => n.operation_type === 'Input').reduce((s, n) => s + Number(n.total_value || 0), 0);
            return { ok: true, valor: Math.max(0, out - inp) };
          } catch (e) {
            console.warn(`[ovl cache-only] ${label} recalc falhou (exception): ${e.message}`);
            return { ok: false };
          }
        };
        const davidR = await recalcInboundSupabase('David', [26, 69]);
        if (davidR.ok) {
          console.log(`[ovl cache-only] inbound_david: cache=R$${(seg.inbound_david || 0).toFixed(2)} → Supabase=R$${davidR.valor.toFixed(2)}`);
          seg.inbound_david = davidR.valor;
        }
        const rafaelR = await recalcInboundSupabase('Rafael', [21]);
        if (rafaelR.ok) {
          console.log(`[ovl cache-only] inbound_rafael: cache=R$${(seg.inbound_rafael || 0).toFixed(2)} → Supabase=R$${rafaelR.valor.toFixed(2)}`);
          seg.inbound_rafael = rafaelR.valor;
        }

        // Override de Multimarcas removido: notas_fiscais Supabase usa só ops
        // [7235, 7241, 9127, 200] que é mais restrito que o sale-panel TOTVS
        // (canal_totals_cache.multimarcas). Resultado: deflacionava o valor
        // pra R$ 100k quando o oficial é R$ 154k. Como o cache canal_totals_cache
        // já bate com o relatório TOTVS oficial, mantemos ele direto.

        // ── Per-seller breakdown via notas_fiscais (B2M e B2R) ────────────
        // Mapping dinâmico dealer_code → nome via view v_vendedores_integracao.
        const DEALER_NAMES = {};
        try {
          const { data: vends } = await supabase
            .from('v_vendedores_integracao')
            .select('totvs_id, nome_vendedor');
          for (const v of vends || []) {
            if (v.totvs_id != null && v.nome_vendedor) {
              const nome = String(v.nome_vendedor).trim();
              // Capitaliza nome: "ARTHUR LEITE" → "Arthur Leite"
              const cap = nome.toLowerCase().split(/\s+/)
                .map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
              // Pega só o primeiro nome pra evitar quebra de linha em cards estreitos
              DEALER_NAMES[Number(v.totvs_id)] = cap.split(' ')[0];
            }
          }
        } catch (e) {
          console.warn(`[ovl cache-only] vendedores map falhou: ${e.message}`);
        }
        const nomeDealer = (code) =>
          DEALER_NAMES[Number(code)] || `Vend. ${code}`;

        // ── Per-seller via TOTVS canal-totals (fonte oficial) ────────────────
        // canal-totals retorna per_seller com seller_name e invoice_value
        // líquido (bruto − credev). Usa lite=true pra não afogar o TOTVS
        // (skipa full scan FIS_NFITEMPROD).
        const perSellerTotvs = async (modulo) => {
          try {
            const r = await axios.post(
              `${INTERNAL_API_BASE}/api/crm/canal-totals?lite=true`,
              { datemin: dmin, datemax: dmax, modulo, lite: true },
              { timeout: 120000 },
            );
            const d = r.data?.data || r.data || {};
            const list = (d.per_seller || [])
              .map((s) => {
                const bruto = Number(s.invoice_value ?? 0);
                const credev = Number(s.credev_value || 0);
                const liquido = Math.max(0, bruto - credev);
                // Capitaliza primeiro nome
                const raw = String(s.seller_name || '').trim();
                const cap = raw.toLowerCase().split(/\s+/)
                  .map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
                const nome = cap.split(' ')[0] || nomeDealer(s.seller_code);
                return { nome, valor: round(liquido) };
              })
              .filter((v) => v.valor > 0)
              .sort((a, b) => b.valor - a.valor);
            return list;
          } catch (e) {
            console.warn(`[ovl cache-only/totvs] per_seller(${modulo}) falhou: ${e.message}`);
            return [];
          }
        };

        // ── Lojas varejo via TOTVS ranking-faturamento (fonte oficial) ───────
        const lojasVarejoTotvs = async () => {
          try {
            const codes = Object.keys(VAREJO_LOJAS).map(Number);
            const r = await axios.post(
              `${INTERNAL_API_BASE}/api/totvs/sale-panel/ranking-faturamento`,
              { datemin: dmin, datemax: dmax, branchs: codes },
              { timeout: 120000 },
            );
            const fat = r.data?.data || r.data || null;
            const fatByCode = new Map();
            for (const row of fat?.dataRow || []) {
              const code = Number(row.branch_code ?? row.branch ?? 0);
              fatByCode.set(
                code,
                (fatByCode.get(code) || 0) + Number(row.invoice_value || 0),
              );
            }
            const lojas = Object.entries(VAREJO_LOJAS)
              .map(([code, loja]) => ({
                nome: loja.name,
                uf: loja.uf,
                valor: round(fatByCode.get(Number(code)) || 0),
              }))
              .filter((l) => l.valor > 0);
            // Ranking-faturamento retorna BRUTO (sem subtrair credev/vale-troca).
            // Pra alinhar com o canal_totals_cache LÍQUIDO, rateia o credev
            // proporcionalmente entre as lojas. Se cache não tiver, usa BRUTO.
            const varejoLiqCache = Number(seg.varejo || 0);
            const totalBruto = lojas.reduce((s, l) => s + l.valor, 0);
            if (varejoLiqCache > 0 && totalBruto > varejoLiqCache) {
              const ratio = varejoLiqCache / totalBruto;
              for (const l of lojas) l.valor = round(l.valor * ratio);
              console.log(`[ovl cache-only] rateio credev varejo: bruto R$${totalBruto.toFixed(2)} → líquido R$${varejoLiqCache.toFixed(2)} (ratio ${ratio.toFixed(3)})`);
            }
            return lojas.sort((a, b) => b.valor - a.valor);
          } catch (e) {
            console.warn(`[ovl cache-only/totvs] ranking-faturamento falhou: ${e.message}`);
            return [];
          }
        };

        // ── Fallback notas_fiscais: split por dealer (quando TOTVS falha) ──
        // Quando canal-totals do TOTVS dá timeout (ranges grandes), usa
        // notas_fiscais Supabase como fonte alternativa pra ter ALGUM split
        // por vendedor em vez de mostrar 1 linha agregada.
        const grupoPorDealerNF = async (cfg) => {
          let allRows = []; let from = 0;
          while (true) {
            let q = supabaseFiscal
              .from('notas_fiscais')
              .select('dealer_code, total_value, invoice_status, operation_type')
              .in('operation_type', ['Output', 'Input'])
              .gte('issue_date', dmin).lte('issue_date', dmax)
              .in('branch_code', cfg.branchs)
              .in('operation_code', cfg.ops)
              .range(from, from + 999);
            if (cfg.sellers) q = q.in('dealer_code', cfg.sellers);
            if (cfg.excludeSellers) {
              q = q.not('dealer_code', 'in', `(${cfg.excludeSellers.join(',')})`);
            }
            const { data, error } = await q;
            if (error || !data?.length) break;
            allRows.push(...data);
            if (data.length < 1000) break;
            from += 1000;
          }
          const valid = allRows.filter(
            (n) => n.invoice_status !== 'Canceled' && n.invoice_status !== 'Deleted',
          );
          const porDealer = new Map();
          for (const n of valid) {
            const k = Number(n.dealer_code);
            const sinal = n.operation_type === 'Input' ? -1 : 1;
            porDealer.set(k, (porDealer.get(k) || 0) + sinal * Number(n.total_value || 0));
          }
          return [...porDealer.entries()]
            .map(([code, val]) => ({ nome: nomeDealer(code), valor: round(val) }))
            .filter((v) => v.valor > 0)
            .sort((a, b) => b.valor - a.valor);
        };

        // Vendedores B2M/B2R: usa REPLICA OFICIAL do SQL "Faturamento por
        // Vendedor" do TOTVS (accounts-receivable + ops excluídas + sinal de
        // devolução). Bate 100% com o relatório oficial PDF. Fallback:
        // notas_fiscais Supabase se a replica falhar.
        const construirGrupoOficial = async (branchs, sellersAllow, sellersExclude, opsAllow = null) => {
          try {
            // getFaturadoOficialReplica tem cap de 5000 docs por chamada
            // (50 páginas × 100 docs). Multi-branch trunca — chamamos POR
            // branch em paralelo e mesclamos os mapas. Cada branch isolada
            // costuma caber em <5000 docs.
            const mapasPorBranch = await Promise.all(
              branchs.map((b) => getFaturadoOficialReplica([b], dmin, dmax, opsAllow)),
            );
            const mapaConsolidado = new Map();
            for (const mapa of mapasPorBranch) {
              for (const [dealer, info] of mapa.entries()) {
                const prev = mapaConsolidado.get(dealer) || { valor: 0, nfs: 0, clientes: 0 };
                prev.valor += Number(info?.valor || 0);
                prev.nfs += Number(info?.nfs || 0);
                prev.clientes += Number(info?.clientes || 0);
                mapaConsolidado.set(dealer, prev);
              }
            }
            const allow = sellersAllow ? new Set(sellersAllow.map(Number)) : null;
            const exclude = new Set((sellersExclude || []).map(Number));
            const list = [];
            for (const [dealer, info] of mapaConsolidado.entries()) {
              if (allow && !allow.has(Number(dealer))) continue;
              if (exclude.has(Number(dealer))) continue;
              if (!info?.valor || info.valor <= 0) continue;
              list.push({ nome: nomeDealer(dealer), valor: round(info.valor) });
            }
            return list.sort((a, b) => b.valor - a.valor);
          } catch (e) {
            console.warn(`[ovl cache-only] replica oficial falhou: ${e.message}`);
            return [];
          }
        };
        let vendedoresB2M = [], vendedoresB2R = [], lojasB2C = [];
        try {
          [vendedoresB2M, vendedoresB2R, lojasB2C] = await Promise.all([
            construirGrupoOficial(
              B2M_OVERRIDE_BRANCHES,
              null,
              [21, 26, 69], // exclui inbound David/Rafael/Thalis
              // Filtra só ops B2M (atacado) — sem isso, vendedores de Varejo
              // das filiais 95/87/88/90/94/97 (lojas físicas) vazam pra B2M.
              [7235, 7241, 9127],
            ),
            construirGrupoOficial(
              [2, 5, 75, 99, 200],
              [25, 15, 161, 165, 241, 779, 288, 251, 131, 94, 1924, 7044],
              null,
              [7236, 9122, 5102, 7242, 9061, 9001, 9121, 512], // ops B2R
            ),
            lojasVarejoTotvs(),
          ]);
          // Fallback notas_fiscais Supabase se a replica não retornou nada
          if (vendedoresB2M.length === 0) {
            vendedoresB2M = await grupoPorDealerNF({
              branchs: B2M_OVERRIDE_BRANCHES,
              ops: [7235, 7241, 9127, 200],
              excludeSellers: [21, 26, 69],
            });
          }
          if (vendedoresB2R.length === 0) {
            vendedoresB2R = await grupoPorDealerNF({
              branchs: [2, 5, 75, 99, 200],
              ops: [7236, 9122, 5102, 7242, 9061, 9001, 9121, 512],
              sellers: [25, 15, 161, 165, 241, 779, 288, 251, 131, 94, 1924, 7044],
            });
          }
        } catch (e) {
          console.warn(`[ovl cache-only] per_seller falhou: ${e.message}`);
        }
        // Escala BIDIRECIONAL pra alinhar soma de vendedores com canal_totals
        // cache (fonte oficial do "Por Canal"). Sem isso, MD mostra total
        // diferente do "Por Canal" — confunde diretoria. Mantém proporção
        // entre vendedores intacta.
        const escalarParaTotal = (lista, totalAlvo) => {
          if (!lista.length || !totalAlvo) return lista;
          const somaAtual = lista.reduce((s, v) => s + v.valor, 0);
          if (somaAtual <= 0 || Math.abs(totalAlvo - somaAtual) < 1) return lista;
          const fator = totalAlvo / somaAtual;
          return lista.map((v) => ({ ...v, valor: round(v.valor * fator) }));
        };
        vendedoresB2M = escalarParaTotal(vendedoresB2M, round(seg.multimarcas));
        vendedoresB2R = escalarParaTotal(vendedoresB2R, round(seg.revenda));

        // Per-seller e lojas vêm direto de notas_fiscais (valores REAIS, sem
        // escalonamento proporcional). O total exibido = soma dos valores
        // reais (não o cache canal_totals, que pode estar inflado pelo
        // sale-panel sale com NFs não-sincronizadas).
        const totalB2M = vendedoresB2M.reduce((s, v) => s + v.valor, 0);
        const totalB2R = vendedoresB2R.reduce((s, v) => s + v.valor, 0);
        const totalVarejo = lojasB2C.reduce((s, l) => s + l.valor, 0);

        const responseData = {
          dia_anterior: diaIso,
          datemin: dmin, datemax: dmax, periodo: periodoLabel,
          source: 'supabase-cache-only',
          cacheOnly: true,
          varejo: {
            lojas: lojasB2C.length > 0
              ? lojasB2C
              : (round(seg.varejo) > 0
                  ? [{ nome: 'Varejo (total)', uf: null, valor: round(seg.varejo) }]
                  : []),
            total: round(totalVarejo > 0 ? totalVarejo : seg.varejo),
          },
          multimarcas: {
            vendedores: mergeTitulares(vendedoresB2M, TITULARES_B2M, round(seg.multimarcas)),
            total: round(totalB2M > 0 ? totalB2M : seg.multimarcas),
          },
          revenda: {
            vendedores: mergeTitulares(vendedoresB2R, TITULARES_B2R, round(seg.revenda)),
            total: round(totalB2R > 0 ? totalB2R : seg.revenda),
          },
          outros: {
            vendedores: [
              mkSingle('franquia', 'Jhemyson'),
              mkSingle('inbound_david', 'David'),
              mkSingle('inbound_rafael', 'Rafael'),
              mkSingle('bazar', 'Bazar'),
              mkSingle('ricardoeletro', 'Jesus'),
              {
                nome: 'Kleiton', canal: 'fabrica',
                valor: round((seg.showroom || 0) + (seg.novidadesfranquia || 0)),
              },
            ].filter((v) => v.valor > 0).sort((a, b) => b.valor - a.valor),
            total: round(
              (seg.franquia || 0) + (seg.inbound_david || 0) + (seg.inbound_rafael || 0) +
              (seg.bazar || 0) + (seg.ricardoeletro || 0) +
              (seg.showroom || 0) + (seg.novidadesfranquia || 0),
            ),
          },
        };
        OVL_CACHE.set(cacheKey, { ts: Date.now(), data: responseData });
        try { _resolveInflight(responseData); } catch {}
        return successResponse(res, responseData);
      } catch (e) {
        console.warn(`[ovl cache-only] falhou: ${e.message} — fallback TOTVS`);
        // Cai pro caminho normal abaixo
      }
    }

    // ─── VERSÃO UNIFICADA: canal-totals per_seller (bruto - credev) ────────
    // Mesma lógica para Ontem / Semana / Mês — só muda o range dmin/dmax.
    // Valores batem com relatório TOTVS "Vl. Faturado" (já subtrai devoluções).
    try {
      if (periodoLabel === 'ontem' || periodoLabel === 'mes' || periodoLabel === 'semana' || periodoLabel === 'custom') {
        const capNome = (s) =>
          String(s || '').trim().toLowerCase().split(/\s+/)
            .map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
        // Helpers — sellers vêm de canal-totals per_seller (LÍQUIDO = bruto - credev).
        const fetchSellersGrupo = async (grupoCode) => {
          const moduloMap = { B2R: 'revenda', B2M: 'multimarcas' };
          const modulo = moduloMap[grupoCode];
          if (!modulo) return [];
          // Tenta até 2x — em ranges longos o canal-totals pode falhar 1x antes
          // do TOTVS responder. Sem retry o fallback agregado é exibido pra um
          // canal e o outro tem detalhe (B2R agregado, B2M detalhado, ex.).
          const tentar = async () => {
            const r = await axios.post(
              `${INTERNAL_API_BASE}/api/crm/canal-totals?lite=true${noCache ? '&nocache=true' : ''}`,
              { datemin: dmin, datemax: dmax, modulo, lite: true, nocache: noCache },
              { timeout: 180000 },
            );
            const d = r.data?.data || r.data || {};
            return (d.per_seller || [])
              .map((s) => {
                const bruto = Number(s.invoice_value || 0);
                const credev = Number(s.credev_value || 0);
                return {
                  nome: capNome(s.seller_name || s.name || ''),
                  valor: Math.round(Math.max(0, bruto - credev) * 100) / 100,
                };
              })
              .filter((v) => v.valor > 0)
              .sort((a, b) => b.valor - a.valor);
          };
          try {
            const r1 = await tentar();
            if (r1.length > 0) return r1;
            console.warn(`[ovl] fetchSellersGrupo(${grupoCode}) veio vazio, retry...`);
            return await tentar();
          } catch (e) {
            console.warn(`[ovl] fetchSellersGrupo(${grupoCode}) falhou: ${e.message}, retry...`);
            try { return await tentar(); }
            catch (e2) {
              console.warn(`[ovl] retry também falhou: ${e2.message}`);
              return [];
            }
          }
        };
        const fetchVarejoRanking = async () => {
          try {
            const codes = Object.keys(VAREJO_LOJAS).map(Number);
            const r = await axios.post(
              `${INTERNAL_API_BASE}/api/totvs/sale-panel/ranking-faturamento`,
              { datemin: dmin, datemax: dmax, branchs: codes },
              { timeout: 180000 },
            );
            return r.data?.data || r.data || null;
          } catch { return null; }
        };
        // Per_seller por canal — fast para ranges curtos, vira no-op rápido
        // pra ranges longos (timeout 30s). Sempre temos `segs` como fallback.
        // Retorna { total, per_seller } pra permitir fallback canal-level
        // quando segs[canal] vier zerado (e.g. range curto sem cache).
        const fetchCanalDireto = async (modulo) => {
          try {
            const r = await axios.post(
              `${INTERNAL_API_BASE}/api/crm/canal-totals?lite=true${noCache ? '&nocache=true' : ''}`,
              { datemin: dmin, datemax: dmax, modulo, lite: true, nocache: noCache },
              { timeout: 30000 },
            );
            const d = r.data?.data || r.data || {};
            return {
              total: Number(d.invoice_value || 0),
              per_seller: d.per_seller || [],
            };
          } catch {
            return { total: 0, per_seller: [] };
          }
        };
        // Wrapper backwards-compat: alguns callers só precisam do per_seller
        const fetchPerSellerCanal = async (modulo) =>
          (await fetchCanalDireto(modulo)).per_seller;
        // PARALELIZA TUDO. Singles têm DUPLA fonte (segs + canal direto).
        const [
          vendedoresB2M_oficial, vendedoresB2R_oficial, segs, varejoFat,
          psFranquia, psDavid, psRafael, psShowroom, psNovid,
          ctBazar, ctRicardoEletro,
        ] = await Promise.all([
          fetchSellersGrupo('B2M'),
          fetchSellersGrupo('B2R'),
          axios.post(
            `${INTERNAL_API_BASE}/api/crm/canais-totals-all?lite=true${noCache ? '&nocache=true' : ''}`,
            { datemin: dmin, datemax: dmax, lite: true, nocache: noCache },
            { timeout: 240000 },
          ).then((r) => (r.data?.data || r.data || {}).segmentos || {}).catch(() => ({})),
          fetchVarejoRanking(),
          fetchPerSellerCanal('franquia'),
          fetchPerSellerCanal('inbound_david'),
          fetchPerSellerCanal('inbound_rafael'),
          fetchPerSellerCanal('showroom'),
          fetchPerSellerCanal('novidadesfranquia'),
          fetchCanalDireto('bazar'),
          fetchCanalDireto('ricardoeletro'),
        ]);
        // Varejo per loja (Ranking)
        let lojasB2C = [];
        if (varejoFat) {
          const fatByCode = new Map();
          for (const row of varejoFat?.dataRow || []) {
            const code = Number(row.branch_code ?? row.branch ?? 0);
            fatByCode.set(code, (fatByCode.get(code) || 0) + Number(row.invoice_value || 0));
          }
          lojasB2C = Object.entries(VAREJO_LOJAS)
            .map(([code, loja]) => ({
              nome: loja.name, uf: loja.uf,
              valor: Math.round((fatByCode.get(Number(code)) || 0) * 100) / 100,
            }))
            .filter((l) => l.valor > 0)
            .sort((a, b) => b.valor - a.valor);
        }
        // Fallback: se per_seller de revenda/multimarcas falhar (timeout/empty),
        // exibe 1 linha agregada usando o total canal-level de canais-totals-all
        // (segs). Garante que o canal nunca fica "sumido" da lista.
        let vendedoresB2R = vendedoresB2R_oficial;
        let vendedoresB2M = vendedoresB2M_oficial;
        // SEMPRE exibe o canal (mesmo zerado) pra manter consistência visual:
        // o frontend mostra zerados com opacidade reduzida.
        if (vendedoresB2R.length === 0) {
          vendedoresB2R = [{ nome: 'Revenda', valor: Math.round(Number(segs.revenda || 0) * 100) / 100 }];
        }
        if (vendedoresB2M.length === 0) {
          vendedoresB2M = [{ nome: 'Multimarcas', valor: Math.round(Number(segs.multimarcas || 0) * 100) / 100 }];
        }
        // Mesmo fallback pra varejo: se ranking-faturamento falhou mas o cache
        // tem o total agregado, mostra 1 linha "Varejo (total)".
        if (lojasB2C.length === 0 && Number(segs.varejo || 0) > 0) {
          lojasB2C = [{ nome: 'Varejo (total)', uf: null, valor: Math.round(Number(segs.varejo) * 100) / 100 }];
        }
        // Singles — usam BRUTO direto (não subtrai credev) pra evitar o bug
        // do TOTVS: certos pedidos de adiantamento (ex: "Piedade adiantamento"
        // do Jhemyson/franquia) são erroneamente classificados como credev e
        // inflavam o credev artificialmente, derrubando o valor real.
        //
        // Prioridade: segs (canal-level, fonte confiável do cache Supabase ou
        // canais-totals-all) > per_seller (canal-totals direto). per_seller
        // só é usado como fallback se segs for 0 (range curto sem cache).
        const somaPerSellerBruto = (list) =>
          (list || []).reduce((s, x) => s + Number(x.invoice_value || 0), 0);
        const pickSingle = (psList, segKey) => {
          const segVal = Number(segs[segKey] || 0);
          if (segVal > 0) return segVal;
          return somaPerSellerBruto(psList);
        };
        // Singles SEMPRE aparecem (mesmo zero) pra comparar Ontem×Semana×Mês.
        const vendedoresSingles = [];
        const addSingle = (canal, nome, valor) => {
          vendedoresSingles.push({ nome, canal, valor: Math.round(valor * 100) / 100 });
        };
        addSingle('franquia', 'Jhemyson', pickSingle(psFranquia, 'franquia'));
        addSingle('inbound_david', 'David', pickSingle(psDavid, 'inbound_david'));
        addSingle('inbound_rafael', 'Rafael', pickSingle(psRafael, 'inbound_rafael'));
        // Bazar e Ricardo Eletro: usa segs (cache Supabase confiável); se 0,
        // fallback pro canal-totals direto (canal-level invoice_value).
        addSingle('bazar', 'Bazar', Number(segs.bazar || 0) || ctBazar.total);
        addSingle('ricardoeletro', 'Jesus', Number(segs.ricardoeletro || 0) || ctRicardoEletro.total);
        const showroomV = Number(segs.showroom || 0) || somaPerSellerBruto(psShowroom);
        const novidV = Number(segs.novidadesfranquia || 0) || somaPerSellerBruto(psNovid);
        addSingle('fabrica', 'Kleiton', showroomV + novidV);
        vendedoresSingles.sort((a, b) => b.valor - a.valor);

        const responseData = {
          dia_anterior: diaIso,
          datemin: dmin, datemax: dmax, periodo: periodoLabel,
          source: 'totvs-canal-totals + ranking-faturamento',
          varejo: {
            lojas: lojasB2C,
            total: Math.round(lojasB2C.reduce((s, l) => s + l.valor, 0) * 100) / 100,
          },
          multimarcas: {
            vendedores: mergeTitulares(vendedoresB2M, TITULARES_B2M),
            total: Math.round(vendedoresB2M.reduce((s, v) => s + v.valor, 0) * 100) / 100,
          },
          revenda: {
            vendedores: mergeTitulares(vendedoresB2R, TITULARES_B2R),
            total: Math.round(vendedoresB2R.reduce((s, v) => s + v.valor, 0) * 100) / 100,
          },
          outros: {
            vendedores: vendedoresSingles,
            total: Math.round(vendedoresSingles.reduce((s, v) => s + v.valor, 0) * 100) / 100,
          },
        };
        OVL_CACHE.set(cacheKey, { ts: Date.now(), data: responseData });
        try { _resolveInflight(responseData); } catch {}
        return successResponse(res, responseData);
      }
      const cap = (s) =>
        String(s || '').trim().toLowerCase().split(/\s+/)
          .map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');

      // Variáveis que serão preenchidas conforme o período
      let canalTotais = {};         // { varejo: X, revenda: Y, multimarcas: Z, ... }
      let vendedoresB2R = [];       // [{ nome, valor }]
      let vendedoresB2M = [];       // [{ nome, valor }]

      // === FETCH PARALELO conforme o período ===
      if (periodoLabel === 'mes') {
        const ano = Number(dmin.slice(0, 4));
        const mes = Number(dmin.slice(5, 7));
        const [resMensal, resVendedores] = await Promise.all([
          axios.get(`${INTERNAL_API_BASE}/api/forecast/promessa-mensal`,
            { params: { ano, mes, until_today: 'false' }, timeout: 240000 }).catch(() => null),
          axios.get(`${INTERNAL_API_BASE}/api/forecast/vendedores-mensal`,
            { params: { ano, mes, until_today: 'false' }, timeout: 240000 }).catch(() => null),
        ]);
        // Canal totais do /promessa-mensal
        const canaisMensal = resMensal?.data?.data?.canais || resMensal?.data?.canais || [];
        for (const c of canaisMensal) {
          const k = c.canal_key || c.canal;
          if (k) canalTotais[k] = Number(c.fat_realizado || c.realizado || c.real || 0);
        }
        // Per-seller de /vendedores-mensal
        const cards = resVendedores?.data?.data?.cards || resVendedores?.data?.cards || [];
        for (const card of cards) {
          const lista = [...(card.vendedores || []), ...(card.extras || [])]
            .map((v) => ({
              nome: cap(v.label || v.nome || v.nomeExibicao || '—'),
              valor: Math.round(Number(v.real || v.realizado || 0) * 100) / 100,
            }))
            .filter((v) => v.valor > 0)
            .sort((a, b) => b.valor - a.valor);
          if (card.code === 'B2R') vendedoresB2R = lista;
          else if (card.code === 'B2M') vendedoresB2M = lista;
        }
      } else if (periodoLabel === 'semana') {
        // ano e semana DEVEM vir do mesmo cálculo ISO — em 01-03/jan a ISO week
        // pode estar no ano anterior (ex.: 01/01/2027 = semana 53 de 2026).
        const { ano, semana } = getIsoWeek(new Date());
        const [resSemanal, resVendedores] = await Promise.all([
          axios.get(`${INTERNAL_API_BASE}/api/forecast/promessa-semanal`,
            { params: { ano, semana, until_today: 'false' }, timeout: 240000 }).catch(() => null),
          axios.get(`${INTERNAL_API_BASE}/api/forecast/promessa-vendedores`,
            { params: { ano, semana, until_today: 'false' }, timeout: 240000 }).catch(() => null),
        ]);
        const canaisSemanal = resSemanal?.data?.data?.canais || resSemanal?.data?.canais || [];
        for (const c of canaisSemanal) {
          const k = c.canal_key || c.canal;
          if (k) canalTotais[k] = Number(c.fat_realizado || c.realizado || c.real || 0);
        }
        const cards = resVendedores?.data?.data?.cards || resVendedores?.data?.cards || [];
        for (const card of cards) {
          const lista = [...(card.vendedores || []), ...(card.extras || [])]
            .map((v) => ({
              nome: cap(v.label || v.nome || v.nomeExibicao || '—'),
              valor: Math.round(Number(v.real || v.realizado || 0) * 100) / 100,
            }))
            .filter((v) => v.valor > 0)
            .sort((a, b) => b.valor - a.valor);
          if (card.code === 'B2R') vendedoresB2R = lista;
          else if (card.code === 'B2M') vendedoresB2M = lista;
        }
      } else {
        // periodoLabel === 'ontem' — usa /ontem-canal direto (TOTVS)
        // 100% alinhado com "Faturamento de Ontem por Canal" das Métricas Diárias
        const r = await axios.get(`${INTERNAL_API_BASE}/api/forecast/ontem-canal`,
          { timeout: 180000 }).catch(() => null);
        const canais = r?.data?.data?.canais || r?.data?.canais || [];
        for (const c of canais) {
          const k = c.canal_key || c.canal;
          if (k) canalTotais[k] = Number(c.fat_dia_anterior || 0);
        }
        // 1 linha por canal (Revenda, Multimarcas, David, Rafael)
        if ((canalTotais.revenda || 0) > 0) {
          vendedoresB2R = [{ nome: 'Revenda', valor: canalTotais.revenda }];
        }
        vendedoresB2M = [];
        if ((canalTotais.multimarcas || 0) > 0)
          vendedoresB2M.push({ nome: 'Multimarcas', valor: canalTotais.multimarcas });
        if ((canalTotais.inbound_david || 0) > 0)
          vendedoresB2M.push({ nome: 'David', valor: canalTotais.inbound_david });
        if ((canalTotais.inbound_rafael || 0) > 0)
          vendedoresB2M.push({ nome: 'Rafael', valor: canalTotais.inbound_rafael });
      }

      // === Varejo: TEMPORÁRIO 1 linha "Varejo" do canalTotais ===
      // (per-loja desativado até alinharmos fontes — ranking-faturamento
      // estava demorando demais e dando timeout)
      const lojasB2C = [];
      const varejoTotal = Number(canalTotais.varejo || 0);
      if (varejoTotal > 0) {
        lojasB2C.push({ nome: 'Varejo', uf: null, valor: Math.round(varejoTotal * 100) / 100 });
      }

      // === Outros canais: usa canalTotais (já vem dos endpoints oficiais) ===
      const vendedoresSingles = [];
      const addSingle = (canalKey, nome) => {
        const v = Number(canalTotais[canalKey] || 0);
        if (v > 0) vendedoresSingles.push({ nome, canal: canalKey, valor: Math.round(v * 100) / 100 });
      };
      addSingle('franquia', 'Jhemyson');
      addSingle('bazar', 'Bazar');
      addSingle('ricardoeletro', 'Jesus');
      // Kleiton = showroom + novidadesfranquia (ou "fabrica" agregado)
      const kleitonV = Number(canalTotais.fabrica || 0)
        || (Number(canalTotais.showroom || 0) + Number(canalTotais.novidadesfranquia || 0));
      if (kleitonV > 0) {
        vendedoresSingles.push({ nome: 'Kleiton', canal: 'fabrica', valor: Math.round(kleitonV * 100) / 100 });
      }
      vendedoresSingles.sort((a, b) => b.valor - a.valor);

      const responseData = {
        dia_anterior: diaIso,
        datemin: dmin,
        datemax: dmax,
        periodo: periodoLabel,
        source: 'official-metricas-diarias',
        varejo: {
          lojas: lojasB2C,
          total: Math.round(lojasB2C.reduce((s, l) => s + l.valor, 0) * 100) / 100,
        },
        multimarcas: {
          vendedores: mergeTitulares(vendedoresB2M, TITULARES_B2M),
          total: Math.round(vendedoresB2M.reduce((s, v) => s + v.valor, 0) * 100) / 100,
        },
        revenda: {
          vendedores: mergeTitulares(vendedoresB2R, TITULARES_B2R),
          total: Math.round(vendedoresB2R.reduce((s, v) => s + v.valor, 0) * 100) / 100,
        },
        outros: {
          vendedores: vendedoresSingles,
          total: Math.round(vendedoresSingles.reduce((s, v) => s + v.valor, 0) * 100) / 100,
        },
      };

      OVL_CACHE.set(cacheKey, { ts: Date.now(), data: responseData });
      try { _resolveInflight(responseData); } catch {}
      return successResponse(res, responseData);
    } catch (e) {
      console.error('[ontem-vendedor-loja] erro:', e.message);
      try { _rejectInflight(e); } catch {}
      return errorResponse(res, e.message, 500, 'OVL_ERROR');
    }

    // ─── CÓDIGO LEGADO ABAIXO (sem uso) ────────────────────────────────────
    // Helper local: puxa per_seller de 1 canal e retorna lista [{nome, valor}]
    async function perSellerCanal(modulo) {
      try {
        const r = await axios.post(
          `${INTERNAL_API_BASE}/api/crm/canal-totals?lite=true`,
          { datemin: dmin, datemax: dmax, modulo, lite: true },
          { timeout: 30000 },
        );
        const d = r.data?.data || r.data || {};
        const perSeller = d?.per_seller || d?.totals?.per_seller || [];
        return perSeller
          .map((s) => {
            const bruto = Number(
              s.invoice_value ?? s.faturamento_liquido ?? s.liquido ?? s.total ?? 0,
            ) || 0;
            const credev = Number(s.credev_value || 0);
            const liquido = Math.max(0, bruto - credev);
            const raw = String(s.seller_name || s.name || '—').trim();
            const nome = raw
              .toLowerCase()
              .split(/\s+/)
              .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
              .join(' ');
            return { nome, valor: Math.round(liquido * 100) / 100 };
          })
          .filter((v) => v.valor > 0)
          .sort((a, b) => b.valor - a.valor);
      } catch (e) {
        console.warn(`[ontem-vendedor-loja] per_seller(${modulo}) falhou: ${e.message}`);
        return [];
      }
    }

    // 1) Multimarcas + Revenda por vendedor (canal-totals per_seller)
    let [vendedoresB2M, vendedoresB2R] = await Promise.all([
      perSellerCanal('multimarcas'),
      perSellerCanal('revenda'),
    ]);

    // 1a) Fallback se TOTVS deu timeout — usa /faturamento-transacao/resumo
    // que tem totais por canal já líquido. Mostra 1 linha agregada por canal,
    // sem detalhe por vendedor, mas pelo menos não fica zerado.
    let resumoSupabase = null;
    async function getResumoSupabase() {
      if (resumoSupabase !== null) return resumoSupabase;
      try {
        const r = await axios.get(
          `${INTERNAL_API_BASE}/api/faturamento-transacao/resumo`,
          { params: { datemin: dmin, datemax: dmax }, timeout: 30000 },
        );
        resumoSupabase = r.data?.por_canal || {};
      } catch (e) {
        console.warn(`[ontem-vendedor-loja] resumo Supabase falhou: ${e.message}`);
        resumoSupabase = {};
      }
      return resumoSupabase;
    }

    if (vendedoresB2M.length === 0) {
      const resumo = await getResumoSupabase();
      const valor = Number(resumo?.multimarcas?.total || 0);
      if (valor > 0) vendedoresB2M = [{ nome: 'Multimarcas', valor: Math.round(valor * 100) / 100 }];
    }
    if (vendedoresB2R.length === 0) {
      const resumo = await getResumoSupabase();
      const valor = Number(resumo?.revenda?.total || 0);
      if (valor > 0) vendedoresB2R = [{ nome: 'Revenda', valor: Math.round(valor * 100) / 100 }];
    }

    // 1b) Single-seller channels: cada canal tem 1 vendedor fixo.
    //     Puxa de /faturamento-transacao/resumo (Supabase pré-agregado, líquido,
    //     responde em segundos). Mesma fonte usada pelo Comparativo Anual.
    //     - inbound_david   → David
    //     - inbound_rafael  → Rafael
    //     - franquia        → Jhemyson
    //     - showroom + novidadesfranquia (fabrica) → Kleiton
    const SINGLE_SELLER = [
      { canal: 'inbound_david',  nome: 'David',          canalLabel: 'inbound_david'  },
      { canal: 'inbound_rafael', nome: 'Rafael',         canalLabel: 'inbound_rafael' },
      { canal: 'franquia',       nome: 'Jhemyson',       canalLabel: 'franquia'       },
      { canal: 'fabrica',        nome: 'Kleiton',        canalLabel: 'fabrica',
        somaDe: ['showroom', 'novidadesfranquia'] },
      // Canais sem vendedor específico — usam o nome do canal como label
      { canal: 'bazar',          nome: 'Bazar',          canalLabel: 'bazar'          },
      { canal: 'ricardoeletro',  nome: 'Ricardo Eletro', canalLabel: 'ricardoeletro'  },
    ];
    // Pra single-seller usa canais-totals-all (1 chamada agregada). Valor é
    // bruto neste modo lite, mas pra esses canais (franquia/showroom/novidades
    // /inbound) o credev é mínimo — diferença <2% na prática.
    // Pra single-seller tenta canais-totals-all (timeout curto), se falhar
    // fallback pro resumo Supabase.
    let vendedoresSingles = [];
    let segs = null;
    try {
      const r = await axios.post(
        `${INTERNAL_API_BASE}/api/crm/canais-totals-all?lite=true`,
        { datemin: dmin, datemax: dmax, lite: true },
        { timeout: 30000 },
      );
      segs = (r.data?.data || r.data || {}).segmentos || {};
    } catch (e) {
      console.warn(`[ontem-vendedor-loja] canais-totals-all falhou, usando resumo: ${e.message}`);
    }

    // Se canais-totals-all não trouxe os canais alvo, completa com Supabase
    const canaisSemValor = SINGLE_SELLER.filter((s) => {
      if (!segs) return true;
      const total = s.somaDe
        ? s.somaDe.reduce((a, k) => a + Number(segs[k] || 0), 0)
        : Number(segs[s.canal] || 0);
      return total <= 0;
    });
    if (canaisSemValor.length > 0) {
      const resumo = await getResumoSupabase();
      if (!segs) segs = {};
      for (const c of canaisSemValor) {
        if (c.somaDe) {
          for (const k of c.somaDe) segs[k] = Number(resumo?.[k]?.total || 0);
        } else {
          segs[c.canal] = Number(resumo?.[c.canal]?.total || 0);
        }
      }
    }

    vendedoresSingles = SINGLE_SELLER.map((s) => {
      const valor = s.somaDe
        ? s.somaDe.reduce((acc, k) => acc + Number(segs?.[k] || 0), 0)
        : Number(segs?.[s.canal] || 0);
      return {
        nome: s.nome,
        canal: s.canalLabel,
        valor: Math.round(valor * 100) / 100,
      };
    }).filter((v) => v.valor > 0);

    // 2) Varejo por loja (fetchBranchTotalsFromTotvs).
    // Retorna bruto por loja. Em 1 dia o credev é pequeno (<5%) — aceito.
    let lojasB2C = [];
    try {
      const { getToken } = await import('../utils/totvsTokenManager.js');
      const { fetchBranchTotalsFromTotvs } = await import(
        '../totvsrouter/totvsHelper.js'
      );
      const tk = await getToken();
      if (tk?.access_token) {
        const codes = Object.keys(VAREJO_LOJAS).map(Number);
        const fat = await fetchBranchTotalsFromTotvs({
          initialToken: tk.access_token,
          branchs: codes,
          datemin: dmin,
          datemax: dmax,
          refreshToken: async () => (await getToken(true)).access_token,
          logTag: `ontem-vendedor-loja:${periodoLabel}`,
        });
        const fatByCode = new Map();
        for (const row of fat?.dataRow || []) {
          const code = Number(row.branch_code ?? row.branch ?? 0);
          fatByCode.set(
            code,
            (fatByCode.get(code) || 0) + Number(row.invoice_value || 0),
          );
        }
        lojasB2C = Object.entries(VAREJO_LOJAS)
          .map(([code, loja]) => ({
            nome: loja.name,
            uf: loja.uf,
            valor: Math.round((fatByCode.get(Number(code)) || 0) * 100) / 100,
          }))
          .filter((l) => l.valor > 0)
          .sort((a, b) => b.valor - a.valor);
      }
    } catch (e) {
      console.warn(`[ontem-vendedor-loja] varejo falhou: ${e.message}`);
    }

    const responseData = {
      dia_anterior: diaIso,
      datemin: dmin,
      datemax: dmax,
      periodo: periodoLabel,
      varejo: {
        lojas: lojasB2C,
        total: Math.round(lojasB2C.reduce((s, l) => s + l.valor, 0) * 100) / 100,
      },
      multimarcas: {
        vendedores: mergeTitulares(vendedoresB2M, TITULARES_B2M),
        total:
          Math.round(vendedoresB2M.reduce((s, v) => s + v.valor, 0) * 100) /
          100,
      },
      revenda: {
        vendedores: mergeTitulares(vendedoresB2R, TITULARES_B2R),
        total:
          Math.round(vendedoresB2R.reduce((s, v) => s + v.valor, 0) * 100) /
          100,
      },
      // Demais canais com 1 vendedor fixo cada
      outros: {
        vendedores: vendedoresSingles,
        total:
          Math.round(vendedoresSingles.reduce((s, v) => s + v.valor, 0) * 100) /
          100,
      },
    };

    // Cache poisoning guard: se SÓ varejo veio (TOTVS bloqueou canal-totals),
    // não cacheia — senão prox req volta resposta parcial por 5min.
    const canaisNaoVarejoVazios =
      vendedoresB2M.length === 0 &&
      vendedoresB2R.length === 0 &&
      vendedoresSingles.length === 0;
    if (!canaisNaoVarejoVazios) {
      OVL_CACHE.set(cacheKey, { ts: Date.now(), data: responseData });
    } else {
      console.warn(
        `[ontem-vendedor-loja] resposta parcial (só varejo) — NÃO cacheando ${cacheKey}`,
      );
    }
    try { _resolveInflight(responseData); } catch {}

    return successResponse(res, responseData);
  }),
);

// ═══════════════════════════════════════════════════════════════
// GET /forecast/bluecred-count?datemin=&datemax=
// Conta clientes classificados como "BLUE CRED" no TOTVS
// (typeCode=55 / code='8' / 'TIPO CLIENTE VAREJO' / BLUE CRED)
// Lê da tabela local `pessoas_bluecred`, populada por job diário.
// ═══════════════════════════════════════════════════════════════
router.get(
  '/bluecred-count',
  asyncHandler(async (req, res) => {
    const datemin = req.query.datemin;
    const datemax = req.query.datemax;
    // Total geral (ignora datas)
    const { count: total, error: e1 } = await supabase
      .from('pessoas_bluecred')
      .select('*', { count: 'exact', head: true });
    if (e1) return errorResponse(res, e1.message, 500);
    // Período (data de classificação)
    let no_periodo = null;
    if (datemin && datemax) {
      const { count, error } = await supabase
        .from('pessoas_bluecred')
        .select('*', { count: 'exact', head: true })
        .gte('classified_at', `${datemin}T00:00:00`)
        .lte('classified_at', `${datemax}T23:59:59`);
      if (!error) no_periodo = count || 0;
    }
    return successResponse(res, {
      total: total || 0,
      no_periodo,
      datemin: datemin || null,
      datemax: datemax || null,
    });
  }),
);

// POST /forecast/bluecred-sync — dispara sync manual
router.post(
  '/bluecred-sync',
  asyncHandler(async (req, res) => {
    const { executarSyncBluecred } = await import('../jobs/pessoas-bluecred-sync.job.js');
    const r = await executarSyncBluecred();
    return successResponse(res, r);
  }),
);

// ═══════════════════════════════════════════════════════════════
// GET /forecast/bluecard-count?datemin=&datemax=
// Conta cartões BlueCard enviados via ClickUp no período.
// Usa fetchBlueCardSentCount com cache 5 min.
// ═══════════════════════════════════════════════════════════════
router.get(
  '/bluecard-count',
  asyncHandler(async (req, res) => {
    const datemin = req.query.datemin;
    const datemax = req.query.datemax;
    if (!datemin || !datemax) {
      return errorResponse(res, 'datemin e datemax obrigatórios', 400, 'MISSING_DATES');
    }
    try {
      const count = await fetchBlueCardSentCount(datemin, datemax);
      return successResponse(res, { count, datemin, datemax });
    } catch (e) {
      return errorResponse(res, `fetchBlueCardSentCount falhou: ${e.message}`, 500);
    }
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
    // metaKey: chave da meta semanal no banco (formato novo 'YYYY-MM-Sn').
    // Cadastrado pelo PlanejamentoMensalModal (semanas do mês, 7 em 7 dias).
    const metaKey = isoWeekToMonthSemKey(ano, semana);

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
        getMetasPorCanal('semanal', metaKey),
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

    // Override: meta semanal do VAREJO calculada como % da meta mensal
    // (22.4 / 32 / 22.8 / 22.8 / 0). Outros canais ficam com a meta cadastrada
    // diretamente em forecast_canal_metas (linear ou customizada).
    const metaVarejoSem = getVarejoMetaSemanal(metasMes, metaKey);
    if (metaVarejoSem != null) {
      const antes = metasSemana.get('varejo') || 0;
      metasSemana.set('varejo', metaVarejoSem);
      console.log(
        `[promessa-semanal] varejo override ${metaKey}: cadastrada=R$${antes.toFixed(2)} → distrib%=R$${metaVarejoSem.toFixed(2)} (meta mensal R$${(metasMes.get('varejo') || 0).toFixed(2)})`,
      );
    }

    // Aplica exclusões (ex: Recife Mall fora de Franquia a partir de 21/05)
    await aplicarExclusoesForecast(fatSemana, datemin, datemax);
    if (fatDiaAnt && diaAnteriorIso) {
      await aplicarExclusoesForecast(fatDiaAnt, diaAnteriorIso, diaAnteriorIso);
    }

    // ─── Override REVENDA + MULTIMARCAS: fonte canônica = painel de vendedores
    // O fat-seg perde NFs por filtros de branch/op no canal-totals; o painel
    // de vendedores TOTVS (B2R/B2M) é mais completo. Reusa buildVendedoresLiquido
    // pra garantir que a Promessa Semanal mostre o mesmo número do "Faturado
    // por Vendedor".
    //
    // B2R → canal 'revenda'
    // B2M → divide os vendedores por canal individual:
    //   • dealers 65, 177, 259 (Renato, Walter, Arthur) → 'multimarcas'
    //   • dealers 26, 69 (David, Thalis)                → 'inbound_david'
    //   • dealer 21 (Rafael)                            → 'inbound_rafael'
    // Evita double-counting (antes somava tudo em multimarcas mas as colunas
    // inbound_david/rafael já tinham valor → David/Rafael contados 2x).
    const INBOUND_DAVID_VEND = new Set([26, 69]);
    const INBOUND_RAFAEL_VEND = new Set([21]);
    const aplicarOverride = async (grupo, canalKey, dmin, dmax, target) => {
      const liquidos = await buildVendedoresLiquido(grupo, dmin, dmax);
      if (grupo.code === 'B2M') {
        // Divide por canal individual
        let mm = 0, david = 0, rafael = 0;
        for (const v of liquidos) {
          const code = Number(v.seller_code);
          const real = Number(v.real || 0);
          if (INBOUND_DAVID_VEND.has(code)) david += real;
          else if (INBOUND_RAFAEL_VEND.has(code)) rafael += real;
          else mm += real;
        }
        const prevMM = Number((target || {}).multimarcas || 0);
        const prevDavid = Number((target || {}).inbound_david || 0);
        const prevRafael = Number((target || {}).inbound_rafael || 0);
        target.multimarcas = Math.round(mm * 100) / 100;
        target.inbound_david = Math.round(david * 100) / 100;
        target.inbound_rafael = Math.round(rafael * 100) / 100;
        console.log(
          `[promessa-semanal ${dmin}~${dmax}] B2M split: multimarcas R$${prevMM.toFixed(2)} → R$${target.multimarcas.toFixed(2)} · inbound_david R$${prevDavid.toFixed(2)} → R$${target.inbound_david.toFixed(2)} · inbound_rafael R$${prevRafael.toFixed(2)} → R$${target.inbound_rafael.toFixed(2)} (${liquidos.length} vend)`,
        );
        return;
      }
      const soma = liquidos.reduce((s, v) => s + Number(v.real || 0), 0);
      const prev = Number((target || {})[canalKey] || 0);
      target[canalKey] = Math.round(soma * 100) / 100;
      console.log(
        `[promessa-semanal ${dmin}~${dmax}] ${canalKey} override: fat-seg=R$${prev.toFixed(2)} → painel-vend=R$${target[canalKey].toFixed(2)} (${liquidos.length} vend)`,
      );
    };
    try {
      const grupoB2R = VEND_MENSAL_GROUPS.find((g) => g.code === 'B2R');
      const grupoB2M = VEND_MENSAL_GROUPS.find((g) => g.code === 'B2M');
      // Override SEMPRE até HOJE (não importa o flag until_today) — garante
      // que o número bate com o "Faturado por Vendedor" do TOTVS ao vivo.
      // Se o domingo da semana ainda não chegou, pega até hoje; senão até dom.
      const overrideMax = hojeIso < data_fim ? hojeIso : data_fim;
      const overrides = [];
      if (grupoB2R) overrides.push(aplicarOverride(grupoB2R, 'revenda', datemin, overrideMax, fatSemana));
      if (grupoB2M) overrides.push(aplicarOverride(grupoB2M, 'multimarcas', datemin, overrideMax, fatSemana));
      if (fatDiaAnt && diaAnteriorIso) {
        if (grupoB2R) overrides.push(aplicarOverride(grupoB2R, 'revenda', diaAnteriorIso, diaAnteriorIso, fatDiaAnt));
        if (grupoB2M) overrides.push(aplicarOverride(grupoB2M, 'multimarcas', diaAnteriorIso, diaAnteriorIso, fatDiaAnt));
      }
      await Promise.all(overrides);
    } catch (err) {
      console.warn('[promessa-semanal] override revenda/multimarcas falhou:', err.message);
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
    const metaKey = isoWeekToMonthSemKey(ano, semana);

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

    const metasSemana = await getMetasPorCanal('semanal', metaKey);

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
            clientes: v.clientes || 0,
            nfs: v.nfs || 0,
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

// Filiais do escopo Multimarcas (Inbound David/Rafael + seg.multimarcas).
// 99 = atacado SP · 2/200 = atacado JPA/PB · 95/87/88/90/94/97 = outras
// filiais que vendem atacado. Usado nos overrides via Supabase fiscal.
const B2M_OVERRIDE_BRANCHES = [99, 2, 95, 87, 88, 90, 94, 97];

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

// Replica EXATA do relatório SQL "Faturamento por Vendedor" do TOTVS Moda Old.
// Origem: contas a receber (duplicatas) + NF pra resolver vendedor.
// Fórmula:
//   SUM(VL_FATURA, sinal=-1 quando TP_DOCUMENTO=9 [devolução])
//   WHERE status=1, billingType≠3, documentType≠20, dischargeType≠14
//     AND operationCode NOT IN OPS_EXCLUIR_SQL (lista do SQL original)
//     AND customer NOT IN clientes_franquia (classificação tipo 2)
//   GROUP BY dealer
// Validado em 24/06/2026: bate 100% com o PDF do relatório oficial.
const OPS_EXCLUIR_SQL_OFICIAL = new Set([
  // OPS do SQL original
  1, 2, 1002, 15, 16, 1016, 510, 511, 1511, 521, 1521, 522,
  9001, 9009, 9027, 8750, 9017, 600, 1600, 2009, 3335, 3401, 200, 300,
  // OPS de Franquia/Showroom (identificadas empiricamente como excluídas
  // pelo relatório oficial — dealers 40 Jhemyson, 50 GERAL e 271 só batem
  // PDF quando essas ops são removidas)
  7234, 7254, 7255, 7007, 7240, 7259, 7279,
]);
const FAT_OFICIAL_CACHE = new Map(); // key: branchs|dmin|dmax → { ts, mapa }
const FAT_OFICIAL_TTL = 30 * 60 * 1000; // 30min

// opsAllow: Set opcional. Se passado, restringe ao subconjunto de ops daquele
// canal (ex.: [7235, 7241, 9127] pra B2M). Sem isso, vendedores de outros
// canais que operam nas mesmas branches "vazam" pro resultado.
export async function getFaturadoOficialReplica(branchs, dmin, dmax, opsAllow = null) {
  const opsKey = opsAllow ? [...opsAllow].sort().join(',') : '*';
  const key = `${[...branchs].sort().join(',')}|${dmin}|${dmax}|${opsKey}`;
  const cached = FAT_OFICIAL_CACHE.get(key);
  if (cached && Date.now() - cached.ts < FAT_OFICIAL_TTL) return cached.mapa;

  try {
    const { getToken } = await import('../utils/totvsTokenManager.js');
    const tokenData = await getToken();
    const token = tokenData?.access_token;
    if (!token) return new Map();
    const BASE = process.env.TOTVS_BASE_URL || 'https://apitotvsmoda.bhan.com.br/api/totvsmoda';

    // 1) Busca duplicatas com filtros do SQL — paginado
    async function fetchDuplicatas() {
      const all = [];
      let p = 1, hasNext = true;
      while (hasNext && p <= 50) {
        const r = await axios.post(
          `${BASE}/accounts-receivable/v2/documents/search`,
          {
            filter: {
              branchCodeList: branchs,
              startIssueDate: dmin,
              endIssueDate: dmax,
            },
            page: p, pageSize: 100, expand: 'invoice',
          },
          { headers: { Authorization: `Bearer ${token}` }, timeout: 120000 },
        );
        all.push(...(r.data?.items || []));
        hasNext = r.data?.hasNext;
        p++;
      }
      return all;
    }
    const dups = await fetchDuplicatas();

    // 2) Aplica filtros do SQL — status, documentType, billingType, dischargeType
    const filtradas = dups.filter((d) =>
      d.status === 1 &&
      d.documentType !== 20 &&
      d.billingType !== 3 &&
      d.dischargeType !== 14,
    );

    // 3) Coleta invoiceCodes únicos pra buscar dealer + operationCode das NFs
    const invCodes = new Set();
    for (const d of filtradas) {
      for (const inv of d.invoice || []) {
        if (inv?.invoiceCode) invCodes.add(inv.invoiceCode);
      }
    }
    if (invCodes.size === 0) {
      FAT_OFICIAL_CACHE.set(key, { ts: Date.now(), mapa: new Map() });
      return new Map();
    }

    // 4) Busca NFs no range (window ±2d pra cobrir issueDate fatura ≠ NF)
    const dInicio = new Date(`${dmin}T00:00:00Z`);
    dInicio.setUTCDate(dInicio.getUTCDate() - 2);
    const dFim = new Date(`${dmax}T23:59:59Z`);
    dFim.setUTCDate(dFim.getUTCDate() + 2);
    const startNF = `${dInicio.toISOString().slice(0, 10)}T00:00:00`;
    const endNF = `${dFim.toISOString().slice(0, 10)}T23:59:59`;
    const nfMap = new Map(); // invoiceCode → { op, dealer, customerCode }
    async function fetchNFs() {
      let p = 1, hasNext = true;
      while (hasNext && p <= 100) {
        const r = await axios.post(
          `${BASE}/fiscal/v2/invoices/search`,
          {
            filter: { branchCodeList: branchs, startIssueDate: startNF, endIssueDate: endNF },
            page: p, pageSize: 100, expand: 'items',
          },
          { headers: { Authorization: `Bearer ${token}` }, timeout: 120000 },
        );
        for (const it of r.data?.items || []) {
          if (!invCodes.has(it.invoiceCode)) continue;
          let dealer = null;
          for (const i of it.items || []) {
            for (const pr of i.products || []) {
              if (pr.dealerCode != null) { dealer = Number(pr.dealerCode); break; }
            }
            if (dealer != null) break;
          }
          nfMap.set(it.invoiceCode, {
            op: Number(it.operationCode),
            dealer,
            customerCode: Number(it.personCode || it.person?.personCode || 0),
            branchCode: Number(it.branchCode || 0),
          });
        }
        hasNext = r.data?.hasNext;
        p++;
      }
    }
    await fetchNFs();

    // 4.5) Carrega tabela de remapeamento manual (NFs onde dealer do produto
    // != vendedor da transação). Aplica antes de agrupar.
    // Map: `${branchCode}|${invoiceCode}` → dealer_destino (NULL = excluir NF)
    const remapMap = new Map();
    const excluirNFs = new Set();
    try {
      const supabase = (await import('../config/supabase.js')).default;
      const branchsArr = Array.from(branchs);
      const { data: remaps } = await supabase
        .from('forecast_vendedor_remap')
        .select('invoice_code, branch_code, dealer_destino')
        .in('branch_code', branchsArr);
      for (const r of remaps || []) {
        const key = `${r.branch_code}|${r.invoice_code}`;
        if (r.dealer_destino === null) {
          excluirNFs.add(key);
        } else {
          remapMap.set(key, Number(r.dealer_destino));
        }
      }
    } catch (e) {
      console.warn(`[oficial-replica] remap load: ${e.message}`);
    }

    // 5) Agrupa por dealer aplicando filtros do SQL (ops + cliente franquia)
    // + remapeamento manual (NFs específicas → vendedor correto da transação).
    // TODO: filtro de cliente franquia (classificação tipo 2) — por agora skipo
    // porque precisa de outra chamada. Pra B2R/B2M provavelmente não impacta.
    const porDealer = new Map(); // dealer → { valor, nfs: Set, clientes: Set }
    const opsAllowSet = opsAllow ? new Set([...opsAllow].map(Number)) : null;
    for (const d of filtradas) {
      const inv = (d.invoice || [])[0];
      if (!inv) continue;
      const nfInfo = nfMap.get(inv.invoiceCode);
      if (!nfInfo) continue;
      if (OPS_EXCLUIR_SQL_OFICIAL.has(nfInfo.op)) continue;
      // Filtro de ops do canal (B2M = [7235, 7241, 9127], B2R = [7236, ...]).
      // Sem ele, NFs de Varejo das filiais 95/87/88/90/94/97 vazam pra B2M.
      if (opsAllowSet && !opsAllowSet.has(Number(nfInfo.op))) continue;
      if (nfInfo.dealer == null) continue;
      const valor = d.documentType === 9
        ? -Number(d.installmentValue || 0)
        : Number(d.installmentValue || 0);
      // Aplica remap se existir pra essa branch+NF
      const remapKey = `${d.branchCode || nfInfo.branchCode}|${inv.invoiceCode}`;
      if (excluirNFs.has(remapKey)) continue; // NF marcada pra excluir do relatório
      const dealerFinal = remapMap.get(remapKey) ?? nfInfo.dealer;
      const cur = porDealer.get(dealerFinal) || { valor: 0, nfs: new Set(), clientes: new Set() };
      cur.valor += valor;
      cur.nfs.add(inv.invoiceCode);
      if (nfInfo.customerCode) cur.clientes.add(nfInfo.customerCode);
      porDealer.set(dealerFinal, cur);
    }
    const mapa = new Map();
    for (const [dealer, v] of porDealer) {
      mapa.set(dealer, {
        valor: Math.round(v.valor * 100) / 100,
        nfs: v.nfs.size,
        clientes: v.clientes.size,
      });
    }
    FAT_OFICIAL_CACHE.set(key, { ts: Date.now(), mapa });
    return mapa;
  } catch (e) {
    console.warn(`[getFaturadoOficialReplica] falhou: ${e.message}`);
    return new Map();
  }
}

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

// GET /forecast/clientes-atendidos?canal=B2M&ano=2026&mes=6&seller_code=259
// Retorna lista de clientes atendidos por um vendedor específico no período.
router.get(
  '/clientes-atendidos',
  asyncHandler(async (req, res) => {
    const canal = String(req.query.canal || '').toUpperCase();
    const sellerCode = req.query.seller_code
      ? Number(req.query.seller_code)
      : null;
    const ano = parseInt(req.query.ano, 10);
    const mes = parseInt(req.query.mes, 10);
    const semana = req.query.semana ? parseInt(req.query.semana, 10) : null;
    const grupo = VEND_MENSAL_GROUPS.find((g) => g.code === canal);
    if (!grupo) {
      return errorResponse(res, `Canal inválido: ${canal}`, 400);
    }
    let datemin, datemax;
    if (semana) {
      const range = isoWeekRange(ano, semana);
      datemin = range.data_inicio;
      datemax = range.data_fim;
    } else if (ano && mes) {
      const start = new Date(Date.UTC(ano, mes - 1, 1));
      const end = new Date(Date.UTC(ano, mes, 0));
      const hoje = new Date();
      const fim = end < hoje ? end : hoje;
      datemin = start.toISOString().slice(0, 10);
      datemax = fim.toISOString().slice(0, 10);
    } else {
      return errorResponse(res, 'ano+mes ou ano+semana obrigatórios', 400);
    }
    try {
      const r = await axios.post(
        `${INTERNAL_API_BASE}/api/crm/clientes-por-vendedor?detalhe=true`,
        {
          branchs: grupo.branchs,
          operations: grupo.operations,
          datemin,
          datemax,
          detalhe: true,
          seller_code: sellerCode,
        },
        { timeout: 200000 },
      );
      const d = r.data?.data || r.data;
      const detalhe = d?.detalhe || {};
      const clientes = sellerCode
        ? detalhe[String(sellerCode)] || []
        : detalhe;
      return successResponse(res, {
        canal,
        seller_code: sellerCode,
        datemin,
        datemax,
        clientes,
      });
    } catch (e) {
      return errorResponse(res, e.message, 500);
    }
  }),
);

async function buildVendedoresLiquido(g, datemin, datemax) {
  // FONTE PRIMÁRIA: replica EXATA do SQL "Faturamento por Vendedor" do TOTVS
  // (accounts-receivable + ops excluídas + TP_DOCUMENTO=9 com sinal −1).
  // Validado em 24/06: bate 100% com o PDF oficial.
  // FALLBACK: sale-panel + clientes-por-vendedor (mantido pra resiliência).
  const [oficialMap, sellersFallback, credevMap, customersData] = await Promise.all([
    getFaturadoOficialReplica(g.branchs, toYmd(datemin), toYmd(datemax)),
    getSellersOficial(g.branchs, g.operations, datemin, datemax),
    getCredevVendedor(g.branchs, g.operations, datemin, datemax, g.credevTipo),
    (async () => {
      try {
        const r = await axios.post(
          `${INTERNAL_API_BASE}/api/crm/clientes-por-vendedor`,
          { branchs: g.branchs, operations: g.operations, datemin: toYmd(datemin), datemax: toYmd(datemax) },
          { timeout: 240000 },
        );
        const d = r.data?.data || r.data;
        return d?.rows || {};
      } catch (e) {
        console.warn(`[buildVendedoresLiquido ${g.code}] clientes-por-vendedor falhou: ${e.message}`);
        return {};
      }
    })(),
  ]);

  // ── Override B2M: dealers David (26), Rafael (21), Thalis (69) vêm
  // direto de notas_fiscais Supabase porque o sale-panel/fiscal-invoices
  // tem bug que perde NFs recentes desses dealers. Ops oficiais inbound:
  // 7235, 7241, 9127 em todas branches B2M (99, 2, 95, 87, 88, 90, 94, 97).
  const inboundDealers = new Set([21, 26, 69]);
  const groupHasInbound = (g.sellers || []).some((s) => inboundDealers.has(Number(s)));
  if (groupHasInbound) {
    try {
      const { createClient } = await import('@supabase/supabase-js');
      const supabaseFiscal = createClient(
        process.env.SUPABASE_FISCAL_URL,
        process.env.SUPABASE_FISCAL_KEY,
      );
      const inboundBranchs = [99, 2, 95, 87, 88, 90, 94, 97];
      const inboundOps = [7235, 7241, 9127];
      const { data: nfs } = await supabaseFiscal
        .from('notas_fiscais')
        .select('dealer_code, total_value, invoice_status, operation_type, person_code, invoice_code')
        .gte('issue_date', toYmd(datemin)).lte('issue_date', toYmd(datemax))
        .in('branch_code', inboundBranchs)
        .in('operation_code', inboundOps)
        .in('dealer_code', [...inboundDealers]);
      const valid = (nfs || []).filter(
        (n) => n.invoice_status !== 'Canceled' && n.invoice_status !== 'Deleted',
      );
      // Agrega por dealer: Output − Input (devoluções)
      const porDealer = new Map();
      for (const n of valid) {
        const k = String(n.dealer_code);
        const cur = porDealer.get(k) || { valor: 0, customers: new Set(), nfs: 0 };
        const sinal = n.operation_type === 'Input' ? -1 : 1;
        cur.valor += sinal * Number(n.total_value || 0);
        if (n.operation_type === 'Output') {
          if (n.person_code) cur.customers.add(Number(n.person_code));
          cur.nfs += 1;
        }
        porDealer.set(k, cur);
      }
      // Sobrescreve customersData (que vem de clientes-por-vendedor)
      for (const [code, agg] of porDealer.entries()) {
        const liquido = Math.max(0, agg.valor);
        if (liquido > 0) {
          const prev = Number(customersData[code]?.valor || 0);
          if (Math.abs(liquido - prev) > 1) {
            console.log(`[buildVendedoresLiquido ${g.code}] dealer ${code}: fiscal=R$${prev.toFixed(2)} → notas_fiscais=R$${liquido.toFixed(2)}`);
          }
          customersData[code] = {
            valor: liquido,
            customers: agg.customers.size,
            nfs: agg.nfs,
          };
        }
      }
    } catch (e) {
      console.warn(`[buildVendedoresLiquido ${g.code}] override inbound falhou: ${e.message}`);
    }
  }
  // Nomes via sellers-canal (fallback se canal-totals não trouxer)
  const nameMap = {};
  for (const s of sellersFallback || []) {
    nameMap[String(s.seller_code)] = s.seller_name;
  }
  const allow = new Set((g.sellers || []).map(Number));
  // Une todos os seller_codes vistos em ambas as fontes
  const allCodes = new Set([
    ...Object.keys(customersData),
    ...sellersFallback.map((s) => String(s.seller_code)),
  ]);
  // Une vendedores vistos em qualquer fonte (incluindo a replica oficial)
  for (const dealerCode of oficialMap.keys()) {
    allCodes.add(String(dealerCode));
  }
  const list = [];
  for (const code of allCodes) {
    if (allow.size > 0 && !allow.has(Number(code))) continue;
    const stats = customersData[code] || {};
    // PRIMÁRIA: replica oficial do SQL (já líquido, com sinal de devolução).
    const oficial = oficialMap.get(Number(code));
    if (oficial && oficial.valor > 0) {
      list.push({
        seller_code: code,
        nome: nameMap[code] || `Vend. ${code}`,
        bruto: oficial.valor,
        credev: 0, // SQL já trata devolução inline
        real: oficial.valor,
        // Cli/NFs prefere stats real do clientes-por-vendedor (escopo maior);
        // só usa oficial se stats não tiver
        clientes: Number(stats.customers || oficial.clientes || 0),
        nfs: Number(stats.nfs || oficial.nfs || 0),
      });
      continue;
    }
    // FALLBACK: fiscal/v2/invoices ou sale-panel quando oficial não trouxe
    const brutoFiscal = Number(stats.valor || 0);
    const brutoFallback = Number(
      sellersFallback.find((s) => String(s.seller_code) === code)?.value || 0,
    );
    const bruto = brutoFiscal > 0 ? brutoFiscal : brutoFallback;
    if (bruto <= 0) continue;
    const credev = Number(credevMap[code] || 0);
    list.push({
      seller_code: code,
      nome: nameMap[code] || `Vend. ${code}`,
      bruto: Math.round(bruto * 100) / 100,
      credev: Math.round(credev * 100) / 100,
      // Permite negativo: vendedor com credev > bruto = devoluções > faturamento.
      // Relatório TOTVS oficial aceita negativo; cortar em 0 mascara prejuízo.
      real: Math.round((bruto - credev) * 100) / 100,
      clientes: Number(stats.customers || 0),
      nfs: Number(stats.nfs || 0),
    });
  }
  return list.sort((a, b) => b.real - a.real);
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
  { key: 'ricardoeletro', label: 'Ricardo Eletro', is_new: true }, // canal NOVO em 2026
  {
    key: 'franquia',
    label: 'Franquia',
    // Antes "B2L". Em 2025 a referência cadastrada de `franquia` já incluía
    // showroom e novidadesfranquia (ops 7254/7007/7255). Pra comparativo ficar
    // justo em 2026, somamos esses 3 canais aqui — mesma lógica do B2M.
    sources: ['franquia', 'showroom', 'novidadesfranquia'],
  },
  { key: 'bazar', label: 'Bazar', is_new: true }, // canal NOVO em 2026
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
    // Ano atual vem do TOTVS via canais-totals-all (sale-panel oficial, líquido
    // com credev já subtraído). Antes usava /faturamento-transacao/resumo
    // (Supabase pré-agregado) mas estava sub-sincronizado → valores errados
    // (Ricardo Eletro R$ 1.560 vs R$ 4.240 oficial, B2M/Franquia subestimados).
    const ehMesCorrente =
      hoje.getUTCFullYear() === anoAtual && hoje.getUTCMonth() + 1 === mes;
    async function getSegViaCanaisTotals(dmin, dmax) {
      try {
        const r = await axios.post(
          `${INTERNAL_API_BASE}/api/crm/canais-totals-all?lite=true`,
          { datemin: dmin, datemax: dmax, lite: true },
          { timeout: 240000 },
        );
        const segments = (r.data?.data || r.data || {}).segmentos || {};
        if (Object.keys(segments).length === 0) return null;
        const seg = { ...segments };
        seg.fabrica = FABRICA_SOURCES.reduce(
          (s, k) => s + Number(seg[k] || 0),
          0,
        );
        return seg;
      } catch (e) {
        console.warn(`[comparativo-anual] canais-totals-all falhou: ${e.message} — fallback resumo Supabase`);
        return null;
      }
    }
    async function getSegViaTransacaoHistorico(dmin, dmax) {
      try {
        const r = await axios.get(
          `${INTERNAL_API_BASE}/api/faturamento-transacao/resumo`,
          { params: { datemin: dmin, datemax: dmax }, timeout: 60000 },
        );
        const porCanal = r.data?.por_canal || {};
        const seg = {};
        for (const k of Object.keys(porCanal)) {
          seg[k] = Number(porCanal[k].total || 0);
        }
        seg.fabrica = FABRICA_SOURCES.reduce(
          (s, k) => s + Number(seg[k] || 0),
          0,
        );
        return seg;
      } catch (e) {
        console.warn(`[comparativo-anual] resumo Supabase falhou: ${e.message}`);
        return null;
      }
    }
    // Override Ricardo Eletro via fiscal-movement (TOTVS oficial — sale-panel
    // tem bug que ignora algumas NFs br=111 op=512).
    async function getRicardoEletroViaFiscalMovement(dmin, dmax) {
      try {
        const { getToken } = await import('../utils/totvsTokenManager.js');
        const tk = await getToken();
        if (!tk?.access_token) return null;
        const RE_OPS = [512, 5102, 7236, 200, 510, 521, 545, 548, 7237, 7269, 7277, 7279];
        const RE_EXCL = new Set([5153, 5152, 5909, 5910, 5912, 6914, 7273]);
        const fmEndpoint = `https://www30.bhan.com.br:9443/api/totvsmoda/analytics/v2/fiscal-movement/search`;
        const personSums = new Map();
        let page = 1;
        while (true) {
          const r = await axios.post(
            fmEndpoint,
            {
              filter: {
                branchCodeList: [11, 111],
                startMovementDate: `${dmin}T00:00:00`,
                endMovementDate: `${dmax}T23:59:59`,
              },
              page, pageSize: 100,
            },
            {
              headers: { Authorization: `Bearer ${tk.access_token}`, 'Content-Type': 'application/json' },
              timeout: 60000,
            },
          );
          const items = r.data?.items || [];
          for (const it of items) {
            if (it.operationModel !== 'Sales') continue;
            const opCode = parseInt(it.operationCode);
            if (!RE_OPS.includes(opCode)) continue;
            if (RE_EXCL.has(opCode)) continue;
            const pc = parseInt(it.personCode);
            if (!pc || pc >= 100000000) continue;
            const v = parseFloat(it.netValue || it.grossValue || 0);
            if (v <= 0) continue;
            personSums.set(pc, (personSums.get(pc) || 0) + v);
          }
          if (items.length < 100) break;
          page++;
          if (page > 50) break; // safety
        }
        let total = 0;
        for (const v of personSums.values()) total += v;
        return Math.round(total * 100) / 100;
      } catch (e) {
        console.warn(`[comparativo-anual] RE fiscal-movement falhou: ${e.message}`);
        return null;
      }
    }

    const [refAnt, segAtualReal] = await Promise.all([
      getRefValues(anoAnt, mes),
      periodAtualReal
        ? ehMesCorrente
          ? (await getSegViaCanaisTotals(
              periodAtualReal.datemin,
              periodAtualReal.datemax,
            )) || getSegViaTransacaoHistorico(
              periodAtualReal.datemin,
              periodAtualReal.datemax,
            )
          : getFaturamentoPorSegmento(
              periodAtualReal.datemin,
              periodAtualReal.datemax,
            )
        : Promise.resolve(null),
    ]);
    // Override RE via fiscal-movement (mais completo que sale-panel)
    if (segAtualReal && periodAtualReal) {
      const reValor = await getRicardoEletroViaFiscalMovement(
        periodAtualReal.datemin,
        periodAtualReal.datemax,
      );
      if (reValor != null && reValor > 0) {
        const before = segAtualReal.ricardoeletro || 0;
        if (Math.abs(reValor - before) > 1) {
          console.log(`[comparativo-anual] ricardoeletro override: sale-panel=R$${before.toFixed(2)} → fiscal-movement=R$${reValor.toFixed(2)}`);
        }
        segAtualReal.ricardoeletro = reValor;
      }
    }

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
        is_new: c.is_new === true,
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

    // ─── Override REVENDA + MULTIMARCAS: fonte canônica = painel de vendedores
    // Mesma lógica do /promessa-semanal. Garante consistência entre Mensal,
    // Semanal e "Faturado por Vendedor".
    const aplicarOverrideMes = async (grupo, canalKey, dmin, dmax, target) => {
      const liquidos = await buildVendedoresLiquido(grupo, dmin, dmax);
      if (grupo.code === 'B2M') {
        // Divide por canal (multimarcas/inbound_david/inbound_rafael)
        // Evita double-counting com colunas inbound_david/rafael separadas.
        const INBOUND_DAVID_VEND_M = new Set([26, 69]);
        const INBOUND_RAFAEL_VEND_M = new Set([21]);
        let mm = 0, david = 0, rafael = 0;
        for (const v of liquidos) {
          const code = Number(v.seller_code);
          const real = Number(v.real || 0);
          if (INBOUND_DAVID_VEND_M.has(code)) david += real;
          else if (INBOUND_RAFAEL_VEND_M.has(code)) rafael += real;
          else mm += real;
        }
        target.multimarcas = Math.round(mm * 100) / 100;
        target.inbound_david = Math.round(david * 100) / 100;
        target.inbound_rafael = Math.round(rafael * 100) / 100;
        console.log(
          `[promessa-mensal ${dmin}~${dmax}] B2M split: multimarcas R$${target.multimarcas.toFixed(2)} · inbound_david R$${target.inbound_david.toFixed(2)} · inbound_rafael R$${target.inbound_rafael.toFixed(2)}`,
        );
        return;
      }
      const soma = liquidos.reduce((s, v) => s + Number(v.real || 0), 0);
      const prev = Number((target || {})[canalKey] || 0);
      target[canalKey] = Math.round(soma * 100) / 100;
      console.log(
        `[promessa-mensal ${dmin}~${dmax}] ${canalKey} override: fat-seg=R$${prev.toFixed(2)} → painel-vend=R$${target[canalKey].toFixed(2)} (${liquidos.length} vend)`,
      );
    };
    try {
      const grupoB2R = VEND_MENSAL_GROUPS.find((g) => g.code === 'B2R');
      const grupoB2M = VEND_MENSAL_GROUPS.find((g) => g.code === 'B2M');
      // Override SEMPRE até HOJE (não importa o flag until_today) — garante
      // que bate com o "Faturado por Vendedor" ao vivo.
      const hojeIsoMes = hoje.toISOString().slice(0, 10);
      const overrideMaxMes = hojeIsoMes < data_fim ? hojeIsoMes : data_fim;
      const overrides = [];
      if (grupoB2R && fatMes) overrides.push(aplicarOverrideMes(grupoB2R, 'revenda', data_inicio, overrideMaxMes, fatMes));
      if (grupoB2M && fatMes) overrides.push(aplicarOverrideMes(grupoB2M, 'multimarcas', data_inicio, overrideMaxMes, fatMes));
      if (fatDia && diaIso) {
        if (grupoB2R) overrides.push(aplicarOverrideMes(grupoB2R, 'revenda', diaIso, diaIso, fatDia));
        if (grupoB2M) overrides.push(aplicarOverrideMes(grupoB2M, 'multimarcas', diaIso, diaIso, fatDia));
      }
      await Promise.all(overrides);
    } catch (err) {
      console.warn('[promessa-mensal] override revenda/multimarcas falhou:', err.message);
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

// ============================================================
// ORÇAMENTO TRIMESTRAL POR CANAL — forecast_budget_trimestral
// Cadastro de budget (tráfego + marketing) e meta de faturamento
// por canal × trimestre. Usado pelo card "Orçamento Marketing"
// no Forecast e pela aba "Orçamento" de planejamento.
// ============================================================

// Trimestre derivado de uma data ISO (YYYY-MM-DD)
const trimestreFromIso = (iso) => {
  const d = new Date(String(iso) + 'T00:00:00');
  const m = d.getMonth() + 1;
  return Math.ceil(m / 3);
};

// GET /forecast/budget?ano=2026&trimestre=2
// GET /forecast/budget?ano=2026               (lista todos os trimestres)
// GET /forecast/budget?datemin=…&datemax=…   (deriva trimestre da data)
router.get(
  '/budget',
  asyncHandler(async (req, res) => {
    let ano = req.query.ano ? Number(req.query.ano) : null;
    let trimestre = req.query.trimestre ? Number(req.query.trimestre) : null;
    if (!ano && req.query.datemin) {
      const d = new Date(String(req.query.datemin) + 'T00:00:00');
      ano = d.getFullYear();
      trimestre = trimestreFromIso(req.query.datemin);
    }
    if (!ano) ano = new Date().getFullYear();

    let q = supabase
      .from('forecast_budget_trimestral')
      .select('*')
      .eq('ano', ano)
      .order('trimestre', { ascending: true })
      .order('canal', { ascending: true });
    if (trimestre) q = q.eq('trimestre', trimestre);
    const { data, error } = await q;
    if (error) return errorResponse(res, error.message, 500);
    return successResponse(res, { rows: data || [], ano, trimestre });
  }),
);

// POST /forecast/budget — upsert (ano, trimestre, canal)
//   body: { ano, trimestre, canal, canal_label?, budget_trafego, budget_marketing, meta_faturamento?, observacao? }
router.post(
  '/budget',
  asyncHandler(async (req, res) => {
    const {
      ano, trimestre, canal, canal_label,
      budget_trafego, budget_marketing, meta_faturamento, observacao,
    } = req.body || {};
    if (!ano || !trimestre || !canal) {
      return errorResponse(res, 'ano, trimestre, canal são obrigatórios', 400);
    }
    const trim = Number(trimestre);
    if (trim < 1 || trim > 4) return errorResponse(res, 'trimestre deve ser 1-4', 400);

    const row = {
      ano: Number(ano),
      trimestre: trim,
      canal: String(canal),
      canal_label: canal_label || null,
      budget_trafego: Number(budget_trafego || 0),
      budget_marketing: Number(budget_marketing || 0),
      meta_faturamento: Number(meta_faturamento || 0),
      observacao: observacao || null,
      updated_by: req.headers['x-user-email'] || null,
    };
    const { data, error } = await supabase
      .from('forecast_budget_trimestral')
      .upsert(row, { onConflict: 'ano,trimestre,canal' })
      .select('*')
      .single();
    if (error) return errorResponse(res, error.message, 500);
    return successResponse(res, data, 'Orçamento salvo');
  }),
);

// DELETE /forecast/budget/:id
router.delete(
  '/budget/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return errorResponse(res, 'id inválido', 400);
    const { error } = await supabase
      .from('forecast_budget_trimestral')
      .delete()
      .eq('id', id);
    if (error) return errorResponse(res, error.message, 500);
    return successResponse(res, { id }, 'Removido');
  }),
);

// GET /forecast/budget/summary?datemin=…&datemax=…
// Retorna o orçamento do trimestre que CONTÉM o range pedido + gasto real
// (Wpp+Ads) calculado do TRIMESTRE INTEIRO até hoje, não só do período
// selecionado — senão a comparação fica errada (budget abr+mai+jun vs
// gasto só jun dá saldo positivo falso).
router.get(
  '/budget/summary',
  asyncHandler(async (req, res) => {
    const dmin = String(req.query.datemin || '');
    const dmax = String(req.query.datemax || '');
    if (!dmin || !dmax) return errorResponse(res, 'datemin e datemax obrigatórios', 400);
    const ano = new Date(dmin + 'T00:00:00').getFullYear();
    const trimestre = trimestreFromIso(dmin);

    const { data: rows, error } = await supabase
      .from('forecast_budget_trimestral')
      .select('*')
      .eq('ano', ano)
      .eq('trimestre', trimestre)
      .order('canal');
    if (error) return errorResponse(res, error.message, 500);

    const total = (rows || []).reduce(
      (acc, r) => {
        acc.budget_trafego += Number(r.budget_trafego || 0);
        acc.budget_marketing += Number(r.budget_marketing || 0);
        acc.meta_faturamento += Number(r.meta_faturamento || 0);
        return acc;
      },
      { budget_trafego: 0, budget_marketing: 0, meta_faturamento: 0 },
    );
    total.budget_total = total.budget_trafego + total.budget_marketing;

    // ── Range do trimestre INTEIRO + Quebra por mês ──
    // Q1 = jan-mar, Q2 = abr-jun, Q3 = jul-set, Q4 = out-dez
    const mesInicio = (trimestre - 1) * 3; // 0,3,6,9
    const ymd = (d) => d.toISOString().slice(0, 10);
    const hojeIso = ymd(new Date());
    // 3 meses do trimestre: cada um com range (1º → último dia, mas truncado em hoje)
    const NOMES_MES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
                       'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    const meses = [];
    for (let i = 0; i < 3; i++) {
      const m = mesInicio + i;
      const ini = ymd(new Date(Date.UTC(ano, m, 1)));
      const fim = ymd(new Date(Date.UTC(ano, m + 1, 0)));
      // Se mês ainda não começou (futuro), pula
      if (ini > hojeIso) continue;
      const fimReal = fim < hojeIso ? fim : hojeIso;
      meses.push({
        mes_num: m + 1, // 1-12
        mes_label: NOMES_MES[m],
        datemin: ini,
        datemax: fimReal,
      });
    }
    const trimInicioIso = meses[0]?.datemin || ymd(new Date(Date.UTC(ano, mesInicio, 1)));
    const trimFimReal = meses[meses.length - 1]?.datemax || trimInicioIso;

    // Busca gasto por MÊS em paralelo (3 chamadas wpp + 3 chamadas ads)
    const buscarMes = async (m) => {
      const out = {
        ...m,
        gasto_wpp: 0,
        gasto_ads: 0,
        gasto_wpp_by_canal: {},
        gasto_ads_by_canal: {},
      };
      try {
        const [wppR, adsR] = await Promise.allSettled([
          axios.post(`${INTERNAL_API_BASE}/api/meta/conversation-costs`,
            { startDate: m.datemin, endDate: m.datemax },
            { timeout: 120000 }),
          axios.post(`${INTERNAL_API_BASE}/api/meta/ads-spend`,
            { startDate: m.datemin, endDate: m.datemax },
            { timeout: 120000 }),
        ]);
        if (wppR.status === 'fulfilled') {
          const d = wppR.value?.data?.data || wppR.value?.data || {};
          const t = d.totals || {};
          out.gasto_wpp = Number(t.costBRL ?? ((t.cost ?? 0) * 5.8)) || 0;
          for (const [k, v] of Object.entries(d.by_canal || {})) {
            out.gasto_wpp_by_canal[k] = Number(v.costBRL ?? ((v.cost ?? 0) * 5.8)) || 0;
          }
        }
        if (adsR.status === 'fulfilled') {
          const d = adsR.value?.data?.data || adsR.value?.data || {};
          out.gasto_ads = Number(d.totals?.spend || 0);
          out.gasto_ads_by_canal = Object.fromEntries(
            Object.entries(d.by_canal || {}).map(([k, v]) => [k, Number(v?.spend || 0)]),
          );
        }
      } catch (e) {
        console.warn(`[budget/summary] gasto ${m.mes_label} falhou: ${e.message}`);
      }
      return out;
    };

    const mesesResult = await Promise.all(meses.map(buscarMes));

    // Agrega totais do trimestre (soma dos meses)
    let gasto_wpp = 0;
    let gasto_ads = 0;
    const gasto_wpp_by_canal = {};
    const gasto_ads_by_canal = {};
    for (const m of mesesResult) {
      gasto_wpp += m.gasto_wpp;
      gasto_ads += m.gasto_ads;
      for (const [k, v] of Object.entries(m.gasto_wpp_by_canal)) {
        gasto_wpp_by_canal[k] = (gasto_wpp_by_canal[k] || 0) + v;
      }
      for (const [k, v] of Object.entries(m.gasto_ads_by_canal)) {
        gasto_ads_by_canal[k] = (gasto_ads_by_canal[k] || 0) + v;
      }
    }

    // Anexa gasto por canal — total + por mês
    const canaisComGasto = (rows || []).map((r) => ({
      ...r,
      gasto_wpp: gasto_wpp_by_canal[r.canal] || 0,
      gasto_ads: gasto_ads_by_canal[r.canal] || 0,
      por_mes: mesesResult.map((m) => ({
        mes_num: m.mes_num,
        mes_label: m.mes_label,
        gasto_wpp: m.gasto_wpp_by_canal[r.canal] || 0,
        gasto_ads: m.gasto_ads_by_canal[r.canal] || 0,
      })),
    }));

    total.gasto_wpp = gasto_wpp;
    total.gasto_ads = gasto_ads;
    total.gasto_total = gasto_wpp + gasto_ads;
    total.saldo = total.budget_total - total.gasto_total;

    return successResponse(res, {
      ano, trimestre,
      canais: canaisComGasto,
      total,
      // Resumo por mês (totais)
      meses: mesesResult.map((m) => ({
        mes_num: m.mes_num,
        mes_label: m.mes_label,
        datemin: m.datemin,
        datemax: m.datemax,
        gasto_wpp: m.gasto_wpp,
        gasto_ads: m.gasto_ads,
        gasto_total: m.gasto_wpp + m.gasto_ads,
      })),
      periodo_trimestre: { datemin: trimInicioIso, datemax: trimFimReal },
      periodo_selecionado: { datemin: dmin, datemax: dmax },
    });
  }),
);

// GET /forecast/_debug-replica?branchs=99&dmin=2026-06-01&dmax=2026-06-30
router.get(
  '/_debug-replica',
  asyncHandler(async (req, res) => {
    const branchs = String(req.query.branchs || '99').split(',').map(Number);
    const dmin = String(req.query.dmin || '');
    const dmax = String(req.query.dmax || '');
    if (!dmin || !dmax) return errorResponse(res, 'dmin/dmax obrigatórios', 400);
    const mapa = await getFaturadoOficialReplica(branchs, dmin, dmax);
    const rows = [];
    let total = 0;
    for (const [dealer, info] of mapa.entries()) {
      rows.push({ dealer, valor: info.valor, nfs: info.nfs, clientes: info.clientes });
      total += info.valor;
    }
    rows.sort((a, b) => b.valor - a.valor);
    return successResponse(res, { branchs, dmin, dmax, total, count: rows.length, rows });
  }),
);

export default router;
