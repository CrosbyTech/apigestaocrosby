// Rotas do sync UAzapi → banco database1.crosbytech.com.br/uazapi
//
//   POST /api/uazapi-sync/run                  → dispara sync (admin)
//   GET  /api/uazapi-sync/status               → último log + estatísticas
//   GET  /api/uazapi-sync/media/:inst/:msgId   → serve arquivo de mídia
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { asyncHandler } from '../utils/errorHandler.js';
import {
  runUazapiSync,
  getLastSyncLog,
  getDbStats,
  getPool,
  MEDIA_DIR,
} from '../services/uazapiSync.js';
import {
  runMonitorOnce,
  generateDisconnectReport,
  classifyDisconnect,
} from '../services/uazapiMonitor.js';

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

router.get(
  '/status',
  asyncHandler(async (req, res) => {
    const [stats, logs] = await Promise.all([
      getDbStats().catch(() => ({})),
      getLastSyncLog().catch(() => []),
    ]);
    return successResponse(res, {
      running: SYNC_RUNNING,
      last_run: LAST_RUN_INFO,
      db_stats: stats,
      recent_logs: logs,
    });
  }),
);

// ─── Monitor de status / alertas de desconexão ───────────────────────

// Lista as últimas N transições (com filtros opcionais).
// GET /api/uazapi-sync/alerts?limit=50&status=disconnected
router.get(
  '/alerts',
  asyncHandler(async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 50, 500);
    const filterStatus = req.query.status ? String(req.query.status).toLowerCase() : null;
    const pool = getPool();
    const params = [limit];
    let where = '';
    if (filterStatus) {
      where = 'WHERE new_status = $2';
      params.push(filterStatus);
    }
    const r = await pool.query(
      `SELECT id, instance_id, instance_name, prev_status, new_status, reason,
              changed_at, alerted, alerted_at, alert_channel, alert_error,
              report->'cause' AS cause
         FROM uazapi_instance_status_history
         ${where}
         ORDER BY changed_at DESC
         LIMIT $1`,
      params,
    );
    return successResponse(res, r.rows);
  }),
);

// Gera (ou retorna) relatório de desconexão de uma instância.
// GET /api/uazapi-sync/instance/:instanceId/disconnect-report
router.get(
  '/instance/:instanceId/disconnect-report',
  asyncHandler(async (req, res) => {
    const { instanceId } = req.params;
    const report = await generateDisconnectReport(instanceId);
    const pool = getPool();
    const ir = await pool.query(
      `SELECT id, name, status, last_disconnect, last_disconnect_reason
         FROM instances WHERE id = $1`,
      [instanceId],
    );
    const inst = ir.rows[0] || null;
    const cause = classifyDisconnect(inst?.last_disconnect_reason, report.stats);
    return successResponse(res, { instance: inst, cause, ...report });
  }),
);

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

// Serve um arquivo de mídia baixado pelo sync.
// Path: /api/uazapi-sync/media/:instanceId/:messageId
// Procura o arquivo via DB (messages.media_local_path) e devolve com mime correto.
router.get(
  '/media/:instanceId/:messageId',
  asyncHandler(async (req, res) => {
    const { instanceId, messageId } = req.params;
    const pool = getPool();
    const r = await pool.query(
      `SELECT media_local_path, media_mime, message_type
         FROM messages
        WHERE instance_id = $1 AND message_id = $2
        LIMIT 1`,
      [instanceId, messageId],
    );
    const row = r.rows[0];
    if (!row?.media_local_path) {
      return errorResponse(res, 'Mídia não encontrada', 404, 'NOT_FOUND');
    }
    const abs = path.resolve(MEDIA_DIR, row.media_local_path);
    // proteção: caminho deve estar dentro do MEDIA_DIR (evita traversal)
    if (!abs.startsWith(MEDIA_DIR + path.sep) && abs !== MEDIA_DIR) {
      return errorResponse(res, 'Caminho inválido', 403, 'FORBIDDEN');
    }
    if (!fs.existsSync(abs)) {
      return errorResponse(res, 'Arquivo não está no disco', 404, 'FILE_MISSING');
    }
    if (row.media_mime) res.setHeader('Content-Type', row.media_mime);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.sendFile(abs);
  }),
);

export default router;
