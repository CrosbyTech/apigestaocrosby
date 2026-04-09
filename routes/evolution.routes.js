import express from 'express';
import evolutionPool from '../config/evolution.js';
import {
  asyncHandler,
  successResponse,
  errorResponse,
} from '../utils/errorHandler.js';

const router = express.Router();

/**
 * @route GET /api/evolution/conversations/:phone
 * @desc Busca conversas do WhatsApp pelo número de telefone
 * @param {string} phone - Número de telefone (apenas dígitos, com ou sem 55)
 * @query {number} limit - Limite de mensagens (default: 100, max: 500)
 * @query {number} offset - Offset para paginação (default: 0)
 */
router.get(
  '/conversations/:phone',
  asyncHandler(async (req, res) => {
    let phone = (req.params.phone || '').replace(/\D/g, '');
    if (!phone || phone.length < 10) {
      return errorResponse(res, 'Número de telefone inválido', 400);
    }

    // Normalizar: garantir que tenha 55 na frente
    if (!phone.startsWith('55')) {
      phone = '55' + phone;
    }

    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const offset = parseInt(req.query.offset) || 0;

    const result = await evolutionPool.query(
      `SELECT
        id,
        key,
        "pushName",
        participant,
        "messageType",
        message,
        source,
        "messageTimestamp",
        status,
        text_content,
        msg_ts_tz,
        msisdn_55,
        msisdn_55_v2,
        "instanceId"
      FROM "Message"
      WHERE msisdn_55_v2 = $1
      ORDER BY "messageTimestamp" ASC
      LIMIT $2 OFFSET $3`,
      [phone, limit, offset],
    );

    // Contar total de mensagens
    const countResult = await evolutionPool.query(
      `SELECT COUNT(*)::int as total FROM "Message" WHERE msisdn_55_v2 = $1`,
      [phone],
    );

    return successResponse(res, {
      messages: result.rows,
      total: countResult.rows[0]?.total || 0,
      phone,
      limit,
      offset,
    });
  }),
);

/**
 * @route GET /api/evolution/health
 * @desc Verifica conexão com o banco Evolution
 */
router.get(
  '/health',
  asyncHandler(async (req, res) => {
    const result = await evolutionPool.query('SELECT NOW() as time');
    return successResponse(res, {
      connected: true,
      serverTime: result.rows[0].time,
    });
  }),
);

export default router;
