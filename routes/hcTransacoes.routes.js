// ============================================================================
// /api/hc — módulo HEADCOACH (dados do próprio HeadCoach, sem o TOTVS)
//   GET /transacoes          lista com os filtros do TRAFL016 (só leitura)
//                            ?de&ate&empresa&numero&cliente&vendedor&operacao
//                            &valorMin&valorMax&descontoMin&descontoMax
//                            &encerramentoDe&encerramentoAte&tipo=E|S
//                            &situacao=andamento,atendida,cancelada&origem&nf
//                            &pagina&porPagina
//   GET /transacoes/:id      detalhe (V45 = venda 45, D28 = devolução 28)
//   PUT /transacoes/:id/vendedor   troca o vendedor da transação — SÓ OWNER
//                            body: { vendedorCode, vendedorNome, motivo? }
// Exige usuário logado no HeadCoach (JWT da sessão) — são dados financeiros.
// ============================================================================
import express from 'express';
import { asyncHandler, successResponse, errorResponse } from '../utils/errorHandler.js';
import { requireAuth, requireRole } from '../middlewares/auth.js';
import { listarTransacoes, detalheTransacao, HcTransacaoError } from '../services/hcTransacoes.js';
import { empresasRestritasDoUsuario } from '../utils/empresasUsuario.js';
import { alterarVendedorDaTransacao, historicoDeVendedor, VendedorTransacaoError } from '../services/hcTransacaoVendedor.js';
import { limparCacheFaturamentoVendedor } from '../totvsrouter/painelVendas.js';

const router = express.Router();
router.use(requireAuth);

const responder = (res, err) => {
  if (err instanceof HcTransacaoError || err instanceof VendedorTransacaoError) return errorResponse(res, err.message, err.status, err.code);
  console.error('[hc/transacoes]', err);
  return errorResponse(res, err.message || 'Erro ao consultar as transações', 500, 'HC_TRANSACOES');
};

router.get(
  '/transacoes',
  asyncHandler(async (req, res) => {
    try {
      // vendedor só vê as transações da(s) própria(s) empresa(s) (Yago, 13/11/2026)
      const query = { ...(req.query || {}) };
      const permitidas = await empresasRestritasDoUsuario(req.user);
      if (permitidas) {
        const pedidas = String(query.empresa || '')
          .split(/[,;\s]+/)
          .map(Number)
          .filter((n) => Number.isFinite(n) && n > 0);
        const usar = pedidas.length ? pedidas.filter((n) => permitidas.includes(n)) : permitidas;
        query.empresa = usar.length ? usar.join(',') : '-1';
      }
      const r = await listarTransacoes(query);
      return successResponse(res, r, `${r.resumo.transacoes} transação(ões)`);
    } catch (err) {
      return responder(res, err);
    }
  }),
);

router.get(
  '/transacoes/:id',
  asyncHandler(async (req, res) => {
    try {
      const r = await detalheTransacao(req.params.id);
      const permitidas = await empresasRestritasDoUsuario(req.user);
      if (permitidas && !permitidas.includes(Number(r?.empresa))) return errorResponse(res, 'Transação não encontrada', 404, 'NOT_FOUND');
      // trocas de vendedor já feitas nesta transação (a tela mostra o histórico)
      r.vendedorAlteracoes = await historicoDeVendedor(req.params.id);
      return successResponse(res, r, 'Transação');
    } catch (err) {
      return responder(res, err);
    }
  }),
);

// Troca o vendedor da transação (Yago, 19/11/2026) — só o owner. Vale para o
// ranking, o New Forecast e o contas a receber: ver services/hcTransacaoVendedor.js.
router.put(
  '/transacoes/:id/vendedor',
  requireRole('owner'),
  asyncHandler(async (req, res) => {
    try {
      const b = req.body || {};
      const r = await alterarVendedorDaTransacao(req.params.id, { vendedorCode: b.vendedorCode, vendedorNome: b.vendedorNome, motivo: b.motivo, user: req.user });
      // o faturamento por vendedor fica 30 min em memória: esvazia para recalcular já
      r.guardados.cacheMemoria = limparCacheFaturamentoVendedor();
      return successResponse(res, r, `Vendedor da transação ${r.transacao} alterado para ${r.para.nome}`);
    } catch (err) {
      return responder(res, err);
    }
  }),
);

export default router;
