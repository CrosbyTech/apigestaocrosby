// ─── Axios interceptor global pra rastrear chamadas TOTVS ──────────────────
// Instala uma vez no boot. Detecta URLs que apontam pra hosts TOTVS conhecidos
// e registra no monitor (duração, status, expand=items). Outros calls passam
// transparentes.
// ────────────────────────────────────────────────────────────────────────────
import axios from 'axios';
import { recordTotvsRequest } from './totvsUsageMonitor.js';

const TOTVS_HOST_PATTERNS = [
  /bhan\.com\.br/i,
  /apitotvsmoda/i,
  /totvsmoda/i,
];

function isTotvsUrl(url) {
  if (!url || typeof url !== 'string') return false;
  return TOTVS_HOST_PATTERNS.some((re) => re.test(url));
}

function extractPath(url) {
  try {
    const u = new URL(url);
    // Normaliza: tira IDs/numéricos pra reduzir cardinalidade do endpoint
    return u.pathname.replace(/\/\d{4,}\b/g, '/:id');
  } catch {
    return url;
  }
}

let installed = false;

export function installTotvsTracker() {
  if (installed) return;
  installed = true;

  axios.interceptors.request.use((config) => {
    if (isTotvsUrl(config.url)) {
      config.metadata = { startTime: Date.now() };
    }
    return config;
  });

  axios.interceptors.response.use(
    (response) => {
      const cfg = response.config;
      if (cfg?.metadata?.startTime && isTotvsUrl(cfg.url)) {
        const durationMs = Date.now() - cfg.metadata.startTime;
        const expand =
          cfg.data && typeof cfg.data === 'object'
            ? cfg.data.expand || null
            : (typeof cfg.data === 'string' && cfg.data.includes('expand')
                ? extractExpandFromString(cfg.data)
                : null);
        recordTotvsRequest({
          endpoint: extractPath(cfg.url),
          durationMs,
          status: response.status,
          cached: false,
          expand,
        });
      }
      return response;
    },
    (error) => {
      const cfg = error.config;
      if (cfg?.metadata?.startTime && isTotvsUrl(cfg.url)) {
        const durationMs = Date.now() - cfg.metadata.startTime;
        const expand =
          cfg.data && typeof cfg.data === 'object'
            ? cfg.data.expand || null
            : null;
        recordTotvsRequest({
          endpoint: extractPath(cfg.url),
          durationMs,
          status: error.response?.status || 0,
          cached: false,
          expand,
        });
      }
      return Promise.reject(error);
    },
  );

  console.log('🔍 [totvs-monitor] Interceptor instalado — rastreando chamadas TOTVS');
}

function extractExpandFromString(s) {
  try {
    const j = JSON.parse(s);
    return j.expand || null;
  } catch {
    return null;
  }
}
