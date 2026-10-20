// ============================================================================
// WhatsApp CONTAS A PAGAR (uazapi) — montado em /api/whatsapp-cp.
// Exige sessão do HeadCoach. Só controla a instância "CONTAS A PAGAR".
//
//   GET  /status                         estado da instância (+ QR se conectando)
//   POST /conectar {phone?}              QR code (sem phone) ou código de pareamento   [admin]
//   POST /desconectar                                                                   [admin]
//   POST /enviar/texto {number, text, replyid?, delay?}                                [financeiro]
//   POST /enviar/midia {number, type, file, text?, docName?, mimetype?}                [financeiro]
//   POST /verificar {numbers[]}          quais números têm WhatsApp
//   GET  /chats?limit&offset&naoLidas&grupos&nome
//   GET  /chat/:number                   detalhes (foto, nome) de um contato/grupo
//   GET  /mensagens?chatid|number&limit&offset&trackSource
//   POST /mensagens/download {id, base64?}
//   POST /mensagens/lidas {ids[]}
//   GET  /webhooks · POST /webhooks {action,id?,url,events?,enabled?}                   [admin]
//   POST /webhook/receber?s=SECRET       receptor público de eventos da uazapi (buffer em memória)
//   GET  /eventos?limit                  últimos eventos recebidos
//   GET  /jojo/status · POST /jojo/simular     JOJO (assistente fiscal)           [simular: admin]
//   GET  /bruce/status · POST /bruce/simular   BRUCE (assistente contas a receber)[simular: admin]
// ============================================================================
import express from 'express';
import { asyncHandler, successResponse, errorResponse } from '../utils/errorHandler.js';
import { requireAuth, requireRole } from '../middlewares/auth.js';
import * as wa from '../services/whatsappContasPagar.js';
import * as jojo from '../services/jojoBot.js';
import * as bruce from '../services/bruceBot.js';

const router = express.Router();

const ROLES_ENVIO = ['owner', 'admin', 'manager', 'user'];
const admin = requireRole('owner', 'admin');
const envio = requireRole(...ROLES_ENVIO);

// ─── receptor de eventos (público, protegido por segredo na query) ─────────
const EVENTOS_MAX = 300;
const eventos = [];
const WEBHOOK_SECRET = process.env.WHATSAPP_CP_WEBHOOK_SECRET || '';

router.post(
  '/webhook/receber',
  express.json({ limit: '5mb' }),
  (req, res) => {
    if (WEBHOOK_SECRET && String(req.query.s || '') !== WEBHOOK_SECRET) {
      return res.status(401).json({ success: false, error: 'UNAUTHORIZED' });
    }
    const ev = req.body || {};
    eventos.unshift({
      recebidoEm: new Date().toISOString(),
      tipo: ev.EventType || ev.event || ev.type || 'desconhecido',
      instancia: ev.instanceName || ev.instance?.name || null,
      payload: ev,
    });
    if (eventos.length > EVENTOS_MAX) eventos.length = EVENTOS_MAX;
    // Agentes: cada um responde só no seu grupo (assíncrono, não segura o webhook)
    jojo.processarEvento(ev).catch((e) => console.error(`[jojo] webhook: ${e.message}`));
    bruce.processarEvento(ev).catch((e) => console.error(`[bruce] webhook: ${e.message}`));
    return res.json({ success: true });
  },
);

// ─── tudo abaixo exige login no HeadCoach ──────────────────────────────────
router.use(requireAuth);

function tratar(res, err) {
  const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
  return errorResponse(res, err.message, status, status === 400 ? 'VALIDATION' : 'UAZAPI');
}

router.get(
  '/status',
  asyncHandler(async (req, res) => {
    if (!wa.isConfigurado()) return successResponse(res, { ...wa.infoConfig(), conectado: false, status: 'nao_configurado' });
    try {
      const st = await wa.status();
      return successResponse(res, { ...wa.infoConfig(), ...st });
    } catch (err) {
      return tratar(res, err);
    }
  }),
);

router.post(
  '/conectar',
  admin,
  asyncHandler(async (req, res) => {
    try {
      return successResponse(res, await wa.conectar({ phone: req.body?.phone }), 'Conexão iniciada');
    } catch (err) {
      return tratar(res, err);
    }
  }),
);

router.post(
  '/desconectar',
  admin,
  asyncHandler(async (req, res) => {
    try {
      return successResponse(res, await wa.desconectar(), 'Instância desconectada');
    } catch (err) {
      return tratar(res, err);
    }
  }),
);

router.post(
  '/enviar/texto',
  envio,
  asyncHandler(async (req, res) => {
    const { number, text, replyid, delay, linkPreview } = req.body || {};
    try {
      const r = await wa.enviarTexto({ number, text, replyid, delay: Number(delay), linkPreview, trackId: req.user.email });
      console.log(`📲 [whatsapp-cp] texto → ${r.numero} por ${req.user.email}`);
      return successResponse(res, r, 'Mensagem enviada');
    } catch (err) {
      return tratar(res, err);
    }
  }),
);

router.post(
  '/enviar/midia',
  envio,
  asyncHandler(async (req, res) => {
    const { number, type, file, text, docName, mimetype, replyid, delay } = req.body || {};
    try {
      const r = await wa.enviarMidia({ number, type, file, text, docName, mimetype, replyid, delay: Number(delay), trackId: req.user.email });
      console.log(`📎 [whatsapp-cp] ${type || 'document'} → ${r.numero} por ${req.user.email}`);
      return successResponse(res, r, 'Arquivo enviado');
    } catch (err) {
      return tratar(res, err);
    }
  }),
);

router.post(
  '/verificar',
  asyncHandler(async (req, res) => {
    try {
      return successResponse(res, await wa.verificarNumeros(req.body?.numbers ?? req.body?.number));
    } catch (err) {
      return tratar(res, err);
    }
  }),
);

router.get(
  '/chats',
  asyncHandler(async (req, res) => {
    const { limit, offset, naoLidas, grupos, nome } = req.query;
    try {
      return successResponse(
        res,
        await wa.listarChats({
          limit,
          offset,
          somenteNaoLidas: String(naoLidas) === 'true',
          incluirGrupos: String(grupos ?? 'true') !== 'false',
          nome,
        }),
      );
    } catch (err) {
      return tratar(res, err);
    }
  }),
);

router.get(
  '/chat/:number',
  asyncHandler(async (req, res) => {
    try {
      return successResponse(res, await wa.detalhesChat(req.params.number));
    } catch (err) {
      return tratar(res, err);
    }
  }),
);

router.get(
  '/mensagens',
  asyncHandler(async (req, res) => {
    const { chatid, number, limit, offset, trackSource } = req.query;
    if (!chatid && !number) return errorResponse(res, 'Informe chatid ou number', 400, 'VALIDATION');
    try {
      return successResponse(res, await wa.buscarMensagens({ chatid, number, limit, offset, trackSource }));
    } catch (err) {
      return tratar(res, err);
    }
  }),
);

router.post(
  '/mensagens/download',
  asyncHandler(async (req, res) => {
    try {
      return successResponse(res, await wa.baixarMidia(req.body?.id, { base64: Boolean(req.body?.base64) }));
    } catch (err) {
      return tratar(res, err);
    }
  }),
);

router.post(
  '/mensagens/lidas',
  envio,
  asyncHandler(async (req, res) => {
    try {
      return successResponse(res, await wa.marcarLidas(req.body?.ids ?? req.body?.id));
    } catch (err) {
      return tratar(res, err);
    }
  }),
);

router.get(
  '/webhooks',
  admin,
  asyncHandler(async (req, res) => {
    try {
      return successResponse(res, await wa.listarWebhooks());
    } catch (err) {
      return tratar(res, err);
    }
  }),
);

router.post(
  '/webhooks',
  admin,
  asyncHandler(async (req, res) => {
    const { action, id, url, events, enabled, excludeMessages } = req.body || {};
    if (action !== 'delete' && !url) return errorResponse(res, 'url obrigatória', 400, 'VALIDATION');
    try {
      return successResponse(res, await wa.configurarWebhook({ action, id, url, events, enabled, excludeMessages }), 'Webhook salvo');
    } catch (err) {
      return tratar(res, err);
    }
  }),
);

// ─── JOJO (fiscal) e BRUCE (contas a receber) ──────────────────────────────
router.get('/jojo/status', (req, res) => successResponse(res, jojo.statusJojo()));
router.get('/bruce/status', (req, res) => successResponse(res, bruce.statusBruce()));

// Simula uma mensagem do grupo (testes) — só admin. Responde DE VERDADE no grupo.
function simular(agente, grupoDefault) {
  return asyncHandler(async (req, res) => {
    const { text, senderName, sender, sender_pn, quoted, chatid, id } = req.body || {};
    if (!text) return errorResponse(res, 'text obrigatório', 400, 'VALIDATION');
    const r = await agente.processarMensagem({
      id: id || `sim:${Date.now()}`,
      chatid: chatid || grupoDefault,
      fromMe: false,
      text,
      senderName: senderName || req.user.name,
      sender: sender || null,
      sender_pn: sender_pn || null,
      quoted: quoted || null,
      messageTimestamp: Date.now(),
    });
    return successResponse(res, r);
  });
}
router.post('/jojo/simular', admin, simular(jojo, process.env.JOJO_GRUPO_CHATID || '120363414933413909@g.us'));
router.post('/bruce/simular', admin, simular(bruce, process.env.BRUCE_GRUPO_CHATID || '120363411253432671@g.us'));

router.get('/eventos', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, EVENTOS_MAX);
  return successResponse(res, { total: eventos.length, eventos: eventos.slice(0, limit) });
});

export default router;
