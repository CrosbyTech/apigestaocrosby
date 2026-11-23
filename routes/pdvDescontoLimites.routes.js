// ============================================================================
// HEADCOACH › FINANCEIRO › LIBERAÇÃO DE DESCONTO — /api/pdv-crosby/descontos
//
//   GET  /meu         limite de quem está logado (o PDV Crosby usa)   — qualquer login
//   POST /autorizar   { email, senha, pct, empresa? } outro usuário libera o desconto
//                     até o limite dele (gerente 30%, owner/admin tudo) — qualquer login
//   GET  /            usuários do Varejo com loja + limite + lojas     — owner/admin
//   PUT  /            { escopo: 'usuario'|'loja'|'todos', userId?, empresa?, pct } — owner/admin
//   GET  /historico   últimas mudanças                                 — owner/admin
//
// Regras em services/pdvDescontoLimites.js.
// ============================================================================
import express from 'express';
import { asyncHandler, successResponse, errorResponse } from '../utils/errorHandler.js';
import { requireAuth, requireRole } from '../middlewares/auth.js';
import { listarLimites, limiteDoUsuario, definirLimite, historicoDosLimites, autorizarDesconto, DescontoLimiteError } from '../services/pdvDescontoLimites.js';

const router = express.Router();
const responde = (res, err) => (err instanceof DescontoLimiteError ? errorResponse(res, err.message, err.status, err.code) : errorResponse(res, err?.message || 'Erro no limite de desconto', 500, 'DESCONTO_LIMITE'));
const fmtPct = (n) => `${String(Number(n)).replace('.', ',')}%`;

router.use(requireAuth);

router.get(
  '/meu',
  asyncHandler(async (req, res) => successResponse(res, await limiteDoUsuario(req.user), 'Limite de desconto')),
);

router.post(
  '/autorizar',
  asyncHandler(async (req, res) => {
    try {
      const { email, senha, pct, empresa } = req.body || {};
      const r = await autorizarDesconto({ email, senha, pct, empresa, pedidoPor: req.user?.email || req.user?.name || null });
      return successResponse(res, r, 'Desconto liberado');
    } catch (err) {
      return responde(res, err);
    }
  }),
);

router.get(
  '/',
  requireRole('owner', 'admin'),
  asyncHandler(async (req, res) => {
    try {
      const dados = await listarLimites({ fresco: req.query.atualizar === '1' });
      return successResponse(res, dados, `${dados.usuarios.length} usuário(s) do Varejo com loja`);
    } catch (err) {
      return responde(res, err);
    }
  }),
);

router.put(
  '/',
  requireRole('owner', 'admin'),
  asyncHandler(async (req, res) => {
    try {
      const { escopo, userId, empresa, pct } = req.body || {};
      const r = await definirLimite({ escopo, userId, empresa, pct, por: { id: req.user.id, nome: req.user.name || req.user.email } });
      const n = r.alterados.length;
      return successResponse(res, r, n ? `Limite de ${fmtPct(r.pct)} gravado para ${n} usuário${n > 1 ? 's' : ''}` : `Nada mudou: já estava em ${fmtPct(r.pct)}`);
    } catch (err) {
      return responde(res, err);
    }
  }),
);

router.get(
  '/historico',
  requireRole('owner', 'admin'),
  asyncHandler(async (req, res) => {
    try {
      const itens = await historicoDosLimites({ limite: req.query.limite });
      return successResponse(res, { itens }, `${itens.length} mudança(s)`);
    } catch (err) {
      return responde(res, err);
    }
  }),
);

export default router;
