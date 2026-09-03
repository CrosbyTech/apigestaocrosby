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

export default router;
