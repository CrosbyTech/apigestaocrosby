// ============================================================================
// /api/hc/saldos-clientes — HEADCOACH › SALDOS DE CLIENTES (CREDEV e
// adiantamento do HeadCoach; services/hcSaldosClientes.js). Exige login.
//   GET  /?empresa&busca&todos=1        clientes com saldo (todos=1 inclui zerados)
//   GET  /cliente/:code?empresa         saldo + extrato do cliente
//   POST /sincronizar-devolucoes        credita as devoluções atendidas que faltam (owner/admin)
// ============================================================================
import express from 'express';
import { asyncHandler, successResponse, errorResponse } from '../utils/errorHandler.js';
import { requireAuth } from '../middlewares/auth.js';
import { SaldoClienteError, listarSaldos, saldoDoCliente, extratoDoCliente, sincronizarDevolucoes } from '../services/hcSaldosClientes.js';

const router = express.Router();
router.use(requireAuth);

const rota = (fn, msg) =>
  asyncHandler(async (req, res) => {
    try {
      const r = await fn(req);
      return successResponse(res, r, typeof msg === 'function' ? msg(r) : msg);
    } catch (err) {
      if (err instanceof SaldoClienteError) return errorResponse(res, err.message, err.status, err.code);
      console.error('[hc/saldos-clientes]', err);
      return errorResponse(res, err.message || 'Erro nos saldos de clientes', 500, 'HC_SALDOS');
    }
  });

router.get(
  '/',
  rota((req) => listarSaldos({ empresa: req.query.empresa || null, busca: req.query.busca || '', comSaldo: req.query.todos !== '1' }), (r) => `${r.totais.clientes} cliente(s)`),
);
router.get(
  '/cliente/:code',
  rota(async (req) => {
    const code = parseInt(req.params.code, 10);
    if (!code) throw new SaldoClienteError('Informe o cliente');
    const empresa = parseInt(req.query.empresa, 10) || 99;
    const [saldo, extrato] = await Promise.all([saldoDoCliente(code, empresa), extratoDoCliente(code, empresa)]);
    return { saldo, extrato };
  }, 'Saldo do cliente'),
);
router.post(
  '/sincronizar-devolucoes',
  rota(async (req) => {
    if (!['owner', 'admin'].includes(req.user?.role)) throw new SaldoClienteError('Só owner ou admin', 'SEM_PERMISSAO', 403);
    return sincronizarDevolucoes();
  }, (r) => `${r.creditadas} devolução(ões) creditada(s), ${r.descreditadas} desfeita(s)`),
);

export default router;
