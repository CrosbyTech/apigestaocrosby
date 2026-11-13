// ============================================================================
// /api/recebimento-mercadoria — RECEBIMENTO DE MERCADORIA TRANSFERIDA + ESTOQUE
// DAS LOJAS (services/recebimentoTransferencia.js). Exige login.
//   GET  /transferencias?empresa        transferências para as lojas do usuário (a receber / recebidas)
//   GET  /transferencias/:id            peças da transferência (para conferir) + recebimento
//   POST /transferencias/:id/receber    { epcs[], manuais: { productCode: qtd }, observacao }
//   GET  /estoque?empresa&busca         saldo da loja por produto
// ============================================================================
import express from 'express';
import { asyncHandler, successResponse, errorResponse } from '../utils/errorHandler.js';
import { requireAuth } from '../middlewares/auth.js';
import { RecebimentoError, listarTransferencias, detalheTransferencia, receberTransferencia, estoque } from '../services/recebimentoTransferencia.js';

const router = express.Router();
router.use(requireAuth);

const rota = (fn, msg) =>
  asyncHandler(async (req, res) => {
    try {
      const r = await fn(req);
      return successResponse(res, r, typeof msg === 'function' ? msg(r) : msg);
    } catch (err) {
      if (err instanceof RecebimentoError) return errorResponse(res, err.message, err.status, err.code);
      console.error('[recebimento-mercadoria]', err);
      return errorResponse(res, err.message || 'Erro no recebimento', 500, 'RECEBIMENTO');
    }
  });

router.get('/transferencias', rota((req) => listarTransferencias(req.user, req.query || {}), 'Transferências'));
router.get('/transferencias/:id', rota((req) => detalheTransferencia(req.user, req.params.id), 'Transferência'));
router.post(
  '/transferencias/:id/receber',
  rota((req) => receberTransferencia(req.user, req.params.id, req.body || {}), (r) => `Mercadoria recebida: ${r.qtd_recebida} peça(s) no estoque${r.qtd_faltando ? ` · faltaram ${r.qtd_faltando}` : ''}`),
);
router.get('/estoque', rota((req) => estoque(req.user, req.query || {}), 'Estoque'));

export default router;
