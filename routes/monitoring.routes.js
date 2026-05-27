// ─── Endpoint de observabilidade do consumo TOTVS ──────────────────────────
// GET /api/monitoring/totvs-usage?window=60   → stats da última 1min (default)
//                                ?window=300  → última 5min
//                                ?window=3600 → última 1h
//
// POST /api/monitoring/totvs-usage/reset (admin) → zera contadores
// ────────────────────────────────────────────────────────────────────────────
import express from 'express';
import { getMonitorStats, resetMonitor } from '../services/totvsUsageMonitor.js';
import { asyncHandler, successResponse } from '../utils/errorHandler.js';

const router = express.Router();

// Anti-cache (estatística sempre fresca)
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

router.get(
  '/totvs-usage',
  asyncHandler(async (req, res) => {
    const windowSec = Math.max(
      30,
      Math.min(3600, parseInt(req.query.window, 10) || 60),
    );
    const stats = getMonitorStats({ windowMs: windowSec * 1000 });
    return successResponse(res, stats, 'OK');
  }),
);

router.post(
  '/totvs-usage/reset',
  asyncHandler(async (_req, res) => {
    resetMonitor();
    return successResponse(res, { ok: true }, 'Contadores resetados');
  }),
);

export default router;
