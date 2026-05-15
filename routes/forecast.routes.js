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
    throw new Error(`Instância "${CROSBYBOT_NAME}" não encontrada no banco. Rode sync.`);
  }
  try {
    await axios.post(
      `${UAZ_BASE}/send/text`,
      { number, text },
      { headers: { token: sender.token, 'Content-Type': 'application/json' }, timeout: 30_000 },
    );
  } catch (err) {
    if (err.response?.status === 404) {
      await axios.post(
        `${UAZ_BASE}/sendText`,
        { number, text },
        { headers: { token: sender.token, 'Content-Type': 'application/json' }, timeout: 30_000 },
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
    throw new Error(`Instância "${CROSBYBOT_NAME}" não encontrada no banco. Rode sync.`);
  }
  // Aceita imagem com ou sem prefixo data:URI
  const cleanB64 = String(imageBase64 || '').replace(/^data:image\/\w+;base64,/, '');
  if (!cleanB64) throw new Error('Imagem vazia');

  // UAzapi /send/media — tenta dois formatos comuns por compatibilidade
  const tries = [
    { url: `${UAZ_BASE}/send/media`, body: { number, type: 'image', file: cleanB64, text: caption } },
    { url: `${UAZ_BASE}/send/media`, body: { number, mediatype: 'image', file: `data:image/png;base64,${cleanB64}`, text: caption } },
    { url: `${UAZ_BASE}/sendImage`,  body: { number, image: cleanB64, caption } },
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
      return { sender: sender.name, recipient: number, endpoint: t.url, status: sender.status };
    } catch (err) {
      lastErr = err;
      // Se for 4xx (not found), tenta o próximo formato
      if (err.response?.status === 404 || err.response?.status === 400) continue;
      throw err;
    }
  }
  throw lastErr || new Error('Nenhum endpoint UAzapi aceitou o envio de imagem');
}

const INTERNAL_API_BASE =
  process.env.INTERNAL_API_BASE_URL || `http://localhost:${process.env.PORT || 4100}`;

// ──────────────────────────────────────────────────────────────
// Configuração dos canais (igual ao Forecast "Por Canal")
// ──────────────────────────────────────────────────────────────
// Canal "fabrica" é virtual: soma showroom + novidadesfranquia.
// As metas usam canal='fabrica' na forecast_canal_metas.
const FABRICA_SOURCES = ['showroom', 'novidadesfranquia'];

const CANAIS = [
  { key: 'varejo',         label: 'Varejo' },
  { key: 'revenda',        label: 'Revenda' },
  { key: 'multimarcas',    label: 'Multimarcas' },
  { key: 'inbound_david',  label: 'MTM Inbound David' },
  { key: 'inbound_rafael', label: 'MTM Inbound Rafael' },
  { key: 'franquia',       label: 'Franquia' },
  { key: 'bazar',          label: 'Bazar' },
  { key: 'fabrica',        label: 'Fábrica (Kleiton)' }, // showroom + novidadesfranquia
  { key: 'business',       label: 'Business' },
  { key: 'ricardoeletro',  label: 'Ricardo Eletro' },
];

// ──────────────────────────────────────────────────────────────
// Helpers de período
// ──────────────────────────────────────────────────────────────

function getIsoWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
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
  if (hoje.getUTCFullYear() === ano && hoje.getUTCMonth() + 1 === mes) ref = hoje;
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
    const r = await axios.post(
      `${INTERNAL_API_BASE}/api/crm/faturamento-por-segmento`,
      { datemin: toYmd(datemin), datemax: toYmd(datemax) },
      { timeout: 180000 }, // endpoint pode demorar (faz paginação no TOTVS)
    );
    const seg = r.data?.data?.segmentos || r.data?.segmentos || {};
    const out = { ...seg };
    // Canal virtual "fabrica" = showroom + novidadesfranquia
    out.fabrica = FABRICA_SOURCES.reduce((s, k) => s + Number(seg[k] || 0), 0);
    return out;
  } catch (e) {
    console.warn('[forecast/promessa] getFaturamentoPorSegmento falhou:', e?.message);
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
  return new Map((data || []).map((m) => [String(m.canal).toLowerCase(), Number(m.valor_meta || 0)]));
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
    const untilToday = req.query.until_today === 'true' || req.query.until_today === '1';

    const { data_inicio, data_fim } = isoWeekRange(ano, semana);
    const wKey = weekKey(ano, semana);

    // Dias úteis (seg-sáb) da semana (uso geral)
    const startDate = new Date(`${data_inicio}T12:00:00Z`);
    const endDate = new Date(`${data_fim}T12:00:00Z`);
    const diasUteisTotal = diasUteisRangeMonSat(startDate, endDate);
    const refDecorr = hoje < endDate ? hoje : endDate;
    const diasUteisDecorridos = refDecorr < startDate
      ? 0
      : diasUteisRangeMonSat(startDate, refDecorr);

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

    const [metasSemana, metasMes, fatSemana, fatDiaAnt] = await Promise.all([
      getMetasPorCanal('semanal', wKey),
      getMetasPorCanal('mensal', mKey),
      getFaturamentoPorSegmento(datemin, datemax),
      diaAnteriorIso
        ? getFaturamentoPorSegmento(diaAnteriorIso, diaAnteriorIso)
        : Promise.resolve(null),
    ]);

    const diasUteisMes = diasUteisDoMes(refMesAno, refMesNum);

    const canaisOut = CANAIS.map((c) => {
      const meta = metasSemana.get(c.key) || 0;
      const real = Number((fatSemana || {})[c.key] || 0);
      const fatAnt = Number((fatDiaAnt || {})[c.key] || 0);
      const pct = meta > 0 ? (real / meta) * 100 : 0;

      // Qnt Deveria = meta × min(dias_decorridos, 6) / 6
      // Varejo: dom-sáb / Demais: seg-sáb
      const diasCanal = diasDecorridosCanal(c.key);
      const qntDeveria = meta * diasCanal / 6;

      const forecastMensal = metasMes.get(c.key) || 0;
      const metaDoDia = forecastMensal > 0 && diasUteisMes > 0
        ? forecastMensal / diasUteisMes
        : (diasUteisTotal > 0 ? meta / diasUteisTotal : 0);

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
      { meta_realista: 0, faturamento_real: 0, qnt_deveria: 0, meta_do_dia: 0, fat_dia_anterior: 0 },
    );
    total.percentual = total.meta_realista > 0
      ? Number(((total.faturamento_real / total.meta_realista) * 100).toFixed(2))
      : 0;

    return successResponse(res, {
      ano,
      semana_iso: semana,
      data_inicio,
      data_fim,
      dia_anterior: diaAnteriorIso,
      dias_uteis_total: diasUteisTotal,
      dias_uteis_decorridos: diasUteisDecorridos,
      period_key: wKey,
      mes_referencia: { ano: refMesAno, mes: refMesNum, period_key: mKey, dias_uteis: diasUteisMes },
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
      { nome: 'MICHEL',  label: 'Michel' },
      { nome: 'YAGO',    label: 'Yago' },
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
      { nome: 'RAFAEL', label: 'Rafael', canalMeta: 'inbound_rafael', canalFat: 'inbound_rafael' },
      { nome: 'DAVID',  label: 'David',  canalMeta: 'inbound_david',  canalFat: 'inbound_david' },
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
    console.warn(`[forecast/vendedores] per_seller(${modulo}) falhou:`, e?.message);
    return [];
  }
}

function findSellerFat(perSeller, nome) {
  const target = String(nome).toUpperCase().trim();
  for (const s of perSeller || []) {
    const sname = String(s.seller_name || s.name || '').toUpperCase();
    if (sname.includes(target)) {
      // Ordem de campos: invoice_value é o campo real do /canal-totals
      const v = s.invoice_value ?? s.faturamento_liquido ?? s.liquido ?? s.total_liquido ?? s.total ?? 0;
      return Number(v) || 0;
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
    const untilToday = req.query.until_today === 'true' || req.query.until_today === '1';

    const { data_inicio, data_fim } = isoWeekRange(ano, semana);
    const wKey = weekKey(ano, semana);

    // Para o REAL: cap em (hoje|ontem) se semana corrente/futura
    const endDate = new Date(`${data_fim}T12:00:00Z`);
    const ontem = new Date(hoje);
    ontem.setUTCDate(ontem.getUTCDate() - 1);
    while (ontem.getUTCDay() === 0) ontem.setUTCDate(ontem.getUTCDate() - 1);
    const refDate = untilToday ? hoje : ontem;
    const realDateMax = refDate < endDate ? refDate.toISOString().slice(0, 10) : data_fim;
    const datemin = data_inicio;
    const datemax = realDateMax;

    const metasSemana = await getMetasPorCanal('semanal', wKey);

    // Quais canais precisamos buscar per_seller
    const canaisNeeded = new Set();
    for (const card of VENDEDORES_CARDS) {
      canaisNeeded.add(card.canal);
      for (const conv of card.convidados || []) canaisNeeded.add(conv.canalFat);
    }
    const perSellerByCanal = {};
    await Promise.all(
      Array.from(canaisNeeded).map(async (m) => {
        perSellerByCanal[m] = await getPerSeller(m, datemin, datemax);
      }),
    );

    const cards = VENDEDORES_CARDS.map((card) => {
      const metaTotal = metasSemana.get(card.canal) || 0;
      const titulares = card.titulares || [];
      const n = titulares.length;
      const metaPorVend = n > 0 ? metaTotal / n : 0;
      const ps = perSellerByCanal[card.canal] || [];

      // Titulares: rateio meta_canal/N, faturamento via per_seller (match por nome)
      const vendedores = titulares.map((t) => {
        const nomeMatch = t.nome || t.label || String(t);
        const labelOut = t.label || nomeMatch;
        const real = findSellerFat(ps, nomeMatch);
        const pct = metaPorVend > 0 ? (real / metaPorVend) * 100 : 0;
        return {
          nome: labelOut,
          meta: Number(metaPorVend.toFixed(2)),
          real: Number(real.toFixed(2)),
          percentual: Number(pct.toFixed(2)),
        };
      });

      // Convidados: meta vem do canalMeta dele, faturamento via per_seller do canalFat
      for (const conv of card.convidados || []) {
        const cMeta = metasSemana.get(conv.canalMeta) || 0;
        const cPs = perSellerByCanal[conv.canalFat] || [];
        const cReal = findSellerFat(cPs, conv.nome);
        const pct = cMeta > 0 ? (cReal / cMeta) * 100 : 0;
        vendedores.push({
          nome: conv.label || conv.nome,
          meta: Number(cMeta.toFixed(2)),
          real: Number(cReal.toFixed(2)),
          percentual: Number(pct.toFixed(2)),
          convidado: true,
          canal_origem: conv.canalMeta,
        });
      }

      // Extras: vendedores no per_seller do canal que NÃO estão na lista (ex: Jucelino)
      // Inclui titulares E convidados — evita duplicar Rafael/David que aparecem
      // tanto como "convidado" (puxando do canal inbound_*) quanto no per_seller do
      // canal multimarcas (porque operam na branch 99 com mesmas ops).
      const tokensUsados = new Set([
        ...titulares.map((t) => String(t.nome || t).toUpperCase()),
        ...(card.convidados || []).map((c) => String(c.nome || c.label).toUpperCase()),
      ]);
      const extras = (ps || [])
        .map((s) => ({
          nome: String(s.seller_name || s.name || '').trim().toUpperCase(),
          real: Number(s.invoice_value ?? s.faturamento_liquido ?? s.liquido ?? s.total_liquido ?? s.total ?? 0) || 0,
        }))
        .filter((s) => s.nome && s.real > 0 && !Array.from(tokensUsados).some((t) => s.nome.includes(t)))
        .map((s) => ({
          nome: s.nome,
          meta: 0,
          real: Number(s.real.toFixed(2)),
          percentual: 0,
          extra: true,
        }));

      const totalMeta = vendedores.reduce((acc, v) => acc + v.meta, 0)
        + extras.reduce((a, e) => a + e.meta, 0);
      const totalReal = vendedores.reduce((acc, v) => acc + v.real, 0)
        + extras.reduce((a, e) => a + e.real, 0);
      const totalPct = totalMeta > 0 ? (totalReal / totalMeta) * 100 : 0;

      return {
        code: card.code,
        label: `Prometido ${card.label} - Semana ${semana}`,
        canal: card.canal,
        meta_canal: metaTotal,
        vendedores,
        extras,
        total: {
          meta: Number(totalMeta.toFixed(2)),
          real: Number(totalReal.toFixed(2)),
          percentual: Number(totalPct.toFixed(2)),
        },
      };
    });

    return successResponse(res, {
      ano,
      semana_iso: semana,
      data_inicio,
      data_fim,
      period_key: wKey,
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
  { key: 'b2m_total',     label: 'B2M', sources: ['multimarcas', 'inbound_rafael', 'inbound_david'] }, // B2M = Multimarcas + Inbound David + Inbound Rafael
  { key: 'revenda',       label: 'B2R' },
  { key: 'varejo',        label: 'B2C' },
  { key: 'ricardoeletro', label: 'Ricardo Eletro' },
  { key: 'fabrica',       label: 'Fábrica (Kleiton)', sources: ['showroom', 'novidadesfranquia'] }, // ops 7254, 7007, 7255
  { key: 'franquia',      label: 'B2L' },               // B2L = Franquia (= B2L Pronta)
  { key: 'bazar',         label: 'Bazar' },
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
    const nv = m.get('novidadesfranquia') || { full: 0, acumulado: 0, dia: null };
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
      acumulado: Number((mm.acumulado + ir.acumulado + id.acumulado).toFixed(2)),
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
    const mes = parseInt(req.query.mes, 10) || (hoje.getUTCMonth() + 1);
    const anoAnt = anoAtual - 1;
    // until_today=true → REAL 2026 vai até HOJE; senão até ONTEM (D-1, default)
    const untilToday = req.query.until_today === 'true' || req.query.until_today === '1';

    const fmt = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const lastDayAnt = new Date(Date.UTC(anoAnt, mes, 0)).getUTCDate();
    const lastDayAtual = new Date(Date.UTC(anoAtual, mes, 0)).getUTCDate();

    // Período cheio do ano anterior
    const periodAntFull = { datemin: fmt(anoAnt, mes, 1), datemax: fmt(anoAnt, mes, lastDayAnt) };

    // Período acumulado: 1º → (hoje | ontem) cap em mês corrente
    let diaAcum;
    if (hoje.getUTCFullYear() === anoAtual && hoje.getUTCMonth() + 1 === mes) {
      // Mês corrente: até hoje (untilToday) ou ontem (D-1)
      diaAcum = untilToday ? hoje.getUTCDate() : Math.max(0, hoje.getUTCDate() - 1);
    } else if (hoje.getUTCFullYear() < anoAtual || (hoje.getUTCFullYear() === anoAtual && hoje.getUTCMonth() + 1 < mes)) {
      diaAcum = 0; // mês futuro — sem real
    } else {
      diaAcum = lastDayAtual; // mês passado
    }

    const periodAntAcum = diaAcum > 0
      ? { datemin: fmt(anoAnt, mes, 1), datemax: fmt(anoAnt, mes, Math.min(diaAcum, lastDayAnt)) }
      : null;
    const periodAtualReal = diaAcum > 0
      ? { datemin: fmt(anoAtual, mes, 1), datemax: fmt(anoAtual, mes, diaAcum) }
      : null;

    // Ano anterior vem da tabela de REFERÊNCIA (valores fixos cadastrados).
    // Ano atual vem do TOTVS (real do mês corrente).
    const [refAnt, segAtualReal] = await Promise.all([
      getRefValues(anoAnt, mes),
      periodAtualReal
        ? getFaturamentoPorSegmento(periodAtualReal.datemin, periodAtualReal.datemax)
        : Promise.resolve(null),
    ]);

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
      const comparativo = fat2024Acum > 0
        ? ((fat2025Real / fat2024Acum) - 1) * 100
        : (fat2025Real > 0 ? 100 : 0); // 100% se ano passado era 0 e este ano > 0
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
      { fat_ano_anterior_full: 0, fat_ano_anterior_acumulado: 0, fat_ano_atual_real: 0 },
    );
    total.diferenca = Number((total.fat_ano_anterior_acumulado - total.fat_ano_atual_real).toFixed(2));
    total.comparativo_pct = total.fat_ano_anterior_acumulado > 0
      ? Number((((total.fat_ano_atual_real / total.fat_ano_anterior_acumulado) - 1) * 100).toFixed(2))
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
    const mes = parseInt(req.query.mes, 10) || (hoje.getUTCMonth() + 1);
    // until_today=true → REAL acumulado vai até HOJE; senão até ONTEM (D-1, default)
    const untilToday = req.query.until_today === 'true' || req.query.until_today === '1';

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
    } else if (hoje.getUTCFullYear() < ano || (hoje.getUTCFullYear() === ano && hoje.getUTCMonth() + 1 < mes)) {
      diaIso = null;
    } else {
      diaIso = data_fim;
    }

    // Para o REAL acumulado: 01/MM → refIso (hoje ou ontem conforme toggle)
    const realDateMax = (hoje.getUTCFullYear() === ano && hoje.getUTCMonth() + 1 === mes)
      ? refIso
      : (hoje.getUTCFullYear() < ano || (hoje.getUTCFullYear() === ano && hoje.getUTCMonth() + 1 < mes))
        ? null  // mês futuro — sem dados
        : data_fim; // mês passado — usa fim do mês

    const diasUteisTotal = diasUteisDoMes(ano, mes);
    // Dias úteis decorridos: até HOJE (untilToday) ou ONTEM (D-1, default)
    const diasUteisDecorridos = diasUteisDecorridosNoMes(ano, mes, untilToday ? hoje : ontem);

    const [metas, fatMes, fatDia] = await Promise.all([
      getMetasPorCanal('mensal', mKey),
      realDateMax
        ? getFaturamentoPorSegmento(data_inicio, realDateMax)
        : Promise.resolve(null),
      diaIso
        ? getFaturamentoPorSegmento(diaIso, diaIso)
        : Promise.resolve(null),
    ]);

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
      { meta_mensal: 0, forecast_mensal: 0, qnt_deveria: 0, real_acumulado: 0, meta_do_dia: 0, faturado_do_dia: 0 },
    );
    total.percentual = total.qnt_deveria > 0
      ? Number(((total.real_acumulado / total.qnt_deveria) * 100).toFixed(2))
      : 0;

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
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

const fmtBRL = (v) =>
  `R$ ${Number(v || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const fmtPct = (v) => `${Number(v || 0).toFixed(0)}%`;

const arrowEmoji = (pct) => {
  if (pct >= 100) return '🟢';
  if (pct >= 70) return '🟡';
  return '🔴';
};

const arrowComp = (pct) => (pct >= 0 ? '🟢⬆️' : '🔴⬇️');

async function fetchInternal(path) {
  const r = await axios.get(`${INTERNAL_API_BASE}/api/forecast${path}`, { timeout: 180000 });
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
    lines.push(`   Forecast: ${fmtBRL(c.forecast_mensal)}`);
    lines.push(`   Real:     ${fmtBRL(c.real_acumulado)}`);
    lines.push(`   Qnt Dev.: ${fmtBRL(c.qnt_deveria)}  |  ${fmtPct(c.percentual)}`);
    lines.push('');
  }
  const t = d.total || {};
  lines.push('━━━━━━━━━━━━━━━');
  lines.push(`*TOTAL*  ${arrowEmoji(t.percentual)}`);
  lines.push(`Forecast: ${fmtBRL(t.forecast_mensal)}`);
  lines.push(`Real:     ${fmtBRL(t.real_acumulado)}  (${fmtPct(t.percentual)})`);
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
    lines.push(`   Meta:     ${fmtBRL(c.meta_realista)}`);
    lines.push(`   Real:     ${fmtBRL(c.faturamento_real)}  (${fmtPct(c.percentual)})`);
    lines.push(`   Fat ontem: ${fmtBRL(c.fat_dia_anterior)}`);
    lines.push('');
  }
  const t = d.total || {};
  lines.push('━━━━━━━━━━━━━━━');
  lines.push(`*TOTAL*  ${arrowEmoji(t.percentual)}`);
  lines.push(`Meta:     ${fmtBRL(t.meta_realista)}`);
  lines.push(`Real:     ${fmtBRL(t.faturamento_real)}  (${fmtPct(t.percentual)})`);
  return lines.join('\n');
}

function buildTextoVendedores(d) {
  const lines = [];
  lines.push(`👥 *Detalhe por Vendedor — Semana ${d.semana_iso}*`);
  lines.push('');
  for (const card of d.cards || []) {
    lines.push(`*${card.label}*`);
    for (const v of card.vendedores || []) {
      const tag = v.convidado ? ' ⓘ' : '';
      lines.push(`${arrowEmoji(v.percentual)} ${v.nome}${tag}: ${fmtBRL(v.real)} / ${fmtBRL(v.meta)} (${fmtPct(v.percentual)})`);
    }
    for (const e of card.extras || []) {
      lines.push(`   ${e.nome}: ${fmtBRL(e.real)} (extra)`);
    }
    const t = card.total || {};
    lines.push(`*Total:* ${fmtBRL(t.real)} / ${fmtBRL(t.meta)}  (${fmtPct(t.percentual)})`);
    lines.push('');
  }
  return lines.join('\n');
}

function buildTextoComparativo(d) {
  const lines = [];
  lines.push(`📈 *Comparativo ${d.ano_anterior} × ${d.ano_atual}*`);
  lines.push(`${MESES_NOMES[d.mes - 1]}/${d.ano_atual} (até dia ${d.dia_referencia})`);
  lines.push('');
  for (const c of d.canais || []) {
    if (!c.fat_ano_anterior_full && !c.fat_ano_atual_real) continue;
    lines.push(`${arrowComp(c.comparativo_pct)} *${c.nome}* (${c.comparativo_pct >= 0 ? '+' : ''}${c.comparativo_pct.toFixed(0)}%)`);
    lines.push(`   ${d.ano_anterior}:        ${fmtBRL(c.fat_ano_anterior_full)}`);
    lines.push(`   ${d.ano_anterior} Acum.:  ${fmtBRL(c.fat_ano_anterior_acumulado)}`);
    lines.push(`   ${d.ano_atual} Real:   ${fmtBRL(c.fat_ano_atual_real)}`);
    lines.push('');
  }
  const t = d.total || {};
  lines.push('━━━━━━━━━━━━━━━');
  lines.push(`*TOTAL* ${arrowComp(t.comparativo_pct)}`);
  lines.push(`${d.ano_anterior} Acum.: ${fmtBRL(t.fat_ano_anterior_acumulado)}`);
  lines.push(`${d.ano_atual} Real:  ${fmtBRL(t.fat_ano_atual_real)}`);
  lines.push(`Comparativo: ${t.comparativo_pct >= 0 ? '+' : ''}${Number(t.comparativo_pct || 0).toFixed(0)}%`);
  return lines.join('\n');
}

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
      return errorResponse(res, 'Número de telefone inválido (formato esperado: DDD+número)', 400);
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
      return successResponse(res, { ok: true, ...r, preview: text.slice(0, 200) }, 'Mensagem enviada');
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
    const { recalcularForecastRef } = await import('../jobs/forecast-ref-yoy.job.js');
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
    const r = await axios.post(`${INTERNAL_API_BASE}/api/crm/clear-fatseg-cache`, {});
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
      return errorResponse(res, 'datemin e datemax obrigatórios (YYYY-MM-DD)', 400);
    }
    const { executarFaturamentoDiario } = await import('../jobs/faturamento-diario.job.js');
    const result = await executarFaturamentoDiario({ datemin, datemax });
    if (!result.ok) {
      return errorResponse(res, 'Falha na re-importação (ver logs)', 500);
    }
    return successResponse(res, result, `Re-importação concluída: ${result.totalUpserted} NFs (${result.dateRange})`);
  }),
);

export default router;
