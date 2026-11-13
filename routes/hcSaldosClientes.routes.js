// ============================================================================
// /api/hc/saldos-clientes — HEADCOACH › SALDOS DE CLIENTES (CREDEV e
// adiantamento do HeadCoach; services/hcSaldosClientes.js). Exige login.
//   GET  /?empresa&busca&todos=1        clientes com saldo (todos=1 inclui zerados)
//   GET  /cliente/:code?empresa         saldo + extrato do cliente
//   POST /sincronizar-devolucoes        credita as devoluções atendidas que faltam (owner/admin)
//   POST /gerar                         { empresa, clienteCode, clienteNome, tipo: credev|adiantamento, valor, motivo, senha } (owner/admin)
// ============================================================================
import express from 'express';
import { asyncHandler, successResponse, errorResponse } from '../utils/errorHandler.js';
import { requireAuth } from '../middlewares/auth.js';
import { empresasRestritasDoUsuario } from '../utils/empresasUsuario.js';
import { SaldoClienteError, listarSaldos, saldoDoCliente, extratoDoCliente, sincronizarDevolucoes, gerarCredito } from '../services/hcSaldosClientes.js';

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

// só as empresas que a pessoa pode ver (utils/empresasUsuario.js; null = todas)
async function permitidas(req, empresa = null) {
  const codes = await empresasRestritasDoUsuario(req.user);
  if (codes && empresa && !codes.includes(Number(empresa))) throw new SaldoClienteError(`Você não tem acesso à empresa ${empresa}`, 'SEM_ACESSO_EMPRESA', 403);
  return codes;
}

router.get(
  '/',
  rota(async (req) => {
    const codes = await permitidas(req, req.query.empresa || null);
    if (codes && !codes.length) return { lista: [], totais: { clientes: 0, credev: 0, adiantamento: 0 } };
    return listarSaldos({ empresa: req.query.empresa || null, empresas: codes, busca: req.query.busca || '', comSaldo: req.query.todos !== '1' });
  }, (r) => `${r.totais.clientes} cliente(s)`),
);
router.get(
  '/cliente/:code',
  rota(async (req) => {
    const code = parseInt(req.params.code, 10);
    if (!code) throw new SaldoClienteError('Informe o cliente');
    const empresa = parseInt(req.query.empresa, 10) || 99;
    await permitidas(req, empresa);
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

router.post(
  '/gerar',
  rota((req) => gerarCredito(req.user, req.body || {}), (r) => `${r.tipo === 'credev' ? 'CREDEV' : 'Adiantamento'} de R$ ${r.valor.toFixed(2).replace('.', ',')} gerado — saldo agora R$ ${Number(r.saldo).toFixed(2).replace('.', ',')}`),
);

export default router;
