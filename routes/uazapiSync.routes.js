// Rotas do sync UAzapi → banco database1.crosbytech.com.br/uazapi
//
//   POST /api/uazapi-sync/run          → dispara sync (admin)
//   POST /api/uazapi-sync/monitor/run  → dispara 1 ciclo do monitor (admin)
import express from 'express';
import { asyncHandler } from '../utils/errorHandler.js';
import { runUazapiSync } from '../services/uazapiSync.js';
import { runMonitorOnce } from '../services/uazapiMonitor.js';

const router = express.Router();

function successResponse(res, data, message = 'OK') {
  return res.json({ success: true, message, data });
}
function errorResponse(res, message, status = 500, code = 'ERR') {
  return res.status(status).json({ success: false, message, error: code });
}

// Estado em memória — evita rodar 2 syncs em paralelo
let SYNC_RUNNING = false;
let LAST_RUN_INFO = null;

router.post(
  '/run',
  asyncHandler(async (req, res) => {
    // Auth: admin/owner only
    const userRole = String(req.headers['x-user-role'] || '').toLowerCase();
    if (userRole !== 'admin' && userRole !== 'owner') {
      return errorResponse(
        res,
        'Apenas administradores podem rodar o sync',
        403,
        'FORBIDDEN',
      );
    }
    if (SYNC_RUNNING) {
      return errorResponse(
        res,
        'Sync já está rodando — aguarde terminar',
        409,
        'ALREADY_RUNNING',
      );
    }
    SYNC_RUNNING = true;
    const triggeredBy =
      req.body?.triggered_by ||
      req.headers['x-user-login'] ||
      'manual';

    // Responde 202 imediatamente — sync roda em background
    res.status(202).json({
      success: true,
      message: 'Sync iniciado em background',
      data: { started_at: new Date().toISOString(), triggered_by: triggeredBy },
    });

    runUazapiSync({ triggeredBy })
      .then((result) => {
        LAST_RUN_INFO = {
          finishedAt: new Date().toISOString(),
          status: 'success',
          ...result,
        };
        console.log('[uazapi-sync] CONCLUÍDO', result);
      })
      .catch((err) => {
        LAST_RUN_INFO = {
          finishedAt: new Date().toISOString(),
          status: 'failed',
          error: err.message,
        };
        console.error('[uazapi-sync] FALHOU:', err.message);
      })
      .finally(() => {
        SYNC_RUNNING = false;
      });
  }),
);

// ─── Monitor de status / alertas de desconexão ───────────────────────

// Dispara 1 ciclo do monitor manualmente (admin).
router.post(
  '/monitor/run',
  asyncHandler(async (req, res) => {
    const userRole = String(req.headers['x-user-role'] || '').toLowerCase();
    if (userRole !== 'admin' && userRole !== 'owner') {
      return errorResponse(res, 'Apenas admins', 403, 'FORBIDDEN');
    }
    await runMonitorOnce();
    return successResponse(res, { ok: true });
  }),
);

export default router;
