// ============================================================
// BOT STONE EXTRATOS — API (prefixo /api/stone-bot)
//
// Tela (usuário logado no HeadCoach, Bearer Supabase):
//   GET    /status                 → agente online?, execução em andamento, últimas execuções, saldos
//   GET    /execucoes?limite       → histórico
//   GET    /execucoes/:id          → execução + log completo
//   POST   /execucoes {de?, ate?}  → enfileira (botão "Baixar extratos agora")
//   DELETE /execucoes/:id          → cancela uma pendente
//   GET    /saldos                 → saldos da última captura
//
// Agente local (bots/stone-extratos, header x-bot-token = STONE_BOT_TOKEN):
//   POST   /agente/ping                         { host, versao, sessaoOk, proximaAgendada }
//   GET    /agente/proxima?host                 → execução pendente (marca rodando) ou null
//   POST   /agente/execucoes  { origem }        → cria execução (horário agendado do bot)
//   POST   /agente/execucoes/:id/log            { linhas: [{t?, nivel?, msg}] }
//   POST   /agente/execucoes/:id/pdf            multipart arquivo + meta (JSON)
//   POST   /agente/execucoes/:id/extrato-json   { conta, entradas, saldo, periodo }
//   POST   /agente/execucoes/:id/saldos         { saldos: [...] , data? }
//   POST   /agente/execucoes/:id/pagarme        { de?, ate? } → saldo + extrato Pagar.me (servidor)
//   Tela: GET /pagarme/saldos · POST /pagarme/executar {de?, ate?}
//   POST   /agente/execucoes/:id/finalizar      { status, resumo, erro }
// ============================================================
import crypto from 'node:crypto';
import express from 'express';
import multer from 'multer';
import { asyncHandler, successResponse, errorResponse } from '../utils/errorHandler.js';
import { requireAuth } from '../middlewares/auth.js';
import bot from '../services/stoneBot.js';
import { executarPagarme, saldosPagarme } from '../services/pagarmeConta.js';
import { salvarComprovante } from '../services/comprovantesStone.js';
import { MigrationPendingError } from '../services/fluxoCaixaExt.js';

const router = express.Router();

const tratar = (res, e) => {
  if (e instanceof MigrationPendingError || e?.code === 'MIGRATION_PENDING') return errorResponse(res, e.message, 503, 'MIGRATION_PENDING');
  console.error('[stone-bot]', e);
  return errorResponse(res, e.message || 'Erro interno', 500, 'STONE_BOT');
};

// ─── autenticação do agente (token compartilhado) ─────────────
const tokenConfere = (a, b) => {
  if (!a || !b) return false;
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
};
const requireBotToken = (req, res, next) => {
  const esperado = process.env.STONE_BOT_TOKEN;
  if (!esperado) return errorResponse(res, 'STONE_BOT_TOKEN não configurado no servidor.', 503, 'BOT_TOKEN_AUSENTE');
  const recebido = req.headers['x-bot-token'] || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!tokenConfere(recebido, esperado)) return errorResponse(res, 'Token do bot inválido.', 401, 'BOT_TOKEN_INVALIDO');
  return next();
};

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024, files: 1 } });

const dataIso = (v) => (v && /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v) : null);

// ═══ tela ═════════════════════════════════════════════════════
const tela = express.Router();
tela.use(requireAuth);

tela.get(
  '/status',
  asyncHandler(async (req, res) => {
    try {
      return successResponse(res, await bot.status());
    } catch (e) {
      return tratar(res, e);
    }
  }),
);

tela.get(
  '/execucoes',
  asyncHandler(async (req, res) => {
    try {
      return successResponse(res, await bot.listarExecucoes({ limite: Math.min(Number(req.query.limite) || 20, 100) }));
    } catch (e) {
      return tratar(res, e);
    }
  }),
);

tela.get(
  '/execucoes/:id',
  asyncHandler(async (req, res) => {
    try {
      return successResponse(res, await bot.obterExecucao(Number(req.params.id)));
    } catch (e) {
      return tratar(res, e);
    }
  }),
);

tela.post(
  '/execucoes',
  asyncHandler(async (req, res) => {
    try {
      const de = dataIso(req.body?.de);
      const ate = dataIso(req.body?.ate);
      if ((de && !ate) || (!de && ate)) return errorResponse(res, 'Informe "de" e "ate" juntos (AAAA-MM-DD) ou nenhum dos dois.', 400);
      if (de && ate && de > ate) return errorResponse(res, 'Data inicial maior que a final.', 400);
      const r = await bot.solicitarExecucao({ solicitadoPor: req.user?.email, origem: 'manual', parametros: de ? { de, ate } : null });
      return successResponse(res, r, r.reaproveitada ? 'Já existe uma execução em andamento — acompanhe o log.' : 'Execução enfileirada. O bot começa em instantes.');
    } catch (e) {
      return tratar(res, e);
    }
  }),
);

tela.delete(
  '/execucoes/:id',
  asyncHandler(async (req, res) => {
    try {
      return successResponse(res, await bot.cancelarExecucao(Number(req.params.id), { por: req.user?.email }), 'Execução cancelada');
    } catch (e) {
      return tratar(res, e);
    }
  }),
);

tela.get(
  '/saldos',
  asyncHandler(async (req, res) => {
    try {
      return successResponse(res, await bot.ultimosSaldos());
    } catch (e) {
      return tratar(res, e);
    }
  }),
);

// Pagar.me (roda no servidor, não depende do PC do bot)
tela.get(
  '/pagarme/saldos',
  asyncHandler(async (req, res) => {
    try {
      return successResponse(res, await saldosPagarme());
    } catch (e) {
      return tratar(res, e);
    }
  }),
);

tela.post(
  '/pagarme/executar',
  asyncHandler(async (req, res) => {
    try {
      const de = dataIso(req.body?.de);
      const ate = dataIso(req.body?.ate);
      const r = await executarPagarme({ de: de && ate ? de : undefined, ate: de && ate ? ate : undefined });
      return successResponse(res, r, r.falhas ? `Pagar.me: ${r.falhas} falha(s) — veja o log do servidor` : 'Pagar.me atualizada');
    } catch (e) {
      return tratar(res, e);
    }
  }),
);

// ═══ agente ═══════════════════════════════════════════════════
const agente = express.Router();
agente.use(requireBotToken);

agente.post(
  '/ping',
  asyncHandler(async (req, res) => {
    try {
      return successResponse(res, await bot.pingAgente(req.body || {}));
    } catch (e) {
      return tratar(res, e);
    }
  }),
);

agente.get(
  '/proxima',
  asyncHandler(async (req, res) => {
    try {
      return successResponse(res, await bot.proximaExecucao({ host: req.query.host }));
    } catch (e) {
      return tratar(res, e);
    }
  }),
);

agente.post(
  '/execucoes',
  asyncHandler(async (req, res) => {
    try {
      const { de, ate } = req.body || {};
      const r = await bot.solicitarExecucao({
        solicitadoPor: req.body?.host ? `bot@${req.body.host}` : 'bot',
        origem: req.body?.origem === 'agendado' ? 'agendado' : 'manual',
        parametros: dataIso(de) && dataIso(ate) ? { de, ate } : null,
      });
      return successResponse(res, r);
    } catch (e) {
      return tratar(res, e);
    }
  }),
);

agente.post(
  '/execucoes/:id/log',
  asyncHandler(async (req, res) => {
    try {
      const linhas = req.body?.linhas || req.body?.linha || req.body;
      return successResponse(res, await bot.registrarLog(Number(req.params.id), linhas));
    } catch (e) {
      return tratar(res, e);
    }
  }),
);

agente.post(
  '/execucoes/:id/pdf',
  (req, res, next) =>
    upload.single('arquivo')(req, res, (err) => (err ? errorResponse(res, err.message, 400, 'UPLOAD') : next())),
  asyncHandler(async (req, res) => {
    try {
      if (!req.file) return errorResponse(res, 'Envie o PDF no campo "arquivo".', 400);
      let meta = {};
      try {
        meta = req.body?.meta ? JSON.parse(req.body.meta) : {};
      } catch {
        meta = {};
      }
      const r = await bot.importarPdf(Number(req.params.id), { buffer: req.file.buffer, nome: req.file.originalname, meta });
      return successResponse(res, r);
    } catch (e) {
      return tratar(res, e);
    }
  }),
);

// comprovante de uma saída (PDF do portal) → bucket + fluxo_caixa_comprovantes
agente.post(
  '/execucoes/:id/comprovante',
  (req, res, next) =>
    upload.single('arquivo')(req, res, (err) => (err ? errorResponse(res, err.message, 400, 'UPLOAD') : next())),
  asyncHandler(async (req, res) => {
    try {
      if (!req.file) return errorResponse(res, 'Envie o PDF no campo "arquivo".', 400);
      let meta = {};
      try {
        meta = req.body?.meta ? JSON.parse(req.body.meta) : {};
      } catch {
        meta = {};
      }
      const r = await salvarComprovante({ ...meta, buffer: req.file.buffer, nome: req.file.originalname, execucaoId: Number(req.params.id) });
      return successResponse(res, r);
    } catch (e) {
      return tratar(res, e);
    }
  }),
);

agente.post(
  '/execucoes/:id/extrato-json',
  asyncHandler(async (req, res) => {
    try {
      const { conta, entradas, saldo, periodo } = req.body || {};
      if (!conta || !Array.isArray(entradas)) return errorResponse(res, 'Envie { conta, entradas[], saldo?, periodo{de,ate} }.', 400);
      return successResponse(res, await bot.importarJson(Number(req.params.id), { conta, entradas, saldo, periodo }));
    } catch (e) {
      return tratar(res, e);
    }
  }),
);

agente.post(
  '/execucoes/:id/saldos',
  asyncHandler(async (req, res) => {
    try {
      return successResponse(res, await bot.gravarSaldos(Number(req.params.id), req.body?.saldos || [], { data: dataIso(req.body?.data) }));
    } catch (e) {
      return tratar(res, e);
    }
  }),
);

// o bot chama no fim da execução: saldo + extrato Pagar.me com log na mesma execução
agente.post(
  '/execucoes/:id/pagarme',
  asyncHandler(async (req, res) => {
    try {
      const { de, ate } = req.body || {};
      const r = await executarPagarme({ execucaoId: Number(req.params.id), de: dataIso(de) || undefined, ate: dataIso(ate) || undefined });
      return successResponse(res, r);
    } catch (e) {
      return tratar(res, e);
    }
  }),
);

agente.post(
  '/execucoes/:id/finalizar',
  asyncHandler(async (req, res) => {
    try {
      const { status, resumo, erro } = req.body || {};
      return successResponse(res, await bot.finalizarExecucao(Number(req.params.id), { status, resumo, erro }));
    } catch (e) {
      return tratar(res, e);
    }
  }),
);

router.use('/agente', agente);
router.use('/', tela);

export default router;
