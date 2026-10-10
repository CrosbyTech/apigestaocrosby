// =============================================================================
// Portal RFID (Chainway UR4) — rotas para a página de teste PORTALRFID
// Liga/desliga o inventário do portal e entrega as tags lidas (polling).
// =============================================================================
import express from 'express';
import {
  asyncHandler,
  successResponse,
  errorResponse,
} from '../utils/errorHandler.js';
import {
  startPortal,
  stopPortal,
  getPortalStatus,
  getPortalTags,
  clearPortalTags,
  getPortalPower,
  getPortalBeep,
  setPortalBeep,
  setPortalPower,
} from '../services/ur4Portal.js';

const router = express.Router();

// POST /api/portal-rfid/connect { host?, port? }
router.post(
  '/connect',
  asyncHandler(async (req, res) => {
    const { host, port } = req.body || {};
    if (host && !/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
      return errorResponse(res, 'Host inválido', 400, 'INVALID_HOST');
    }
    const st = startPortal({ host, port });
    return successResponse(res, st, 'Portal ligado');
  }),
);

// POST /api/portal-rfid/disconnect
router.post(
  '/disconnect',
  asyncHandler(async (req, res) => {
    const st = stopPortal();
    return successResponse(res, st, 'Portal desligado');
  }),
);

// GET /api/portal-rfid/status
router.get(
  '/status',
  asyncHandler(async (req, res) =>
    successResponse(res, getPortalStatus(), 'Status do portal'),
  ),
);

// GET /api/portal-rfid/tags
router.get(
  '/tags',
  asyncHandler(async (req, res) =>
    successResponse(
      res,
      { status: getPortalStatus(), tags: getPortalTags() },
      'Tags lidas',
    ),
  ),
);

// POST /api/portal-rfid/clear
router.post(
  '/clear',
  asyncHandler(async (req, res) => {
    clearPortalTags();
    return successResponse(res, getPortalStatus(), 'Lista limpa');
  }),
);

// GET /api/portal-rfid/power — potência de cada antena (dBm)
router.get(
  '/power',
  asyncHandler(async (req, res) => {
    try {
      return successResponse(res, await getPortalPower(), 'Potência do portal');
    } catch (e) {
      return errorResponse(res, e.message, 502, 'PORTAL_POWER_ERROR');
    }
  }),
);

// POST /api/portal-rfid/power { potencia } | { antenas: [{ ant, potencia }] }
router.post(
  '/power',
  asyncHandler(async (req, res) => {
    try {
      const r = await setPortalPower(req.body || {});
      return successResponse(res, r, 'Potência gravada');
    } catch (e) {
      return errorResponse(res, e.message, 502, 'PORTAL_POWER_ERROR');
    }
  }),
);

// GET /api/portal-rfid/beep — buzzer do portal ligado?
router.get(
  '/beep',
  asyncHandler(async (req, res) => {
    try {
      return successResponse(res, await getPortalBeep(), 'Buzzer do portal');
    } catch (e) {
      return errorResponse(res, e.message, 502, 'PORTAL_BEEP_ERROR');
    }
  }),
);

// POST /api/portal-rfid/beep { ligado: true|false }
router.post(
  '/beep',
  asyncHandler(async (req, res) => {
    try {
      const r = await setPortalBeep(!!req.body?.ligado);
      return successResponse(res, r, r.ligado ? 'Buzzer ligado' : 'Buzzer desligado');
    } catch (e) {
      return errorResponse(res, e.message, 502, 'PORTAL_BEEP_ERROR');
    }
  }),
);

export default router;
