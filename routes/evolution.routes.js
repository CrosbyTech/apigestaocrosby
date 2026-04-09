import express from 'express';
import axios from 'axios';
import evolutionPool from '../config/evolution.js';
import {
  asyncHandler,
  successResponse,
  errorResponse,
} from '../utils/errorHandler.js';

const router = express.Router();

// Evolution API HTTP config
const EVOLUTION_API_URL =
  process.env.EVOLUTION_API_URL || 'https://wsapi.crosbytech.com.br';
const EVOLUTION_API_KEY =
  process.env.EVOLUTION_API_KEY || 'bf8de105-8b03-4f1d-9abc-90f75234ab58';

// Cache instanceId → instanceName
const instanceNameCache = new Map();

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
    const instanceId = req.query.instanceId || null;
    const startDate = req.query.startDate || null;
    const endDate = req.query.endDate || null;

    let whereExtra = '';
    const params = [phone];
    let paramIdx = 2;

    if (instanceId) {
      whereExtra += ` AND "instanceId" = $${paramIdx}`;
      params.push(instanceId);
      paramIdx++;
    }
    if (startDate) {
      whereExtra += ` AND msg_ts_tz >= $${paramIdx}::timestamp`;
      params.push(`${startDate}T00:00:00`);
      paramIdx++;
    }
    if (endDate) {
      whereExtra += ` AND msg_ts_tz <= $${paramIdx}::timestamp`;
      params.push(`${endDate}T23:59:59`);
      paramIdx++;
    }

    const limitIdx = paramIdx;
    const offsetIdx = paramIdx + 1;
    params.push(limit, offset);

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
      WHERE msisdn_55_v2 = $1 ${whereExtra}
      ORDER BY "messageTimestamp" ASC
      LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params,
    );

    // Contar total de mensagens (mesmos filtros, sem limit/offset)
    const countParams = params.slice(0, paramIdx - 1);
    const countResult = await evolutionPool.query(
      `SELECT COUNT(*)::int as total FROM "Message" WHERE msisdn_55_v2 = $1 ${whereExtra}`,
      countParams,
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

/**
 * @route POST /api/evolution/media
 * @desc Busca mídia (áudio, imagem, vídeo, documento) via Evolution API HTTP
 *       Retorna base64 do arquivo descriptografado
 * @body {
 *   messageId: string (id da mensagem no banco),
 *   instanceId: string (id da instância),
 *   key: object (key da mensagem com id, remoteJid, fromMe),
 *   messageType: string (imageMessage, audioMessage, videoMessage, documentMessage)
 * }
 */
router.post(
  '/media',
  asyncHandler(async (req, res) => {
    const { messageId } = req.body;

    if (!messageId) {
      return errorResponse(res, 'messageId é obrigatório', 400);
    }

    // Buscar a mensagem completa do banco (inclui instanceId, key, message, messageType)
    const msgResult = await evolutionPool.query(
      'SELECT message, key, "messageType", "instanceId" FROM "Message" WHERE id = $1 LIMIT 1',
      [messageId],
    );
    if (msgResult.rows.length === 0) {
      return errorResponse(res, 'Mensagem não encontrada', 404);
    }

    const msgData = msgResult.rows[0];
    const msgKey = msgData.key;
    const msgContent = msgData.message;
    const messageType = msgData.messageType;
    const instanceId = msgData.instanceId;

    if (!instanceId) {
      return errorResponse(res, 'Mensagem sem instanceId', 400);
    }

    // Resolver instanceId → instanceName (o Evolution API HTTP precisa do name, não id)
    let instanceName = instanceNameCache.get(instanceId);
    if (!instanceName) {
      const instResult = await evolutionPool.query(
        'SELECT name FROM "Instance" WHERE id = $1 LIMIT 1',
        [instanceId],
      );
      if (instResult.rows.length === 0) {
        return errorResponse(res, 'Instância não encontrada', 404);
      }
      instanceName = instResult.rows[0].name;
      instanceNameCache.set(instanceId, instanceName);
    }

    // Montar payload para a Evolution API
    const convertToMp4 =
      messageType === 'audioMessage' || messageType === 'ptvMessage';
    const payload = {
      message: {
        key: {
          id: msgKey.id,
          remoteJid: msgKey.remoteJid,
          fromMe: msgKey.fromMe,
        },
        message: msgContent,
      },
      convertToMp4,
    };

    console.log('🔍 Evolution media request:', {
      messageId,
      instanceName,
      messageType,
      keyId: msgKey.id,
      remoteJid: msgKey.remoteJid,
      fromMe: msgKey.fromMe,
    });

    try {
      const response = await axios.post(
        `${EVOLUTION_API_URL}/chat/getBase64FromMediaMessage/${encodeURIComponent(instanceName)}`,
        payload,
        {
          headers: {
            'Content-Type': 'application/json',
            apikey: EVOLUTION_API_KEY,
          },
          timeout: 30000,
        },
      );

      const base64Data = response.data?.base64;
      const mimetype = response.data?.mimetype || response.data?.mediatype;

      if (!base64Data) {
        return errorResponse(res, 'Mídia não disponível ou expirada', 404);
      }

      return successResponse(res, {
        base64: base64Data,
        mimetype,
        messageType,
      });
    } catch (error) {
      const errData = error.response?.data;
      const errStr =
        typeof errData === 'string' ? errData : JSON.stringify(errData);
      console.error('❌ Erro ao buscar mídia Evolution:', {
        status: error.response?.status,
        data: errStr,
        keyId: msgKey.id,
      });

      // Detectar mídia expirada (CDN URL não disponível mais)
      const isExpired =
        errStr?.includes('Failed to fetch stream') || errStr?.includes('404');
      if (isExpired) {
        return errorResponse(
          res,
          'Mídia expirada — o arquivo não está mais disponível no WhatsApp',
          410,
          'MEDIA_EXPIRED',
        );
      }

      const status = error.response?.status || 500;
      const msg =
        error.response?.data?.message ||
        error.message ||
        'Erro ao buscar mídia';
      return errorResponse(res, msg, status);
    }
  }),
);

/**
 * @route GET /api/evolution/instances/:phone
 * @desc Lista instâncias que conversaram com esse telefone, agrupadas com contagem
 * @param {string} phone - Número de telefone
 * @query {string} startDate - Data início (YYYY-MM-DD)
 * @query {string} endDate - Data fim (YYYY-MM-DD)
 */
router.get(
  '/instances/:phone',
  asyncHandler(async (req, res) => {
    let phone = (req.params.phone || '').replace(/\D/g, '');
    if (!phone || phone.length < 10) {
      return errorResponse(res, 'Número de telefone inválido', 400);
    }
    if (!phone.startsWith('55')) phone = '55' + phone;

    const startDate = req.query.startDate || null;
    const endDate = req.query.endDate || null;

    let dateFilter = '';
    const params = [phone];
    let paramIdx = 2;

    if (startDate) {
      dateFilter += ` AND msg_ts_tz >= $${paramIdx}::timestamp`;
      params.push(`${startDate}T00:00:00`);
      paramIdx++;
    }
    if (endDate) {
      dateFilter += ` AND msg_ts_tz <= $${paramIdx}::timestamp`;
      params.push(`${endDate}T23:59:59`);
      paramIdx++;
    }

    const result = await evolutionPool.query(
      `SELECT
        m."instanceId",
        i.name as "instanceName",
        COUNT(*)::int as "messageCount",
        MIN(m.msg_ts_tz) as "firstMessage",
        MAX(m.msg_ts_tz) as "lastMessage"
      FROM "Message" m
      LEFT JOIN "Instance" i ON i.id = m."instanceId"
      WHERE m.msisdn_55_v2 = $1 ${dateFilter}
      GROUP BY m."instanceId", i.name
      ORDER BY MAX(m."messageTimestamp") DESC`,
      params,
    );

    return successResponse(res, {
      instances: result.rows,
      phone,
    });
  }),
);

export default router;
