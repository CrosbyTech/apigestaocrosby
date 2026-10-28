// ============================================================
// SOLICITAÇÕES CROSBY — setor PATRIMONIO (prefixo /api/solicitacoes-patrimonio)
//
// Conciliação das solicitações de PRODUTO (pagas no cartão pelo Jesus) com o
// extrato bancário. Usuário logado no HeadCoach (Bearer Supabase); a tela
// só mostra os botões para gestor/financeiro.
//
//   GET  /conciliar                 → simulação da varredura (todas as pendentes)
//   POST /conciliar {dryRun?, ids?} → varre e concilia as que casam sozinhas
//   GET  /:id/candidatos            → saídas do extrato com o valor da solicitação
//   POST /:id/conciliar {lancamentoId} → escolha manual
//   POST /:id/desfazer-conciliacao  → volta para aguardando_conciliacao
// ============================================================
import express from 'express';
import { asyncHandler, successResponse, errorResponse } from '../utils/errorHandler.js';
import { requireAuth } from '../middlewares/auth.js';
import { conciliarPatrimonio, candidatosDaSolicitacao, conciliarManual, desfazerConciliacao } from '../services/conciliacaoPatrimonio.js';

const router = express.Router();
router.use(requireAuth);

const quem = (req) => `${req.user?.name || req.user?.email || 'tela'}`;
const tratar = (res, e) => {
  console.error('[solicitacoes-patrimonio]', e?.message || e);
  return errorResponse(res, e?.message || 'Erro na conciliação de patrimônio', 400, 'CONCILIACAO_PATRIMONIO');
};

router.get(
  '/conciliar',
  asyncHandler(async (req, res) => {
    try {
      return successResponse(res, await conciliarPatrimonio({ dryRun: true }));
    } catch (e) {
      return tratar(res, e);
    }
  }),
);

router.post(
  '/conciliar',
  asyncHandler(async (req, res) => {
    try {
      const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : null;
      const r = await conciliarPatrimonio({ dryRun: !!req.body?.dryRun, ids, usuario: `conciliação de patrimônio (${quem(req)})` });
      return successResponse(res, r, r.dryRun ? 'Simulação' : `${r.conciliadas} solicitação(ões) conciliada(s)`);
    } catch (e) {
      return tratar(res, e);
    }
  }),
);

router.get(
  '/:id/candidatos',
  asyncHandler(async (req, res) => {
    try {
      return successResponse(res, await candidatosDaSolicitacao(req.params.id));
    } catch (e) {
      return tratar(res, e);
    }
  }),
);

router.post(
  '/:id/conciliar',
  asyncHandler(async (req, res) => {
    try {
      const lancamentoId = Number(req.body?.lancamentoId);
      if (!lancamentoId) return errorResponse(res, 'Informe o lançamento do extrato (lancamentoId).', 400, 'VALIDATION');
      const r = await conciliarManual({ solicitacaoId: req.params.id, lancamentoId, usuario: quem(req) });
      return successResponse(res, r, 'Solicitação conciliada com o extrato');
    } catch (e) {
      return tratar(res, e);
    }
  }),
);

router.post(
  '/:id/desfazer-conciliacao',
  asyncHandler(async (req, res) => {
    try {
      const r = await desfazerConciliacao({ solicitacaoId: req.params.id, usuario: quem(req) });
      return successResponse(res, r, 'Conciliação desfeita');
    } catch (e) {
      return tratar(res, e);
    }
  }),
);

export default router;
