// ─── Monitor de consumo TOTVS (in-memory, sem dependência externa) ──────────
// Conta requests, durações, cache hits e auth attempts. Tudo em RAM, com
// ring buffer fixo (~2000 eventos = ~50KB). Resetado a cada restart.
//
// Uso típico:
//   import { recordTotvsRequest, recordAuth, getMonitorStats } from './totvsUsageMonitor.js';
//   recordTotvsRequest({ endpoint, durationMs, status, expand });
//
// Endpoint exposto: GET /api/monitoring/totvs-usage
// ────────────────────────────────────────────────────────────────────────────

const RING_BUFFER_SIZE = 2000;
const events = [];           // ring buffer de eventos TOTVS (não-cache)
const cacheEvents = [];      // ring buffer de cache hits (mais leve)
const startedAt = Date.now();

// Contadores cumulativos desde o boot
let totalTotvsCalls = 0;
let totalCacheHits = 0;
let totalAuthAttempts = 0;
let totalAuthFails = 0;
let lastAuthFailAt = null;
let lastAuthFailReason = null;
let lastAuthSuccessAt = null;
let inflightCoalesces = 0; // quantas vezes algum coalescing economizou request

function pushRing(arr, evt) {
  arr.push(evt);
  if (arr.length > RING_BUFFER_SIZE) arr.shift();
}

/**
 * Registra uma chamada ao TOTVS (real, não cache).
 * @param {object} p
 * @param {string} p.endpoint  ex: "/fiscal/v2/invoices/search"
 * @param {number} p.durationMs
 * @param {number} [p.status]    HTTP status code (200, 400, …)
 * @param {boolean} [p.cached]   true se foi atendido por cache (não TOTVS)
 * @param {string}  [p.expand]   "items" / "payments" / "items,payments" (custoso)
 * @param {string}  [p.modulo]   contexto (revenda, multimarcas, ...)
 * @param {string}  [p.caller]   nome do route handler
 */
export function recordTotvsRequest({
  endpoint,
  durationMs,
  status,
  cached = false,
  expand = null,
  modulo = null,
  caller = null,
}) {
  const evt = {
    ts: Date.now(),
    endpoint: endpoint || 'unknown',
    durationMs: Number(durationMs) || 0,
    status: status ?? null,
    expand,
    modulo,
    caller,
  };
  if (cached) {
    totalCacheHits++;
    pushRing(cacheEvents, evt);
  } else {
    totalTotvsCalls++;
    pushRing(events, evt);
  }
}

/** Registra resultado de auth TOTVS. */
export function recordAuth(success, reason = null) {
  totalAuthAttempts++;
  if (success) {
    lastAuthSuccessAt = Date.now();
  } else {
    totalAuthFails++;
    lastAuthFailAt = Date.now();
    lastAuthFailReason = reason || 'unknown';
  }
}

/** Registra um coalescing bem-sucedido (request economizada). */
export function recordCoalesce() {
  inflightCoalesces++;
}

/** Retorna estatísticas agregadas. */
export function getMonitorStats({ windowMs = 60_000 } = {}) {
  const now = Date.now();
  const cutoff = now - windowMs;
  const recentTotvs = events.filter((e) => e.ts >= cutoff);
  const recentCache = cacheEvents.filter((e) => e.ts >= cutoff);

  // P50/P95 das durações TOTVS recentes
  const durs = recentTotvs.map((e) => e.durationMs).sort((a, b) => a - b);
  const percentile = (p) => {
    if (durs.length === 0) return 0;
    const idx = Math.min(durs.length - 1, Math.floor((p / 100) * durs.length));
    return durs[idx];
  };

  // Top endpoints na janela
  const byEndpoint = new Map();
  for (const e of recentTotvs) {
    const cur = byEndpoint.get(e.endpoint) || { count: 0, totalMs: 0, slow: 0, withItems: 0 };
    cur.count++;
    cur.totalMs += e.durationMs;
    if (e.durationMs > 5000) cur.slow++;
    if (e.expand && /items/i.test(e.expand)) cur.withItems++;
    byEndpoint.set(e.endpoint, cur);
  }
  const topEndpoints = [...byEndpoint.entries()]
    .map(([endpoint, v]) => ({
      endpoint,
      count: v.count,
      avg_ms: Math.round(v.totalMs / v.count),
      slow_count: v.slow,
      with_items: v.withItems,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Slow queries (>5s) recentes
  const slow = recentTotvs
    .filter((e) => e.durationMs > 5000)
    .slice(-20)
    .map((e) => ({
      ts: new Date(e.ts).toISOString(),
      endpoint: e.endpoint,
      duration_ms: e.durationMs,
      modulo: e.modulo,
      expand: e.expand,
      status: e.status,
    }));

  // Erros recentes (status >= 400 ou null com expand)
  const errors = recentTotvs
    .filter((e) => e.status && e.status >= 400)
    .slice(-20)
    .map((e) => ({
      ts: new Date(e.ts).toISOString(),
      endpoint: e.endpoint,
      status: e.status,
      modulo: e.modulo,
    }));

  // Distribuição por expand (impacto FIS_NFITEMPROD)
  const fullScanCount = recentTotvs.filter((e) => e.expand && /items/i.test(e.expand)).length;

  return {
    window_seconds: windowMs / 1000,
    timestamp: new Date(now).toISOString(),
    server_uptime_seconds: Math.floor((now - startedAt) / 1000),

    // contagem total desde o boot
    totals_since_boot: {
      totvs_calls: totalTotvsCalls,
      cache_hits: totalCacheHits,
      coalesces: inflightCoalesces,
      auth_attempts: totalAuthAttempts,
      auth_failures: totalAuthFails,
    },

    // janela recente
    recent: {
      totvs_calls: recentTotvs.length,
      cache_hits: recentCache.length,
      total_requests: recentTotvs.length + recentCache.length,
      cache_hit_rate:
        recentTotvs.length + recentCache.length > 0
          ? +(
              recentCache.length /
              (recentTotvs.length + recentCache.length)
            ).toFixed(3)
          : 0,
      slow_queries: recentTotvs.filter((e) => e.durationMs > 5000).length,
      full_scan_candidates: fullScanCount, // expand contém 'items'
      avg_duration_ms:
        recentTotvs.length > 0
          ? Math.round(
              recentTotvs.reduce((s, e) => s + e.durationMs, 0) /
                recentTotvs.length,
            )
          : 0,
      p50_duration_ms: percentile(50),
      p95_duration_ms: percentile(95),
      max_duration_ms: durs[durs.length - 1] || 0,
    },

    top_endpoints: topEndpoints,
    slow_queries: slow,
    recent_errors: errors,

    auth: {
      total_attempts: totalAuthAttempts,
      total_failures: totalAuthFails,
      last_success_at: lastAuthSuccessAt
        ? new Date(lastAuthSuccessAt).toISOString()
        : null,
      last_failure_at: lastAuthFailAt
        ? new Date(lastAuthFailAt).toISOString()
        : null,
      last_failure_reason: lastAuthFailReason,
    },
  };
}

/** Reseta contadores (útil para testes/admin). */
export function resetMonitor() {
  events.length = 0;
  cacheEvents.length = 0;
  totalTotvsCalls = 0;
  totalCacheHits = 0;
  totalAuthAttempts = 0;
  totalAuthFails = 0;
  lastAuthFailAt = null;
  lastAuthFailReason = null;
  lastAuthSuccessAt = null;
  inflightCoalesces = 0;
}
